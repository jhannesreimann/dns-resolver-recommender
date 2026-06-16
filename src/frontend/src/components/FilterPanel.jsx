import { useMemo } from 'react';
import { SlidersHorizontal, RotateCcw, MapPin, ChevronDown } from 'lucide-react';
import {
  WEIGHT_LABELS,
  WEIGHT_HINTS,
  PRIORITY_KEYS,
  PRESETS,
  DEFAULT_WEIGHTS,
  weightDistribution,
  rebalanceWeights,
} from '../lib/scoring';

const flagUrl = (c) => `https://flagcdn.com/24x18/${c.toLowerCase()}.png`;

const RANGE_CLASS = {
  speed: 'range-primary',
  consistency: 'range-accent',
  dnssec: 'range-success',
  privacy: 'range-info',
  unfiltered: 'range-warning',
  countryMatch: 'range-secondary',
};

const SEG_CLASS = {
  speed: 'bg-primary',
  consistency: 'bg-accent',
  dnssec: 'bg-success',
  privacy: 'bg-info',
  unfiltered: 'bg-warning',
  countryMatch: 'bg-secondary',
};

function PrioritySlider({ keyName, value, onChange }) {
  return (
    <div className="flex flex-col gap-1.5 select-none">
      <div className="flex items-baseline justify-between gap-2">
        <span className="tooltip tooltip-bottom text-xs font-medium text-base-content/80" data-tip={WEIGHT_HINTS[keyName]}>
          {WEIGHT_LABELS[keyName]}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-base-content/50">
          {value === 0 ? 'off' : `${value}%`}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`range range-xs ${RANGE_CLASS[keyName]}`}
        aria-label={WEIGHT_LABELS[keyName]}
      />
    </div>
  );
}

