// Shared, dependency-free charts for the public data pages (Ghost Job Index,
// Entry-Level Index, Weekly Hiring Trends). Specs follow the dataviz method:
// bars ≤24px with 4px rounded DATA ends (square at the baseline), 2px surface
// gaps between adjacent marks, hairline solid gridlines, text in text tokens
// (never the series color), a legend whenever there are two series, selective
// direct labels, and a real hover tooltip. Palette validated for the dark
// surface (#0f172a) with the six-checks script: #3b82f6 + #059669 — CVD ΔE
// 80.1 worst pair, contrast ≥3:1, lightness band PASS.

import { useState } from "react";

export const VIZ_SERIES_A = "#3b82f6"; // blue-500 — primary series
export const VIZ_SERIES_B = "#059669"; // emerald-600 — second series

interface WeekPoint {
  label: string;
  a: number;
  b?: number;
  aDetail?: string;
  bDetail?: string;
  muted?: boolean; // e.g. the current partial week
}

/** Grouped weekly bars, one or two series, with legend + hover tooltip. */
export function WeeklyBars({
  data,
  seriesA,
  seriesB,
  height = 180,
}: {
  data: WeekPoint[];
  seriesA: string;
  seriesB?: string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (data.length === 0) return null;
  const hasB = data.some((d) => typeof d.b === "number");
  const max = Math.max(1, ...data.flatMap((d) => [d.a, d.b ?? 0]));
  // Clean tick ceiling that hugs the data: finer mantissa steps so a 26k max
  // gets a 30k axis, not a half-empty 50k plot.
  const pow = 10 ** Math.floor(Math.log10(max));
  const top = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * pow).find((v) => v >= max) ?? max;
  const ticks = [0, top / 2, top];
  const W = 640;
  const PAD_L = 44;
  const PAD_B = 22;
  const PAD_T = 8;
  const plotW = W - PAD_L - 8;
  const plotH = height - PAD_B - PAD_T;
  const band = plotW / data.length;
  const barW = Math.min(24, hasB ? (band - 10) / 2 - 2 : band - 12);
  const y = (v: number) => PAD_T + plotH - (v / top) * plotH;
  const maxIdx = data.reduce((mi, d, i) => (d.a > data[mi].a ? i : mi), 0);

  // A bar with a rounded DATA end and a square baseline end.
  const bar = (cx: number, v: number, color: string, dim: boolean) => {
    const h = Math.max(0, PAD_T + plotH - y(v));
    if (h <= 0) return null;
    const r = Math.min(4, h);
    return (
      <path
        d={`M${cx},${PAD_T + plotH} v${-(h - r)} q0,${-r} ${r},${-r} h${barW - 2 * r} q${r},0 ${r},${r} v${h - r} z`}
        fill={color}
        opacity={dim ? 0.45 : 1}
      />
    );
  };

  return (
    <div className="relative">
      {hasB && (
        <div className="flex items-center gap-4 mb-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: VIZ_SERIES_A }} />
            {seriesA}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: VIZ_SERIES_B }} />
            {seriesB}
          </span>
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label={seriesA}>
        {ticks.map((tv) => (
          <g key={tv}>
            <line x1={PAD_L} x2={W - 8} y1={y(tv)} y2={y(tv)} stroke="currentColor" strokeWidth="1" className="text-border" opacity={tv === 0 ? 0.9 : 0.4} />
            <text x={PAD_L - 6} y={y(tv) + 3} textAnchor="end" fontSize="10" className="fill-current text-muted-foreground">
              {tv >= 1000 ? `${(tv / 1000).toLocaleString()}k` : tv.toLocaleString()}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x0 = PAD_L + i * band + (band - (hasB ? barW * 2 + 2 : barW)) / 2;
          return (
            <g
              key={d.label + i}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              {/* oversized hit target for the hover layer */}
              <rect x={PAD_L + i * band} y={PAD_T} width={band} height={plotH + PAD_B} fill="transparent" />
              {bar(x0, d.a, VIZ_SERIES_A, !!d.muted)}
              {hasB && bar(x0 + barW + 2, d.b ?? 0, VIZ_SERIES_B, !!d.muted)}
              {i === maxIdx && !d.muted && (
                <text x={x0 + barW / 2} y={y(d.a) - 4} textAnchor="middle" fontSize="10" fontWeight="600" className="fill-current text-foreground">
                  {d.a.toLocaleString()}
                </text>
              )}
              <text x={PAD_L + i * band + band / 2} y={height - 6} textAnchor="middle" fontSize="10" className="fill-current text-muted-foreground">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      {hover !== null && data[hover] && (
        <div className="absolute -top-1 left-1/2 -translate-x-1/2 pointer-events-none rounded-lg border border-border bg-background/95 backdrop-blur px-3 py-1.5 text-[11px] shadow-lg whitespace-nowrap">
          <span className="font-semibold text-foreground">{data[hover].label}</span>
          <span className="text-muted-foreground"> · {data[hover].aDetail ?? data[hover].a.toLocaleString()}</span>
          {hasB && <span className="text-muted-foreground"> · {data[hover].bDetail ?? (data[hover].b ?? 0).toLocaleString()}</span>}
        </div>
      )}
    </div>
  );
}

/** Proportional horizontal bar list: identity labels in text tokens, value at
    the bar tip, single validated hue. */
export function HBarList({
  items,
  renderLabel,
}: {
  items: Array<{ key: string; label: string; value: number; detail?: string }>;
  renderLabel?: (item: { key: string; label: string; value: number }) => React.ReactNode;
}) {
  if (items.length === 0) return null;
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-1.5">
      {items.map((it) => (
        <li key={it.key} className="flex items-center gap-3" title={it.detail}>
          <span className="w-40 sm:w-48 shrink-0 text-[12px] text-muted-foreground truncate text-right">
            {renderLabel ? renderLabel(it) : it.label}
          </span>
          <span className="flex-1 h-4 relative">
            <span
              className="absolute inset-y-0 left-0 rounded-r"
              style={{ width: `${Math.max(1.5, (it.value / max) * 100)}%`, backgroundColor: VIZ_SERIES_A }}
            />
          </span>
          <span className="w-16 shrink-0 text-[12px] font-semibold text-foreground tabular-nums">
            {it.value.toLocaleString()}
          </span>
        </li>
      ))}
    </ul>
  );
}
