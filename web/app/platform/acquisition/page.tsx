import Link from "next/link";
import { requireOperator } from "@/lib/operator";
import { acquisitionStages, buildFunnel, change, formatChange, percent, periods, readRange, RANGES } from "@/lib/acquisition";
import { funnelEvents, loadFirstParty, websiteTotals } from "@/lib/acquisition-data";
import { AcquisitionFrame, Stat, count, gaMissing } from "@/components/platform/acquisition-frame";

/**
 * Acquisition overview: the headline numbers for the period against the one
 * before, and where the funnel loses the most people. Spec sections 15 and 28.
 */

export const dynamic = "force-dynamic";
export const metadata = { title: "Platform · Acquisition" };



export default async function AcquisitionOverview({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const range = readRange((await searchParams).range);
  await requireOperator(`/platform/acquisition?range=${range}`);
  const p = periods(range, new Date());
  const [totals, events, own] = await Promise.all([websiteTotals(p), funnelEvents(p), loadFirstParty(p)]);

  const ga = totals.ok ? totals.value : null;
  const GA_MISSING = gaMissing(totals.ok ? events : totals);
  const pair = (v: { current: number; previous: number } | undefined) =>
    v ? { value: count.format(v.current), change: formatChange(change(v.current, v.previous)) } : { value: null, change: null };
  const applied = { current: own.applications.length, previous: own.previousApplications };
  const { steps, leak } = buildFunnel(
    acquisitionStages({
      events: events.ok ? events.value : null,
      gaMissing: GA_MISSING,
      applications: own.applications,
      companies: own.companies,
      range,
    })
  );
  const visitors = ga?.visitors.current ?? null;
  const finishedStep = steps.find((s) => s.key === "activated");
  const firstJobFinished = finishedStep && finishedStep.count !== null ? count.format(finishedStep.count) : null;

  return (
    <AcquisitionFrame tab="/platform/acquisition" range={range} ga={totals.ok ? { ok: true } : totals}>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">
          The website, last {RANGES[range].label}{" "}
          <span className="font-normal text-muted-foreground">(Google Analytics, against the {RANGES[range].label} before)</span>
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Visitors" {...pair(ga?.visitors)} missing={GA_MISSING} href={`/platform/acquisition/website?range=${range}`} />
          <Stat label="New visitors" {...pair(ga?.newVisitors)} missing={GA_MISSING} />
          <Stat label="Returning visitors" {...pair(ga?.returningVisitors)} missing={GA_MISSING} />
          <Stat label="Sessions" {...pair(ga?.sessions)} missing={GA_MISSING} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">
          From the application on <span className="font-normal text-muted-foreground">(Tickd&apos;s own records)</span>
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="Applied" value={count.format(applied.current)} change={formatChange(change(applied.current, applied.previous))} href="/platform/founding" />
          <Stat
            label="New companies"
            value={count.format(own.newCompanies.current)}
            change={formatChange(change(own.newCompanies.current, own.newCompanies.previous))}
            href="/platform"
          />
          <Stat
            label="Free periods started"
            value={count.format(own.freePeriodsStarted.current)}
            change={formatChange(change(own.freePeriodsStarted.current, own.freePeriodsStarted.previous))}
          />
          <Stat
            label="First job finished"
            value={firstJobFinished}
            missing="Needs a database update."
            href="/platform/onboarding"
          />
          <Stat label="Paying" value={null} missing="Billing isn't live yet." />
        </div>
        <p className="text-sm text-muted-foreground">
          {visitors
            ? `${percent(applied.current, visitors)} of visitors applied (${count.format(applied.current)} of ${count.format(visitors)}).`
            : "The share of visitors who apply appears once Google Analytics is connected."}
        </p>
      </section>

      <section className="space-y-2 rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">Where people are lost</h2>
        <p className="text-sm text-foreground">
          {leak
            ? `The biggest drop is between “${leak.from}” and “${leak.to}”: ${count.format(leak.lost)} of ${count.format(leak.of)} didn't go on.`
            : steps.some((s) => s.count)
              ? "No drop to show yet: there aren't enough people at two steps in a row."
              : "Nothing to show yet for this period."}
        </p>
        <Link href={`/platform/acquisition/funnel?range=${range}`} className="text-sm text-primary underline-offset-4 hover:underline">
          See the whole funnel
        </Link>
      </section>
    </AcquisitionFrame>
  );
}