export default function FilterPanel({
  weights,
  onWeightsChange,
  preferredCountry,
  onPreferredCountryChange,
  resolvers,
}) {
  const countries = useMemo(() => {
    const seen = new Set();
    return (resolvers || [])
      .map((r) => r.country)
      .filter((c) => {
        if (!c || seen.has(c)) return false;
        seen.add(c);
        return true;
      })
      .sort();
  }, [resolvers]);

  const sliderKeys = preferredCountry ? [...PRIORITY_KEYS, 'countryMatch'] : PRIORITY_KEYS;

  // Sliders share a single 100% budget: dragging one rebalances the rest so
  // every thumb moves to represent its real share of the ranking weight.
  const setShare = (key, value) => onWeightsChange(rebalanceWeights(weights, sliderKeys, key, value));

  const { total, shares } = weightDistribution(weights);
  const activeKeys = sliderKeys.filter((k) => shares[k] > 0);

  // Apply a preset to the priority keys, normalized to fill whatever budget the
  // (optional) Country factor leaves, so the total still sums to 100%.
  const applyPreset = (preset) => {
    const countryShare = preferredCountry ? weights.countryMatch || 0 : 0;
    const room = 100 - countryShare;
    const sum = PRIORITY_KEYS.reduce((s, k) => s + (preset[k] || 0), 0);
    const next = { ...weights, countryMatch: countryShare };
    let acc = 0;
    PRIORITY_KEYS.forEach((k, i) => {
      if (i === PRIORITY_KEYS.length - 1) {
        next[k] = Math.max(0, room - acc);
      } else {
        const v = sum > 0 ? Math.round(((preset[k] || 0) / sum) * room) : 0;
        next[k] = v;
        acc += v;
      }
    });
    onWeightsChange(next);
  };

  const prioSum = PRIORITY_KEYS.reduce((s, k) => s + (weights[k] || 0), 0);
  const isPreset = (preset) => {
    const pSum = PRIORITY_KEYS.reduce((s, k) => s + (preset[k] || 0), 0);
    if (prioSum === 0 || pSum === 0) return false;
    return PRIORITY_KEYS.every(
      (k) => Math.round(((weights[k] || 0) / prioSum) * 100) === Math.round(((preset[k] || 0) / pSum) * 100)
    );
  };

  const pickCountry = (c) => {
    onPreferredCountryChange(c);
    if (document.activeElement) document.activeElement.blur();
  };

  return (
    <div className="card relative z-30 mb-6 border border-base-300 bg-base-100 motion-preset-fade motion-duration-300">
      <div className="card-body gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <SlidersHorizontal size={15} className="text-primary" />
          <span className="text-sm font-semibold text-base-content">Ranking priorities</span>
          <span className="text-xs text-base-content/50">
            relative importance: raising one lowers the others
          </span>
          <button
            type="button"
            onClick={() => applyPreset(DEFAULT_WEIGHTS)}
            className="btn btn-ghost btn-xs ml-auto gap-1 text-base-content/60"
          >
            <RotateCcw size={12} /> Reset
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {Object.entries(PRESETS).map(([name, preset]) => (
            <button
              key={name}
              type="button"
              onClick={() => applyPreset(preset)}
              className={`btn btn-xs capitalize ${isPreset(preset) ? 'btn-primary' : 'btn-outline border-base-300 text-base-content/70'}`}
            >
              {name}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          {sliderKeys.map((key) => (
            <PrioritySlider
              key={key}
              keyName={key}
              value={weights[key]}
              onChange={(v) => setShare(key, v)}
            />
          ))}
        </div>

        {/* Live distribution bar: visualizes how the sliders combine into the
            normalized weights actually used for ranking. */}
        <div>
          <div className="mb-1 flex items-center justify-between text-[11px] text-base-content/50">
            <span>Effective ranking weight</span>
            <span>{total === 0 ? 'pure latency ranking' : `${activeKeys.length} factor${activeKeys.length === 1 ? '' : 's'}`}</span>
          </div>
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-base-300">
            {total === 0 ? (
              <div className="h-full w-full bg-base-content/15" />
            ) : (
              activeKeys.map((key) => (
                <div
                  key={key}
                  className={`tooltip h-full ${SEG_CLASS[key]} transition-all duration-300`}
                  data-tip={`${WEIGHT_LABELS[key]} ${Math.round(shares[key] * 100)}%`}
                  style={{ width: `${shares[key] * 100}%` }}
                />
              ))
            )}
          </div>
          {total > 0 && (
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {activeKeys.map((key) => (
                <span key={key} className="inline-flex items-center gap-1.5 text-[11px] text-base-content/60">
                  <span className={`size-2 rounded-full ${SEG_CLASS[key]}`} />
                  {WEIGHT_LABELS[key]}
                </span>
              ))}
            </div>
          )}
        </div>

        {countries.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-base-300 pt-4">
            <MapPin size={14} className="text-secondary" />
            <span className="text-xs text-base-content/70">Prefer resolvers in</span>
            <div className="dropdown dropdown-end">
              <div
                tabIndex={0}
                role="button"
                className="btn btn-sm btn-outline border-base-300 gap-2 font-normal"
              >
                {preferredCountry ? (
                  <>
                    <img src={flagUrl(preferredCountry)} alt="" className="h-3 w-4 rounded-sm object-cover" />
                    {preferredCountry}
                  </>
                ) : (
                  'Any country'
                )}
                <ChevronDown size={14} className="opacity-60" />
              </div>
              <ul
                tabIndex={0}
                className="dropdown-content menu z-[60] mt-1 max-h-64 w-52 flex-nowrap overflow-y-auto rounded-box border border-base-300 bg-base-100 p-1 text-xs shadow-lg"
              >
                <li>
                  <button type="button" onClick={() => pickCountry('')} className={!preferredCountry ? 'active' : ''}>
                    Any country
                  </button>
                </li>
                {countries.map((c) => (
                  <li key={c}>
                    <button
                      type="button"
                      onClick={() => pickCountry(c)}
                      className={preferredCountry === c ? 'active' : ''}
                    >
                      <img src={flagUrl(c)} alt="" className="h-3 w-4 rounded-sm object-cover" />
                      {c}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
