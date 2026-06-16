import { motion } from 'framer-motion';
import { Award, Check } from 'lucide-react';
import { FeatureList, CopyButton, VerificationBadge } from './ResolverBadges';

function Stat({ label, value, unit, accent }) {
  return (
    <div className="rounded-lg bg-base-200 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-base-content/50">{label}</div>
      <div className={`font-mono text-lg font-semibold tabular-nums ${accent ? 'text-primary' : 'text-base-content'}`}>
        {value}
        {unit && <span className="ml-0.5 text-xs font-normal text-base-content/50">{unit}</span>}
      </div>
    </div>
  );
}

export default function RecommendationCard({ top }) {
  if (!top) return null;

  const r = top.resolver;
  const d = top.dimensions || {};

  const reasons = [];
  if (d.speed > 0.85) reasons.push('Among the fastest measured');
  else if (top.scoreMs != null) reasons.push(`Low weighted latency (${top.scoreMs.toFixed(0)} ms)`);
  if (d.consistency > 0.8) reasons.push('Very consistent latency');
  if (r.dnssec) reasons.push('DNSSEC validation');
  if (r.noLogs) reasons.push('No-logs policy');
  if (r.noFilter) reasons.push('Unfiltered resolution');
  if (top.canaryVerified) reasons.push('Verified via canary log');
  else if (top.cloudflareVerified) reasons.push('Verified via Cloudflare analytics');

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      className="card relative mb-6 border border-primary/30 bg-base-100 shadow-md"
    >
      <div className="absolute inset-x-0 top-0 h-1 rounded-t-2xl bg-gradient-to-r from-primary via-secondary to-primary" />
      <div className="card-body gap-4 p-5">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-secondary">
            <Award size={13} /> Recommended
          </span>
          <div className="ml-auto">
            <VerificationBadge result={top} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="text-2xl font-bold text-base-content">{r.name}</h2>
          {r.country && (
            <img
              src={`https://flagcdn.com/24x18/${r.country.toLowerCase()}.png`}
              alt={r.country}
              className="h-3.5 w-5 rounded-sm object-cover"
            />
          )}
        </div>

        <FeatureList resolver={r} />

        <div className="grid grid-cols-3 gap-2">
          <Stat label="Score" value={top.scoreMs != null ? top.scoreMs.toFixed(1) : '--'} unit="ms" accent />
          <Stat label="Cached" value={top.cachedAvg != null ? top.cachedAvg.toFixed(1) : '--'} unit="ms" />
          <Stat label="Uncached" value={top.uncachedAvg != null ? top.uncachedAvg.toFixed(1) : '--'} unit="ms" />
        </div>

        {reasons.length > 0 && (
          <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
            {reasons.map((reason, i) => (
              <li key={i} className="inline-flex items-center gap-1.5 text-xs text-base-content/70">
                <Check size={13} className="text-success" />
                {reason}
              </li>
            ))}
          </ul>
        )}

        <div className="rounded-lg border border-base-300 bg-base-200/60 p-3">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-base-content/50">
            Use this resolver (DoH URL)
          </div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-base-100 px-2 py-1 font-mono text-xs text-base-content/80">
              {r.url}
            </code>
            <CopyButton value={r.url} label="Copy" />
          </div>
          {r.ip_address && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[11px] text-base-content/50">System IP</span>
              <code className="rounded bg-base-100 px-2 py-0.5 font-mono text-xs text-base-content/80">{r.ip_address}</code>
              <CopyButton value={r.ip_address} label="Copy" />
            </div>
          )}
          <p className="mt-2 text-[11px] leading-relaxed text-base-content/50">
            Paste the DoH URL into your browser&rsquo;s Secure DNS setting, or use the IP in your system network settings.
          </p>
        </div>
      </div>
    </motion.div>
  );
}
