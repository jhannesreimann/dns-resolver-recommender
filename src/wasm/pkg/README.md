# WebAssembly DoH Engine

This Rust module is compiled to WebAssembly to provide an academic-grade DNS-over-HTTPS (DoH) measurement engine for the browser.

## Why Wasm?

We chose Rust + Wasm over pure JavaScript for several reasons:
1. **Accurate Binary Parsing:** Pure JS tools often rely on opaque `fetch()` timings without parsing the response. We use `hickory-proto` to securely build and parse RFC 8484 binary DNS messages, allowing us to verify response codes (`NOERROR`) and extracted records.
2. **Stable Timings:** Wasm bypasses JavaScript's Garbage Collector (GC) and JIT spikes during the crucial serialization/deserialization phases.

## Building

```bash
cargo install wasm-pack
wasm-pack build --target web
```

This generates a `pkg/` directory which is directly imported by the frontend JavaScript.
