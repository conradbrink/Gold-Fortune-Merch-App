import type { RepDay } from "@/lib/rep-report";
import { moneyShort } from "@/lib/rep-report";

/**
 * The report's two graphs, drawn by hand in SVG.
 *
 * Recharts is already a dependency and draws every other chart in the app, and
 * it is the wrong tool here for three reasons. It measures its container to
 * size itself, and a `ResponsiveContainer` inside a print layout has no
 * settled width at the moment the browser paginates — the chart comes out
 * clipped, or zero-height, or on its own page. It renders its own typography
 * and palette, which is the generic-dashboard look this report is explicitly
 * not meant to have. And it draws with fills that a black-and-white printer
 * turns into two indistinguishable greys.
 *
 * A fixed `viewBox` has none of those problems: it scales to whatever width
 * the sheet gives it, prints at the resolution of the printer rather than the
 * screen, and every rule below about weight and hatching is one attribute.
 *
 * Colours come from the Gold Fortune palette as literal values rather than CSS
 * variables, because `oklch()` inside an SVG fill is not reliably honoured by
 * print renderers, and a chart that disappears when printed is worse than one
 * that ignores dark mode. The report sheet is white in both themes for the
 * same reason: it is a document, not a screen.
 */

/** Navy — the brand primary, and near-black in a monochrome print. */
const INK = "#243055";
/** Gold — distinguishable from navy in colour, and clearly lighter in grey. */
const GOLD = "#d8a83a";
const RULE = "#c9ced9";
const LABEL = "#5b6376";

/** Nice round axis top: 1, 2, 5 × 10ⁿ above the tallest value. */
function axisMax(highest: number): number {
  if (highest <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(highest)));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= highest) return candidate;
  }
  return 10 * magnitude;
}

/**
 * Which days get a date under the axis.
 *
 * Six weeks of daily bars is forty-two labels in 184mm, which overlap into a
 * grey smear. Every label is dropped except one in `n`, chosen so that about a
 * dozen survive — and the first and last are always among them, because a
 * chart whose axis ends unlabelled is a chart nobody can place in time.
 *
 * The last label then evicts any regular label too close to it: at 42 days the
 * step is four, so the run ended `… 10/9 11/9` with the two overprinting each
 * other. The final date is the one that must survive, so the neighbour goes.
 */
function labelIndices(count: number): Set<number> {
  const every = Math.max(1, Math.ceil(count / 12));
  const last = count - 1;
  const out = new Set<number>();
  for (let i = 0; i < count; i += every) {
    if (last - i >= every * 0.6) out.add(i);
  }
  out.add(last);
  return out;
}

function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(+d)) return iso;
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

function weekdayInitial(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(+d)) return "";
  return ["S", "M", "T", "W", "T", "F", "S"][d.getDay()];
}

const W = 720;
/**
 * 720 × 142 is not arbitrary: at 184mm of sheet width the chart comes out
 * 36mm tall, and two of them plus the header, the scorecard, the score and the
 * attendance strip are what fit on one A4 page with room for a longer
 * territory list. It was 168 and page one measured 313mm.
 */
const H = 142;
const PAD = { top: 10, right: 8, bottom: 22 };

/**
 * The left gutter is per chart because the axis labels are not the same width:
 * "10" needs almost nothing, "P25,000" needs three times as much, and a single
 * shared value either clipped the money or wasted a centimetre on the counts.
 */
function plot(left: number) {
  return {
    x: left,
    y: PAD.top,
    w: W - left - PAD.right,
    h: H - PAD.top - PAD.bottom,
  };
}

/**
 * Planned visits against completed visits, one pair of bars per day.
 *
 * Planned is drawn as an outline and completed as a solid fill inside it, so
 * the gap between the two *is* the shortfall — a reader sees the miss without
 * subtracting. Overlaid rather than side by side because at a day's width on
 * A4 two bars are three pixels each.
 */
