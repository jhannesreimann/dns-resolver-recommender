"""Telemetry storage: SQLite database for measurement data collection.

Stores per-test-run metadata and per-resolver latency measurements. No raw IP
addresses are stored -- ASN and country are looked up from the local GeoLite2
database and the IP is discarded immediately. The raw User-Agent is never stored
either: it is parsed into coarse, non-identifying browser and OS families.
"""

from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Any
import psycopg

from dnsrr.database import PostgresDatabase

logger = logging.getLogger(__name__)

def _parse_user_agent(ua: str | None) -> dict[str, str | None]:
    """Parse a User-Agent string into coarse, non-identifying research fields.

    Returns the browser family (e.g. Chrome, Firefox, Safari), the browser major
    version, and the OS family (e.g. Windows, macOS, Linux, Android, iOS). The raw
    User-Agent is intentionally discarded: these low-cardinality categories answer
    "which browser/OS did users run" for research without acting as a per-device
    fingerprint, so the stored data stays anonymous rather than pseudonymous.
    """
    result: dict[str, str | None] = {"browser": None, "version": None, "os": None}
    if not ua:
        return result

    # OS family. Order matters: Android contains "Linux", iOS contains "like Mac".
    if "Windows NT" in ua:
        result["os"] = "Windows"
    elif "Android" in ua:
        result["os"] = "Android"
    elif "iPhone" in ua or "iPad" in ua or "iPod" in ua:
        result["os"] = "iOS"
    elif "CrOS" in ua:
        result["os"] = "ChromeOS"
    elif "Mac OS X" in ua or "Macintosh" in ua:
        result["os"] = "macOS"
    elif "Linux" in ua:
        result["os"] = "Linux"

    # Browser family. Order matters: Edge/Opera/branded Chromium must be checked
    # before Chrome, and Chrome before Safari (Chrome UAs also contain "Safari").
    browser_patterns = [
        ("Edge", r"Edg(?:e|A|iOS)?/(\d+)"),
        ("Opera", r"(?:OPR|Opera)/(\d+)"),
        ("Samsung Internet", r"SamsungBrowser/(\d+)"),
        ("Chrome", r"CriOS/(\d+)"),
        ("Firefox", r"FxiOS/(\d+)"),
        ("Firefox", r"Firefox/(\d+)"),
        ("Chrome", r"(?:Chrome|Chromium)/(\d+)"),
        ("Safari", r"Version/(\d+)[\d.]*\s+(?:Mobile/\S+\s+)?Safari"),
    ]
    for name, pattern in browser_patterns:
        match = re.search(pattern, ua)
        if match:
            result["browser"] = name
            result["version"] = match.group(1)
            break

    return result


def _lookup_ip_geolite2(ip_address: str, geoip_db: str, country_db: str) -> dict[str, Any] | None:
    """Try GeoLite2 local database lookup. Returns None if unavailable."""
    try:
        import geoip2.database  # type: ignore
        result: dict[str, Any] = {"asn": None, "asn_org": None, "country": None}

        if os.path.isfile(geoip_db):
            with geoip2.database.Reader(geoip_db) as reader:
                asn_resp = reader.asn(ip_address)
                result["asn"] = asn_resp.autonomous_system_number
                result["asn_org"] = asn_resp.autonomous_system_organization

        if os.path.isfile(country_db):
            with geoip2.database.Reader(country_db) as reader:
                country_resp = reader.country(ip_address)
                result["country"] = country_resp.country.iso_code

        if result["country"] or result["asn"]:
            return result
    except ImportError:
        logger.debug("geoip2 not installed")
    except Exception:
        logger.debug("GeoLite2 lookup failed", exc_info=True)
    return None


def _lookup_ip(ip_address: str) -> dict[str, Any]:
    """Look up ASN and country from IP using the local GeoLite2 database.

    The raw IP address is never stored, logged, or sent to any third party: it is
    used only in-memory for this offline lookup and then discarded.
    """
    geoip_db = os.environ.get("GEOLITE2_ASN_DB", "/var/lib/GeoIP/GeoLite2-ASN.mmdb")
    country_db = os.environ.get("GEOLITE2_COUNTRY_DB", "/var/lib/GeoIP/GeoLite2-Country.mmdb")

    result = _lookup_ip_geolite2(ip_address, geoip_db, country_db)
    if result:
        return result

    return {"asn": None, "asn_org": None, "country": None}


