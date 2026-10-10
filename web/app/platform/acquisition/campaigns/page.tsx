import { requireOperator } from "@/lib/operator";
import { percent, periods, readRange, tallyApplications } from "@/lib/acquisition";
import { byGroup, loadFirstParty } from "@/lib/acquisition-data";
import { AcquisitionFrame, count } from "@/components/platform/acquisition-frame";

/**
 * Campaigns (spec sections 22 and 33): every utm_campaign seen by Google
 * Analytics or carried by an application, with what it produced. Cost per
 * customer needs what was spent, which Tickd doesn't record yet, so it isn't
 * shown (spec section 37: never invent CAC).
 */

export const dynamic = "force-dynamic";
export const metadata = { title: "Platform · Campaigns" };

const EXAMPLE = "https://tickd.co.za/founding?utm_source=facebook&utm_medium=paid_social&utm_campaign=founding-oct";

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const range = readRange((await searchParams).range);
  await requireOperator(`/platform/acquisition/campaigns?range=${range}`);
  const p = periods(range, new Date());
  const [ga, own] = await Promise.all([byGroup(p, "sessionCampaignName"), loadFirstParty(p)]);
  const web = ga.ok ? ga.value : null;
  const mine = tallyApplications(own.applications, (a) => a.attribution?.utm_campaign ?? null, own.companies);
  // GA names visits without a campaign "(direct)", "(organic)", "(referral)" or "(not set)".
  const names = [...new Set([...(web ? [...web.keys()] : []), ...mine.keys()])].filter((n) => n && !n.startsWith("("));
  const rows = names
    .map((name) => ({ name, web: web?.get(name), own: mine.get(name) }))
    .sort((a, b) => (b.own?.applications ?? 0) - (a.own?.applications ?? 0) || (b.web?.visitors ?? 0) - (a.web?.visitors ?? 0));
  const na = <span className="text-muted-foreground">n/a</span>;

  return (
    <AcquisitionFrame tab="/platform/acquisition/campaigns" range={range} ga={ga.ok ? { ok: true } : ga}>
      {rows.length === 0 ? (
        <div className="space-y-2 rounded-lg border border-border bg-card p-6 text-sm">
          <p className="text-foreground">No campaigns in this period yet.</p>
          <p className="text-muted-foreground">
            A campaign shows up here when its links carry a campaign name. Add it to the end of every advert&apos;s
            link, for example:
          </p>
          <p className="break-all rounded bg-muted px-2 py-1 font-mono text-xs text-foreground">{EXAMPLE}</p>
        </div>
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
                  <td className="px-4 py-2 text-right tabular-nums">{web ? count.format(r.web?.startedApplying ?? 0) : na}</td>
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
