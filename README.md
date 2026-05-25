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

## Measurement Methodology

To ensure maximum scientific accuracy and prevent network and TLS handshake overhead from distorting raw DNS resolution times, the engine employs a rigorous measurement lifecycle:

### 1. Connection Warm-Up (Socket Establishment)
Before any latency is recorded, a single dummy query to `example.com` is executed against the target DoH resolver. This initiates the TCP handshakes, TLS negotiation, and establishes the HTTP/2 or HTTP/3 keep-alive connection. 

All subsequent queries are sent over this active, warm socket. This isolates the raw DNS transmission and server resolution time from connection-negotiation overhead (which typically adds 2 RTTs of noise).

### 2. Cached Resolution (Average of 3)
The engine executes 3 consecutive queries to `example.com` (which is guaranteed to be cached by public resolvers). We record the latencies of all successful queries and calculate their **average**.

### 3. Uncached Recursive Resolution (Average of 3)
The engine queries 3 globally generated, unique `uuid.diic-hpi.org` subdomains. Because each subdomain is completely unique, the target resolver has no cache record and is forced to perform full recursive resolution back to the authoritative Nameserver. We calculate the **average** of these 3 recursive runs.

### 4. Weighted Performance Score (Real-World Ranking)
To determine the recommended resolver, the system calculates a weighted **Performance Score**:

$$\text{Score} = 0.8 \times \text{Cached Average} + 0.2 \times \text{Uncached Average}$$

This is representative of real-world web browsing behavior, where approximately 80% to 95% of queries are resolved instantly from the cache, while 5% to 20% represent cold-starts (new sites or sub-resources) requiring recursive lookup.

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
