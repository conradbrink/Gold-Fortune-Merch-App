import Link from "next/link";
import { RANGES, type RangeKey } from "@/lib/acquisition";

/**
 * The Acquisition area's header: its tabs and the period. Both are links, so
 * each view is an address that can be bookmarked; the tabs keep the period and
 * the period keeps the tab (and any filters the page passes in `keep`).
 */

const TABS = [
  { href: "/platform/acquisition", label: "Overview" },
  { href: "/platform/acquisition/website", label: "Website" },
  { href: "/platform/acquisition/funnel", label: "Funnel" },
  { href: "/platform/acquisition/sources", label: "Sources" },
  { href: "/platform/acquisition/campaigns", label: "Campaigns" },
];

export type GaStatus = { ok: true } | { ok: false; reason: "not-connected" | "error"; message?: string };

export function AcquisitionFrame({
  tab,
  range,
  ga,
  keep = {},
  children,
}: {
  tab: string;
  range: RangeKey;
  ga: GaStatus;
  keep?: Record<string, string>;
  children: React.ReactNode;
}) {
  const query = (extra: Record<string, string>) => {
    const q = new URLSearchParams({ ...keep, ...extra });
    for (const [k, v] of [...q.entries()]) if (!v) q.delete(k);
    return `?${q.toString()}`;
  };
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
      <header className="space-y-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-foreground">Acquisition</h1>
          <p className="text-sm text-muted-foreground">
            How people find Tickd, and how many become customers. Website numbers come from Google Analytics and count
            devices; from the Founding application on, they are Tickd&apos;s own records.
          </p>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border">
          <nav aria-label="Acquisition" className="-mb-px flex gap-1 overflow-x-auto">
            {TABS.map((t) => {
              const on = t.href === tab;
              return (
                <Link
                  key={t.href}
                  href={`${t.href}${query({ range })}`}
                  aria-current={on ? "page" : undefined}
                  className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
                    on ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t.label}
                </Link>
              );
            })}
          </nav>
          <div role="group" aria-label="Period" className="mb-2 flex rounded-md border border-border bg-card p-0.5 text-sm">
            {(Object.keys(RANGES) as RangeKey[]).map((r) => (
              <Link
                key={r}
                href={`${tab}${query({ range: r })}`}
                aria-current={r === range ? "true" : undefined}
                className={`rounded px-2.5 py-1 ${
                  r === range ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {RANGES[r].label}
              </Link>
            ))}
          </div>
        </div>
      </header>

      {!ga.ok && (
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground">
          {ga.reason === "not-connected"
            ? `Google Analytics isn't connected yet, so the website numbers are missing. Tickd's own records (applications and companies) are below. ${ga.message ?? "To connect it, add GA4_CLIENT_EMAIL and GA4_PRIVATE_KEY in Vercel."}`
            : `Google Analytics didn't answer: ${ga.message ?? "unknown error"}. Tickd's own records are below.`}
        </p>
      )}

      {children}
    </main>
  );
}

/** One number with its change against the previous period, or a reason it is missing. */
export function Stat({
  label,
  value,
  change,
  missing,
  href,
}: {
  label: string;
  value: string | null;
  change?: string | null;
  missing?: string;
  href?: string;
}) {
  const body = (
    <>
      <div className="text-sm text-muted-foreground">{label}</div>
      {value === null ? (
        <div className="mt-1 text-sm text-muted-foreground">{missing ?? "Not available"}</div>
      ) : (
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums text-foreground">{value}</span>
          {change && <span className="text-sm tabular-nums text-muted-foreground">{change}</span>}
        </div>
      )}
    </>
  );
  return href && value !== null ? (
    <Link href={href} className="block rounded-lg border border-border bg-card p-4 hover:border-primary/40">
      {body}
    </Link>
  ) : (
    <div className="rounded-lg border border-border bg-card p-4">{body}</div>
  );
}

export const count = new Intl.NumberFormat("en-ZA");

/** Why a website number is missing, in a few words: never "not connected" when it is connected but failed. */
export function gaMissing(r: { ok: boolean; reason?: "not-connected" | "error" }): string {
  if (r.ok) return "No answer from Google Analytics.";
  return r.reason === "not-connected" ? "Google Analytics isn't connected yet." : "Google Analytics didn't answer (see above).";
}

/**
 * Who is on the website in the last 30 minutes (Google's realtime view). The
 * quickest proof that tracking works: open tickd.co.za and reload this page.
 */
export function RightNow({
  now,
}: {
  now: { ok: true; value: { total: number; pages: { title: string; visitors: number }[] } } | { ok: false };
}) {
  if (!now.ok) return null;
  const { total, pages } = now.value;
  return (
    <div className="rounded-lg border border-border bg-card p-4 text-sm">
      <div className="text-foreground">
        <span className="font-semibold tabular-nums">{count.format(total)}</span>{" "}
        {total === 1 ? "person is" : "people are"} on the website right now
        <span className="text-muted-foreground"> (last 30 minutes, live from Google)</span>
        {pages.length > 0 && <span className="text-muted-foreground">: </span>}
        {pages.map((p, i) => (
          <span key={p.title} className="text-muted-foreground">
            {i > 0 && ", "}
            {p.title} ({p.visitors})
          </span>
        ))}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        The numbers below come from Google&apos;s processed reports, which can take a few hours to catch up.
      </div>
    </div>
  );
}
