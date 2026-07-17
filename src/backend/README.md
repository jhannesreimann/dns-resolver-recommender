# Backend

FastAPI service that runs on the Hetzner VM behind Nginx (`https://dns.diic-hpi.org/api/*`).

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Health check, returns configured zone |
| `GET` | `/api/resolvers?refresh=false` | Resolver catalogue (cached 24h, stale fallback) |
| `POST` | `/api/dns/rotate` | Create a fresh `<uuid>.diic-hpi.org` A record via Cloudflare API |
| `DELETE` | `/api/dns/{record_id}` | Remove the A record after measurement |
| `GET` | `/api/dns/verify?domain=X&since=...` | Cloudflare GraphQL verification |
| `GET` | `/api/dns/verify-canary?domain=X` | Local bind9 query log check |
| `POST` | `/api/telemetry` | Store anonymised measurement results (opt-in) |
| `PATCH` | `/api/telemetry/{run_id}/verify` | Update per-resolver verification status |
| `GET` | `/api/stats` | Aggregate statistics for the dashboard |

## Layout

```
dnsrr/
  __init__.py    Package marker
  __main__.py    `python -m dnsrr` entry point
  api.py         FastAPI app factory and all routes
  cloudflare.py  Async Cloudflare DNS Records API client
  config.py      Pydantic settings loaded from environment
  database.py    PostgreSQL adapter (psycopg), schema and migrations
  probe_h3.py    HTTP/3 QUIC prober (daily systemd timer)
  resolvers.py   DNSCrypt public list parser + GeoLite2 country lookup
  telemetry.py   Telemetry storage (IP→ASN/country, UA→browser/OS, then discard)
pyproject.toml   Dependencies and packaging metadata
```

## Local development

The easiest way to run the backend is to use the `uv` package manager.

Sync the dependencies (needed only when first-time running):

```bash
uv sync
```

Then start the application with the necessary secrets:

```bash
export CLOUDFLARE_API_KEY=...
export ZONE_ID=...
uv run dnsrr        # serves on 127.0.0.1:8000
```

Hit `curl -X POST http://127.0.0.1:8000/api/dns/rotate` to verify it works.

### Local Database

A local PostgreSQL instance for testing (replace `podman` with `docker` if you prefer):

```bash
podman pull postgres:18
podman run --name local-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_DB=postgres \
  -p 15432:5432 -d postgres:18
```

Verify with password `postgres`:

```bash
psql -U postgres -h localhost -p 15432
```

The default `DATABASE_PORT` in `config.py` is `15432` to match this local setup.

## Lint and tests

```bash
ruff check .     # lint
pytest           # run tests
```

## Production

The service runs as the `dnsrr` systemd unit. Secrets live in
`/etc/dnsrr/dnsrr.env` (`chmod 600`) and are pulled in via `EnvironmentFile`.
See `deploy/` for the unit file and the Nginx site config.
