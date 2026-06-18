/*
 * Weighted scoring engine.
 *
 * Each priority is a 0-100 importance slider. The effective weight of a
 * dimension is its slider value divided by the sum of all slider values, so the
 * sliders are inherently relative to one another: raising one lowers everyone
 * else's share. When every slider is 0 we fall back to pure latency ranking.
 */

export const PRIORITY_KEYS = ['speed', 'consistency', 'dnssec', 'privacy', 'unfiltered'];

export const DEFAULT_WEIGHTS = {
  speed: 100,
  consistency: 0,
  dnssec: 0,
  privacy: 0,
  unfiltered: 0,
  countryMatch: 0,
};

export const WEIGHT_LABELS = {
  speed: 'Speed',
  consistency: 'Consistency',
  dnssec: 'DNSSEC',
  privacy: 'No-logs',
  unfiltered: 'Unfiltered',
  countryMatch: 'Country',
};

export const WEIGHT_HINTS = {
  speed: 'Lower weighted latency (80% cached, 20% uncached)',
  consistency: 'Stable, spike-free latency. Only counts among already-fast resolvers',
  dnssec: 'Cryptographically validates DNS answers',
  privacy: 'Operator advertises a no-logging policy',
  unfiltered: 'Resolves every domain, no ad/content blocking',
  countryMatch: 'Located in your preferred country',
};

export const PRESETS = {
  balanced: { speed: 60, consistency: 15, dnssec: 25, privacy: 25, unfiltered: 0, countryMatch: 0 },
  speed: { speed: 100, consistency: 0, dnssec: 0, privacy: 0, unfiltered: 0, countryMatch: 0 },
  privacy: { speed: 30, consistency: 10, dnssec: 60, privacy: 90, unfiltered: 60, countryMatch: 0 },
};

// Ratio-based speed score: the fastest resolver scores 1.0, a resolver twice as
// slow scores 0.5, and so on. Unlike linear min-max, this preserves meaningful
// gaps between fast resolvers and is not distorted by a single slow outlier
// compressing everyone else toward 1.0.
function normalizeLatency(value, min) {
  if (value <= 0 || min <= 0) return 0;
  return Math.max(0, Math.min(1, min / value));
}

// Steadiness: 1 - coefficient of variation across all latency samples. A
// perfectly steady resolver (cv = 0) scores 1; jitter >= the mean (cv >= 1)
// scores 0. The paradox flag (uncached faster than cached) trims a bit.
function steadiness(result) {
  const samples = [...(result.cachedSamples || []), ...(result.uncachedSamples || [])];
  if (samples.length < 2) return 0.5;
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  if (mean <= 0) return 0.5;
  const variance =
    samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length;
  const cv = Math.sqrt(variance) / mean;
  let score = Math.max(0, Math.min(1, 1 - cv));
  if (result.paradox) score *= 0.85;
  return score;
}

// Consistency dimension. Steadiness alone would reward a resolver that is
// reliably *slow* (a steady 200 ms resolver has cv ~ 0), which is useless in
// practice. We therefore gate steadiness by the resolver's normalized speed, so
// "consistency" means "low jitter among already-fast resolvers" and can never
// promote a genuinely slow resolver to the top.
function consistencyScore(result, speedNorm) {
  return speedNorm * steadiness(result);
}

// Redistribute a 0-100 importance set so the visible sliders always sum to 100.
// Dragging one slider to `target` proportionally rescales the others, so every
// thumb physically moves to represent its true share of the ranking.
export function rebalanceWeights(weights, keys, changedKey, targetValue) {
  const target = Math.max(0, Math.min(100, Math.round(targetValue)));
  const others = keys.filter((k) => k !== changedKey);
  const othersSum = others.reduce((s, k) => s + (weights[k] || 0), 0);
  const remaining = 100 - target;
  const out = { ...weights, [changedKey]: target };

  if (othersSum > 0) {
    let acc = 0;
    others.forEach((k, i) => {
      if (i === others.length - 1) {
        out[k] = Math.max(0, remaining - acc);
      } else {
        const v = Math.round(((weights[k] || 0) / othersSum) * remaining);
        out[k] = v;
        acc += v;
      }
    });
  } else if (target > 0) {
    // No other active factor: the changed slider is the sole factor at 100%.
    out[changedKey] = 100;
  }
  return out;
}

// Returns the normalized share (0-1) each priority contributes, for the UI to
// visualize how "connected" the sliders are.
export function weightDistribution(weights) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const out = {};
  for (const [key, value] of Object.entries(weights)) {
    out[key] = total > 0 ? value / total : 0;
  }
  return { total, shares: out };
}

export function computeScores(results, weights, preferredCountry) {
  const withLatency = results.filter((r) => r.scoreMs != null && !r.dead);
  if (withLatency.length === 0) return [];

  const latencies = withLatency.map((r) => r.scoreMs);
  const minLat = Math.min(...latencies);

  const effectiveWeights = { ...weights };
  // Country preference only counts when an actual country is selected.
  if (!preferredCountry) effectiveWeights.countryMatch = 0;

  const totalWeight = Object.values(effectiveWeights).reduce((a, b) => a + b, 0);

  const scored = withLatency.map((r) => {
    const speed = normalizeLatency(r.scoreMs, minLat);
    const consistency = consistencyScore(r, speed);
    const dnssec = r.resolver.dnssec ? 1 : 0;
    const privacy = r.resolver.noLogs ? 1 : 0;
    const unfiltered = r.resolver.noFilter ? 1 : 0;
    let country = 0;
    if (preferredCountry && r.resolver.country) {
      const c = r.resolver.country;
      if (c.split(',').includes(preferredCountry)) {
        country = 1;
      } else if (c === 'Global') {
        country = 0.5;
      }
    }

    const dimensions = { speed, consistency, dnssec, privacy, unfiltered, country };

    if (totalWeight === 0) {
      return { ...r, finalScore: -r.scoreMs, dimensions };
    }

    const finalScore =
      (effectiveWeights.speed * speed +
        effectiveWeights.consistency * consistency +
        effectiveWeights.dnssec * dnssec +
        effectiveWeights.privacy * privacy +
        effectiveWeights.unfiltered * unfiltered +
        effectiveWeights.countryMatch * country) /
      totalWeight;

    return { ...r, finalScore, dimensions, speedScore: speed, consistencyScore: consistency };
  });

  scored.sort((a, b) => b.finalScore - a.finalScore);
  return scored;
}

export function applyHardFilters(results, _filters) {
  return results;
}
