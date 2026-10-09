"use client";

import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useCompanyConfig, useTerms } from "@/lib/use-company-config";
import { lower, type Terms } from "@/lib/terms";
import { formatMoneyShort } from "@/lib/money";
import type { DateRange } from "@/lib/date-range";
import {
  findKpi,
  formatKpi,
  hasEnoughData,
  kpiChange,
  tileColumns,
  type FirstWeek,
  type Kpi,
  type KpiDef,
} from "@/lib/kpis";
import { todayProgress, type ContractsDue, type Numbers, type Today } from "@/lib/dashboard-numbers";

/**
 * The trade dashboards' cards (Stage 7 Part 3). They use the headline's own
 * vocabulary (lib: business-widgets): the same tiles, the same section cards,
 * the same green and red, so a trade's dashboard reads like Gold Fortune's.
 * Design notes: ~/.claude/plans/part3-dashboards/DESIGN.md.
 */

const COLS: Record<2 | 3 | 4 | 5, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
  5: "sm:grid-cols-2 lg:grid-cols-5",
};

function useMoney() {
  const config = useCompanyConfig();
  const currency = config?.settings.currency_code ?? "";
  // Whole amounts, as the headline shows them: cents are noise on a dashboard.
  return (n: number) => formatMoneyShort(n, currency);
}

/** The line under a number: its own context first, then the change, then why it is blank. */
function subLine(def: KpiDef, k: Kpi | undefined, t: Terms, money: (n: number) => string, days: number) {
  if (!k || !hasEnoughData(def, k)) {
    const have = k?.events ?? 0;
    return { text: def.minEvents > 1 ? `Not enough data yet (${have} of ${def.minEvents})` : "Nothing yet", tone: "muted" as const };
  }
  const extra = k.extra ?? 0;
  switch (def.code) {
    case "owed":
      return extra > 0 ? { text: `${money(extra)} overdue`, tone: "bad" as const } : { text: "Nothing overdue", tone: "muted" as const };
    case "jobs_today":
      return { text: extra > 0 ? `${extra} under way` : "None under way", tone: "muted" as const };
    case "hours_worked":
      if (extra > 0) return { text: `${extra} ${extra === 1 ? "shift" : "shifts"} over 12 hours`, tone: "bad" as const };
      break;
    case "quotes_waiting_value":
      return k.events > 0
        ? { text: `${k.events} waiting, oldest ${extra} ${extra === 1 ? "day" : "days"}`, tone: "muted" as const }
        : { text: "None waiting", tone: "muted" as const };
    case "accepted_not_invoiced":
      return { text: `${k.events} ${k.events === 1 ? "quote" : "quotes"}`, tone: "muted" as const };
    case "unbilled_jobs":
      return k.value && k.value > 0
        ? { text: "Invoice these", tone: "act" as const }
        : { text: `Every finished ${lower(t.job.one)} is invoiced`, tone: "muted" as const };
  }
  const change = kpiChange(def, k);
  if (change) {
    const arrow = change.pct > 0 ? "▲" : "▼";
    return {
      text: `${arrow} ${Math.abs(change.pct)}% on the ${days} days before`,
      tone: change.good === null ? ("muted" as const) : change.good ? ("good" as const) : ("bad" as const),
    };
  }
  if (def.code === "jobs_done_pct" || def.code === "missed") return { text: `Of ${k.events} planned`, tone: "muted" as const };
  return { text: def.scope === "now" ? "Now" : `Last ${days} days`, tone: "muted" as const };
}

const TONE: Record<"muted" | "good" | "bad" | "act", string> = {
  muted: "text-muted-foreground",
  good: "font-medium text-emerald-700 dark:text-emerald-400",
  bad: "font-medium text-red-700 dark:text-red-400",
  act: "font-medium text-amber-700 dark:text-amber-400",
};

function NumberTile({
  def,
  k,
  range,
  days,
  wide = false,
}: {
  def: KpiDef;
  k: Kpi | undefined;
  range: DateRange;
  days: number;
  /** Spans both columns below desktop, so an odd last tile never sits alone. */
  wide?: boolean;
}) {
  const t = useTerms();
  const money = useMoney();
  const enough = hasEnoughData(def, k);
  const sub = subLine(def, k, t, money, days);
  const bad = enough && def.code === "missed" && (k?.value ?? 0) > 0;
  return (
    <Link
      href={def.href(range)}
      title={def.hint(t)}
      className={`${wide ? "col-span-2 lg:col-span-1 " : ""}flex min-h-[112px] flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition-[background-color,transform] duration-150 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.98] motion-reduce:transition-none`}
    >
      <span className="text-xs font-medium text-muted-foreground">{def.label(t)}</span>
      {enough && k && k.value !== null ? (
        <span
          className={`text-[28px] font-semibold leading-none tracking-tight tabular-nums ${bad ? "text-red-700 dark:text-red-400" : ""}`}
        >
          {formatKpi(def, k.value, money)}
        </span>
      ) : (
        <span className="text-[28px] font-semibold leading-none tracking-tight text-muted-foreground/60" aria-label="No figure yet">
          -
        </span>
      )}
      <span className={`text-xs ${TONE[sub.tone]}`}>{sub.text}</span>
    </Link>
  );
}

