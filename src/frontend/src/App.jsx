import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Square, RotateCcw, ShieldCheck, EyeOff, Globe } from 'lucide-react';
import Header from './components/Header';
import StartButton from './components/StartButton';
import ProgressBar from './components/ProgressBar';
import ResultsTable from './components/ResultsTable';
import FilterPanel from './components/FilterPanel';
import RecommendationCard from './components/RecommendationCard';
import Footer from './components/Footer';
import { runMeasurement, fetchResolversFromAPI } from './lib/measurement';
import {
  computeScores,
  applyHardFilters,
  rebalanceWeights,
  DEFAULT_WEIGHTS,
  PRIORITY_KEYS,
} from './lib/scoring';
import { verifyCanary, verifyCloudflare, submitTelemetry, updateVerificationStatus } from './lib/api';

const COUNTRY_KEYS = [...PRIORITY_KEYS, 'countryMatch'];

const LIGHT = 'dnsrrlight';
const DARK = 'dnsrrdark';

function initialTheme() {
  const stored = localStorage.getItem('dnsrr-theme');
  if (stored === LIGHT || stored === DARK) return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? DARK : LIGHT;
}

export default function App() {
  const [theme, setTheme] = useState(initialTheme);
  const [expertMode, setExpertMode] = useState(false);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [resolvers, setResolvers] = useState([]);
  const [results, setResults] = useState([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [weights, setWeights] = useState({ ...DEFAULT_WEIGHTS });
  const [preferredCountry, setPreferredCountry] = useState('');
  const [optIn, setOptIn] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const abortRef = useRef(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('dnsrr-theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === DARK ? LIGHT : DARK));

  // Tier 3 verification: for opaque (no-CORS) resolvers we cannot read the
  // answer in-browser, and they may have missed the local canary log, so we
  // poll the Cloudflare DNS analytics API to confirm they actually queried our
  // authoritative zone. This is slow and rate-limited (top 10 only, backoff up
  // to 90s), so it runs detached from the main flow and upgrades badges live.
  // Telemetry is submitted here too, after badges reflect their final state.
  const verifyOpaqueAndReport = useCallback(
    async (rawResults, signal, telRunId) => {
      const refresh = () => setResults((prev) => [...prev]);
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));

      const opaque = rawResults
        .filter(
          (r) => !r.dead && r.scoreMs != null && !r.resolver.cors && !r.canaryVerified && r.domains?.[0]
        )
        .sort((a, b) => (a.scoreMs ?? 9999) - (b.scoreMs ?? 9999))
        .slice(0, 10);

      if (opaque.length > 0) {
        opaque.forEach((r) => {
          r.verifying = true;
        });
        refresh();

        const BACKOFF = [0, 8, 16, 32];
        const MAX_TOTAL = 90000;
        const start = Date.now();
        await wait(10000);

        let idx = 0;
        while (!signal?.aborted && Date.now() - start < MAX_TOTAL) {
          const remaining = opaque.filter((r) => !r.cloudflareVerified);
          if (remaining.length === 0) break;
          for (const r of remaining) {
            if (signal?.aborted) break;
            try {
              const v = await verifyCloudflare(r.domains[0]);
              if (v.verified) {
                r.cloudflareVerified = true;
                r.verifying = false;
                refresh();
              }
            } catch {
              /* best-effort */
            }
          }
          if (opaque.every((r) => r.cloudflareVerified)) break;
          const delay = (BACKOFF[Math.min(idx, BACKOFF.length - 1)] || 32) * 1000;
          idx += 1;
          if (Date.now() - start + delay >= MAX_TOTAL) break;
          await wait(delay);
        }
        opaque.forEach((r) => {
          r.verifying = false;
        });
        refresh();

        if (telRunId) {
          const verified = opaque.filter((r) => r.cloudflareVerified);
          if (verified.length > 0) {
            try {
              await updateVerificationStatus(
                telRunId,
                verified.map((r) => ({
                  resolver_id: r.resolver.id,
                  verification_status: 'verified_auth',
                }))
              );
            } catch {}
          }
        }
      }

    },
    []
  );

  const run = useCallback(async () => {
    abortRef.current?.abort();
    setRunning(true);
    setStarted(true);
    setShowAll(false);
    setResults([]);
    setProgress({ done: 0, total: 0 });
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const list = resolvers.length > 0 ? resolvers : await fetchResolversFromAPI();
      setResolvers(list);
      setProgress({ done: 0, total: list.length });

      const rawResults = await runMeasurement(
        list,
        (result, done, total) => {
          setResults((prev) =>
            [...prev, result].sort((a, b) => (a.scoreMs ?? 9999) - (b.scoreMs ?? 9999))
          );
          setProgress({ done, total });
        },
        controller.signal
      );

      const verifyPass = async (batch) => {
        const failed = [];
        for (const r of batch) {
          if (!r.canaryDomain) continue;
          try {
            const v = await verifyCanary(r.canaryDomain);
            if (v.verified) r.canaryVerified = true;
            else failed.push(r);
          } catch {
            failed.push(r);
          }
        }
        return failed;
      };

      const missed = await verifyPass(
        rawResults.filter((r) => r.canaryDomain && !r.canaryVerified)
      );
      if (missed.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await verifyPass(missed);
      }

      // Measurements + canary done: surface results immediately.
      setResults((prev) => [...prev].sort((a, b) => (a.scoreMs ?? 9999) - (b.scoreMs ?? 9999)));

      // Submit telemetry immediately so data is saved even if the user closes
      // the tab before Cloudflare verification finishes.
      if (optIn && rawResults.length > 0) {
        const payload = {
          userAgent: navigator.userAgent,
          browserLang: navigator.language,
          resolvers: rawResults.map((res) => ({
            id: res.resolver.id,
            name: res.resolver.name,
            url: res.resolver.url,
            cachedAvgMs: res.cachedAvg,
            uncachedAvgMs: res.uncachedAvg,
            scoreMs: res.scoreMs,
            cors: res.resolver.cors,
            dnssec: res.resolver.dnssec,
            noLogs: res.resolver.noLogs,
            noFilter: res.resolver.noFilter,
            country: res.resolver.country,
            verificationStatus: res.dead
              ? 'dead'
              : res.resolver.cors
                ? 'verified_dns'
                : res.canaryVerified
                  ? 'verified_canary'
                  : 'unverified',
            cachedTimes: res.cachedSamples || [],
            uncachedTimes: res.uncachedSamples || [],
          })),
        };
        let telRunId = null;
        try { const tel = await submitTelemetry(payload); telRunId = tel.run_id; } catch {}
      }

      // Detached tier-3 Cloudflare verification; never blocks the UI.
      void verifyOpaqueAndReport(rawResults, controller.signal, telRunId);
    } catch (e) {
      console.error('Measurement failed', e);
    } finally {
      setRunning(false);
    }
  }, [resolvers, verifyOpaqueAndReport]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setRunning(false);
  }, []);

  const reset = () => {
    stop();
    setStarted(false);
    setResults([]);
    setProgress({ done: 0, total: 0 });
  };

  const handleCountryChange = (c) => {
    setPreferredCountry(c);
    // Selecting a country injects the Country factor (default 30% share) and
    // rescales the others; clearing it folds that share back into the rest.
    setWeights((w) => rebalanceWeights(w, COUNTRY_KEYS, 'countryMatch', c ? 30 : 0));
  };

  const filtered = applyHardFilters(results, {});
  const scored = useMemo(
    () => computeScores(filtered, weights, preferredCountry),
    [filtered, weights, preferredCountry]
  );

  const offlineCount = results.filter((r) => r.dead || r.scoreMs == null).length;
  const tableExpanded = expertMode || showAll;

  return (
    <div className="flex min-h-screen flex-col bg-base-200 text-base-content">
      <Header
        theme={theme}
        onToggleTheme={toggleTheme}
        expertMode={expertMode}
        onToggleExpert={() => setExpertMode((m) => !m)}
        onReset={reset}
      />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        <AnimatePresence mode="wait">
          {!started ? (
            <motion.div
              key="hero"
              className="flex min-h-[65vh] flex-col items-center justify-center"
              exit={{ y: -30, opacity: 0, transition: { duration: 0.3 } }}
            >
              <motion.h1
                className="mb-4 text-center text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.1 }}
              >
                <span className="text-base-content">DNS Resolver </span>
                <span className="bg-gradient-to-r from-primary via-secondary to-primary bg-[length:200%_100%] bg-clip-text text-transparent motion-preset-shimmer">
                  Recommender
                </span>
              </motion.h1>
              <motion.p
                className="mx-auto mb-7 max-w-xl text-center text-base leading-relaxed text-base-content/60 sm:text-lg"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.25 }}
              >
                Measure and compare 100+ public DNS-over-HTTPS resolvers directly from your
                browser. Find the right balance of speed, privacy, and security for your
                connection.
              </motion.p>
              <motion.div
                className="flex flex-col items-center gap-4"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.4 }}
              >
                <StartButton running={running} onStart={run} />
                <label className="flex cursor-pointer items-center gap-2 text-xs text-base-content/60">
                  <input
                    type="checkbox"
                    checked={optIn}
                    onChange={(e) => setOptIn(e.target.checked)}
                    className="checkbox checkbox-primary checkbox-sm"
                  />
                  Share anonymized results with HPI for research
                </label>
              </motion.div>
            </motion.div>
          ) : (
            <motion.div
              key="results"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
            >
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <h1 className="text-xl font-semibold text-base-content sm:text-2xl">Results</h1>
                  <p className="text-xs text-base-content/50">
                    {running
                      ? 'Measuring resolvers in your browser…'
                      : `${scored.length} measurable${offlineCount > 0 ? ` · ${offlineCount} offline` : ''}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {running ? (
                    <button onClick={stop} className="btn btn-sm btn-outline btn-error gap-1.5">
                      <Square size={14} fill="currentColor" /> Stop
                    </button>
                  ) : (
                    <button onClick={run} className="btn btn-sm btn-primary gap-1.5">
                      <RotateCcw size={14} /> Run again
                    </button>
                  )}
                </div>
              </div>

              {expertMode && (
                <FilterPanel
                  weights={weights}
                  onWeightsChange={setWeights}
                  preferredCountry={preferredCountry}
                  onPreferredCountryChange={handleCountryChange}
                  resolvers={resolvers}
                />
              )}

              {running && <ProgressBar done={progress.done} total={progress.total} />}

              {!running && scored.length > 0 && !expertMode && (
                <RecommendationCard top={scored[0]} />
              )}

              {results.length > 0 && (
                <ResultsTable
                  results={scored}
                  running={running}
                  expertMode={tableExpanded}
                  onExtend={() => setShowAll(true)}
                />
              )}

              {offlineCount > 0 && !running && (
                <p className="mt-3 text-center text-xs text-base-content/45">
                  {offlineCount} resolver{offlineCount === 1 ? '' : 's'} did not respond within the timeout and {offlineCount === 1 ? 'was' : 'were'} excluded from ranking.
                </p>
              )}

              <Methodology />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <Footer />
    </div>
  );
}

function Methodology() {
  return (
    <div className="collapse collapse-arrow mt-6 border border-base-300 bg-base-100">
      <input type="checkbox" />
      <div className="collapse-title text-sm font-medium text-base-content/80">
        How ranking &amp; verification work
      </div>
      <div className="collapse-content space-y-3 text-xs leading-relaxed text-base-content/60">
        <p>
          Each resolver is scored as <span className="font-mono text-base-content/80">0.8 &times; cached + 0.2 &times; uncached</span>{' '}
          latency, mirroring real browsing where most lookups hit the cache. Use{' '}
          <span className="font-medium text-base-content/80">Advanced</span> to re-rank by additional priorities; the bars are
          relative, so raising one factor automatically lowers the others&rsquo; share.
        </p>
        <p>
          <span className="font-medium text-base-content/80">Consistency</span> rewards low jitter, but only among already-fast
          resolvers: a resolver that is reliably <em>slow</em> can never reach the top on consistency alone.
        </p>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck size={13} className="text-success" /> DNSSEC validated
          </span>
          <span className="inline-flex items-center gap-1.5">
            <EyeOff size={13} className="text-info" /> No-logs policy
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Globe size={13} className="text-primary" /> Unfiltered
          </span>
        </div>
        <p className="font-medium text-base-content/80">Verification works in three tiers:</p>
        <ul className="ml-1 space-y-1">
          <li>
            <span className="font-medium text-primary">CORS</span>: the resolver sends CORS headers, so we parse its
            real DNS answer directly in your browser.
          </li>
          <li>
            <span className="font-medium text-success">Canary</span>: for opaque resolvers, a parallel query to a unique{' '}
            <span className="font-mono">verify.diic-hpi.org</span> sub-domain is matched against our own authoritative bind9 log.
          </li>
          <li>
            <span className="font-medium text-info">Authoritative</span>: opaque resolvers that miss the canary are
            cross-checked against Cloudflare&rsquo;s DNS analytics API to confirm they really queried our zone.
          </li>
        </ul>
        <p>
          Anything still unconfirmed after all three tiers is marked{' '}
          <span className="font-medium text-warning">Unverified</span>.
        </p>
      </div>
    </div>
  );
}
