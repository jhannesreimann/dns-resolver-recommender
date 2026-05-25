import base64
import logging
import re
import time
from typing import Any
import httpx

logger = logging.getLogger(__name__)

# URL of the official DNSCrypt public resolvers list
RESOLVERS_LIST_URL = "https://raw.githubusercontent.com/DNSCrypt/dnscrypt-resolvers/master/v3/public-resolvers.md"
# Cache duration: 24 hours (86400 seconds)
CACHE_DURATION_SECONDS = 86400

# Global cache variables
_cached_resolvers: list[dict[str, Any]] = []
_cache_last_updated: float = 0.0


def decode_doh_stamp(stamp_str: str) -> dict[str, Any] | None:
    """Decode an sdns:// DNS Stamp if it is a DNS-over-HTTPS (DoH) stamp.
    
    Returns a dict with url, ip_address, dnssec, no_logs, and no_filter properties.
    See specification: https://dnscrypt.info/stamps-specifications/
    """
    if not stamp_str.startswith("sdns://"):
        return None
    
    stamp = stamp_str[7:].strip()
    # Add Base64 padding if missing
    padded = stamp + "=" * (-len(stamp) % 4)
    
    try:
        data = base64.urlsafe_b64decode(padded)
    except Exception:
        logger.warning("Failed to decode base64 stamp: %s", stamp_str)
        return None
        
    if not data or len(data) < 9:
        return None
        
    proto = data[0]
    if proto != 0x02:  # 0x02 is the protocol ID for DNS-over-HTTPS
        return None
        
    # Props: 8-byte little-endian bitmask
    props = int.from_bytes(data[1:9], "little")
    dnssec = bool(props & 1)
    no_logs = bool(props & (1 << 1))
    no_filter = bool(props & (1 << 2))
    
    idx = 9
    
    # Helper to read a length-prefixed field
    def read_lp() -> bytes:
        nonlocal idx
        if idx >= len(data):
            return b""
        length = data[idx]
        val = data[idx + 1:idx + 1 + length]
        idx += 1 + length
        return val

    # 1. IP address (with port if non-standard)
    try:
        ip_addr_bytes = read_lp()
        ip_address = ip_addr_bytes.decode("utf-8", errors="ignore")
    except Exception:
        ip_address = ""
        
    # 2. Hashes: list of SHA-256 certificate hashes, terminated by a 0-length field
    try:
        while True:
            h = read_lp()
            if not h:
                break
    except Exception:
        pass
        
    # 3. Hostname
    try:
        host_bytes = read_lp()
        hostname = host_bytes.decode("utf-8", errors="ignore")
    except Exception:
        hostname = ""
        
    # 4. Path
    try:
        path_bytes = read_lp()
        path = path_bytes.decode("utf-8", errors="ignore")
    except Exception:
        path = ""
        
    if not hostname or not path:
        return None
        
    # Construct standard DoH query URL
    url = f"https://{hostname}{path}"
    
    return {
        "url": url,
        "ip_address": ip_address,
        "dnssec": dnssec,
        "no_logs": no_logs,
        "no_filter": no_filter,
    }