export function PlannedVsCompletedChart({ days }: { days: RepDay[] }) {
  const rows = days.filter((d) => !d.inFuture);
  // Not just "no days": a period of forty-two days on which nothing was ever
  // planned drew a grid with an axis running 0, 1, 1 and no bars — which looks
  // like a chart that failed rather than a period with no round in it.
  const anything = rows.some((d) => d.planned > 0 || d.completed > 0);
  if (!anything) {
    return <EmptyChart message="No planned visits during this period." />;
  }

  const p = plot(26);
  const max = axisMax(Math.max(...rows.map((d) => Math.max(d.planned, d.completed))));
  const slot = p.w / rows.length;
  // Two thirds of the slot, capped: at seven days an uncapped bar is 67 units
  // wide and reads as a block of colour rather than a measurement. The cap is
  // 40 rather than 26 because at 26 a week of bars looked like isolated marks
  // adrift in white space; six weeks of them are far below the cap either way.
  const barWidth = Math.min(slot * 0.68, 40);
  const labelled = labelIndices(rows.length);
  const ticks = [0, max / 2, max];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="rr-chart" role="img"
         aria-label="Planned visits against completed visits, by day">
      {ticks.map((t) => {
        const y = p.y + p.h - (t / max) * p.h;
        return (
          <g key={t}>
            <line x1={p.x} y1={y} x2={p.x + p.w} y2={y} stroke={RULE} strokeWidth={0.8} />
            <text x={p.x - 6} y={y + 3} textAnchor="end" fontSize={9} fill={LABEL}>
              {Math.round(t)}
            </text>
          </g>
        );
      })}

      {rows.map((d, i) => {
        const cx = p.x + slot * i + slot / 2;
        const x = cx - barWidth / 2;
        const plannedH = (d.planned / max) * p.h;
        const doneH = (d.completed / max) * p.h;
        return (
          <g key={d.day}>
            {d.planned > 0 && (
              <rect
                x={x}
                y={p.y + p.h - plannedH}
                width={barWidth}
                height={plannedH}
                fill="none"
                stroke={INK}
                strokeWidth={0.9}
              />
            )}
            {d.completed > 0 && (
              <rect
                x={x}
                y={p.y + p.h - doneH}
                width={barWidth}
                height={doneH}
                fill={INK}
              />
            )}
            {/* A planned day with nothing done gets a mark on the baseline, or
                it is indistinguishable from a day off. */}
            {d.planned > 0 && d.completed === 0 && (
              <rect x={x} y={p.y + p.h - 1.5} width={barWidth} height={1.5} fill={GOLD} />
            )}
            {labelled.has(i) ? (
              <>
                <text x={cx} y={H - 12} textAnchor="middle" fontSize={9} fill={LABEL}>
                  {dayLabel(d.day)}
                </text>
                {/* LABEL, not RULE. The weekday is text and RULE is a
                    hairline grey — about 1.9:1 on the white sheet, which is
                    unreadable on screen and close to invisible in print. The
                    smaller size still separates it from the date above. */}
                <text x={cx} y={H - 3} textAnchor="middle" fontSize={8} fill={LABEL}>
                  {weekdayInitial(d.day)}
                </text>
              </>
            ) : null}
          </g>
        );
      })}

      <line x1={p.x} y1={p.y + p.h} x2={p.x + p.w} y2={p.y + p.h} stroke={INK} strokeWidth={1} />
    </svg>
  );
}

/**
 * Delivered sales per day.
 *
 * A line, with every day on the axis including the ones worth nothing — a
 * chart drawn only through the days that sold makes a fortnight of silence
 * look like a gentle slope. Points are marked so a single day's sale in an
 * otherwise empty week is visible at all.
 */
export function DailySalesChart({ days }: { days: RepDay[] }) {
  const rows = days.filter((d) => !d.inFuture);
  const total = rows.reduce((a, d) => a + d.salesNet, 0);
  if (rows.length === 0 || total === 0) {
    return <EmptyChart message="No sales recorded during this period." />;
  }

  const p = plot(50);
  const max = axisMax(Math.max(...rows.map((d) => d.salesNet)));
  const step = rows.length > 1 ? p.w / (rows.length - 1) : 0;
  const at = (i: number, value: number) => ({
    x: p.x + step * i,
    y: p.y + p.h - (value / max) * p.h,
  });
  const points = rows.map((d, i) => at(i, d.salesNet));
  const labelled = labelIndices(rows.length);
  const ticks = [0, max / 2, max];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="rr-chart" role="img"
         aria-label="Delivered sales in Pula, by day">
      {ticks.map((t) => {
        const y = p.y + p.h - (t / max) * p.h;
        return (
          <g key={t}>
            <line x1={p.x} y1={y} x2={p.x + p.w} y2={y} stroke={RULE} strokeWidth={0.8} />
            <text x={p.x - 6} y={y + 3} textAnchor="end" fontSize={9} fill={LABEL}>
              {t === 0 ? "0" : moneyShort(t)}
            </text>
          </g>
        );
      })}

      <polyline
        points={points.map((q) => `${q.x},${q.y}`).join(" ")}
        fill="none"
        stroke={INK}
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
      {rows.map((d, i) =>
        d.salesNet > 0 ? (
          <circle key={d.day} cx={points[i].x} cy={points[i].y} r={2.2} fill={GOLD}
                  stroke={INK} strokeWidth={0.8} />
        ) : null
      )}

      {rows.map((d, i) =>
        labelled.has(i) ? (
          <text key={d.day} x={points[i].x} y={H - 9} textAnchor="middle" fontSize={9} fill={LABEL}>
            {dayLabel(d.day)}
          </text>
        ) : null
      )}

      <line x1={p.x} y1={p.y + p.h} x2={p.x + p.w} y2={p.y + p.h} stroke={INK} strokeWidth={1} />
    </svg>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="rr-chart-empty">{message}</div>
  );
}
