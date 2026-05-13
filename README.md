# DNS Resolver Recommender

A research tool for measuring and comparing DNS-over-HTTPS (DoH) resolver performance
directly in the browser using a Rust/WebAssembly core.

Part of the Trends in Internet Measurements course at HPI.
Supervisor: Robert Richter.

## Project Structure

```
src/
  wasm/        Rust crate compiled to WebAssembly (DoH measurement engine)
  frontend/    Web application (UI, results display)
  backend/     Python API (Cloudflare DNS rotation, telemetry, anonymisation)
docs/
  proposal/    Course proposal presentation and supporting materials
deploy/        Nginx config and systemd unit files
flake.nix      Nix development environment
```

## Infrastructure

Frontend and API are served from `dns.diic-hpi.org` on a Hetzner VM in Nuremberg.
Uncached DoH measurements use fresh `<uuid>.diic-hpi.org` subdomains created on
demand via the Cloudflare API. Cloudflare's anycasted nameservers handle the
authoritative answer, so latencies stay realistic for users worldwide.

## Development Setup

Enter the Nix dev shell (provides Rust, wasm-pack, Python):

```bash
nix develop
```

Build the WebAssembly module:

```bash
cd src/wasm
wasm-pack build --target web
```

Start a local dev server:

```bash
python3 -m http.server 8000
```

## Research Questions

1. How can we do DNS in the web? (JS, JS libs, Wasm?)
2. What protocols can we use for DNS in the web?
3. How can we do cached vs. uncached DNS in the web?
4. How can we collect user telemetry data in a GDPR-compliant way?
