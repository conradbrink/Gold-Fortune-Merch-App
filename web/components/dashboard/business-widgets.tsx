"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { useCompanyConfig } from "@/lib/use-company-config";
import {
  describeAge,
  describeSource,
  freshnessOf,
  minutesSince,
  type LiveReps,
} from "@/lib/live-reps";
import {
  deltaPct,
  formatMoney,
  formatMoneyShort,
  formatPct,
  type BusinessSummary,
  type DashboardSummary,
} from "@/lib/dashboard";
import { achievedFor, MEASURES, type Measure, type TargetProgress } from "@/lib/targets";
import { toLocalDateInput, type DateRange } from "@/lib/date-range";

/**
 * The redesigned dashboard's cards: the headline row, sales, the orders
 * pipeline, the field team and store health.
 *
 * Built to be scanned, not read: a number, a few words saying what it is, and a
 * link to where it can be taken apart. Explanations belong on the pages these
 * link to; the dashboard used to carry them inline and that was most of what
 * made it feel cluttered.
 */

const MONTH = new Intl.DateTimeFormat("en-GB", { month: "short" });

function monthLabel(isoDay: string) {
  return MONTH.format(new Date(`${isoDay}T00:00:00`));
}

/** Days elapsed and in total for the calendar month starting `monthStart`. */
function monthProgress(monthStart: string, today: string) {
  const start = new Date(`${monthStart}T00:00:00`);
  const now = new Date(`${today}T00:00:00`);
  const daysIn = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
  const elapsed = Math.round((now.getTime() - start.getTime()) / 86_400_000) + 1;
  return { elapsed: Math.min(Math.max(elapsed, 1), daysIn), daysIn };
}

function Delta({ pct, invert = false }: { pct: number | null; invert?: boolean }) {
  if (pct === null || pct === 0) return null;
  const good = invert ? pct < 0 : pct > 0;
  return (
    <span className={good ? "font-semibold text-emerald-700 dark:text-emerald-400" : "font-semibold text-red-700 dark:text-red-400"}>
      {pct > 0 ? "▲" : "▼"} {Math.abs(pct)}%
    </span>
  );
}

function SectionCard({
  title,
  href,
  linkLabel,
  children,
  id,
}: {
  title: string;
  href: string;
  linkLabel: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <Card id={id} className="flex h-full flex-col gap-4 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <Link href={href} className="text-sm text-primary hover:underline">
          {linkLabel} →
        </Link>
      </div>
      {children}
    </Card>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: ReactNode; tone?: "bad" | "good" }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={
          tone === "bad"
            ? "text-lg font-semibold tabular-nums text-red-700 dark:text-red-400"
            : tone === "good"
              ? "text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-400"
              : "text-lg font-semibold tabular-nums"
        }
      >
        {value}
      </span>
    </div>
  );
}

// ------------------------------------------------------------ headline row

function Tile({
  href,
  label,
  value,
  sub,
  primary,
  tone,
}: {
  href: string;
  label: string;
  value: ReactNode;
  sub: ReactNode;
  primary?: boolean;
  tone?: "bad";
}) {
  return (
    <Link
      href={href}
      className={
        primary
          ? "flex flex-col gap-2 rounded-xl bg-primary p-4 text-primary-foreground transition-opacity hover:opacity-95 sm:col-span-2 xl:col-span-1"
          : "flex flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition-colors hover:bg-muted/40"
      }
    >
      <span className={primary ? "text-xs font-medium text-primary-foreground/75" : "text-xs font-medium text-muted-foreground"}>
        {label}
      </span>
      <span
        className={
          tone === "bad"
            ? "text-[28px] font-semibold leading-none tracking-tight tabular-nums text-red-700 dark:text-red-400"
            : "text-[28px] font-semibold leading-none tracking-tight tabular-nums"
        }
      >
        {value}
      </span>
      <span className={primary ? "text-xs text-primary-foreground/75" : "text-xs text-muted-foreground"}>{sub}</span>
    </Link>
  );
}

