import { ArrowLeft, ShieldCheck, EyeOff, Radio, BadgeCheck, ServerCog, Clock, CircleSlash } from 'lucide-react';

const FEATURE_TAGS = [
  { key: 'dnssec', label: 'DNSSEC', tone: 'bg-success/15 text-success', icon: ShieldCheck, tip: 'Cryptographically validated answers (DNSSEC)' },
  { key: 'noLogs', label: 'No-logs', tone: 'bg-info/15 text-info', icon: EyeOff, tip: 'Operator advertises a no-logging policy' },
  { key: 'noFilter', label: 'Unfiltered', tone: 'bg-primary/15 text-primary', icon: Radio, tip: 'Resolves every domain, no ad/content blocking' },
];

const VERIF_TAGS = [
  { key: 'verified_dns', label: 'verified_dns', tone: 'bg-primary/15 text-primary', icon: ShieldCheck, tip: 'CORS wire-format passed or canary log matched' },
  { key: 'verified_canary', label: 'verified_canary', tone: 'bg-success/15 text-success', icon: BadgeCheck, tip: 'Opaque, confirmed by our authoritative canary DNS log' },
  { key: 'verified_auth', label: 'verified_auth', tone: 'bg-info/15 text-info', icon: ServerCog, tip: 'Opaque, confirmed via Cloudflare DNS analytics' },
  { key: 'unverified', label: 'unverified', tone: 'bg-warning/15 text-warning', icon: Clock, tip: 'Not confirmed by CORS, canary, or Cloudflare' },
  { key: 'dead', label: 'dead', tone: 'bg-base-content/10 text-base-content/50', icon: CircleSlash, tip: 'No valid response within the timeout window' },
];

