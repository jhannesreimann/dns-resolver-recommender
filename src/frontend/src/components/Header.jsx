import { Globe, SlidersHorizontal } from 'lucide-react';
import ThemeToggle from './ThemeToggle';

export default function Header({ theme, onToggleTheme, expertMode, onToggleExpert, onReset }) {
  return (
    <header className="sticky top-0 z-40 border-b border-base-300 bg-base-100/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={onReset}
          className="group flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          title="Back to start"
        >
          <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-primary to-secondary text-primary-content shadow-sm transition-transform group-hover:scale-105">
            <Globe size={18} />
          </span>
          <span className="hidden text-sm font-semibold tracking-tight text-base-content sm:inline">
            DNS Resolver Recommender
          </span>
          <span className="text-sm font-semibold tracking-tight text-base-content sm:hidden">
            DNS&nbsp;RR
          </span>
        </button>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={onToggleExpert}
            aria-pressed={expertMode}
            className={`btn btn-sm gap-2 ${expertMode ? 'btn-primary' : 'btn-ghost text-base-content/70'}`}
            title="Toggle advanced ranking & all columns"
          >
            <SlidersHorizontal size={15} />
            <span className="hidden sm:inline">Advanced</span>
          </button>
          <a href="/probe-hosting.html" class="btn btn-sm gap-2">Host a Probe</a>
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        </div>
      </div>
    </header>
  );
}