export function Headline({
  business,
  summary,
  days,
}: {
  business: BusinessSummary;
  summary: DashboardSummary | null;
  days: number;
}) {
  const r = business.revenue;
  const p = business.pipeline;
  const h = business.health;
  const action = p.new + p.confirmed + p.picking + p.packed + p.dispatched;
  const coverage =
    summary && summary.stores_active > 0
      ? summary.current.stores_covered / summary.stores_active
      : null;
  const visitsDelta = summary
    ? deltaPct(summary.current.visits_completed, summary.previous.visits_completed)
    : null;

  return (
    // One row of five on a wide screen; below that the revenue tile takes the
    // full width and the other four pair up, so no tile is ever left alone on
    // a row (2 + 2 + 1 at laptop widths looked broken, seen on production).
    // xl rather than lg: the sidebar takes ~14rem, so at lg the five would be
    // too narrow for their sublines.
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Tile
        primary
        href="/sales"
        label={`Revenue, last ${days} days`}
        value={formatMoney(r.current)}
        sub={
          <>
            {r.orders} orders delivered
            {r.previous > 0 && (
              <>
                {" · "}
                {deltaPct(r.current, r.previous)! >= 0 ? "▲" : "▼"} {Math.abs(deltaPct(r.current, r.previous)!)}% on the {days} before
              </>
            )}
          </>
        }
      />
      <Tile
        href="/orders"
        label="Orders needing action"
        value={action}
        sub={`${p.new + p.confirmed} to confirm · ${p.picking + p.packed} to pick or dispatch · ${p.dispatched} out`}
      />
      <Tile
        href="/invoices"
        label="Owed to us"
        value={formatMoney(business.money.outstanding)}
        sub={business.money.overdue > 0 ? `${formatMoney(business.money.overdue)} overdue` : "Nothing overdue"}
        tone={business.money.overdue > 0 ? "bad" : undefined}
      />
      <Tile
        href="/reports"
        label={`Store coverage, last ${days} days`}
        value={formatPct(coverage)}
        sub={
          summary ? (
            <>
              {summary.current.stores_covered} of {summary.stores_active} stores · {summary.current.visits_completed} visits{" "}
              <Delta pct={visitsDelta} />
            </>
          ) : (
            "Visit figures did not load"
          )
        }
      />
      <Tile
        href="/stores"
        label="Stores needing attention"
        value={h.not_visited_30d}
        tone={h.not_visited_30d > 0 ? "bad" : undefined}
        sub={`Not visited in 30 days${h.lapsed_60d > 0 ? ` · ${h.lapsed_60d} stopped ordering` : ""}`}
      />
    </div>
  );
}

// ------------------------------------------------------------------ sales

