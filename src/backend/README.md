# Backend

FastAPI service that runs on the Hetzner VM behind Nginx (`https://dns.diic-hpi.org/api/*`).

## Endpoints

`POST /api/dns/rotate` creates a fresh `<uuid>.diic-hpi.org` A record via the
Cloudflare API and returns the FQDN plus the record id.
`DELETE /api/dns/{record_id}` removes the record once the measurement is done.
`GET  /api/health` returns the configured zone for quick smoke tests.

`POST /api/submit` (telemetry, anonymised measurement results) lands here
later. Raw IP is dropped immediately after the GeoIP lookup.

## Layout

```
dnsrr/
  api.py         FastAPI app and routes
  cloudflare.py  Async Cloudflare DNS Records API client
  config.py      Pydantic settings loaded from environment
  __main__.py    `python -m dnsrr` entry point
pyproject.toml   Dependencies and packaging metadata
```

## Local development

```bash
python -m venv .venv && . .venv/bin/activate
pip install -e .
export CLOUDFLARE_API_KEY=...
export ZONE_ID=...
python -m dnsrr        # serves on 127.0.0.1:8000
```

Hit `curl -X POST http://127.0.0.1:8000/api/dns/rotate` to verify it works.

## Production

The service runs as the `dnsrr` systemd unit. Secrets live in
`/etc/dnsrr/dnsrr.env` (`chmod 600`) and are pulled in via `EnvironmentFile`.
See `deploy/` for the unit file and the Nginx site config.
