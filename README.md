# DNS Resolver Recommender

A research tool for measuring and comparing DNS-over-HTTPS (DoH) resolver performance
directly in the browser using a Rust/WebAssembly core.

Part of the Trends in Internet Measurements course at HPI.
Supervisor: Robert Richter.

## Project Structure

```
src/
  wasm/        Rust crate compiled to WebAssembly (DoH measurement engine)
  frontend/    React web application (UI, results display)
  backend/     Python telemetry API (anonymisation, data storage)
  dns-server/  Custom authoritative DNS server for uncached measurements
docs/
  research/    Background research notes and literature
  proposal/    Course proposal presentation and supporting materials
deploy/        Server configuration and deployment scripts
flake.nix      Nix development environment
```

## Infrastructure

- **Frontend/API host:** dns.diic-hpi.org (Hetzner VM, Nuremberg)
- **Authoritative DNS:** ns1.dns.diic-hpi.org -> 46.225.184.21
- **Measurement subdomain:** measure.dns.diic-hpi.org (delegated to VM port 53)

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
3. How can we do cached vs. uncached DNS in the web using a custom authoritative resolver?
4. How can we collect user telemetry data in a GDPR-compliant way?