export function SalesCard({
  business,
  targets,
}: {
  business: BusinessSummary;
  targets: TargetProgress[];
}) {
  const r = business.revenue;
  // From the first month with any sales: months before the app took orders are
  // not "zero revenue", they are "not recorded here", and six empty bars would
  // say the former.
  const firstWithSales = r.by_month.findIndex((m) => m.net > 0);
  const months = firstWithSales === -1 ? r.by_month.slice(-1) : r.by_month.slice(firstWithSales);
  const current = r.by_month[r.by_month.length - 1];
  const { elapsed, daysIn } = monthProgress(r.month_start, r.today);
  // A projection after two days is noise; from the third it is a fair guess,
  // and it is labelled as one.
  const pace = current && elapsed >= 3 && elapsed < daysIn ? (current.net / elapsed) * daysIn : null;
  const scale = Math.max(1, ...months.map((m) => m.net), pace ?? 0);

  const withTarget = targets.filter((t) => t.target != null && Number(t.target) > 0);
  const leader = Math.max(1, ...targets.map((t) => Number(t.revenue_excl_vat)));
  const reps = [...targets].sort((a, b) => Number(b.revenue_excl_vat) - Number(a.revenue_excl_vat));

  return (
    <SectionCard title="Sales" href="/sales" linkLabel="Sales">
      <div className="flex flex-col gap-2.5">
        <span className="text-xs text-muted-foreground">Delivered revenue by month, excluding VAT</span>
        <div className="grid grid-cols-[2.5rem_1fr_6rem] items-center gap-x-3 gap-y-2 text-sm">
          {months.map((m) => {
            const isCurrent = m.month === r.month_start;
            return (
              <div key={m.month} className="contents">
                <span className={isCurrent ? "font-semibold" : "text-muted-foreground"}>{monthLabel(m.month)}</span>
                <div className="relative h-[22px] overflow-hidden rounded-md bg-muted">
                  {isCurrent && pace !== null && (
                    <div
                      className="absolute inset-y-0 left-0 rounded-md border-[1.5px] border-dashed border-primary/40"
                      style={{ width: `${(pace / scale) * 100}%` }}
                      aria-hidden
                    />
                  )}
                  <div
                    className={isCurrent ? "absolute inset-y-0 left-0 rounded-md bg-primary" : "absolute inset-y-0 left-0 rounded-md bg-primary/35"}
                    style={{ width: `${(m.net / scale) * 100}%` }}
                  />
                </div>
                <span className={isCurrent ? "text-right font-semibold tabular-nums" : "text-right tabular-nums"}>
                  {formatMoney(m.net)}
                </span>
              </div>
            );
          })}
        </div>
        {pace !== null && (
          <span className="text-xs text-muted-foreground">
            {monthLabel(r.month_start)} is {elapsed} of {daysIn} days in and on pace for about {formatMoneyShort(pace)} (dashed).
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2.5 border-t pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {withTarget.length > 0 ? "Reps this month against target" : "Reps this month"}
          </span>
          <Link href="/targets" className="text-xs text-primary hover:underline">
            {withTarget.length > 0 ? "Targets" : `Set ${monthLabel(r.month_start)} targets`}
          </Link>
        </div>
        {reps.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active reps.</p>
        ) : (
          <div className="grid grid-cols-[minmax(6rem,9rem)_1fr_auto] items-center gap-x-3 gap-y-2.5 text-sm">
            {reps.map((t) => {
              const measure = (t.measure as Measure) ?? "revenue";
              const hasTarget = t.target != null && Number(t.target) > 0;
              const achieved = hasTarget ? achievedFor(t, measure) : Number(t.revenue_excl_vat);
              const pct = hasTarget ? achieved / Number(t.target) : achieved / leader;
              const money = MEASURES.find((m) => m.value === measure)?.money ?? true;
              return (
                <div key={t.rep_id} className="contents">
                  <span className="truncate">{t.rep_name}</span>
                  <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-gold" style={{ width: `${Math.min(pct, 1) * 100}%` }} />
                  </div>
                  <span className="text-right tabular-nums">
                    {money ? formatMoney(achieved) : achieved.toLocaleString("en-GB")}
                    {hasTarget && <span className="ml-1.5 text-xs text-muted-foreground">{Math.round(pct * 100)}%</span>}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {withTarget.length === 0 && reps.length > 0 && (
          <span className="text-xs text-muted-foreground">No targets set yet, so each bar is measured against the month&apos;s leader.</span>
        )}
      </div>
    </SectionCard>
  );
}

// -------------------------------------------------------------- pipeline

function Stage({ count, label, href, urgent }: { count: number; label: string; href: string; urgent?: boolean }) {
  return (
    <Link
      href={href}
      className={
        urgent && count > 0
          ? "flex flex-col gap-1 rounded-lg bg-amber-50 p-3 transition-colors hover:bg-amber-100 dark:bg-amber-500/10 dark:hover:bg-amber-500/20"
          : "flex flex-col gap-1 rounded-lg bg-muted/60 p-3 transition-colors hover:bg-muted"
      }
    >
      <span className="text-2xl font-semibold tabular-nums">{count}</span>
      <span className={urgent && count > 0 ? "text-xs text-amber-900 dark:text-amber-300" : "text-xs text-muted-foreground"}>{label}</span>
    </Link>
  );
}

function Row({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <li className="flex items-center justify-between gap-3 border-b py-2.5 text-sm last:border-b-0">
      <span>{label}</span>
      {value > 0 ? (
        <Link href={href} className="font-semibold tabular-nums text-primary hover:underline">
          {value}
        </Link>
      ) : (
        <span className="tabular-nums text-muted-foreground">0</span>
      )}
    </li>
  );
}

export function PipelineCard({ business }: { business: BusinessSummary }) {
  const p = business.pipeline;
  const m = business.money;
  return (
    <SectionCard title="Orders pipeline" href="/orders" linkLabel="All orders">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stage count={p.new + p.confirmed} label="To confirm" href="/orders" urgent />
        <Stage count={p.picking} label="Being picked" href="/warehouse" />
        <Stage count={p.packed} label="Packed, to dispatch" href="/orders" urgent />
        <Stage count={p.dispatched} label="Out for delivery" href="/orders" />
      </div>
      <ul className="flex flex-col border-t">
        <Row label="Delivered, proof of delivery missing" value={p.pod_missing} href="/orders" />
        <Row label="Quotes waiting on the customer" value={p.quotes_waiting} href="/quotes" />
        <Row label="Recurring orders placing this week" value={p.recurring_due_7d} href="/recurring-orders" />
        <Row label="Products below reorder point" value={p.low_stock} href="/inventory" />
      </ul>
      <div className="grid grid-cols-3 gap-3 border-t pt-4">
        <MiniStat label="Invoiced" value={formatMoney(m.invoiced)} />
        <MiniStat label="Overdue" value={formatMoney(m.overdue)} tone={m.overdue > 0 ? "bad" : undefined} />
        <MiniStat label="Commission to approve" value={formatMoney(m.commission_pending)} />
      </div>
    </SectionCard>
  );
}

// ------------------------------------------------------------ field team

const DOT: Record<ReturnType<typeof freshnessOf>, string> = {
  fresh: "bg-emerald-500",
  recent: "bg-amber-500",
  stale: "bg-muted-foreground/50",
  unknown: "bg-slate-300 dark:bg-slate-600",
};

export function FieldTeamCard({
  liveReps,
  summary,
  business,
  range,
}: {
  liveReps: LiveReps;
  summary: DashboardSummary | null;
  business: BusinessSummary | null;
  /** The dashboard's range, handed to the off-site list so it shows the same check-ins. */
  range: DateRange;
}) {
  // Ages tick on their own, as on the rep map: the dashboard stays open, and
  // "12 min ago" that never becomes 13 is a reading pretending to be live.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  // The dots age against the company's own GPS interval, as on the maps.
  const interval = useCompanyConfig()?.settings.gps_ping_interval_minutes ?? null;
  const oosDelta =
    summary && summary.current.oos_rate !== null && summary.previous.oos_rate !== null
      ? deltaPct(summary.current.oos_rate * 1000, summary.previous.oos_rate * 1000)
      : null;
  const planoDelta =
    summary && summary.current.planogram_rate !== null && summary.previous.planogram_rate !== null
      ? deltaPct(summary.current.planogram_rate * 1000, summary.previous.planogram_rate * 1000)
      : null;
  return (
    <SectionCard title="Field team" href="/tracking" linkLabel="Tracking">
      <ul className="flex flex-col">
        {liveReps.positions.map((p) => {
          const mins = minutesSince(p.recordedAt, now);
          return (
            <li key={p.repId} className="grid grid-cols-[10px_1fr_auto] items-center gap-2.5 border-b py-2.5 text-sm last:border-b-0">
              <span className={`h-2 w-2 rounded-full ${DOT[freshnessOf(mins, interval)]}`} aria-hidden />
              <span className="min-w-0 truncate">
                <span className="font-medium">{p.repName}</span>
                <span className="text-muted-foreground">
                  {" · "}
                  {describeSource(p.source, p.storeName)}
                  {!p.dayOpen && " · day ended"}
                </span>
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">{describeAge(mins)}</span>
            </li>
          );
        })}
        {liveReps.missing.map((m) => (
          <li key={m.repId} className="grid grid-cols-[10px_1fr_auto] items-center gap-2.5 border-b py-2.5 text-sm last:border-b-0">
            <span className="h-2 w-2 rounded-full border-[1.5px] border-red-600" aria-hidden />
            <span className="min-w-0 truncate">
              <span className="font-medium">{m.repName}</span>
              <span className="text-red-700 dark:text-red-400"> · no position in 24 hours</span>
            </span>
            <Link href={`/tracking/${m.repId}`} className="text-xs text-primary hover:underline">
              Check
            </Link>
          </li>
        ))}
        {liveReps.positions.length + liveReps.missing.length === 0 && (
          <li className="py-2.5 text-sm text-muted-foreground">No active reps.</li>
        )}
      </ul>
      <div className="mt-auto grid grid-cols-3 gap-3 border-t pt-4">
        <MiniStat
          label="Out of stock"
          value={
            <>
              {formatPct(summary?.current.oos_rate ?? null)} <span className="text-xs"><Delta pct={oosDelta} invert /></span>
            </>
          }
        />
        <MiniStat
          label="Planogram"
          value={
            <>
              {formatPct(summary?.current.planogram_rate ?? null)} <span className="text-xs"><Delta pct={planoDelta} /></span>
            </>
          }
        />
        <MiniStat
          label={`Check-ins over ${business?.field.off_site_m ?? 500} m from store`}
          value={
            business ? (
              <Link
                href={`/visits/off-site?${new URLSearchParams({
                  from: toLocalDateInput(range.from),
                  to: toLocalDateInput(range.to),
                }).toString()}`}
                className="hover:underline"
                title="See which reps, stores and how far"
              >
                {business.field.flagged_checkins}
              </Link>
            ) : (
              "—"
            )
          }
          tone={business && business.field.flagged_checkins > 0 ? "bad" : undefined}
        />
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------- store health

export function StoreHealthCard({ business }: { business: BusinessSummary }) {
  const h = business.health;
  const total = Math.max(1, h.stores_active);
  // The three groups are disjoint by construction: ordered in 30 days; visited
  // in 30 days without ordering; not visited in 30 days (whether or not they
  // ordered — a store that orders but is never seen still needs a visit).
  const orderedSeen = Math.max(0, h.stores_active - h.visited_no_order_30d - h.not_visited_30d);
  return (
    <SectionCard title="Store health" href="/stores" linkLabel="All stores">
      <div className="flex h-3.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
        <div className="bg-emerald-600" style={{ flex: orderedSeen / total }} />
        <div className="bg-muted-foreground/25" style={{ flex: h.visited_no_order_30d / total }} />
        <div className="bg-red-600" style={{ flex: h.not_visited_30d / total }} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <MiniStat label="Visited and ordering" value={orderedSeen} tone="good" />
        <MiniStat label="Visited, no order in 30 days" value={h.visited_no_order_30d} />
        <MiniStat label="Not visited in 30 days" value={h.not_visited_30d} tone={h.not_visited_30d > 0 ? "bad" : undefined} />
      </div>
      <div className="flex flex-col border-t">
        <span className="pb-1.5 pt-3 text-xs text-muted-foreground">Visit these first</span>
        {h.longest_unvisited.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">Every active store was visited in the last 30 days.</p>
        ) : (
          h.longest_unvisited.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 border-b py-2 text-sm last:border-b-0">
              <span className="min-w-0 truncate">
                {s.name}
                {s.city && <span className="text-muted-foreground"> · {s.city}</span>}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{s.days == null ? "Never visited" : `${s.days} days`}</span>
            </div>
          ))
        )}
      </div>
      {h.lapsed_60d > 0 && (
        <span className="text-xs text-muted-foreground">
          {h.lapsed_60d} {h.lapsed_60d === 1 ? "store that used to order has" : "stores that used to order have"} placed nothing in 60 days.
        </span>
      )}
    </SectionCard>
  );
}
