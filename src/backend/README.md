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

The easiest way to run the backend is to use the `uv` package manager.

Sync the dependencies (needed only when first-time running):

```bash
uv sync
```

The start the application with the necessary secrets:

```bash
export CLOUDFLARE_API_KEY=...
export ZONE_ID=...
uv run dnsrr        # serves on 127.0.0.1:8000
```

Hit `curl -X POST http://127.0.0.1:8000/api/dns/rotate` to verify it works.

### Local Database

Using the production database is a bad idea, but you can use a local database for testing. Do the following:

```bash
podman pull postgres:18
podman run --name local-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=postgres -p 5432:5432 -d postgres
```

You can also replace podman with docker, if you prefer that. This creates a local database running on port 5432. To verify it is running, use the following with password `postgres`:

```bash
psql -U postgres -h localhost -p 5432
```

## Production

The service runs as the `dnsrr` systemd unit. Secrets live in
`/etc/dnsrr/dnsrr.env` (`chmod 600`) and are pulled in via `EnvironmentFile`.
See `deploy/` for the unit file and the Nginx site config.
