import { Play } from 'lucide-react';

export default function StartButton({ running, onStart, size = 'lg' }) {
  if (running) return null;

  return (
    <button
      onClick={onStart}
      className={`btn btn-primary ${size === 'lg' ? 'btn-lg px-10' : 'px-8'} rounded-xl text-base font-medium shadow-lg shadow-primary/25 transition-transform hover:scale-[1.02] active:scale-95`}
    >
      <Play size={18} fill="currentColor" />
      Start measurement
    </button>
  );
}
