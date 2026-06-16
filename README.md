# DNS Resolver Recommender

A research tool for measuring and comparing DNS-over-HTTPS (DoH) resolver performance
directly in the browser using a Rust/WebAssembly core.

Part of the Trends in Internet Measurements course at HPI.
Supervisor: Robert Richter.

## Project Structure

```
src/
  wasm/        Rust crate compiled to WebAssembly (DoH measurement engine)
  frontend/    React + Vite web application (UI, measurement, ranking)
  backend/     Python API (Cloudflare DNS rotation, telemetry, anonymisation)
docs/
  proposal/    Course proposal presentation and supporting materials
deploy/        Nginx config and systemd unit files
flake.nix      Nix development environment
```

The frontend is a React 19 + Vite single-page app (Tailwind CSS 4 + daisyUI).
The Rust/WASM engine in `src/wasm/` is generated with `wasm-pack` and its output
is vendored into `src/frontend/src/wasm/`, so the frontend builds with Node
alone. See `src/frontend/README.md` for details.

## Infrastructure

Frontend and API are served from `dns.diic-hpi.org` on a Hetzner VM in Nuremberg.
Uncached DoH measurements use fresh `<uuid>.diic-hpi.org` subdomains created on
demand via the Cloudflare API. Cloudflare's anycasted nameservers handle the
authoritative answer, so latencies stay realistic for users worldwide.

## Measurement Methodology

To ensure maximum scientific accuracy and prevent network and TLS handshake overhead from distorting raw DNS resolution times, the engine employs a rigorous measurement lifecycle:

### 1. Connection Warm-Up (Socket Establishment)
Before any latency is recorded, a single dummy query to `example.com` is executed against the target DoH resolver. This initiates the TCP handshakes, TLS negotiation, and establishes the HTTP/2 or HTTP/3 keep-alive connection. 

All subsequent queries are sent over this active, warm socket. This isolates the raw DNS transmission and server resolution time from connection-negotiation overhead (which typically adds 2 RTTs of noise).

### 2. Cached Resolution (7 queries, first 2 dropped)
The engine executes 7 consecutive queries to a globally popular domain (guaranteed to be cached by public resolvers). The first 2 are discarded to remove residual TLS/HTTP-2 cold-start bias, and a **robust (trimmed) mean** of the rest is taken.

### 3. Uncached Recursive Resolution (5 fresh UUIDs)
The engine queries 5 globally unique `uuid.diic-hpi.org` subdomains. Because each subdomain is completely unique, the target resolver has no cache record and is forced to perform full recursive resolution back to the authoritative nameserver. We take a **robust mean** of these runs. One subdomain is also queried under `verify.<zone>` as a canary so the backend can confirm the resolver really performed the lookup.

### 4. Weighted Performance Score (Real-World Ranking)
To determine the recommended resolver, the system calculates a weighted **Performance Score**:

$$\text{Score} = 0.8 \times \text{Cached Average} + 0.2 \times \text{Uncached Average}$$

This is representative of real-world web browsing behavior, where approximately 80% to 95% of queries are resolved instantly from the cache, while 5% to 20% represent cold-starts (new sites or sub-resources) requiring recursive lookup.

### 5. Configurable Ranking
The Performance Score above is a single latency number. The final ordering is produced by a small weighted model (`src/frontend/src/lib/scoring.js`) over several 0-100 priority sliders that share one budget: **Speed**, **Consistency**, **DNSSEC**, **No-logs**, **Unfiltered**, and an optional **Country** preference. Speed is scored by ratio to the fastest measured resolver (so a single slow outlier cannot compress the rest), and consistency only counts among already-fast resolvers. The default (and the non-advanced recommendation) is **pure speed**.

## Development Setup

Enter the Nix dev shell (provides Rust, wasm-pack, Python):

```bash
nix develop
```

Build the WebAssembly module (only needed when the Rust crate changes):

```bash
cd src/wasm
wasm-pack build --target web
# then vendor pkg/* into src/frontend/src/wasm/ (see src/frontend/README.md)
```

Run the frontend dev server (proxies `/api` to the live backend):

```bash
cd src/frontend
npm install
npm run dev
```

## Deployment

Pushes to `main` trigger the GitLab pipeline (`.gitlab-ci.yml`):

- **deploy-frontend**: on changes under `src/frontend/**`, builds the Vite
  app with Node and copies the static `dist/` into the nginx webroot
  `/var/www/dnsrr/` on the VM.
- **deploy-backend**: on changes under `src/backend/**`, syncs the FastAPI
  code and restarts the `dnsrr` systemd service.

The frontend and API are same-origin behind nginx, which reverse-proxies
`/api/` to the backend on `127.0.0.1:8000` (see `deploy/`).

## Research Questions

1. How can we do DNS in the web? (JS, JS libs, Wasm?)
2. What protocols can we use for DNS in the web?
3. How can we do cached vs. uncached DNS in the web?
4. How can we collect user telemetry data in a GDPR-compliant way?
