export default function Footer() {
  return (
    <footer className="border-t border-base-300 bg-base-100">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-1 px-4 py-3 text-[11px] text-base-content/60 sm:flex-row sm:px-6 lg:px-8">
        <span>DNS Resolver Recommender &middot; Hasso Plattner Institute</span>
        <span className="flex items-center gap-4">
          <span className="link link-hover cursor-default opacity-70">Imprint (soon)</span>
          <span className="link link-hover cursor-default opacity-70">Privacy (soon)</span>
        </span>
      </div>
    </footer>
  );
}
