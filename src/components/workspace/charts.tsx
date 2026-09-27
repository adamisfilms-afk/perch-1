// Small, dependency-free charts for the KPI band. Server-rendered SVG.

/** A thin trend line with a dot on the latest value, and an optional dashed target line. */
export function Sparkline({ values, target, label }: { values: number[]; target?: number | null; label: string }) {
  const w = 220;
  const h = 48;
  const pad = 4;
  // Only show the target line when it's close enough not to flatten the trend.
  const dataMax = Math.max(1, ...values);
  const showTarget = target != null && target <= dataMax * 1.5;
  const max = Math.max(dataMax, showTarget ? target : 0);
  const min = Math.min(...values, showTarget ? target : Infinity);
  const range = max - min || 1;
  const x = (i: number) => pad + (i / Math.max(1, values.length - 1)) * (w - pad * 2);
  const y = (v: number) => h - pad - ((v - min) / range) * (h - pad * 2);
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = values.length - 1;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-12 w-full max-w-56 overflow-visible" role="img" aria-label={label}>
      {showTarget && (
        <line x1={pad} x2={w - pad} y1={y(target!)} y2={y(target!)} stroke="currentColor" strokeDasharray="2 4" className="text-neutral-300" />
      )}
      {values.length > 1 && <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.25} className="text-neutral-800" />}
      {last >= 0 && <circle cx={x(last)} cy={y(values[last])} r={2.5} className="fill-neutral-900" />}
    </svg>
  );
}

/**
 * A row of ticks from 0 to `max`, filled up to the current value, with ▼ over the value
 * and a longer tick under the target.
 */
export function TickGauge({ value, max, target, label }: { value: number | null; max: number; target?: number | null; label: string }) {
  const ticks = 48;
  const w = 250;
  const step = w / (ticks - 1);
  const pos = (v: number) => Math.min(w, Math.max(0, (v / max) * w));
  const filled = value == null ? -1 : Math.round((Math.min(value, max) / max) * (ticks - 1));
  return (
    <svg viewBox={`-4 0 ${w + 8} 30`} className="h-8 w-full max-w-64 overflow-visible" role="img" aria-label={label}>
      {value != null && <path d={`M${pos(value) - 4},4 h8 l-4,6 z`} className="fill-neutral-900" />}
      {Array.from({ length: ticks }, (_, i) => (
        <line key={i} x1={i * step} x2={i * step} y1={12} y2={20} strokeWidth={1.2} stroke="currentColor" className={i <= filled ? "text-neutral-700" : "text-neutral-300"} />
      ))}
      {target != null && (
        <g>
          <title>Target</title>
          <line x1={pos(target)} x2={pos(target)} y1={22} y2={27} strokeWidth={1.5} stroke="currentColor" className="text-neutral-700" />
        </g>
      )}
    </svg>
  );
}
