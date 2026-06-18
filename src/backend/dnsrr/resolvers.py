import base64
import ipaddress
import logging
import os
import re
import time
from typing import Any
import httpx

logger = logging.getLogger(__name__)

# Anycast / global DNS providers. Key = lowercased resolver name substring to
# match against. Value = country tag. "Global" means the resolver serves all
# countries and should match any country filter. Regional anycast uses
# comma-separated ISO 3166-1 alpha-2 codes for the regions they serve.
ANYCAST_TAGS: dict[str, str] = {
    # Global anycast: serve everywhere
    "cloudflare": "Global",
    "google": "Global",
    "quad9": "Global",
    "nextdns": "Global",
    "adguard": "Global",
    "controld": "Global",
    "cleanbrowsing": "Global",
    "doh-cleanbrowsing": "Global",
    "dns.sb": "Global",
    "cisco": "Global",
    "opendns": "Global",
    "mullvad": "Global",
    "he": "Global",
    # Regional anycast
    "yandex": "RU,BY,KZ",
    "alidns": "CN,HK",
    "dnspod": "CN,HK",
    "cira": "CA",
    "iij": "JP",
    "nic.cz": "CZ",
    "restena": "LU",
    "switch": "CH",
}

def _geoip_country(ip_str: str) -> str | None:
    """Look up an IP address in the local GeoLite2-Country database.
    Returns the ISO country code or None."""
    if not ip_str:
        return None
    try:
        import geoip2.database
    except ImportError:
        return None
    db_path = os.environ.get(
        "GEOLITE2_COUNTRY_DB", "/var/lib/GeoIP/GeoLite2-Country.mmdb"
    )
    if not os.path.isfile(db_path):
        return None
    try:
        addr = ip_str.strip("[]")
        ip = ipaddress.ip_address(addr)
        with geoip2.database.Reader(db_path) as reader:
            return reader.country(ip).country.iso_code
    except Exception:
        return None

def _tag_anycast(name: str) -> str | None:
    """Return the anycast country tag if this resolver name matches a known
    anycast provider, or None otherwise."""
    name_lower = name.lower()
    for pattern, tag in ANYCAST_TAGS.items():
        # Match at word boundary or at start of name, to avoid false
        # positives like "he" matching "cipherdns".
        idx = name_lower.find(pattern)
        if idx == -1:
            continue
        # Check that the match is at a word boundary: either at position 0
        # or preceded by a non-alphanumeric character.
        if idx > 0 and name_lower[idx - 1].isalnum():
            continue
        return tag
    return None

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
            if idx >= len(data):
                break
            vlen = data[idx]
            length = vlen & 0x7F
            idx += 1
            if length > 0:
                # We skip storing actual hash bytes since we only need to advance idx to reach hostname/path
                idx += length
            if not (vlen & 0x80):
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
    seen_urls = set()
    
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
            if stamp_info and stamp_info["url"] not in seen_urls:
                seen_urls.add(stamp_info["url"])
                description = " ".join(current_description_lines).strip()
                # Clean up multiple whitespaces
                description = " ".join(description.split())
                
                # Country assignment: anycast tag > GeoLite2 on stamp IP > description fallback
                country = None
                country_source = None
                anycast_tag = _tag_anycast(current_name)
                if anycast_tag:
                    country = anycast_tag
                    if ',' in anycast_tag:
                        country_source = 'Regional anycast'
                    else:
                        country_source = 'Global anycast'
                else:
                    ip = stamp_info["ip_address"]
                    country = _geoip_country(ip)
                    if country:
                        country_source = f'GeoLite2 on IP {ip}'
                    else:
                        country_match = re.search(r"\b([A-Z]{2})\b", description)
                        if country_match:
                            country = country_match.group(1)
                            country_source = f'Description pattern match'

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
                    "country_source": country_source,
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
            "country": "Global",
            "country_source": "Global anycast (fallback)",
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
            "country": "Global",
            "country_source": "Global anycast (fallback)",
        },
    ]
