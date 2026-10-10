import Link from "next/link";
import { requireOperator } from "@/lib/operator";
import { loadActivation } from "@/lib/activation-data";
import { attentionFor, whatsappNumber } from "@/lib/activation";
import { change, formatChange, percent, periods, readRange, RANGES, type RangeKey } from "@/lib/acquisition";
import { loadFirstParty, ownStats } from "@/lib/acquisition-data";
import { healthProblems, inFreePeriod, isActive, madeIn, moduleAdoption, newPerMonth, ACTIVE_DAYS } from "@/lib/control-dashboard";
import { loadHealth, loadModuleUse } from "@/lib/control-dashboard-data";
import { Stat, count } from "@/components/platform/acquisition-frame";

/**
 * The Control Centre's home (owner's spec sections 4, 5, 6, 48 and 49): how
 * Tickd is doing, who needs attention, where new customers come from, and
 * whether anything is broken, on one screen. Every headline links to the page
 * with its records. Numbers Tickd can't know yet (MRR, paying, churn: billing
 * isn't live) say so instead of showing 0.
 */

export const dynamic = "force-dynamic";
export const metadata = { title: "Platform · Dashboard" };

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

function Section({ title, href, link, children }: { title: string; href?: string; link?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {href && (
          <Link href={href} className="text-sm text-primary underline-offset-4 hover:underline">
            {link}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const range = readRange((await searchParams).range);
  await requireOperator(`/platform?range=${range}`);
  const now = new Date();
  const p = periods(range, now);

  // Each read stands alone: if one fails, its section says so and the rest still show.
  const safe = <T,>(read: Promise<T>) => read.then((value) => ({ ok: true as const, value })).catch(() => ({ ok: false as const }));
  const activationRead = loadActivation();
  const [activationResult, web, webBefore, ownResult, health, useResult] = await Promise.all([
    safe(activationRead),
    safe(ownStats(p.current)),
    safe(ownStats(p.previous)),
    safe(loadFirstParty(p, activationRead)),
    loadHealth(),
    safe(loadModuleUse()),
  ]);
  const activation = activationResult.ok ? activationResult.value : { ok: false as const, message: "Companies couldn't be read just now. Reload in a moment." };
  const own = ownResult.ok ? ownResult.value : null;
  const use = useResult.ok ? useResult.value : null;

  const companies = activation.ok ? activation.companies : [];
  const total = companies.length;
  const active = companies.filter((c) => isActive(c, now)).length;
  const free = companies.filter((c) => inFreePeriod(c, now)).length;
  const newNow = companies.filter((c) => madeIn(c, p.current)).length;
  const newBefore = companies.filter((c) => madeIn(c, p.previous)).length;

  const attention = companies
    .map((c) => ({ c, reasons: attentionFor(c, now) }))
    .filter((r) => r.reasons.length > 0)
    .sort((a, b) => b.reasons[0].urgency - a.reasons[0].urgency);

  const webNow = web.ok && web.value.ok ? web.value.value : null;
  const webPrev = webBefore.ok && webBefore.value.ok ? webBefore.value.value : null;
  const visitors = webNow?.visitors ?? null;
  const applied = own?.applications.length ?? 0;
  const linked = own ? own.applications.filter((a) => a.organization_id && own.companies.has(a.organization_id)) : [];
  const firstJob = own ? linked.filter((a) => own.companies.get(a.organization_id!)?.activated).length : 0;

  const months = newPerMonth(companies, now);
  const top = Math.max(1, ...months.map((m) => m.count));
  const modules = use ? moduleAdoption(use.modules, use.enabled, total).slice(0, 6) : null;
  const problems = health.ok ? healthProblems(health.value) : [];
  const rangeLabel = RANGES[range].label;

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-4 sm:p-8 [--series:#008f8c] dark:[--series:#1a9e9a]">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-foreground">How Tickd is doing</h1>
          <p className="text-sm text-muted-foreground">
            The last {rangeLabel}, against the {rangeLabel} before. Every number opens the records behind it.
          </p>
        </div>
        <div role="group" aria-label="Period" className="flex rounded-md border border-border bg-card p-0.5 text-sm">
          {(Object.keys(RANGES) as RangeKey[]).map((r) => (
            <Link
              key={r}
              href={`/platform?range=${r}`}
              aria-current={r === range ? "true" : undefined}
              className={`rounded px-2.5 py-1 ${r === range ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {RANGES[r].label}
            </Link>
          ))}
        </div>
      </header>

      {!activation.ok && (
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground">{activation.message}</p>
      )}

      <Section title="The business">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Companies" value={count.format(total)} href="/platform/companies" />
          <Stat
            label={`Active (used in the last ${ACTIVE_DAYS} days)`}
            value={total ? `${count.format(active)} of ${count.format(total)}` : "0"}
            href="/platform/onboarding?view=all"
          />
          <Stat label="In a free period" value={count.format(free)} href="/platform/onboarding?view=all" />
          <Stat
            label={`New, last ${rangeLabel}`}
            value={count.format(newNow)}
            change={formatChange(change(newNow, newBefore))}
            href="/platform/companies"
          />
        </div>
        <p className="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Money:</span> monthly revenue (MRR), paying companies and companies
          that leave appear here once billing is live.
        </p>
      </Section>

      <Section
        title={attention.length ? `Needs attention (${attention.length})` : "Needs attention"}
        href="/platform/onboarding?view=attention"
        link="Onboarding"
      >
        {attention.length === 0 ? (
          <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            Nobody needs you right now: every company is on track.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {attention.slice(0, 5).map(({ c, reasons }) => {
              const wa = whatsappNumber(c.contactPhone);
              return (
                <li key={c.orgId} className="flex flex-wrap items-start justify-between gap-3 p-3 text-sm">
                  <div className="min-w-0 space-y-0.5">
                    <Link href={`/platform/companies/${c.orgId}`} className="font-medium text-foreground hover:underline">
                      {c.name}
                    </Link>
                    <div className="text-foreground">
                      {reasons[0].reason}
                      {reasons.length > 1 && <span className="text-muted-foreground"> (and {plural(reasons.length - 1, "more thing")})</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">{reasons[0].action}</div>
                  </div>
                  <div className="flex gap-3 text-xs">
                    {wa && (
                      <a className="text-primary underline-offset-4 hover:underline" href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer">
                        WhatsApp
                      </a>
                    )}
                    {c.contactEmail && (
                      <a className="text-primary underline-offset-4 hover:underline" href={`mailto:${c.contactEmail}`}>
                        Email
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title={`Where new companies come from, last ${rangeLabel}`} href={`/platform/acquisition/funnel?range=${range}`} link="The whole funnel">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Website visitors"
            value={visitors !== null ? count.format(visitors) : null}
            change={webNow && webPrev ? formatChange(change(webNow.visitors, webPrev.visitors)) : null}
            missing="Couldn't be read just now."
            href={`/platform/acquisition/website?range=${range}`}
          />
          <Stat
            label="Applied"
            value={own ? count.format(applied) : null}
            change={own ? formatChange(change(applied, own.previousApplications)) : null}
            missing="Couldn't be read just now."
            href="/platform/founding"
          />
          <Stat label="Company set up" value={own ? count.format(linked.length) : null} missing="Couldn't be read just now." href="/platform/founding" />
          <Stat label="First job finished" value={own ? count.format(firstJob) : null} missing="Couldn't be read just now." href="/platform/onboarding" />
        </div>
        <p className="text-sm text-muted-foreground">
          {visitors
            ? `${percent(applied, visitors)} of visitors applied, ${applied ? percent(linked.length, applied) : "none"} of applicants got a company, and ${linked.length ? percent(firstJob, linked.length) : "none"} of those finished a first job. Paying companies appear once billing is live.`
            : "The funnel fills in as people come to the website and apply."}
        </p>
      </Section>

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="New companies per month" href="/platform/companies" link="All companies">
          <div className="rounded-lg border border-border bg-card p-4">
            <ol className="flex items-end gap-1.5" aria-label="New companies per month, last 12 months">
              {months.map((m) => (
                <li key={m.month} className="flex flex-1 flex-col items-center gap-1">
                  <span className="h-4 text-xs tabular-nums text-muted-foreground">{m.count || ""}</span>
                  <div className="flex h-24 w-full items-end">
                    <div
                      className="w-full rounded-t-[4px] bg-[var(--series)]"
                      style={{ height: `${(m.count / top) * 100}%`, minHeight: m.count ? 4 : 0 }}
                      title={`${m.label}: ${plural(m.count, "new company", "new companies")}`}
                    />
                  </div>
                  <span className="text-[11px] text-muted-foreground">{m.label}</span>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-muted-foreground">Companies that leave are counted once billing is live.</p>
          </div>
        </Section>

        <Section title="Modules companies use">
          <div className="space-y-2 rounded-lg border border-border bg-card p-4">
            {modules === null ? (
              <p className="text-sm text-muted-foreground">Modules couldn&apos;t be read just now.</p>
            ) : modules.length === 0 ? (
              <p className="text-sm text-muted-foreground">No modules yet.</p>
            ) : (
              modules.map((m) => (
                <div key={m.code} className="space-y-1 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-foreground">{m.name}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {Math.round(m.share * 100)}% ({m.companies} of {total})
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted" aria-hidden="true">
                    <div className="h-1.5 rounded-full bg-[var(--series)]" style={{ width: `${m.share * 100}%` }} />
                  </div>
                </div>
              ))
            )}
            <p className="pt-1 text-xs text-muted-foreground">Switched on, out of every company.</p>
          </div>
        </Section>
      </div>

      <Section title="Tickd itself">
        <div className="rounded-lg border border-border bg-card p-4 text-sm">
          {!health.ok ? (
            <p className="text-muted-foreground">{health.message}</p>
          ) : problems.length === 0 ? (
            <p className="font-medium text-foreground">
              All systems working: {plural(health.value.jobs.filter((j) => j.active).length, "scheduled job")} running
              without failures, and no emails failed or stuck.
            </p>
          ) : (
            <ul className="list-disc space-y-1 pl-5 text-foreground">
              {problems.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          )}
          {health.ok && (
            <p className="mt-1 text-xs text-muted-foreground">
              The website count received {plural(health.value.webEvents24h, "event")} in the last 24 hours.
            </p>
          )}
        </div>
      </Section>
    </main>
  );
}
