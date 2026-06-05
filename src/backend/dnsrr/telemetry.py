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
import sqlite3
import time
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

DEFAULT_DB_PATH = "/var/lib/dnsrr/telemetry.db"

_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    asn INTEGER,
    asn_org TEXT,
    country TEXT,
    browser_family TEXT,
    browser_major TEXT,
    os_family TEXT,
    browser_lang TEXT,
    total_resolvers INTEGER NOT NULL,
    cors_count INTEGER NOT NULL,
    opaque_count INTEGER NOT NULL,
    dead_count INTEGER NOT NULL,
    verified_dns_count INTEGER NOT NULL DEFAULT 0,
    verified_auth_count INTEGER NOT NULL DEFAULT 0,
    unverified_count INTEGER NOT NULL DEFAULT 0,
    paradox_count INTEGER NOT NULL DEFAULT 0,
    avg_cached_ms REAL,
    avg_uncached_ms REAL
);

CREATE TABLE IF NOT EXISTS measurements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    resolver_id TEXT NOT NULL,
    resolver_name TEXT NOT NULL,
    resolver_url TEXT NOT NULL,
    cached_avg_ms REAL,
    uncached_avg_ms REAL,
    score_ms REAL,
    cors INTEGER NOT NULL,
    dnssec INTEGER NOT NULL,
    no_logs INTEGER NOT NULL,
    no_filter INTEGER NOT NULL,
    resolver_country TEXT,
    verification_status TEXT,
    paradox INTEGER NOT NULL DEFAULT 0,
    cached_times TEXT,
    uncached_times TEXT
);

CREATE INDEX IF NOT EXISTS idx_measurements_run ON measurements(run_id);
CREATE INDEX IF NOT EXISTS idx_measurements_resolver ON measurements(resolver_id);
CREATE INDEX IF NOT EXISTS idx_measurements_score ON measurements(score_ms);
CREATE INDEX IF NOT EXISTS idx_runs_timestamp ON runs(timestamp);
"""


def _get_db_path() -> str:
    return os.environ.get("TELEMETRY_DB_PATH", DEFAULT_DB_PATH)


def _ensure_db(db_path: str) -> None:
    """Create database directory and initialize schema if needed."""
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.executescript(_SCHEMA_SQL)
    conn.commit()

    # Migrate: add columns that may not exist in older databases
    _migrate_add_column(conn, "runs", "verified_dns_count", "INTEGER NOT NULL DEFAULT 0")
    _migrate_add_column(conn, "runs", "verified_auth_count", "INTEGER NOT NULL DEFAULT 0")
    _migrate_add_column(conn, "runs", "unverified_count", "INTEGER NOT NULL DEFAULT 0")
    _migrate_add_column(conn, "runs", "paradox_count", "INTEGER NOT NULL DEFAULT 0")
    _migrate_add_column(conn, "runs", "browser_family", "TEXT")
    _migrate_add_column(conn, "runs", "browser_major", "TEXT")
    _migrate_add_column(conn, "runs", "os_family", "TEXT")
    _migrate_add_column(conn, "measurements", "paradox", "INTEGER NOT NULL DEFAULT 0")

    conn.close()


def _migrate_add_column(conn: sqlite3.Connection, table: str, column: str, col_type: str) -> None:
    """Add a column to a table if it does not already exist."""
    existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
    if column not in existing:
        logger.info("Migrating %s: adding column %s %s", table, column, col_type)
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}")
        conn.commit()


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


def store_telemetry(payload: dict, request_headers: dict, client_host: str | None) -> dict:
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

    db_path = _get_db_path()
    _ensure_db(db_path)
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")

    ua = _parse_user_agent(payload.get("userAgent"))

    try:
        cursor = conn.execute(
            """INSERT INTO runs (timestamp, asn, asn_org, country, browser_family,
               browser_major, os_family, browser_lang, total_resolvers, cors_count,
               opaque_count, dead_count, verified_dns_count, verified_auth_count,
               unverified_count, paradox_count, avg_cached_ms, avg_uncached_ms)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
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
            ),
        )
        run_id = cursor.lastrowid

        for r in resolver_data:
            conn.execute(
                """INSERT INTO measurements (run_id, resolver_id, resolver_name,
                   resolver_url, cached_avg_ms, uncached_avg_ms, score_ms, cors,
                   dnssec, no_logs, no_filter, resolver_country, verification_status,
                   paradox, cached_times, uncached_times)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
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
                ),
            )

        conn.commit()
        logger.info("Stored run %s: %d resolvers, %d CORS-capable, %d verified-dns, %d verified-auth, %d paradox, geo=%s/%s",
                     run_id, total, cors_count, verified_dns_count, verified_auth_count, paradox_count, geo.get("country"), geo.get("asn_org"))

        return {"status": "ok", "run_id": run_id}

    except Exception:
        conn.rollback()
        logger.exception("Failed to store telemetry data")
        raise
    finally:
        conn.close()


def get_stats() -> dict:
    """Return aggregate statistics for the dashboard/research."""
    db_path = _get_db_path()
    _ensure_db(db_path)

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        total_runs = conn.execute("SELECT COUNT(*) as c FROM runs").fetchone()["c"]
        total_measurements = conn.execute("SELECT COUNT(*) as c FROM measurements").fetchone()["c"]

        # Fastest resolvers (median score across all runs)
        top = conn.execute(
            """SELECT resolver_name, resolver_url, ROUND(AVG(score_ms),1) as avg_score,
               COUNT(*) as runs, ROUND(AVG(cached_avg_ms),1) as avg_cached,
               ROUND(AVG(uncached_avg_ms),1) as avg_uncached
               FROM measurements WHERE score_ms IS NOT NULL
               GROUP BY resolver_id HAVING runs >= 2
               ORDER BY avg_score ASC LIMIT 10"""
        ).fetchall()

        # CORS distribution
        cors_stats = conn.execute(
            "SELECT cors, COUNT(*) as c FROM measurements GROUP BY cors"
        ).fetchall()

        # Country distribution
        country_stats = conn.execute(
            "SELECT country, COUNT(*) as runs FROM runs WHERE country IS NOT NULL GROUP BY country ORDER BY runs DESC LIMIT 10"
        ).fetchall()

        # Recent runs
        recent = conn.execute(
            "SELECT id, timestamp, country, asn_org, total_resolvers, cors_count, verified_dns_count, verified_auth_count, unverified_count, paradox_count, ROUND(avg_cached_ms,1) as avg_cached, ROUND(avg_uncached_ms,1) as avg_uncached FROM runs ORDER BY id DESC LIMIT 20"
        ).fetchall()

        return {
            "status": "ok",
            "total_runs": total_runs,
            "total_measurements": total_measurements,
            "top_resolvers": [dict(r) for r in top],
            "cors_distribution": [dict(r) for r in cors_stats],
            "country_distribution": [dict(r) for r in country_stats],
            "recent_runs": [dict(r) for r in recent],
        }
    finally:
        conn.close()