def parse_resolvers_markdown(content: str) -> list[dict[str, Any]]:
    """Parse the public-resolvers.md file into a list of parsed DoH resolvers."""
    resolvers = []
    
    lines = content.splitlines()
    current_name: str | None = None
    current_description_lines: list[str] = []
    
    for line in lines:
        line_stripped = line.strip()
        
        # Check for new resolver header
        if line_stripped.startswith("## "):
            current_name = line_stripped[3:].strip()
            current_description_lines = []
            continue
            
        # If we have a name and see an sdns link, decode and save
        if current_name and line_stripped.startswith("sdns://"):
            stamp_info = decode_doh_stamp(line_stripped)
            if stamp_info:
                description = " ".join(current_description_lines).strip()
                # Clean up multiple whitespaces
                description = " ".join(description.split())
                
                # Derive country/location code if mentioned in the description (e.g., "[DE]", "Germany", "CH")
                country = None
                # Check for country flags or brackets in description
                # E.g., "in Germany", "Switzerland", "Munich, Germany"
                country_match = re.search(r"\b([A-Z]{2})\b", description)
                if country_match:
                    country = country_match.group(1)
                elif "Germany" in description or "DE" in description or "Deutschland" in description:
                    country = "DE"
                elif "Switzerland" in description or "CH" in description or "Schweiz" in description:
                    country = "CH"
                elif "Austria" in description or "AT" in description or "Österreich" in description:
                    country = "AT"
                elif "United States" in description or "US" in description or "USA" in description:
                    country = "US"
                elif "Netherlands" in description or "NL" in description:
                    country = "NL"
                elif "France" in description or "FR" in description:
                    country = "FR"
                elif "Finland" in description or "FI" in description:
                    country = "FI"
                elif "Singapore" in description or "SG" in description:
                    country = "SG"
                elif "Japan" in description or "JP" in description:
                    country = "JP"
                elif "Canada" in description or "CA" in description:
                    country = "CA"
                
                resolvers.append({
                    "id": current_name,
                    "name": current_name,
                    "description": description,
                    "url": stamp_info["url"],
                    "ip_address": stamp_info["ip_address"],
                    "dnssec": stamp_info["dnssec"],
                    "no_logs": stamp_info["no_logs"],
                    "no_filter": stamp_info["no_filter"],
                    "country": country,
                })
            
            # Reset after saving
            current_name = None
            current_description_lines = []
        elif current_name:
            # Accumulate description lines (skip license/usage boilerplate lines)
            if (
                line_stripped
                and not line_stripped.startswith("#")
                and "To use that list" not in line_stripped
                and "urls =" not in line_stripped
                and "dnscrypt-proxy.toml" not in line_stripped
            ):
                current_description_lines.append(line_stripped)
                
    return resolvers


async def get_resolvers(force_refresh: bool = False) -> list[dict[str, Any]]:
    """Get the list of DoH resolvers, utilizing cached data if valid."""
    global _cached_resolvers, _cache_last_updated
    
    current_time = time.time()
    cache_age = current_time - _cache_last_updated
    
    if _cached_resolvers and cache_age < CACHE_DURATION_SECONDS and not force_refresh:
        return _cached_resolvers
        
    logger.info("Fetching fresh public DNSCrypt resolvers list...")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(RESOLVERS_LIST_URL)
            response.raise_for_status()
            content = response.text
            
        parsed = parse_resolvers_markdown(content)
        if parsed:
            _cached_resolvers = parsed
            _cache_last_updated = current_time
            logger.info("Successfully loaded and cached %d DoH resolvers", len(parsed))
            return _cached_resolvers
            
    except Exception as exc:
        logger.exception("Failed to fetch or parse DNSCrypt resolvers")
        # Fall back to stale cache if available
        if _cached_resolvers:
            logger.warning("Using stale resolvers cache as fallback")
            return _cached_resolvers
            
    # Hardcoded minimal fallback if nothing works and cache is empty
    return [
        {
            "id": "cloudflare",
            "name": "cloudflare",
            "description": "Cloudflare public DNS - Non-logging, DNSSEC, filtering options available.",
            "url": "https://cloudflare-dns.com/dns-query",
            "ip_address": "1.1.1.1",
            "dnssec": True,
            "no_logs": True,
            "no_filter": True,
            "country": "US",
        },
        {
            "id": "google",
            "name": "google",
            "description": "Google Public DNS - DNSSEC validation, some logging applies.",
            "url": "https://dns.google/dns-query",
            "ip_address": "8.8.8.8",
            "dnssec": True,
            "no_logs": False,
            "no_filter": True,
            "country": "US",
        },
    ]