/** A new company's first week, until its numbers have something to show. */
function FirstWeekCard({ fw }: { fw: FirstWeek }) {
  const t = useTerms();
  const steps = [
    { done: fw.sites, label: `Add your first ${lower(t.site.one)}`, href: "/stores" },
    { done: fw.workdays, label: `A ${lower(t.staff.one)} starts a ${lower(t.workday.one)} on the app`, href: "/settings/users" },
    { done: fw.proven, label: `First ${lower(t.job.one)} proven, with a photo`, href: "/visits" },
    ...(fw.invoices === null ? [] : [{ done: fw.invoices, label: "Send your first invoice", href: "/invoices/new" }]),
  ];
  const done = steps.filter((s) => s.done).length;
  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold">Your first week</h2>
          <p className="text-sm text-muted-foreground">Your numbers fill in here as your team works.</p>
        </div>
        <span className="text-sm tabular-nums text-muted-foreground">
          {done} of {steps.length} done
        </span>
      </div>
      <ol className={`grid grid-cols-1 gap-x-6 gap-y-2 ${steps.length === 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3"}`}>
        {steps.map((s) => (
          <li key={s.label}>
            <Link
              href={s.href}
              className="flex min-h-11 items-start gap-2 rounded-md py-1 text-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              {s.done ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-label="Done" />
              ) : (
                <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="To do" />
              )}
              <span className={s.done ? "text-muted-foreground line-through" : "text-foreground"}>{s.label}</span>
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/**
 * "Your numbers": the trade's numbers as tiles, straight in the dashboard
 * grid like the headline (no card around cards), then the proof on file.
 * A new company sees its first week instead, until there is work to count.
 */
export function YourNumbers({
  codes,
  numbers,
  range,
  days,
}: {
  codes: string[];
  numbers: Numbers;
  range: DateRange;
  days: number;
}) {
  const t = useTerms();
  const k = numbers.kpis;
  const fw = numbers.firstWeek;
  const early = (k.jobs_done?.events ?? 0) < 5;
  if (fw && early && !(fw.sites && fw.workdays && fw.proven && (fw.invoices ?? true))) {
    return <FirstWeekCard fw={fw} />;
  }
  // Numbers the database left out (money for someone without invoicing) are not shown.
  const defs = codes.map((c) => findKpi(c)).filter((d): d is KpiDef => !!d && (!d.money || d.code in k));
  const cols = tileColumns(defs.length);
  const jobs = k.jobs_done?.value ?? 0;
  return (
    <div className="space-y-2">
      <div className={`grid grid-cols-2 gap-3 ${COLS[cols]}`}>
        {defs.map((d, i) => (
          <NumberTile
            key={d.code}
            def={d}
            k={k[d.code]}
            range={range}
            days={days}
            wide={defs.length % 2 === 1 && i === defs.length - 1}
          />
        ))}
      </div>
      {jobs > 0 && (
        <p className="px-1 text-xs text-muted-foreground">
          Proof on file, last {days} days: {jobs} {jobs === 1 ? lower(t.job.one) : lower(t.job.many)} checked in,{" "}
          {k.photos_taken?.value ?? 0} photos, {k.forms_done?.value ?? 0} checklists.
        </p>
      )}
    </div>
  );
}


/** Today: who is where, the late and not-started first; done work as a count. */
export function TodayCard({ today }: { today: Today }) {
  const t = useTerms();
  const { done, underway, of } = todayProgress(today.jobs);
  const open = today.jobs.filter((j) => j.status !== "done");
  const shown = [...open.filter((j) => j.status === "in_progress"), ...open.filter((j) => j.status === "not_started")].slice(0, 6);
  return (
    <Card className="flex h-full flex-col gap-4 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold">Today</h2>
        <Link href="/visits" className="text-sm text-primary hover:underline">
          All {lower(t.job.many)} →
        </Link>
      </div>
      {today.jobs.length === 0 ? (
        <div className="text-sm">
          <p className="text-muted-foreground">Nothing is planned for today.</p>
          <Link href="/schedule" className="mt-1 inline-block font-medium text-primary hover:underline">
            Plan your {lower(t.job.many)}
          </Link>
        </div>
      ) : (
        <>
          <p className="text-sm">
            <span className="text-2xl font-semibold tabular-nums">{done}</span>
            <span className="text-muted-foreground">
              {" "}
              of {of} done
              {underway > 0 ? `, ${underway} under way` : ""}
            </span>
          </p>
          {shown.length > 0 ? (
            <ul className="divide-y divide-border text-sm">
              {shown.map((j) => (
                <li key={j.id} className="flex min-h-11 items-center gap-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-foreground">{j.staff || `A ${lower(t.staff.one)}`}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {j.site}
                      {j.planned ? "" : " (not planned)"}
                    </span>
                  </span>
                  <span className={`shrink-0 text-xs tabular-nums ${j.status === "in_progress" ? "text-primary" : "text-muted-foreground"}`}>
                    {j.status === "in_progress" ? `On site since ${j.at}` : "Not started"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Everything planned for today is done.</p>
          )}
        </>
      )}
    </Card>
  );
}

function Row({
  label,
  value,
  href,
  sub,
  tone,
}: {
  label: string;
  value: string;
  href: string;
  sub?: string;
  tone?: "bad" | "act";
}) {
  return (
    <Link
      href={href}
      className="flex min-h-11 items-center justify-between gap-3 py-2 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span className="min-w-0">
        <span className="block text-sm text-foreground">{label}</span>
        {sub && <span className={`block text-xs ${tone === "bad" ? TONE.bad : tone === "act" ? TONE.act : "text-muted-foreground"}`}>{sub}</span>}
      </span>
      <span className={`shrink-0 text-lg font-semibold tabular-nums ${tone === "bad" ? "text-red-700 dark:text-red-400" : ""}`}>
        {value}
      </span>
    </Link>
  );
}

/** Money: what to invoice, what is owed, what came in, what goes out next. */
export function MoneyCard({ numbers, contractsDue, days }: { numbers: Numbers; contractsDue: ContractsDue | null; days: number }) {
  const t = useTerms();
  const money = useMoney();
  const config = useCompanyConfig();
  const k = numbers.kpis;
  const unbilled = k.unbilled_jobs?.value ?? 0;
  const overdue = k.owed?.extra ?? 0;
  return (
    <Card className="flex h-full flex-col gap-2 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold">Money</h2>
        <Link href="/owed" className="text-sm text-primary hover:underline">
          Who owes you →
        </Link>
      </div>
      <div className="divide-y divide-border">
        <Row
          label="Done but not invoiced"
          value={`${unbilled}`}
          href="/invoices/unbilled"
          sub={unbilled > 0 ? "Invoice these" : `Every finished ${lower(t.job.one)} is invoiced`}
          tone={unbilled > 0 ? "act" : undefined}
        />
        <Row
          label="Owed to you"
          value={money(k.owed?.value ?? 0)}
          href="/owed"
          sub={overdue > 0 ? `${money(overdue)} overdue` : "Nothing overdue"}
          tone={overdue > 0 ? "bad" : undefined}
        />
        <Row label={`Invoiced, last ${days} days`} value={money(k.invoiced?.value ?? 0)} href="/invoices" />
        <Row label={`Paid to you, last ${days} days`} value={money(k.received?.value ?? 0)} href="/invoices" />
        {config?.settings.money_contracts && contractsDue && (
          <Row
            label="Contract invoices, next 7 days"
            value={`${contractsDue.count}`}
            href="/contracts"
            sub={contractsDue.count > 0 ? money(contractsDue.value) + " before VAT" : "None due"}
          />
        )}
      </div>
    </Card>
  );
}

/** Quotes: what is waiting, what was won, what is won but not invoiced. */
export function QuotesCard({ numbers, days }: { numbers: Numbers; days: number }) {
  const money = useMoney();
  const k = numbers.kpis;
  const rate = k.quote_win_rate;
  const enough = rate && rate.value !== null && rate.events >= 3;
  return (
    <Card className="flex h-full flex-col gap-2 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold">Quotes</h2>
        <Link href="/quotes" className="text-sm text-primary hover:underline">
          All quotes →
        </Link>
      </div>
      <div className="divide-y divide-border">
        <Row
          label="Waiting for an answer"
          value={money(k.quotes_waiting_value?.value ?? 0)}
          href="/quotes"
          sub={
            (k.quotes_waiting_value?.events ?? 0) > 0
              ? `${k.quotes_waiting_value!.events} waiting, oldest ${k.quotes_waiting_value!.extra ?? 0} days`
              : "None waiting"
          }
        />
        <Row
          label={`Won, last ${days} days`}
          value={enough ? `${Math.round((rate!.value as number) * 100)}%` : "-"}
          href="/quotes"
          sub={
            enough
              ? `${Math.round((k.quote_win_value?.value ?? 0) * 100)}% by value, of ${rate!.events} decided`
              : `Not enough decided yet (${rate?.events ?? 0} of 3)`
          }
        />
        <Row
          label="Accepted, not yet invoiced"
          value={money(k.accepted_not_invoiced?.value ?? 0)}
          href="/quotes"
          sub={`${k.accepted_not_invoiced?.events ?? 0} ${(k.accepted_not_invoiced?.events ?? 0) === 1 ? "quote" : "quotes"}`}
          tone={(k.accepted_not_invoiced?.events ?? 0) > 0 ? "act" : undefined}
        />
      </div>
    </Card>
  );
}
