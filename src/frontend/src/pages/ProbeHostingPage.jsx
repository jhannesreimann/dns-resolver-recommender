import { ArrowLeft } from 'lucide-react';

export default function ProbeHostingPage() {
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

        <h1 className="mb-6 text-2xl font-semibold text-base-content">Hosting a Probe</h1>

        <p className="mb-4 text-sm text-base-content/80">
          For continouos measurements, we are running probe to the DNS Resolver Recommender
          regularly. Enhancing diversity of the measurement data requires many different
          probes. Therefore, we encourage the deployment of measurement probes.
        </p>
        <p className="mb-6 text-sm text-base-content/80">
          We build a headless probe based on Firefox and Selenium. Essentially, it opens the
          website, clicks on opt-in, and starts the measurement. The software is bundled in
          Docker and available online:
          <a href="https://hub.docker.com/r/richterrobert/dnsrr-headless-probe" className="link link-primary">
            richterrobert/dnsrr-headless-probe
          </a>
        </p>

        <h2 className="mb-1 mt-6 text-base font-semibold text-primary">Making Modifications</h2>
        <p className="mb-6 text-sm text-base-content/80">
          All probe code is openly available. See GitHub for more information:
          <a href="https://github.com/diic-starlink/dnsrr-headless-probe" className="link link-primary">
            https://github.com/diic-starlink/dnsrr-headless-probe
          </a>
        </p>
      </div>
    </div>
  );
}
