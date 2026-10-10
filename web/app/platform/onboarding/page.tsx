import Link from "next/link";
import { requireOperator } from "@/lib/operator";
import { loadActivation } from "@/lib/activation-data";
import {
  attentionFor,
  daysToFirstJob,
  HABIT_DAYS,
  median,
  pipeline,
  plural,
  stageOf,
  STAGES,
  whatsappNumber,
  type StageKey,
} from "@/lib/activation";

/**
 * Onboarding (owner's spec sections 29 and 6): how far each company has got,
 * from New to using Tickd every workday, and who needs the operator now, with
 * the next thing to do and one click to reach them. The page opens on "Needs
 * attention" whenever anyone does. Why it's built this way: the step 3
 * worksheet (first value = the first job finished).
 */

export const dynamic = "force-dynamic";
export const metadata = { title: "Platform · Onboarding" };

// Days as the operator lives them: South African time (no daylight saving).
const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Johannesburg" });
const fmt = (iso: string | null) => (iso ? date.format(new Date(iso)) : null);

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireOperator("/platform/onboarding");
  const params = await searchParams;
  const result = await loadActivation();

  if (!result.ok) {
    return (
      <main className="mx-auto max-w-6xl space-y-4 p-4 sm:p-8">
        <h1 className="text-2xl font-bold text-foreground">Onboarding</h1>
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground">{result.message}</p>
      </main>
    );
  }

  const now = new Date();
  const rows = result.companies.map((c) => ({ c, stage: stageOf(c), attention: attentionFor(c, now), days: daysToFirstJob(c) }));
  const counts = pipeline(result.companies);
  const needing = rows.filter((r) => r.attention.length > 0);
  const stageParam = typeof params.stage === "string" && STAGES.some((s) => s.key === params.stage) ? (params.stage as StageKey) : null;
  // An explicit choice wins; with none, open on who needs attention (or everyone, when nobody does).
  const view =
    params.view === "all" || params.view === "attention"
      ? params.view
      : stageParam
        ? "stage"
        : needing.length > 0
          ? "attention"
          : "all";
  const shown = (
    view === "attention" ? needing : view === "stage" ? rows.filter((r) => STAGES[r.stage].key === stageParam) : rows
  ).sort(
    (a, b) =>
      (b.attention[0]?.urgency ?? 0) - (a.attention[0]?.urgency ?? 0) || Date.parse(b.c.createdAt) - Date.parse(a.c.createdAt)
  );
  const speeds = rows.map((r) => r.days).filter((d): d is number => d !== null);
  const typical = median(speeds);
  const activated = rows.filter((r) => r.c.firstJobFinishedAt).length;

  const tab = (href: string, label: string, on: boolean) => (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
        on ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-foreground">Onboarding</h1>
        <p className="text-sm text-muted-foreground">
          A company is activated when its team finishes its first job in Tickd: the first result the owner sees.{" "}
          {activated > 0
            ? `${plural(activated, "company has", "companies have")} got there${
                typical !== null ? `, typically ${plural(Math.round(typical), "day")} after being made` : ""
              }.`
            : "No company has got there yet."}
        </p>
      </header>

      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {STAGES.map((s, i) => (
          <li key={s.key}>
            <Link
              href={`/platform/onboarding?stage=${s.key}`}
              aria-current={stageParam === s.key ? "true" : undefined}
              className={`block h-full rounded-lg border bg-card p-3 hover:border-primary/40 ${
                stageParam === s.key ? "border-primary" : "border-border"
              }`}
            >
              <div className="text-xs text-muted-foreground">
                {i + 1}. {s.label}
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{counts[i]}</div>
            </Link>
          </li>
        ))}
      </ol>
      <p className="-mt-3 text-xs text-muted-foreground">
        Each company is counted at the furthest step it has reached. &ldquo;Using it every workday&rdquo; means jobs
        finished on {HABIT_DAYS} or more different days in the last 14. Dates are South African time.
      </p>

      <nav aria-label="Show" className="-mb-px flex gap-1 border-b border-border">
        {tab("/platform/onboarding?view=attention", `Needs attention (${needing.length})`, view === "attention")}
        {tab("/platform/onboarding?view=all", `All companies (${rows.length})`, view === "all")}
        {stageParam && tab(`/platform/onboarding?stage=${stageParam}`, STAGES.find((s) => s.key === stageParam)!.label, true)}
      </nav>

      {shown.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          {view === "attention" ? "Nobody needs attention right now." : "No companies here."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Company</th>
                <th className="px-4 py-2 font-medium">Got to</th>
                <th className="px-4 py-2 font-medium">First job finished</th>
                <th className="px-4 py-2 font-medium">Team</th>
                <th className="px-4 py-2 font-medium">Last activity</th>
                <th className="px-4 py-2 font-medium">Needs</th>
                <th className="px-4 py-2 font-medium">Contact</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ c, stage, attention, days }) => {
                const wa = whatsappNumber(c.contactPhone);
                return (
                  <tr key={c.orgId} className="border-b border-border align-top last:border-0">
                    <td className="px-4 py-3">
                      <Link href={`/platform/companies/${c.orgId}`} className="font-medium text-foreground hover:underline">
                        {c.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">Made {fmt(c.createdAt)}</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {stage + 1}. {STAGES[stage].label}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {c.firstJobFinishedAt ? (
                        <>
                          {fmt(c.firstJobFinishedAt)}
                          <div className="text-xs text-muted-foreground">
                            {days === 0 ? "the day it was made" : `${plural(days ?? 0, "day")} after being made`}
                          </div>
                        </>
                      ) : (
                        <span className="text-muted-foreground">Not yet</span>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{c.people}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{fmt(c.lastActivityAt) ?? <span className="text-muted-foreground">None</span>}</td>
                    <td className="px-4 py-3">
                      {attention.length === 0 ? (
                        <span className="text-muted-foreground">Nothing</span>
                      ) : (
                        <ul className="space-y-2">
                          {attention.map((a) => (
                            <li key={a.reason}>
                              <div className="font-medium text-foreground">{a.reason}</div>
                              <div className="text-xs text-muted-foreground">{a.action}</div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {c.contactName && <div className="whitespace-nowrap">{c.contactName}</div>}
                      <div className="flex flex-wrap gap-x-3 text-xs">
                        {wa && (
                          <a className="text-primary underline-offset-4 hover:underline" href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer">
                            WhatsApp
                          </a>
                        )}
                        {c.contactEmail && (
                          <a className="text-primary underline-offset-4 hover:underline" href={`mailto:${c.contactEmail}`}>
                            Email
                          </a>
                        )}
                        {!wa && !c.contactEmail && <span className="text-muted-foreground">No contact</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
