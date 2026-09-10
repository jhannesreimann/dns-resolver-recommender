import { ArrowLeft } from 'lucide-react';

export default function ImprintPage() {
  return (
    <div className="min-h-screen bg-base-200">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <a
          href="/"
          className="btn btn-outline btn-sm mb-6 gap-1.5 border-base-300 text-base-content/70"
        >
          <ArrowLeft size={14} />
          Back to DoH Bench
        </a>

        <h1 className="mb-6 text-2xl font-semibold text-base-content">Imprint</h1>

        <p className="mb-4 text-sm text-base-content/80">
          This site is managed and maintained by the chair of Data-Intensive Internet
          Computing at Hasso Plattner Institute, University of Potsdam, Germany.
        </p>
        <p className="mb-6 text-sm text-base-content/80">
          For requests, please see the chair&rsquo;s website:{' '}
          <a href="https://hpi.de/en/bajpai/" className="link link-primary">
            hpi.de/en/bajpai
          </a>
        </p>

        <h2 className="mb-1 mt-6 text-base font-semibold text-primary">Contact</h2>
        <ul className="mb-4 space-y-1 text-sm text-base-content/80">
          <li>
            Jhannes Reimann ·{' '}
            <a href="mailto:jhannes.reimann@student.hpi.de" className="link link-primary">
              jhannes.reimann@student.hpi.de
            </a>
          </li>
          <li>
            Robert Richter ·{' '}
            <a href="mailto:robert.richter@hpi.de" className="link link-primary">
              robert.richter@hpi.de
            </a>
          </li>
        </ul>

        <h2 className="mb-1 mt-6 text-base font-semibold text-primary">Address</h2>
        <p className="text-sm leading-relaxed text-base-content/80">
          Hasso Plattner Institute, University of Potsdam
          <br />
          Prof.-Dr.-Helmert-Str. 2-3
          <br />
          14482 Potsdam
          <br />
          Germany
        </p>
      </div>
    </div>
  );
}
