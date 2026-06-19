/*
 * DNS measurement engine using the WASM DNS validator.
 * Imports the same WASM module as the live site for wire-format validation.
 */

const MEASUREMENT_TIMEOUT_MS = 3000;
const CACHED_DOMAIN = 'example.com';
const WILDCARD_ZONE = 'diic-hpi.org';
const TIMING_BUFFER_SIZE = 2048;

// Ensure the Performance Resource Timing buffer is large enough for our full
// measurement run (102 resolvers × ~12 fetches each ≈ 1224 entries).
try { performance.setResourceTimingBufferSize(TIMING_BUFFER_SIZE); } catch {}

/*
 * Extract the HTTP protocol version used for a specific DoH fetch from the
 * Performance Resource Timing API. `nextHopProtocol` is not restricted by
 * CORS headers, so this works for both CORS and opaque (no-cors) requests.
 * Returns "h2", "h3", or "http/1.1", or null if unavailable.
 */
function getDohHttpVersion(dohUrl) {
  try {
    // Scan all resource timing entries for this resolver's URL. The WASM
    // module fetches <dohUrl>?dns=<uuid> with unique UUIDs, so we match by
    // URL prefix instead of exact name.
    const entries = performance.getEntriesByType('resource');
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].name.startsWith(dohUrl) && entries[i].nextHopProtocol) {
        return entries[i].nextHopProtocol;
      }
    }
  } catch {}
  return null;
}
const CONCURRENCY = 12;

let wasmReady = false;
let wasmMeasure = null;

async function ensureWasm() {
  if (wasmReady) return;
  const mod = await import('../wasm/dns_resolver_recommender.js');
  await mod.default();
  wasmMeasure = mod.measure_resolver;
  wasmReady = true;
}

// Resolvers that are known to send permissive CORS headers, used only as the
// first guess. Every other resolver is probed live in detectCors().
function guessCors(url) {
  return /cloudflare-dns|dns\.cloudflare|dns\.google|8\.8\.8\.8|1\.1\.1\.1/.test(url || '');
}

// Normalize the backend payload (snake_case, no cors flag) into the shape the
// UI and scoring engine consume (camelCase + an initial cors guess).
export async function fetchResolversFromAPI() {
  const res = await fetch('/api/resolvers');
  if (!res.ok) throw new Error('Failed to load resolver list');
  const list = await res.json();
  return list.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description || '',
    url: r.url,
    ip_address: r.ip_address || null,
    country: r.country || null,
    country_source: r.country_source || null,
    dnssec: !!r.dnssec,
    noLogs: !!r.no_logs,
    noFilter: !!r.no_filter,
    cors: guessCors(r.url),
  }));
}

function isOk(status) {
  return (
    typeof status === 'string' &&
    (status === 'ok' || status.includes('NOERROR') || status.includes('opaque'))
  );
}

// Robust mean: drop the single largest sample before averaging so one transient
// latency spike cannot dominate. Falls back to a plain mean for <= 2 samples.
function robustMean(times) {
  if (!times || times.length === 0) return null;
  if (times.length <= 2) return times.reduce((a, b) => a + b, 0) / times.length;
  const sorted = [...times].sort((a, b) => a - b);
  const trimmed = sorted.slice(0, sorted.length - 1);
  return trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
}

// Warm up the connection and detect CORS support. A CORS query is tried first;
// on failure/timeout we fall back to an opaque (no-CORS) query before declaring
// the resolver dead. Returns { cors, dead }.
async function detectCors(url, initialCors) {
  try {
    const warm = await wasmMeasure(url, CACHED_DOMAIN, true, MEASUREMENT_TIMEOUT_MS);
    if (isOk(warm.status)) return { cors: true, dead: false };
    if (warm.status === 'Timeout') {
      const fb = await wasmMeasure(url, CACHED_DOMAIN, false, MEASUREMENT_TIMEOUT_MS);
      return { cors: false, dead: fb.status === 'Timeout' };
    }
    await wasmMeasure(url, CACHED_DOMAIN, false, MEASUREMENT_TIMEOUT_MS);
    return { cors: false, dead: false };
  } catch {
    try {
      const fb = await wasmMeasure(url, CACHED_DOMAIN, false, MEASUREMENT_TIMEOUT_MS);
      return { cors: false, dead: fb.status === 'Timeout' };
    } catch {
      return { cors: !!initialCors, dead: true };
    }
  }
}

