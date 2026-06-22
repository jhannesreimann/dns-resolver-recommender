import { useState } from 'react';
import {
  ShieldCheck,
  EyeOff,
  Radio,
  BadgeCheck,
  ServerCog,
  Clock,
  Loader,
  CircleSlash,
  Check,
  Copy,
} from 'lucide-react';

const TONE = {
  success: 'bg-success/15 text-success',
  info: 'bg-info/15 text-info',
  warning: 'bg-warning/15 text-warning',
  primary: 'bg-primary/15 text-primary',
  error: 'bg-error/15 text-error',
  neutral: 'bg-base-content/10 text-base-content/60',
};

const FEATURES = [
  { key: 'dnssec', label: 'DNSSEC', tone: 'success', icon: ShieldCheck, tip: 'Cryptographically validated answers (DNSSEC)' },
  { key: 'noLogs', label: 'No-logs', tone: 'info', icon: EyeOff, tip: 'Operator advertises a no-logging policy' },
  { key: 'noFilter', label: 'Unfiltered', tone: 'primary', icon: Radio, tip: 'Resolves every domain, no ad/content blocking' },
];

function Pill({ tone = 'neutral', icon: Icon, children, tip }) {
  const content = (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${TONE[tone]}`}
    >
      {Icon && <Icon size={12} strokeWidth={2.5} />}
      {children}
    </span>
  );
  if (!tip) return content;
  return (
    <span className="tooltip tooltip-bottom" data-tip={tip}>
      {content}
    </span>
  );
}

// Compact icon-only feature markers for dense table rows.
export function FeatureBadges({ resolver }) {
  const active = FEATURES.filter((f) => resolver[f.key]);
  if (active.length === 0) return <span className="text-base-content/30 text-xs">--</span>;
  return (
    <span className="flex items-center gap-1">
      {active.map(({ key, tone, icon: Icon, label, tip }) => (
        <span key={key} className={`tooltip tooltip-right rounded-md p-1 ${TONE[tone]}`} data-tip={tip} aria-label={label}>
          <Icon size={12} strokeWidth={2.5} />
        </span>
      ))}
    </span>
  );
}

// Labeled feature pills for the recommendation card / expanded detail.
export function FeatureList({ resolver, showInactive = false }) {
  const items = showInactive ? FEATURES : FEATURES.filter((f) => resolver[f.key]);
  if (items.length === 0) {
    return <span className="text-xs text-base-content/50">No advertised privacy/security features</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map(({ key, label, tone, icon, tip }) => {
        const on = resolver[key];
        return (
          <Pill key={key} tone={on ? tone : 'neutral'} icon={icon} tip={tip}>
            {label}
          </Pill>
        );
      })}
    </div>
  );
}

function computeVerification(result) {
  if (result.dead) {
    return { label: 'Offline', tone: 'neutral', icon: CircleSlash, tip: 'No valid response within the timeout window' };
  }
  const cors = result.resolver.cors;
  if (cors && result.canaryVerified) {
    return { label: 'CORS + Canary', tone: 'success', icon: BadgeCheck, tip: 'CORS response parsed in-browser AND the query appeared in our authoritative DNS log' };
  }
  if (cors) {
    return { label: 'CORS', tone: 'primary', icon: ShieldCheck, tip: 'Real DNS answer parsed directly in your browser (CORS headers present)' };
  }
  if (result.canaryVerified) {
    return { label: 'Canary', tone: 'success', icon: BadgeCheck, tip: 'Opaque response, but the query appeared in our own authoritative bind9 canary log' };
  }
  if (result.cloudflareVerified) {
    return { label: 'Authoritative', tone: 'info', icon: ServerCog, tip: 'Opaque response, confirmed via Cloudflare DNS analytics: the resolver really queried our authoritative zone' };
  }
  if (result.verifying) {
    return { label: 'Verifying', tone: 'neutral', icon: Loader, tip: 'Polling Cloudflare DNS analytics for this opaque resolver…', spin: true };
  }
  return { label: 'Unverified', tone: 'warning', icon: Clock, tip: 'Opaque (no-CORS) request, not (yet) confirmed in our canary or Cloudflare logs' };
}

export function VerificationBadge({ result }) {
  const { label, tone, icon: Icon, tip, spin } = computeVerification(result);
  return (
    <span className="tooltip tooltip-left" data-tip={tip}>
      <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${TONE[tone]}`}>
        <Icon size={12} strokeWidth={2.5} className={spin ? 'animate-spin' : undefined} />
        {label}
      </span>
    </span>
  );
}

export function CopyButton({ value, label = 'Copy', className = '' }) {
  const [copied, setCopied] = useState(false);
  const copy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      className={`btn btn-xs btn-ghost gap-1 text-base-content/60 hover:text-base-content ${className}`}
      title={`${label} to clipboard`}
    >
      {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
      {copied ? 'Copied' : label}
    </button>
  );
}
