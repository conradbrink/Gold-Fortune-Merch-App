import Link from "next/link";
import { requireOperator } from "@/lib/operator";
import { acquisitionStages, buildFunnel, percent, periods, readRange } from "@/lib/acquisition";
import { funnelEvents, loadFirstParty } from "@/lib/acquisition-data";
import { AcquisitionFrame, count, gaMissing } from "@/components/platform/acquisition-frame";

/**
 * The funnel, visitor to paying (spec sections 19, 20 and 29). Each step shows
 * its number, the share of the step before that reached it, and the drop. The
 * bars are drawn against the first measured step, and the biggest drop is
 * named above them. Steps not measured yet say why instead of showing 0.
 */

export const dynamic = "force-dynamic";
export const metadata = { title: "Platform · Funnel" };

export default async function FunnelPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const range = readRange((await searchParams).range);
  await requireOperator(`/platform/acquisition/funnel?range=${range}`);
  const p = periods(range, new Date());
  const [events, own] = await Promise.all([funnelEvents(p), loadFirstParty(p)]);
  const { steps, leak } = buildFunnel(
    acquisitionStages({
      events: events.ok ? events.value : null,
      gaMissing: gaMissing(events),
      applications: own.applications,
      companies: own.companies,
      range,
    })
  );
  const top = Math.max(1, ...steps.map((s) => s.count ?? 0));

  return (
    <AcquisitionFrame tab="/platform/acquisition/funnel" range={range} ga={events.ok ? { ok: true } : events}>
      {leak && (
        <p className="rounded-lg border border-border bg-card p-4 text-sm text-foreground">
          The biggest drop is between “{leak.from}” and “{leak.to}”: {count.format(leak.lost)} of {count.format(leak.of)} didn&apos;t
          go on ({percent(leak.lost, leak.of)}).
        </p>
      )}
      <ol className="space-y-2 [--series:#008f8c] dark:[--series:#1a9e9a]">
        {steps.map((s, i) => (
          <li key={s.key} className="rounded-lg border border-border bg-card p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-sm">
                <span className="mr-2 tabular-nums text-muted-foreground">{i + 1}.</span>
                {s.href && s.count !== null ? (
                  <Link href={s.href} className="font-medium text-foreground hover:underline">
                    {s.label}
                  </Link>
                ) : (
                  <span className="font-medium text-foreground">{s.label}</span>
                )}
                <span className="ml-2 text-xs text-muted-foreground">{s.from === "website" ? "Google Analytics" : "Tickd"}</span>
              </div>
              <div className="text-sm tabular-nums">
                {s.count === null ? (
                  <span className="text-muted-foreground">{s.note}</span>
                ) : (
                  <>
                    <span className="text-lg font-semibold text-foreground">{count.format(s.count)}</span>
                    {s.ofPrevious !== null && (
                      <span className="ml-3 text-muted-foreground">
                        {percent(s.ofPrevious * 100, 100)} of the step before, {percent((s.dropOff ?? 0) * 100, 100)} lost
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>
            {s.count !== null && (
              <div className="mt-2 h-2 rounded-full bg-muted" aria-hidden="true">
                <div className="h-2 rounded-full bg-[var(--series)]" style={{ width: `${Math.max((s.count / top) * 100, s.count > 0 ? 1 : 0)}%` }} />
              </div>
            )}
          </li>
        ))}
      </ol>
      <p className="text-sm text-muted-foreground">
        Steps 1 to 3 count devices (Google Analytics); from step 4 they are Tickd&apos;s own records, so a person on two
        devices counts twice above step 4 and once below it. A company counts once its application is linked to it on
        Founding applications.
      </p>
    </AcquisitionFrame>
  );
}
