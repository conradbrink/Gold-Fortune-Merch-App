"use client";

import { useRef, useState } from "react";

/**
 * Website visitors per day: one series, so one line and no legend (the title
 * names it). The colour is the brand teal at a step that passes the dataviz
 * checks on each surface (#008f8c light, #1a9e9a dark). A crosshair snaps to
 * the nearest day under the pointer or the arrow keys; the same numbers are in
 * the table below the chart, so nothing needs hovering to be read.
 */

const W = 800;
const H = 220;
const PAD = { top: 12, right: 12, bottom: 28, left: 40 };

const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const fmt = (d: string) => day.format(new Date(d + "T00:00:00Z"));

/** The top of the scale: four round steps that just clear the busiest day. */
function niceMax(n: number): number {
  if (n <= 4) return 4;
  const raw = n / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((s) => s * pow >= raw) ?? 10) * pow;
  return step * 4;
}

export function VisitorsChart({ points }: { points: { date: string; visitors: number }[] }) {
  const [active, setActive] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  if (points.length === 0 || points.every((p) => p.visitors === 0)) {
    return (
      <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        No visits recorded in this period yet.
      </p>
    );
  }
  const max = niceMax(Math.max(...points.map((p) => p.visitors)));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.visitors).toFixed(1)}`).join(" ");
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(max * t));
  const labels = [0, Math.floor((points.length - 1) / 2), points.length - 1].filter((v, i, a) => a.indexOf(v) === i);

  const nearest = (clientX: number) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return null;
    const vx = ((clientX - box.left) / box.width) * W;
    const i = Math.round(((vx - PAD.left) / innerW) * (points.length - 1));
    return Math.max(0, Math.min(points.length - 1, i));
  };
  const shown = active !== null ? points[active] : null;

  return (
    <figure className="space-y-3">
      <div className="relative rounded-lg border border-border bg-card p-3 [--series:#008f8c] dark:[--series:#1a9e9a]">
        <svg
          ref={svg}
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
          role="img"
          aria-label={`Visitors per day, ${fmt(points[0].date)} to ${fmt(points[points.length - 1].date)}. The table below has every day.`}
          tabIndex={0}
          onPointerMove={(e) => setActive(nearest(e.clientX))}
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            const from = active ?? (e.key === "ArrowLeft" ? points.length : -1);
            setActive(Math.max(0, Math.min(points.length - 1, from + (e.key === "ArrowLeft" ? -1 : 1))));
          }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
                {t}
              </text>
            </g>
          ))}
          {labels.map((i) => (
            <text
              key={i}
              x={x(i)}
              y={H - 8}
              textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
              className="fill-muted-foreground text-[11px]"
            >
              {fmt(points[i].date)}
            </text>
          ))}
          <path d={line} fill="none" stroke="var(--series)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {active !== null && (
            <g>
              <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + innerH} className="stroke-muted-foreground" strokeWidth={1} />
              <circle cx={x(active)} cy={y(points[active].visitors)} r={4} fill="var(--series)" className="stroke-card" strokeWidth={2} />
            </g>
          )}
        </svg>
        {shown && active !== null && (
          <div
            className="pointer-events-none absolute top-3 whitespace-nowrap rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-sm"
            style={{
              left: `calc(${(x(active) / W) * 100}% + ${active > points.length / 2 ? "-8px" : "8px"})`,
              transform: active > points.length / 2 ? "translateX(-100%)" : undefined,
            }}
          >
            <div className="font-semibold tabular-nums text-foreground">{shown.visitors} visitors</div>
            <div className="text-muted-foreground">{fmt(shown.date)}</div>
          </div>
        )}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Show the numbers as a table</summary>
        <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-border bg-card">
          <table className="w-full">
            <thead className="sticky top-0 border-b border-border bg-card text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 font-medium">Day</th>
                <th className="px-3 py-1.5 text-right font-medium">Visitors</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.date} className="border-b border-border last:border-0">
                  <td className="px-3 py-1">{fmt(p.date)}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{p.visitors}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