// Cached phase: 7 queries to a globally popular domain, discard the first 2 to
// remove TLS/HTTP-2 cold-start bias, then robustMean the rest.
async function measureCachedPhase(url, cors) {
  const all = [];
  for (let i = 0; i < 7; i++) {
    try {
      const res = await wasmMeasure(url, CACHED_DOMAIN, cors, MEASUREMENT_TIMEOUT_MS);
      if (isOk(res.status) && res.latency_ms != null) all.push(res.latency_ms);
    } catch {
      /* failed query is simply skipped */
    }
  }
  const kept = all.slice(2);
  return { avg: kept.length >= 1 ? robustMean(kept) : null, samples: kept };
}

// Uncached phase: 5 unique UUID subdomains force genuine recursion. A parallel
// canary on verify.<zone> lets the backend confirm the resolver really queried.
async function measureUncachedPhase(url, cors) {
  const domains = [];
  for (let i = 0; i < 5; i++) {
    domains.push(`${crypto.randomUUID()}.${WILDCARD_ZONE}`);
  }
  const canaryUuid = domains[0].replace(`.${WILDCARD_ZONE}`, '');
  const canaryDomain = `${canaryUuid}.verify.${WILDCARD_ZONE}`;
  wasmMeasure(url, canaryDomain, cors, MEASUREMENT_TIMEOUT_MS).catch(() => {});

  const times = [];
  for (const domain of domains) {
    try {
      const res = await wasmMeasure(url, domain, cors, MEASUREMENT_TIMEOUT_MS);
      if (isOk(res.status) && res.latency_ms != null) times.push(res.latency_ms);
    } catch {
      /* failed query is simply skipped */
    }
  }
  return { avg: robustMean(times), samples: times, canaryDomain, domains };
}

async function measureResolver(resolver) {
  const { cors, dead } = await detectCors(resolver.url, resolver.cors);
  resolver.cors = cors;

  if (dead) {
    return {
      resolver,
      cachedAvg: null,
      uncachedAvg: null,
      scoreMs: null,
      cachedSamples: [],
      uncachedSamples: [],
      dead: true,
      done: true,
    };
  }

  const cached = await measureCachedPhase(resolver.url, cors);
  const uncached = await measureUncachedPhase(resolver.url, cors);
  const dohHttpVersion = getDohHttpVersion(resolver.url);

  const score =
    cached.avg != null && uncached.avg != null
      ? 0.8 * cached.avg + 0.2 * uncached.avg
      : null;

  return {
    resolver,
    cachedAvg: cached.avg,
    uncachedAvg: uncached.avg,
    scoreMs: score,
    cachedSamples: cached.samples,
    uncachedSamples: uncached.samples,
    canaryDomain: uncached.canaryDomain,
    domains: uncached.domains,
    dohHttpVersion,
    paradox: uncached.avg != null && cached.avg != null && uncached.avg < cached.avg,
    dead: false,
    done: true,
  };
}

export async function runMeasurement(resolvers, onProgress, signal) {
  await ensureWasm();
  const results = [];
  const total = resolvers.length;
  let cursor = 0;
  let done = 0;

  async function worker() {
    while (!signal?.aborted) {
      const index = cursor++;
      if (index >= resolvers.length) return;
      const result = await measureResolver(resolvers[index]);
      if (signal?.aborted) return;
      results.push(result);
      done += 1;
      onProgress(result, done, total);
    }
  }

  const pool = Array.from({ length: Math.min(CONCURRENCY, total) }, () => worker());
  await Promise.all(pool);
  return results;
}
