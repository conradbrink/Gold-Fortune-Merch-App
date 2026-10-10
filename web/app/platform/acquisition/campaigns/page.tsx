import { requireOperator } from "@/lib/operator";
import { groupSources, percent, periods, readRange, tallyApplications } from "@/lib/acquisition";
import { loadFirstParty, ownStats } from "@/lib/acquisition-data";
import { CampaignLinkMaker } from "@/components/platform/campaign-link-maker";
import { AcquisitionFrame, count } from "@/components/platform/acquisition-frame";

/**
 * Campaigns (spec sections 22 and 33): every utm_campaign in Tickd's own
 * count of visits or carried by an application, with what it produced, and a
 * link maker so a new advert's link carries its campaign. Cost per
 * customer needs what was spent, which Tickd doesn't record yet, so it isn't
 * shown (spec section 37: never invent CAC).
 */

export const dynamic = "force-dynamic";
export const metadata = { title: "Platform · Campaigns" };

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const range = readRange((await searchParams).range);
  await requireOperator(`/platform/acquisition/campaigns?range=${range}`);
  const p = periods(range, new Date());
  const [stats, own] = await Promise.all([ownStats(p.current), loadFirstParty(p)]);
  const web = stats.ok ? groupSources(stats.value.sources, (x) => x.utm_campaign) : null;
  const mine = tallyApplications(own.applications, (a) => a.attribution?.utm_campaign ?? null, own.companies);
  const names = [...new Set([...(web ? [...web.keys()] : []), ...mine.keys()])].filter(Boolean);
  const rows = names
    .map((name) => ({ name, web: web?.get(name), own: mine.get(name) }))
    .sort((a, b) => (b.own?.applications ?? 0) - (a.own?.applications ?? 0) || (b.web?.visitors ?? 0) - (a.web?.visitors ?? 0));
  const na = <span className="text-muted-foreground">n/a</span>;

  return (
    <AcquisitionFrame tab="/platform/acquisition/campaigns" range={range} notice={stats.ok ? null : stats.message}>
      <CampaignLinkMaker />
      {rows.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          No campaigns in this period yet. Make a link above and use it in your advert or post.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Campaign</th>
                <th className="px-4 py-2 text-right font-medium">Visitors</th>
                <th className="px-4 py-2 text-right font-medium">Started applying</th>
                <th className="px-4 py-2 text-right font-medium">Applied</th>
                <th className="px-4 py-2 text-right font-medium">Company set up</th>
                <th className="px-4 py-2 text-right font-medium">Visitor to applied</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 font-medium">{r.name}</td>
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
      <p className="text-sm text-muted-foreground">
        Cost per customer needs what each campaign cost, which Tickd doesn&apos;t record yet, so it isn&apos;t shown.
        Paying customers and their money appear once billing is live.
      </p>
    </AcquisitionFrame>
  );
}