function Field({ name, children }) {
  return (
    <li className="text-sm">
      <code className="rounded bg-base-200 px-1 py-0.5 text-[12px] font-semibold text-base-content/80">{name}</code>{' '}
      {children}
    </li>
  );
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-base-200">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <a
          href="/"
          className="btn btn-outline btn-sm mb-6 gap-1.5 border-base-300 text-base-content/70"
        >
          <ArrowLeft size={14} />
          Back to DNS Resolver Recommender
        </a>

        <h1 className="mb-4 text-2xl font-semibold text-base-content">Privacy Disclosure</h1>

        <p className="mb-4 text-sm leading-relaxed text-base-content/80">
          This service is provided by the chair of{' '}
          <a href="https://hpi.de/bajpai" className="link link-primary">
            Data-Intensive Internet Computing
          </a>{' '}
          at the Hasso Plattner Institute, University of Potsdam. We built this tool to
          help users find the fastest and most suitable DNS-over-HTTPS resolver for their
          connection.
        </p>

        <h2 className="mb-1 mt-6 text-base font-semibold text-primary">
          Why are these measurements relevant?
        </h2>
        <p className="mb-2 text-sm text-base-content/80">
          DNS performance differs for every person. It depends on location, ISP, and more.
          DNS resolvers also differ in the features they support:
        </p>
        <ul className="mb-4 ml-4 list-disc space-y-0.5 text-sm text-base-content/80">
          <li>Which DNS protocol? (DNS over UDP, TCP, TLS, HTTPS, QUIC; this project focuses on DoH)</li>
          <li>Does the resolver log DNS requests?</li>
          <li>Does the resolver support DNSSEC?</li>
        </ul>
        <p className="text-sm text-base-content/80">
          We built this tool to let users make an informed decision based on real
          measurements from their own connection.
        </p>

        <h2 className="mb-1 mt-6 text-base font-semibold text-primary">
          Why do we collect data?
        </h2>
        <p className="mb-4 text-sm leading-relaxed text-base-content/80">
          Internet measurement research is data-driven. Real user data helps us identify
          problems and develop solutions. This project is similar to other research
          platforms (e.g., M-Lab, Happy Eyeballs Webtester). However, we make every effort
          to anonymize: we <strong>never</strong> store your IP address, only coarse ASN and
          country derived from a local GeoLite2 lookup. The raw User-Agent is parsed into
          browser family and OS and then discarded.
        </p>

        <h2 className="mb-1 mt-6 text-base font-semibold text-primary">Opt-in only</h2>
        <p className="mb-4 text-sm text-base-content/80">
          No data is collected unless you explicitly check the opt-in checkbox on the main
          page. The measurement runs entirely in your browser. Only when you opt in are the
          results sent to our server.
        </p>

        <h2 className="mb-2 mt-6 text-base font-semibold text-primary">
          What data is stored (upon opt-in)
        </h2>
        <p className="mb-3 text-sm text-base-content/70">
          Data is stored on a server under the complete control of the DIIC chair at HPI.
          No cloud providers are involved.
        </p>

        <div className="collapse collapse-arrow mb-3 border border-base-300 bg-base-100">
          <input type="checkbox" />
          <div className="collapse-title text-sm font-semibold text-base-content/80">
            Per measurement run (one row in the{' '}
            <code className="rounded bg-base-200 px-1 py-0.5 text-[12px]">runs</code> table)
          </div>
          <div className="collapse-content">
            <ul className="space-y-1 text-sm text-base-content/70">
              <Field name="timestamp">When the run was stored (Europe/Berlin)</Field>
              <Field name="asn, asn_org">Client AS number and organization (from GeoLite2)</Field>
              <Field name="country">Country the user was in (from GeoLite2; IP discarded)</Field>
              <Field name="browser_family, browser_major, os_family">Coarse browser and OS (parsed from User-Agent; raw string discarded)</Field>
              <Field name="browser_lang">Browser language setting</Field>
              <Field name="total_resolvers">How many resolvers were probed</Field>
              <Field name="cors_count">Resolvers with CORS headers</Field>
              <Field name="opaque_count">Resolvers without CORS (opaque responses)</Field>
              <Field name="dead_count">Resolvers that were unreachable</Field>
              <Field name="verified_dns_count">Resolvers verified via CORS or canary log</Field>
              <Field name="verified_auth_count">Resolvers verified via Cloudflare authoritative analytics</Field>
              <Field name="unverified_count">Resolvers that could not be verified</Field>
              <Field name="paradox_count">Resolvers where uncached was faster than cached</Field>
              <Field name="avg_cached_ms, avg_uncached_ms">Average latency across all resolvers</Field>
              <Field name="client_http_version">HTTP version between browser and our server</Field>
              <Field name="client_ip_version">4 for IPv4, 6 for IPv6</Field>
            </ul>
          </div>
        </div>

        <div className="collapse collapse-arrow mb-4 border border-base-300 bg-base-100">
          <input type="checkbox" />
          <div className="collapse-title text-sm font-semibold text-base-content/80">
            Per resolver (1 row per resolver in the{' '}
            <code className="rounded bg-base-200 px-1 py-0.5 text-[12px]">measurements</code> table)
          </div>
          <div className="collapse-content">
            <ul className="space-y-1 text-sm text-base-content/70">
              <Field name="resolver_id, resolver_name">Identifier and display name</Field>
              <Field name="resolver_url">DoH endpoint URL</Field>
              <Field name="cached_avg_ms">Average cached latency (trimmed mean of 4)</Field>
              <Field name="uncached_avg_ms">Average uncached latency (trimmed mean of 4)</Field>
              <Field name="score_ms">Weighted score: 0.8 × cached + 0.2 × uncached</Field>
              <Field name="cached_times, uncached_times">Raw 5-sample timing arrays (JSON)</Field>
              <Field name="paradox">Whether uncached measured faster than cached</Field>
              <li className="text-sm">
                Stamp features (self-declared by operator):
                <span className="ml-2 inline-flex flex-wrap gap-1">
                  {FEATURE_TAGS.map((f) => (
                    <span
                      key={f.key}
                      className={`tooltip inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${f.tone}`}
                      data-tip={f.tip}
                    >
                      <f.icon size={12} strokeWidth={2.5} />
                      {f.label}
                    </span>
                  ))}
                </span>
              </li>
              <Field name="resolver_country">
                Country from GeoLite2 on stamp IP, or &ldquo;Global&rdquo; for anycast
              </Field>
              <li className="text-sm">
                <code className="rounded bg-base-200 px-1 py-0.5 text-[12px] font-semibold text-base-content/80">verification_status</code>{' '}
                <span className="inline-flex flex-wrap gap-1">
                  {VERIF_TAGS.map((v) => (
                    <span
                      key={v.key}
                      className={`tooltip inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${v.tone}`}
                      data-tip={v.tip}
                    >
                      <v.icon size={12} strokeWidth={2.5} />
                      {v.label}
                    </span>
                  ))}
                </span>
              </li>
            </ul>
          </div>
        </div>

        <h2 className="mb-1 mt-6 text-base font-semibold text-primary">
          Is the data available to the public?
        </h2>
        <p className="mb-4 text-sm text-base-content/80">
          We plan to make the data available to researchers. We are currently in
          deployment. For current information, contact Robert Richter (
          <a href="https://hpi.de/en/bajpai/team/" className="link link-primary">
            DIIC Team Page
          </a>
          ).
        </p>

        <h2 className="mb-1 mt-6 text-base font-semibold text-primary">Collaborators</h2>
        <ul className="mb-8 ml-4 list-disc space-y-0.5 text-sm text-base-content/80">
          <li>Jhannes Reimann</li>
          <li>Robert Richter</li>
          <li>Vaibhav Bajpai</li>
        </ul>
      </div>
    </div>
  );
}
