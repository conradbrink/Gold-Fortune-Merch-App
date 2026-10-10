import Link from "next/link";
import { requireOperator } from "@/lib/operator";
import { acquisitionStages, buildFunnel, change, eventsMap, formatChange, percent, periods, readRange, RANGES } from "@/lib/acquisition";
import { loadFirstParty, ownStats } from "@/lib/acquisition-data";
import { AcquisitionFrame, Stat, count } from "@/components/platform/acquisition-frame";

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
  const [now, before, own] = await Promise.all([ownStats(p.current), ownStats(p.previous), loadFirstParty(p)]);

  const web = now.ok ? now.value : null;
  const prev = before.ok ? before.value : null;
  const missing = now.ok ? "Not counted yet." : "Needs a database update.";
  const pair = (pick: (s: NonNullable<typeof web>) => number) =>
    web ? { value: count.format(pick(web)), change: formatChange(change(pick(web), prev ? pick(prev) : null)) } : { value: null, change: null };
  const applied = { current: own.applications.length, previous: own.previousApplications };
  const { steps, leak } = buildFunnel(
    acquisitionStages({
      events: web ? eventsMap(web) : null,
      gaMissing: missing,
      applications: own.applications,
      companies: own.companies,
      range,
    })
  );
  const visitors = web?.visitors ?? null;
  const finishedStep = steps.find((s) => s.key === "activated");
  const firstJobFinished = finishedStep && finishedStep.count !== null ? count.format(finishedStep.count) : null;

  return (
    <AcquisitionFrame tab="/platform/acquisition" range={range} notice={now.ok ? null : now.message}>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">
          The website, last {RANGES[range].label}{" "}
          <span className="font-normal text-muted-foreground">(Tickd&apos;s own count, up to the minute, against the {RANGES[range].label} before)</span>
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Visitors" {...pair((s) => s.visitors)} missing={missing} href={`/platform/acquisition/website?range=${range}`} />
          <Stat label="New visitors" {...pair((s) => s.newVisitors)} missing={missing} />
          <Stat label="Returning visitors" {...pair((s) => s.visitors - s.newVisitors)} missing={missing} />
          <Stat label="Page views" {...pair((s) => s.pageViews)} missing={missing} />
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
            : "The share of visitors who apply appears once the website has visitors in this period."}
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
