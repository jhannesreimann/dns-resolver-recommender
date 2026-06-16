export default function ProgressBar({ done, total }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="mb-6">
      <div className="mb-1.5 flex justify-between text-xs">
        <span className="text-base-content/60">
          Measuring resolver {done} of {total}&hellip;
        </span>
        <span className="font-mono font-medium tabular-nums text-primary">{pct}%</span>
      </div>
      <progress className="progress progress-primary h-2 w-full" value={pct} max="100" />
    </div>
  );
}
