# WebAssembly DoH Engine (vendored bindings)

This directory holds the **generated wasm-bindgen output** of the Rust DoH
measurement engine. The Rust source lives in the repo at `src/wasm/`. These
files are vendored here (rather than built in CI) so the frontend compiles with
Node alone, with no Rust toolchain required on the GitLab runner.

Do not edit these files by hand; they are machine-generated.

## Why Wasm?

We chose Rust + Wasm over pure JavaScript for several reasons:
1. **Accurate Binary Parsing:** Pure JS tools often rely on opaque `fetch()` timings without parsing the response. We use `hickory-proto` to securely build and parse RFC 8484 binary DNS messages, allowing us to verify response codes (`NOERROR`) and extracted records.
2. **Stable Timings:** Wasm bypasses JavaScript's Garbage Collector (GC) and JIT spikes during the crucial serialization/deserialization phases.

## Regenerating

After changing the Rust crate at the repo's `src/wasm/`:

```bash
cd ../../../wasm          # repo src/wasm
wasm-pack build --target web
cp pkg/dns_resolver_recommender.js \
   pkg/dns_resolver_recommender.d.ts \
   pkg/dns_resolver_recommender_bg.wasm \
   pkg/dns_resolver_recommender_bg.wasm.d.ts \
   ../frontend/src/wasm/
```

The frontend imports `dns_resolver_recommender.js` from `src/lib/measurement.js`,
and Vite bundles the `.wasm` as a hashed asset.
