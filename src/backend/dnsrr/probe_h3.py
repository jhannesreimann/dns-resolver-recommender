"""
Probe public DoH resolvers for HTTP/3 (QUIC) support.

Tries a QUIC connection to each resolver's IP on the port from their
stamp. Records whether the h3 ALPN was negotiated during the QUIC
handshake. Results cached to /var/lib/dnsrr/resolver_h3.json.

Run via systemd timer daily, or manually: python -m dnsrr.probe_h3
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import socket
import ssl
import time
from pathlib import Path
from typing import Any

from aioquic.asyncio import connect
from aioquic.quic.configuration import QuicConfiguration
from aioquic.quic.logger import QuicLogger

logger = logging.getLogger(__name__)

CACHE_PATH = "/var/lib/dnsrr/resolver_h3.json"
PROBE_TIMEOUT = 3.0  # seconds per resolver
CONCURRENCY = 20


def _resolver_endpoint(resolver: dict) -> tuple[str, int] | None:
    """Extract hostname and port from a resolver's DoH URL."""
    url = resolver.get("url", "")
    if not url:
        return None
    # Parse host:port from https://host:port/path
    try:
        rest = url.split("://", 1)[1]  # host:port/path
        host_part = rest.split("/", 1)[0]  # host:port
        if ":" in host_part:
            host, port = host_part.rsplit(":", 1)
            return host, int(port)
        return host_part, 443
    except Exception:
        return None


async def _probe_one(resolver: dict, sem: asyncio.Semaphore) -> tuple[str, bool]:
    """Try a QUIC connection. Returns (resolver_id, supports_h3)."""
    rid = resolver.get("id", "unknown")
    endpoint = _resolver_endpoint(resolver)
    if not endpoint:
        return rid, False

    host, port = endpoint
    async with sem:
        try:
            config = QuicConfiguration(
                alpn_protocols=["h3"],
                is_client=True,
                idle_timeout=PROBE_TIMEOUT,
            )
            async with asyncio.timeout(PROBE_TIMEOUT):
                async with connect(host, port, configuration=config) as conn:
                    # If we get here, QUIC handshake succeeded
                    negotiated = conn._quic.tls.alpn_negotiated
                    return rid, negotiated == "h3"
        except Exception:
            return rid, False


async def probe_all(resolvers: list[dict]) -> dict[str, bool]:
    """Probe all resolvers, return {resolver_id: supports_h3}."""
    sem = asyncio.Semaphore(CONCURRENCY)
    tasks = [_probe_one(r, sem) for r in resolvers]
    results = {}
    total = len(tasks)
    done = 0
    for task in asyncio.as_completed(tasks):
        rid, supports = await task
        results[rid] = supports
        done += 1
        if done % 20 == 0 or done == total:
            logger.info("h3 probe: %d/%d resolvers checked", done, total)
    return results


def load_cache() -> dict[str, bool]:
    """Load cached h3 results from disk."""
    try:
        with open(CACHE_PATH) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_cache(results: dict[str, bool]) -> None:
    """Save h3 results to disk."""
    Path(CACHE_PATH).parent.mkdir(parents=True, exist_ok=True)
    tmp = CACHE_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(results, f)
    os.replace(tmp, CACHE_PATH)
    logger.info("h3 probe results saved to %s (%d resolvers)", CACHE_PATH, len(results))


async def run_probe(resolvers: list[dict]) -> dict[str, bool]:
    """Probe all resolvers and update the cache. Returns the results."""
    results = await probe_all(resolvers)
    # Merge with existing cache to preserve results for resolvers
    # that were unreachable this time
    cached = load_cache()
    merged = {**cached, **results}
    save_cache(merged)
    return merged


if __name__ == "__main__":
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")

    from dnsrr.resolvers import get_resolvers

    async def main() -> None:
        logger.info("Fetching resolver list...")
        resolvers = await get_resolvers(force_refresh=True)
        logger.info("Probing %d resolvers for HTTP/3 support...", len(resolvers))
        results = await run_probe(resolvers)
        supported = sum(1 for v in results.values() if v)
        logger.info(
            "Done: %d/%d resolvers support HTTP/3", supported, len(results)
        )

    asyncio.run(main())
