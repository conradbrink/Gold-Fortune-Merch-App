import { requireOperator } from "@/lib/operator";
import { change, formatChange, periods, readRange, RANGES } from "@/lib/acquisition";
import { everyDay, ownStats, websiteFilter, websiteTotals } from "@/lib/acquisition-data";
import { AcquisitionFrame, Stat, count } from "@/components/platform/acquisition-frame";
import { VisitorsChart } from "@/components/platform/visitors-chart";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";

/**
 * Website analytics (spec sections 16 and 17) from Tickd's own count, so
 * every number is up to the minute: visitors, sessions, page views, new and
 * returning, visitors per day, and each page with how many started an
 * application on it. Filter by device and country. Engaged sessions and
 * bounce rate are Google Analytics' (it measures time on the page; Tickd's
 * count doesn't), so those two can lag a few hours.
 */

export const dynamic = "force-dynamic";
export const metadata = { title: "Platform · Website" };

const pct = (v: number) => `${Math.round(v * 100)}%`;
const DEVICE_LABEL: Record<string, string> = { mobile: "Phone", tablet: "Tablet", desktop: "Computer" };
const regionName = (() => {
  try {
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    return (code: string) => names.of(code) ?? code;
  } catch {
    return (code: string) => code;
  }
})();

export default async function WebsitePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const range = readRange(params.range);
  const device = typeof params.device === "string" && params.device in DEVICE_LABEL ? params.device : "";
  const country = typeof params.country === "string" && /^[A-Z]{2}$/.test(params.country) ? params.country : "";
  await requireOperator(`/platform/acquisition/website?range=${range}`);
  const p = periods(range, new Date());
  const [now, before, google] = await Promise.all([
    ownStats(p.current, { device, country }),
    ownStats(p.previous, { device, country }),
    // Google names countries in full; its filter takes the name.
    websiteTotals(p, websiteFilter(device, country ? regionName(country) : "")),
  ]);
  const web = now.ok ? now.value : null;
  const prev = before.ok ? before.value : null;
  const stat = (pick: (s: NonNullable<typeof web>) => number) =>
    web ? { value: count.format(pick(web)), change: formatChange(change(pick(web), prev ? pick(prev) : null)) } : { value: null, change: null };
  const g = google.ok ? google.value : null;
  const daily = web ? new Map(web.daily.map((d) => [d.day, d.visitors])) : null;

  return (
    <AcquisitionFrame
      tab="/platform/acquisition/website"
      range={range}
      notice={now.ok ? null : now.message}
      keep={{ device, country }}
    >
      {web && (
        <form method="get" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="range" value={range} />
          <div className="w-40 space-y-1">
            <label htmlFor="device" className="text-sm text-muted-foreground">
              Device
            </label>
            <NativeSelect id="device" name="device" defaultValue={device}>
              <option value="">All devices</option>
              {Object.entries(DEVICE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
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
              {[...new Set([...web.countries, ...(country ? [country] : [])])]
                .sort((a, b) => regionName(a).localeCompare(regionName(b)))
                .map((c) => (
                  <option key={c} value={c}>
                    {regionName(c)}
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
        <Stat label="Visitors" {...stat((s) => s.visitors)} missing="Needs a database update." />
        <Stat label="Sessions" {...stat((s) => s.sessions)} missing="Needs a database update." />
        <Stat label="Page views" {...stat((s) => s.pageViews)} missing="Needs a database update." />
        <Stat
          label="New / returning"
          value={web ? `${count.format(web.newVisitors)} / ${count.format(web.visitors - web.newVisitors)}` : null}
          missing="Needs a database update."
        />
        <Stat
          label="Engaged sessions (Google)"
          value={g ? pct(g.engagementRate.current) : null}
          missing={google.ok ? "No data yet." : "Google Analytics isn't connected."}
        />
        <Stat
          label="Bounce rate (Google)"
          value={g ? pct(g.bounceRate.current) : null}
          missing={google.ok ? "No data yet." : "Google Analytics isn't connected."}
        />
      </div>

      {daily && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">Visitors per day, last {RANGES[range].label}</h2>
          <VisitorsChart points={everyDay(p.current).map((date) => ({ date, visitors: daily.get(date) ?? 0 }))} />
        </section>
      )}

      {web && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">Pages</h2>
          {web.pages.length === 0 ? (
            <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">No page views in this period yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Page</th>
                    <th className="px-4 py-2 text-right font-medium">Visitors</th>
                    <th className="px-4 py-2 text-right font-medium">Views</th>
                    <th className="px-4 py-2 text-right font-medium">Started applying</th>
                  </tr>
                </thead>
                <tbody>
                  {web.pages.map((r) => (
                    <tr key={r.path} className="border-b border-border last:border-0">
                      <td className="px-4 py-2 font-mono text-xs">{r.path}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{count.format(r.visitors)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{count.format(r.views)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{count.format(r.started)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            &ldquo;Started applying&rdquo; is people who began the Founding form on that page. Engaged sessions and bounce
            rate come from Google Analytics, which measures time on the page, and can take a few hours to catch up.
          </p>
        </section>
      )}
    </AcquisitionFrame>
  );
}