def _get_client_ip(request_headers: dict, client_host: str | None) -> str:
    """Extract client IP from X-Forwarded-For header or direct connection."""
    forwarded = request_headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return client_host or "0.0.0.0"


def _get_ip_version(ip: str) -> int:
    """Return 4 or 6 for the given IP address string."""
    return 6 if ":" in ip else 4


def store_telemetry(db: PostgresDatabase, payload: dict, request_headers: dict,
                    client_host: str | None, client_http_version: str = "") -> dict:
    """Store a complete measurement run in the database.

    Args:
        payload: The telemetry JSON from the frontend.
        request_headers: HTTP request headers (for IP extraction).
        client_host: Direct client host from the request.

    Returns:
        dict with status and run_id.
    """
    client_ip = _get_client_ip(request_headers, client_host)
    geo = _lookup_ip(client_ip)
    ip_version = _get_ip_version(client_ip)

    resolver_data = payload.get("resolvers", [])
    total = len(resolver_data)
    # cors = dynamically detected CORS-capable (browser-side probe succeeded)
    cors_count = sum(1 for r in resolver_data if r.get("cors"))
    opaque_count = sum(1 for r in resolver_data if not r.get("cors"))
    valid = [r for r in resolver_data if r.get("cachedAvgMs") is not None and r.get("uncachedAvgMs") is not None]
    dead_count = total - len([r for r in resolver_data if r.get("cachedAvgMs") is not None or r.get("uncachedAvgMs") is not None])

    # Verification breakdown
    ver_statuses = [r.get("verificationStatus", "") for r in resolver_data]
    verified_dns_count = sum(1 for s in ver_statuses if s == "verified_dns")
    verified_auth_count = sum(1 for s in ver_statuses if s == "verified_auth")
    unverified_count = sum(1 for s in ver_statuses if s == "unverified")

    # Paradox: uncached faster than cached (both must be valid measurements)
    paradox_count = sum(1 for r in valid
                        if r["uncachedAvgMs"] < r["cachedAvgMs"])

    avg_cached = sum(r["cachedAvgMs"] for r in valid) / len(valid) if valid else None
    avg_uncached = sum(r["uncachedAvgMs"] for r in valid) / len(valid) if valid else None

    db_conn = db.connect()
    ua = _parse_user_agent(payload.get("userAgent"))

    try:
        cursor = db_conn.execute(
            """INSERT INTO runs (timestamp, asn, asn_org, country, browser_family,
               browser_major, os_family, browser_lang, total_resolvers, cors_count,
               opaque_count, dead_count, verified_dns_count, verified_auth_count,
               unverified_count, paradox_count, avg_cached_ms, avg_uncached_ms,
               client_http_version, client_ip_version)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
               RETURNING id;""",
            (
                # Europe/Berlin timestamp with correct DST offset (+01:00 or +02:00)
                datetime.now(ZoneInfo("Europe/Berlin")).isoformat(),
                geo["asn"],
                geo["asn_org"],
                geo["country"],
                ua["browser"],
                ua["version"],
                ua["os"],
                payload.get("browserLang"),
                total,
                cors_count,
                opaque_count,
                dead_count,
                verified_dns_count,
                verified_auth_count,
                unverified_count,
                paradox_count,
                avg_cached,
                avg_uncached,
                client_http_version,
                ip_version,
            ),
        ).fetchone()
        if cursor is not None:
            run_id = cursor[0]
        else:
            raise Exception("Cannot get run_id")

        for r in resolver_data:
            db_conn.execute(
                """INSERT INTO measurements (run_id, resolver_id, resolver_name,
                   resolver_url, cached_avg_ms, uncached_avg_ms, score_ms, cors,
                   dnssec, no_logs, no_filter, resolver_country, verification_status,
                   paradox, cached_times, uncached_times, doh_http_version)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (
                    run_id,
                    r.get("id", "unknown"),
                    r.get("name", "unknown"),
                    r.get("url", ""),
                    r.get("cachedAvgMs"),
                    r.get("uncachedAvgMs"),
                    r.get("scoreMs"),
                    1 if r.get("cors") else 0,
                    1 if r.get("dnssec") else 0,
                    1 if r.get("noLogs") else 0,
                    1 if r.get("noFilter") else 0,
                    r.get("country"),
                    r.get("verificationStatus"),
                    1 if (r.get("uncachedAvgMs") is not None and r.get("cachedAvgMs") is not None
                          and r["uncachedAvgMs"] < r["cachedAvgMs"]) else 0,
                    json.dumps(r.get("cachedTimes", [])) if r.get("cachedTimes") else None,
                    json.dumps(r.get("uncachedTimes", [])) if r.get("uncachedTimes") else None,
                    r.get("dohHttpVersion"),
                ),
            )

        db_conn.commit()
        logger.info("Stored run %s: %d resolvers, %d CORS-capable, %d verified-dns, %d verified-auth, %d paradox, geo=%s/%s",
                     run_id, total, cors_count, verified_dns_count, verified_auth_count, paradox_count, geo.get("country"), geo.get("asn_org"))

        return {"status": "ok", "run_id": run_id}

    except Exception:
        db_conn.rollback()
        logger.exception("Failed to store telemetry data")
        raise
    finally:
        db_conn.close()


def _rows_to_dicts(cursor) -> list[dict]:
    """Convert a psycopg cursor's results to a list of dicts keyed by column name."""
    cols = [desc[0] for desc in cursor.description] if cursor.description else []
    return [dict(zip(cols, row)) for row in cursor]


def get_stats(db: PostgresDatabase) -> dict:
    """Return aggregate statistics for the dashboard/research."""
    db_conn = db.connect()

    total_runs = -1
    total_measurements = -1
    try:
        _total_runs_output = db_conn.execute("SELECT COUNT(*) AS c FROM runs;").fetchone()
        if _total_runs_output is not None:
            total_runs = _total_runs_output[0]

        _total_measurements_output = db_conn.execute("SELECT COUNT(*) as c FROM measurements").fetchone()
        if _total_measurements_output is not None:
            total_measurements = _total_measurements_output[0]

        # Fastest resolvers (median score across all runs)
        top_cur = db_conn.execute("""
SELECT
    resolver_name, resolver_url, ROUND(CAST(AVG(score_ms) as numeric),1) as avg_score,
    COUNT(*) as runs, ROUND(CAST(AVG(cached_avg_ms) as numeric),1) as avg_cached,
    ROUND(CAST(AVG(uncached_avg_ms) as numeric),1) as avg_uncached
FROM measurements
WHERE score_ms IS NOT NULL
GROUP BY resolver_id, resolver_name, resolver_url
ORDER BY avg_score ASC LIMIT 10
""".strip())
        top = _rows_to_dicts(top_cur)

        # CORS distribution
        cors_cur = db_conn.execute(
            "SELECT cors, COUNT(*) as c FROM measurements GROUP BY cors"
        )
        cors_stats = _rows_to_dicts(cors_cur)

        # Country distribution
        country_cur = db_conn.execute(
            "SELECT country, COUNT(*) as runs FROM runs WHERE country IS NOT NULL GROUP BY country ORDER BY runs DESC LIMIT 10"
        )
        country_stats = _rows_to_dicts(country_cur)

        # Recent runs
        recent_cur = db_conn.execute(
            "SELECT id, timestamp, country, asn_org, total_resolvers, cors_count, verified_dns_count, verified_auth_count, unverified_count, paradox_count, ROUND(CAST(avg_cached_ms as numeric),1) as avg_cached, ROUND(CAST(avg_uncached_ms as numeric),1) as avg_uncached, client_http_version, client_ip_version FROM runs ORDER BY id DESC LIMIT 20"
        )
        recent = _rows_to_dicts(recent_cur)

        return {
            "status": "ok",
            "total_runs": total_runs,
            "total_measurements": total_measurements,
            "top_resolvers": top,
            "cors_distribution": cors_stats,
            "country_distribution": country_stats,
            "recent_runs": recent,
        }
    finally:
        db_conn.close()
