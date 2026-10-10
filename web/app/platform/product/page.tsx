import Link from "next/link";
import { requireOperator } from "@/lib/operator";
import { change, formatChange, periods, readRange, RANGES, type RangeKey } from "@/lib/acquisition";
import { loadActivation } from "@/lib/activation-data";
import { isActive } from "@/lib/control-dashboard";
import { loadModuleUsage, loadModuleUse } from "@/lib/control-dashboard-data";
import { moduleCompanies, moduleRows } from "@/lib/product-usage";
import { count } from "@/components/platform/acquisition-frame";

/**
 * Product (owner's spec section 27): which parts of Tickd companies use. For
 * each built module: switched on, actually used in the period (one plain
 * signal per module, said in words), the share of active companies using it,
 * the trend against the period before, and companies that have it on but
 * don't use it. A module opens the companies behind its numbers.
 */

export const dynamic = "force-dynamic";
export const metadata = { title: "Platform · Product" };

const pct = (v: number) => `${Math.round(v * 100)}%`;

export default async function ProductPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const range = readRange(params.range);
  const selected = typeof params.module === "string" ? params.module : null;
  await requireOperator(`/platform/product?range=${range}`);
  const now = new Date();
  const p = periods(range, now);

  // Each read stands alone, as on the dashboard: a failure says so, the rest still show.
  const failed = { ok: false as const, message: "This couldn't be read just now. Reload in a moment." };
  const safe = <T,>(read: Promise<T>, label: string) =>
    read.catch((error: unknown) => {
      console.error(`product: ${label} failed`, error instanceof Error ? error.message : error);
      return null;
    });
  const [useRead, usageNowRead, usageBeforeRead, activationRead] = await Promise.all([
    safe(loadModuleUse(), "modules"),
    safe(loadModuleUsage(p.current), "usage"),
    safe(loadModuleUsage(p.previous), "earlier usage"),
    safe(loadActivation(), "companies"),
  ]);
  const use = useRead ?? { modules: [], enabled: [] };
  const usageNow = useRead ? (usageNowRead ?? failed) : failed;
  const usageBefore = usageBeforeRead ?? failed;
  const activation = activationRead ?? failed;
  const companies = activation.ok ? activation.companies : [];
  const activeOrgs = new Set(companies.filter((c) => isActive(c, now)).map((c) => c.orgId));
  const names = new Map(companies.map((c) => [c.orgId, c.name]));
  const rows = usageNow.ok
    ? moduleRows({
        modules: use.modules,
        enabled: use.enabled,
        now: usageNow.rows,
        before: usageBefore.ok ? usageBefore.rows : [],
        activeOrgs,
        allOrgs: new Set(companies.map((c) => c.orgId)),
      })
    : [];
  const chosen = selected ? rows.find((r) => r.code === selected) : undefined;
  const chosenInfo = chosen ? use.modules.find((m) => m.code === chosen.code) : undefined;
  const behind = chosenInfo && usageNow.ok ? moduleCompanies(chosenInfo, use.enabled, usageNow.rows, names) : [];
  const rangeLabel = RANGES[range].label;
  const mostUsed = rows.find((r) => r.usedBy > 0);
  const quiet = rows.filter((r) => r.idle !== null && r.switchedOn > 0 && r.idle === r.switchedOn);

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8 [--series:#008f8c] dark:[--series:#1a9e9a]">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-foreground">Product</h1>
          <p className="text-sm text-muted-foreground">
            Which parts of Tickd companies use, last {rangeLabel}. &ldquo;Used&rdquo; means the plain thing under each module
            happened in that time, not only that it&apos;s switched on.
          </p>
        </div>
        <div role="group" aria-label="Period" className="flex rounded-md border border-border bg-card p-0.5 text-sm">
          {(Object.keys(RANGES) as RangeKey[]).map((r) => (
            <Link
              key={r}
              href={`/platform/product?range=${r}${selected ? `&module=${selected}` : ""}`}
              aria-current={r === range ? "true" : undefined}
              className={`rounded px-2.5 py-1 ${r === range ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {RANGES[r].label}
            </Link>
          ))}
        </div>
      </header>

      {!usageNow.ok ? (
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground">{usageNow.message}</p>
      ) : (
        <>
          {(mostUsed || quiet.length > 0) && (
            <p className="rounded-lg border border-border bg-card p-4 text-sm text-foreground">
              {mostUsed && (
                <>
                  {mostUsed.name} is the most used: {count.format(mostUsed.usedBy)}{" "}
                  {mostUsed.usedBy === 1 ? "company" : "companies"} used it, {count.format(mostUsed.uses)} times.{" "}
                </>
              )}
              {quiet.length > 0 &&
                `Switched on but not used by anyone: ${quiet.map((q) => q.name).join(", ")}. Worth showing companies how.`}
            </p>
          )}

          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Module</th>
                  <th className="px-4 py-2 text-right font-medium">Switched on</th>
                  <th className="px-4 py-2 text-right font-medium">Used by</th>
                  <th className="px-4 py-2 font-medium">Active companies using it</th>
                  <th className="px-4 py-2 text-right font-medium">Times used</th>
                  <th className="px-4 py-2 text-right font-medium">On but not used</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.code} className={`border-b border-border last:border-0 ${r.code === selected ? "bg-muted/40" : ""}`}>
                    <td className="px-4 py-2">
                      <Link href={`/platform/product?range=${range}&module=${r.code}`} className="font-medium text-foreground hover:underline">
                        {r.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {r.usedWhen ? `Used when ${r.usedWhen}` : "Not measured: using it isn't recorded"}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{count.format(r.switchedOn)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {r.usedWhen === null ? <span className="text-muted-foreground">n/a</span> : count.format(r.usedBy)}
                      {formatChange(change(r.usedBy, r.usedByBefore)) && (
                        <span className="ml-1 text-xs text-muted-foreground">{formatChange(change(r.usedBy, r.usedByBefore))}</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {r.ofActive === null ? (
                        <span className="text-muted-foreground">{r.usedWhen === null ? "n/a" : "No active companies"}</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-28 rounded-full bg-muted" aria-hidden="true">
                            <div className="h-1.5 rounded-full bg-[var(--series)]" style={{ width: `${r.ofActive * 100}%` }} />
                          </div>
                          <span className="tabular-nums text-muted-foreground">{pct(r.ofActive)}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {r.usedWhen === null ? <span className="text-muted-foreground">n/a</span> : count.format(r.uses)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {r.idle === null ? <span className="text-muted-foreground">n/a</span> : r.idle ? count.format(r.idle) : <span className="text-muted-foreground">0</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Active companies: {count.format(activeOrgs.size)} (signed in or worked in the last 14 days). The small number next
            to &ldquo;Used by&rdquo; is the change against the {rangeLabel} before.
          </p>

          {chosen && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-foreground">
                {chosen.name}: the companies, last {rangeLabel}
              </h2>
              {behind.length === 0 ? (
                <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
                  No company has it on or used it in this period.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border bg-card">
                  <table className="w-full text-sm">
                    <thead className="border-b border-border text-left text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2 font-medium">Company</th>
                        <th className="px-4 py-2 font-medium">Switched on</th>
                        <th className="px-4 py-2 text-right font-medium">Times used</th>
                      </tr>
                    </thead>
                    <tbody>
                      {behind.map((b) => (
                        <tr key={b.orgId} className="border-b border-border last:border-0">
                          <td className="px-4 py-2">
                            <Link href={`/platform/companies/${b.orgId}`} className="font-medium text-foreground hover:underline">
                              {b.name}
                            </Link>
                          </td>
                          <td className="px-4 py-2">{b.switchedOn ? "Yes" : "No"}</td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {b.uses ? count.format(b.uses) : <span className="text-muted-foreground">Not used</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}
