# WebAssembly DoH Engine

This Rust module is compiled to WebAssembly to provide an academic-grade DNS-over-HTTPS (DoH) measurement engine for the browser. Uses `hickory-proto` for RFC 8484 binary DNS message construction and parsing, and `web-sys` for browser fetch API integration.

## Why Wasm?

We chose Rust + Wasm over pure JavaScript for several reasons:
1. **Accurate Binary Parsing:** Pure JS tools often rely on opaque `fetch()` timings without parsing the response. We use `hickory-proto` to securely build and parse RFC 8484 binary DNS messages, allowing us to verify response codes (`NOERROR`) and extracted records.
2. **Stable Timings:** Wasm bypasses JavaScript's Garbage Collector (GC) and JIT spikes during the crucial serialization/deserialization phases.

## Building

```bash
wasm-pack build --target web
```

This generates a `pkg/` directory. The output is then vendored into `src/frontend/src/wasm/` so the frontend builds with Node alone, no Rust toolchain needed on CI.

See `src/frontend/src/wasm/README.md` for the vendoring instructions.
