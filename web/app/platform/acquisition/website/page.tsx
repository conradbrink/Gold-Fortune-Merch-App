import { requireOperator } from "@/lib/operator";
import { change, formatChange, periods, readRange, RANGES } from "@/lib/acquisition";
import { dailyVisitors, filterChoices, pages, websiteFilter, websiteTotals } from "@/lib/acquisition-data";
import { AcquisitionFrame, Stat, count } from "@/components/platform/acquisition-frame";
import { VisitorsChart } from "@/components/platform/visitors-chart";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";

/**
 * Website analytics from Google Analytics (spec sections 16 and 17): the
 * totals, visitors per day, and each page with how many started an
 * application from it. Filter by device and country. GA4's API has no exit
 * rate, so the page table shows engagement and bounce rate instead and says so.
 */

export const dynamic = "force-dynamic";
export const metadata = { title: "Platform · Website" };

const pct = (v: number) => `${Math.round(v * 100)}%`;

export default async function WebsitePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const range = readRange(params.range);
  const device = typeof params.device === "string" ? params.device.slice(0, 40) : "";
  const country = typeof params.country === "string" ? params.country.slice(0, 80) : "";
  await requireOperator(`/platform/acquisition/website?range=${range}`);
  const p = periods(range, new Date());
  const filter = websiteFilter(device, country);
  const [totals, daily, rows, choices] = await Promise.all([
    websiteTotals(p, filter),
    dailyVisitors(p, filter),
    pages(p, filter),
    filterChoices(p),
  ]);
  const t = totals.ok ? totals.value : null;
  const stat = (v: { current: number; previous: number } | undefined, asPct = false) =>
    v
      ? {
          value: asPct ? pct(v.current) : count.format(v.current),
          change: asPct ? null : formatChange(change(v.current, v.previous)),
        }
      : { value: null, change: null };

  return (
    <AcquisitionFrame
      tab="/platform/acquisition/website"
      range={range}
      ga={totals.ok ? { ok: true } : totals}
      keep={{ device, country }}
    >
      {totals.ok && (
        <form method="get" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="range" value={range} />
          <div className="w-40 space-y-1">
            <label htmlFor="device" className="text-sm text-muted-foreground">
              Device
            </label>
            <NativeSelect id="device" name="device" defaultValue={device}>
              <option value="">All devices</option>
              {choices.devices.map((d) => (
                <option key={d} value={d}>
                  {d[0]?.toUpperCase() + d.slice(1)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="w-52 space-y-1">
            <label htmlFor="country" className="text-sm text-muted-foreground">
              Country
            </label>
            <NativeSelect id="country" name="country" defaultValue={country}>
              <option value="">All countries</option>
              {choices.countries.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button type="submit" variant="outline">
            Filter
          </Button>
        </form>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Visitors" {...stat(t?.visitors)} missing="Not connected" />
        <Stat label="Sessions" {...stat(t?.sessions)} missing="Not connected" />
        <Stat label="Page views" {...stat(t?.views)} missing="Not connected" />
        <Stat
          label="New / returning"
          value={t ? `${count.format(t.newVisitors.current)} / ${count.format(t.returningVisitors.current)}` : null}
          missing="Not connected"
        />
        <Stat label="Engaged sessions" {...stat(t?.engagementRate, true)} missing="Not connected" />
        <Stat label="Bounce rate" {...stat(t?.bounceRate, true)} missing="Not connected" />
      </div>

      {daily.ok && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">Visitors per day, last {RANGES[range].label}</h2>
          <VisitorsChart points={daily.value} />
        </section>
      )}

      {rows.ok && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">Pages</h2>
          {rows.value.length === 0 ? (
            <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">No page views in this period yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Page</th>
                    <th className="px-4 py-2 text-right font-medium">Visitors</th>
                    <th className="px-4 py-2 text-right font-medium">Views</th>
                    <th className="px-4 py-2 text-right font-medium">Engaged</th>
                    <th className="px-4 py-2 text-right font-medium">Bounce rate</th>
                    <th className="px-4 py-2 text-right font-medium">Started applying</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.value.map((r) => (
                    <tr key={r.path} className="border-b border-border last:border-0">
                      <td className="px-4 py-2 font-mono text-xs">{r.path}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{count.format(r.visitors)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{count.format(r.views)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{pct(r.engagementRate)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{pct(r.bounceRate)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{count.format(r.startedApplying)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Google Analytics 4 doesn&apos;t give an exit rate through its API, so this shows engaged sessions and bounce
            rate. &ldquo;Started applying&rdquo; is people who began the Founding form on that page.
          </p>
        </section>
      )}
    </AcquisitionFrame>
  );
}
