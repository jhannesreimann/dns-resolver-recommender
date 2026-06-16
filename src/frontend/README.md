# Frontend

The web application for the DNS Resolver Recommender. It measures 100+ public
DoH resolvers directly in the browser, ranks them by a configurable set of
priorities, and recommends one.

## Stack

- **React 19** + **Vite**: UI and build tooling.
- **Tailwind CSS 4** + **daisyUI 5**: styling and components (light/dark themes).
- **Framer Motion** for animations, **lucide-react** for icons.
- **Rust + WebAssembly**: the DoH measurement engine (see `src/wasm/`), which
  builds and parses RFC 8484 binary DNS messages for accurate, GC-free timings.

## Project layout

```
index.html              App shell; applies the saved theme before paint.
src/
  main.jsx              React entry point.
  App.jsx               Top-level state: measurement lifecycle, weights, view.
  index.css             Tailwind + daisyUI theme definitions.
  components/           UI: FilterPanel, ResultsTable, RecommendationCard, ...
  lib/
    api.js              Backend calls (relative /api paths).
    measurement.js      DoH measurement engine driver (loads the WASM module).
    scoring.js          Weighted ranking model (speed, consistency, DNSSEC, ...).
  wasm/                 Vendored wasm-bindgen output generated from ../../wasm.
public/
  favicon.svg
```

## How it talks to the backend

All API calls use **relative** `/api/...` paths (`src/lib/api.js`), so in
production the static bundle and the API are same-origin behind nginx. During
local development, `vite.config.js` proxies `/api` to the live backend at
`https://dns.diic-hpi.org`.

| Endpoint                      | Purpose                                  |
| ----------------------------- | ---------------------------------------- |
| `GET /api/resolvers`          | Resolver catalogue (URL, flags, country) |
| `GET /api/dns/verify-canary`  | Confirm a query hit our bind9 canary log |
| `GET /api/dns/verify`         | Cloudflare authoritative-log fallback    |
| `POST /api/telemetry`         | Opt-in anonymous measurement submission  |

## The vendored WASM engine

The measurement engine is a Rust crate at `../wasm` (repo `src/wasm/`). Its
wasm-bindgen output is **vendored** into `src/wasm/` here so the frontend builds
with Node alone (no Rust toolchain is needed on the CI runner). Vite bundles the
`.wasm` as a hashed asset automatically.

To regenerate after changing the Rust crate:

```bash
cd ../wasm
wasm-pack build --target web
cp pkg/dns_resolver_recommender.js \
   pkg/dns_resolver_recommender.d.ts \
   pkg/dns_resolver_recommender_bg.wasm \
   pkg/dns_resolver_recommender_bg.wasm.d.ts \
   ../frontend/src/wasm/
```

## Development

```bash
npm install
npm run dev      # http://localhost:5173 (proxies /api to the live backend)
npm run lint
npm run build    # outputs the static bundle to dist/
npm run preview  # serve the production build locally
```

## Deployment

`npm run build` produces a self-contained `dist/` (hashed JS/CSS + bundled
wasm). The GitLab CI `deploy-frontend` job builds this and copies `dist/` into
the nginx webroot `/var/www/dnsrr/` on every push to `main` that touches
`src/frontend/**`. See the repo root `README.md` and `.gitlab-ci.yml`.
