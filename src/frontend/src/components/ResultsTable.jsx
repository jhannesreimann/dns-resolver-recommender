import { useState } from 'react';
import { ChevronDown, Table2, AlertTriangle } from 'lucide-react';
import { FeatureBadges, VerificationBadge, CopyButton } from './ResolverBadges';

function SampleChips({ samples }) {
  if (!samples || samples.length === 0) {
    return <span className="text-[11px] text-base-content/40">no samples</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {samples.map((t, i) => (
        <span
          key={i}
          className="rounded bg-base-100 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-base-content/70"
        >
          {Math.round(t)}
        </span>
      ))}
    </div>
  );
}

function DetailLine({ label, value, copy }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 shrink-0 text-base-content/50">{label}</span>
      <code className="min-w-0 flex-1 truncate font-mono text-base-content/80">{value}</code>
      {copy && <CopyButton value={value} label="" />}
    </div>
  );
}

function ExpandRow({ result }) {
  const r = result.resolver;
  return (
    <div className="border-t border-base-300 bg-base-200/50 px-4 py-4 motion-preset-fade motion-duration-200 sm:px-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-2.5">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-base-content/40">
            Connection
          </h4>
          {r.description && (
            <p className="text-xs leading-relaxed text-base-content/60">{r.description}</p>
          )}
          <DetailLine label="DoH URL" value={r.url} copy />
          <DetailLine label="System IP" value={r.ip_address || '--'} copy={!!r.ip_address} />
          <div className="flex items-center gap-2 text-xs">
            <span className="w-16 shrink-0 text-base-content/50">Country</span>
            <span className="flex items-center gap-1.5 text-base-content/80">
              {r.country && (
                <img
                  src={`https://flagcdn.com/24x18/${r.country.toLowerCase()}.png`}
                  alt=""
                  className="h-3 w-4 rounded-sm object-cover"
                />
              )}
              {r.country || '--'}
            </span>
          </div>
          <p className="pt-1 text-[11px] leading-relaxed text-base-content/45">
            Add the DoH URL to your browser&rsquo;s Secure DNS setting to use this resolver.
          </p>
        </div>

        <div className="space-y-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-base-content/40">
            Measurement
          </h4>
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px]">
              <span className="text-base-content/50">
                Cached <span className="opacity-70">&middot; 7 queries, drop 2</span>
              </span>
              <span className="font-mono tabular-nums text-base-content/70">
                {result.cachedAvg != null ? `${result.cachedAvg.toFixed(1)} ms` : '--'}
              </span>
            </div>
            <SampleChips samples={result.cachedSamples} />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px]">
              <span className="text-base-content/50">
                Uncached <span className="opacity-70">&middot; 5 fresh UUIDs</span>
              </span>
              <span className="font-mono tabular-nums text-base-content/70">
                {result.uncachedAvg != null ? `${result.uncachedAvg.toFixed(1)} ms` : '--'}
              </span>
            </div>
            <SampleChips samples={result.uncachedSamples} />
          </div>
          <div className="flex items-center justify-between rounded-lg bg-base-100 px-3 py-2 text-xs">
            <span className="font-mono text-base-content/55">
              0.8&times;cached + 0.2&times;uncached
            </span>
            <span className="font-mono font-semibold tabular-nums text-primary">
              {result.scoreMs != null ? `${result.scoreMs.toFixed(1)} ms` : '--'}
            </span>
          </div>
          {result.paradox && (
            <div className="flex items-center gap-1.5 text-[11px] text-warning">
              <AlertTriangle size={12} />
              Uncached measured faster than cached (cache/anycast effect)
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ result, rank }) {
  const [open, setOpen] = useState(false);
  const top = rank === 1;

  return (
    <>
      <tr
        onClick={() => setOpen((o) => !o)}
        className={`cursor-pointer border-b border-base-200 transition-colors hover:bg-base-200/60 ${
          top ? 'bg-primary/5' : ''
        }`}
      >
        <td className="w-8 py-3 text-center font-mono text-xs text-base-content/40">{rank}</td>
        <td className="py-3">
          <div className="flex items-center gap-2">
            <FeatureBadges resolver={result.resolver} />
            <span className="truncate text-sm font-medium text-base-content max-w-[120px] sm:max-w-[200px]">
              {result.resolver.name}
            </span>
            {result.resolver.country && (
              <img
                src={`https://flagcdn.com/24x18/${result.resolver.country.toLowerCase()}.png`}
                alt=""
                className="hidden h-2.5 w-3.5 rounded-sm object-cover sm:inline-block"
              />
            )}
          </div>
        </td>
        <td className="w-20 py-3 text-right font-mono text-sm font-semibold tabular-nums text-primary">
          {result.scoreMs != null ? result.scoreMs.toFixed(1) : '--'}
        </td>
        <td className="hidden w-20 py-3 text-right font-mono text-xs tabular-nums text-base-content/70 sm:table-cell">
          {result.cachedAvg != null ? result.cachedAvg.toFixed(1) : '--'}
        </td>
        <td className="hidden w-20 py-3 text-right font-mono text-xs tabular-nums text-base-content/70 sm:table-cell">
          {result.uncachedAvg != null ? result.uncachedAvg.toFixed(1) : '--'}
        </td>
        <td className="w-28 py-3 text-center">
          <VerificationBadge result={result} />
        </td>
        <td className="w-6 py-3 text-base-content/40">
          <ChevronDown
            size={15}
            className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          />
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} className="p-0">
            <ExpandRow result={result} />
          </td>
        </tr>
      )}
    </>
  );
}

export default function ResultsTable({ results, running, expertMode, onExtend }) {
  const showAll = expertMode;
  const visible = showAll ? results : results.slice(0, 10);
  const hiddenCount = results.length - visible.length;

  return (
    <div className="overflow-hidden rounded-2xl border border-base-300 bg-base-100">
      <div className="overflow-x-auto overflow-y-hidden">
        <table className="table w-full">
          <thead>
            <tr className="bg-base-200 text-base-content/55">
              <th className="w-8 text-center text-[11px] font-medium uppercase">#</th>
              <th className="text-[11px] font-medium uppercase">Resolver</th>
              <th className="w-20 text-right text-[11px] font-medium uppercase">Score</th>
              <th className="hidden w-20 text-right text-[11px] font-medium uppercase sm:table-cell">Cached</th>
              <th className="hidden w-20 text-right text-[11px] font-medium uppercase sm:table-cell">Uncached</th>
              <th className="w-28 text-center text-[11px] font-medium uppercase">Status</th>
              <th className="w-6" />
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => (
              <Row key={r.resolver.id} result={r} rank={i + 1} />
            ))}
          </tbody>
        </table>
      </div>

      {!showAll && hiddenCount > 0 && (
        <button
          onClick={onExtend}
          className="flex w-full cursor-pointer items-center justify-center gap-2 border-t border-base-300 py-3 text-sm font-medium text-base-content/60 transition-colors hover:bg-base-200/60 hover:text-base-content"
        >
          <Table2 size={15} />
          Show all {results.length} resolvers
        </button>
      )}

      {results.length === 0 && !running && (
        <div className="py-12 text-center text-sm text-base-content/50">
          No measurable resolvers yet.
        </div>
      )}
    </div>
  );
}
