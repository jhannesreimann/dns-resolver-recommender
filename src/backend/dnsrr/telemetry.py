"""Telemetry storage: SQLite database for measurement data collection.

Stores per-test-run metadata and per-resolver latency measurements. No raw IP
addresses are stored -- ASN and country are looked up from GeoLite2 (if
available) and the IP is discarded immediately.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import sqlite3
import time
from datetime import datetime, timezone
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
    browser_hash TEXT,
    browser_lang TEXT,
    total_resolvers INTEGER NOT NULL,
    cors_count INTEGER NOT NULL,
    opaque_count INTEGER NOT NULL,
    dead_count INTEGER NOT NULL,
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
    conn.close()


def _hash_value(value: str, salt: str = "dnsrr-telemetry") -> str:
    """One-way hash a string value for privacy."""
    return hashlib.sha256(f"{salt}:{value}".encode()).hexdigest()[:16]


def _lookup_ip(ip_address: str) -> dict[str, Any]:
    """Look up ASN and country from an IP address using GeoLite2 if available.

    Returns dict with asn, asn_org, country keys. All values are None if the
    GeoLite2 database is not available or the lookup fails. The raw IP is never
    stored or logged.
    """
    result: dict[str, Any] = {"asn": None, "asn_org": None, "country": None}

    geoip_db = os.environ.get("GEOLITE2_ASN_DB", "/var/lib/GeoIP/GeoLite2-ASN.mmdb")
    country_db = os.environ.get("GEOLITE2_COUNTRY_DB", "/var/lib/GeoIP/GeoLite2-Country.mmdb")

    try:
        import geoip2.database  # type: ignore

        if os.path.isfile(geoip_db):
            with geoip2.database.Reader(geoip_db) as reader:
                asn_resp = reader.asn(ip_address)
                result["asn"] = asn_resp.autonomous_system_number
                result["asn_org"] = asn_resp.autonomous_system_organization

        if os.path.isfile(country_db):
            with geoip2.database.Reader(country_db) as reader:
                country_resp = reader.country(ip_address)
                result["country"] = country_resp.country.iso_code

    except ImportError:
        logger.debug("geoip2 not installed, skipping IP lookup")
    except FileNotFoundError:
        logger.debug("GeoLite2 database not found at %s or %s", geoip_db, country_db)
    except Exception:
        logger.debug("GeoIP lookup failed for IP (not logged)", exc_info=True)

    return result


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
    cors_count = sum(1 for r in resolver_data if r.get("cors"))
    opaque_count = sum(1 for r in resolver_data if not r.get("cors"))
    valid = [r for r in resolver_data if r.get("cachedAvgMs") is not None and r.get("uncachedAvgMs") is not None]
    dead_count = total - len([r for r in resolver_data if r.get("cachedAvgMs") is not None or r.get("uncachedAvgMs") is not None])

    avg_cached = sum(r["cachedAvgMs"] for r in valid) / len(valid) if valid else None
    avg_uncached = sum(r["uncachedAvgMs"] for r in valid) / len(valid) if valid else None

    db_path = _get_db_path()
    _ensure_db(db_path)
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")

    try:
        cursor = conn.execute(
            """INSERT INTO runs (timestamp, asn, asn_org, country, browser_hash,
               browser_lang, total_resolvers, cors_count, opaque_count, dead_count,
               avg_cached_ms, avg_uncached_ms)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                datetime.now(timezone.utc).isoformat(),
                geo["asn"],
                geo["asn_org"],
                geo["country"],
                _hash_value(payload.get("userAgent", "")) if payload.get("userAgent") else None,
                payload.get("browserLang"),
                total,
                cors_count,
                opaque_count,
                dead_count,
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
                   cached_times, uncached_times)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
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
                    json.dumps(r.get("cachedTimes", [])) if r.get("cachedTimes") else None,
                    json.dumps(r.get("uncachedTimes", [])) if r.get("uncachedTimes") else None,
                ),
            )

        conn.commit()
        logger.info("Stored telemetry run %s: %d resolvers, %d CORS, geo=%s/%s",
                     run_id, total, cors_count, geo.get("country"), geo.get("asn_org"))

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
    if not os.path.isfile(db_path):
        return {"status": "ok", "runs": 0, "measurements": 0}

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
            "SELECT id, timestamp, country, asn_org, total_resolvers, cors_count, ROUND(avg_cached_ms,1) as avg_cached, ROUND(avg_uncached_ms,1) as avg_uncached FROM runs ORDER BY id DESC LIMIT 20"
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
