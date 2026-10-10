import { requireOperator } from "@/lib/operator";
import { asAttribution, channelOf, CHANNELS, groupSources, percent, periods, readRange, sourceOf, tallyApplications } from "@/lib/acquisition";
import { loadFirstParty, ownStats } from "@/lib/acquisition-data";
import { AcquisitionFrame, count } from "@/components/platform/acquisition-frame";

/**
 * Where people come from (spec sections 21 and 32): visitors and the people
 * who started applying per channel (Tickd's own count, instant), next to the
 * applications and companies from each channel. Customers, not just traffic.
 * Visits and applications are sorted into Google's channel names by the same
 * rules (channelOf), so a row means the same thing on both sides.
 */

export const dynamic = "force-dynamic";
export const metadata = { title: "Platform · Sources" };

export default async function SourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const range = readRange((await searchParams).range);
  await requireOperator(`/platform/acquisition/sources?range=${range}`);
  const p = periods(range, new Date());
  const [stats, own] = await Promise.all([ownStats(p.current), loadFirstParty(p)]);
  const byChannel = tallyApplications(own.applications, (a) => channelOf(a.attribution), own.companies);
  const bySource = tallyApplications(own.applications, (a) => sourceOf(a.attribution), own.companies);
  // Visitors per channel from Tickd's own count, sorted by the same rules as applications.
  const web = stats.ok ? groupSources(stats.value.sources, (x) => channelOf(asAttribution(x))) : null;

  const names = [...new Set([...CHANNELS, ...(web ? [...web.keys()] : [])])].filter(
    (c) => (web?.get(c)?.visitors ?? 0) > 0 || (byChannel.get(c)?.applications ?? 0) > 0
  );
  const rows = names
    .map((c) => ({ channel: c, web: web?.get(c), own: byChannel.get(c) }))
    .sort((a, b) => (b.own?.applications ?? 0) - (a.own?.applications ?? 0) || (b.web?.visitors ?? 0) - (a.web?.visitors ?? 0));
  const na = <span className="text-muted-foreground">n/a</span>;

  return (
    <AcquisitionFrame tab="/platform/acquisition/sources" range={range} notice={stats.ok ? null : stats.message}>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">By channel</h2>
        {rows.length === 0 ? (
          <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
            No visitors or applications in this period yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Channel</th>
                  <th className="px-4 py-2 text-right font-medium">Visitors</th>
                  <th className="px-4 py-2 text-right font-medium">Started applying</th>
                  <th className="px-4 py-2 text-right font-medium">Applied</th>
                  <th className="px-4 py-2 text-right font-medium">Company set up</th>
                  <th className="px-4 py-2 text-right font-medium">Visitor to applied</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.channel} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 font-medium">{r.channel}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{web ? count.format(r.web?.visitors ?? 0) : na}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{web ? count.format(r.web?.started ?? 0) : na}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{count.format(r.own?.applications ?? 0)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{count.format(r.own?.companies ?? 0)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {web && r.web?.visitors ? percent(r.own?.applications ?? 0, r.web.visitors) : na}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">Applications by source</h2>
        {bySource.size === 0 ? (
          <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">No applications in this period yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Source</th>
                  <th className="px-4 py-2 text-right font-medium">Applied</th>
                  <th className="px-4 py-2 text-right font-medium">Company set up</th>
                  <th className="px-4 py-2 text-right font-medium">Free period started</th>
                </tr>
              </thead>
              <tbody>
                {[...bySource.entries()]
                  .sort((a, b) => b[1].applications - a[1].applications)
                  .map(([source, t]) => (
                    <tr key={source} className="border-b border-border last:border-0">
                      <td className="px-4 py-2 font-medium">{source}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{count.format(t.applications)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{count.format(t.companies)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{count.format(t.freePeriods)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-sm text-muted-foreground">
        Paying customers and the money they bring appear here once billing is live. An application&apos;s channel comes
        from how the applicant first found the site; a company counts once its application is linked to it.
      </p>
    </AcquisitionFrame>
  );
}
