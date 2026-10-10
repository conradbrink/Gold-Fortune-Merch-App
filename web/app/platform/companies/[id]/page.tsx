import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { companyInternalSettings, companyTrialEnd, getCompany } from "@/lib/platform";
import { extendTrial, setCompanyModule, setCompanySetting } from "@/app/platform/actions";
import { trialState } from "@/lib/onboarding";

/**
 * Platform operator: one company's modules, switchable.
 *
 * Gated like `/platform`: a session is required by the proxy, and
 * `is_platform_admin()` is asked here before anything is read; everyone else
 * gets a 404. The switches post to `setCompanyModule`, which checks again —
 * this page hiding them is not what protects them.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Platform · Company modules" };

const dateTime = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

export default async function PlatformCompanyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: isOperator, error } = await supabase.rpc("is_platform_admin");
  if (error) throw error;
  if (!isOperator) notFound();

  const { id } = await params;
  // Not a company id at all: a 404, not a database cast error and a 500.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const [company, trialEndsAt, internal] = await Promise.all([
    getCompany(id),
    companyTrialEnd(id),
    companyInternalSettings(id),
  ]);
  if (!company) notFound();
  const trial = trialState(trialEndsAt);

  const raw = (await searchParams).error;
  const refusal = typeof raw === "string" ? raw : null;

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-8">
      <header className="space-y-1">
        <Link href="/platform" className="text-sm text-muted-foreground hover:underline">
          ← Companies
        </Link>
        <h1 className="text-2xl font-bold text-foreground">{company.name}</h1>
        {company.industries.length > 0 && (
          <p className="text-sm text-foreground">
            {company.industries
              .map((i) => (i.version === null ? i.name : `${i.name} (v${i.version})`))
              .join(" + ")}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          Modules switched here take effect on the company&apos;s next page load,
          and on phones at their next refresh. Every change is logged.
        </p>
      </header>

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
        <p className="text-sm text-foreground">
          {trial.kind === "none"
            ? "Not on a free trial."
            : trial.kind === "ended"
              ? `Free trial ended ${dateTime.format(new Date(trialEndsAt!))} UTC.`
              : `Free trial ends ${dateTime.format(new Date(trialEndsAt!))} UTC (${trial.daysLeft} ${trial.daysLeft === 1 ? "day" : "days"} left).`}
        </p>
        <form action={extendTrial} className="flex items-center gap-2">
          <input type="hidden" name="orgId" value={company.id} />
          <label className="text-sm text-muted-foreground" htmlFor="extend-days">
            {trial.kind === "none" ? "Start a trial of" : "Extend by"}
          </label>
          <input
            id="extend-days"
            name="days"
            type="number"
            min={1}
            max={365}
            required
            className="h-8 w-20 rounded-md border border-border bg-transparent px-2 text-sm"
          />
          <span className="text-sm text-muted-foreground">days</span>
          <button
            type="submit"
            className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-secondary"
          >
            Save
          </button>
        </form>
      </section>

      {refusal && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Not changed: {refusal}
        </p>
      )}

      <ul className="divide-y divide-border rounded-lg border border-border bg-card">
        {company.modules.map((m) => (
          <li key={m.code} className="flex items-start justify-between gap-4 p-4">
            <div className="space-y-1">
              <p className="font-medium text-foreground">
                {m.name}{" "}
                <span className="text-xs font-normal text-muted-foreground">({m.planType})</span>
              </p>
              <p className="text-sm text-muted-foreground">{m.description}</p>
              {m.requires.length > 0 && (
                <p className="text-xs text-muted-foreground">Needs: {m.requires.join(", ")}</p>
              )}
            </div>
            <div className="shrink-0">
              {m.planType === "core" ? (
                <span className="text-sm text-muted-foreground">Always on</span>
              ) : !m.isBuilt ? (
                <span className="text-sm text-muted-foreground">Not built yet</span>
              ) : (
                <form action={setCompanyModule}>
                  <input type="hidden" name="orgId" value={company.id} />
                  <input type="hidden" name="module" value={m.code} />
                  <input type="hidden" name="enabled" value={m.enabled ? "false" : "true"} />
                  <button
                    type="submit"
                    className={
                      m.enabled
                        ? "inline-flex h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-secondary"
                        : "inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm text-primary-foreground hover:bg-primary/90"
                    }
                  >
                    {m.enabled ? "On · switch off" : "Off · switch on"}
                  </button>
                </form>
              )}
            </div>
          </li>
        ))}
      </ul>

      {/* Tickd's own settings for this company: how tracking and the reports
          work. The company never sees these (its Company settings show only
          business decisions) and the database refuses its writes to them;
          `setCompanySetting` checks the operator again and logs the change. */}
      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-foreground">Tickd settings</h2>
          <p className="text-sm text-muted-foreground">
            How Tickd works for this company. Leave the defaults unless there is a reason; the company cannot see or
            change these.
          </p>
        </div>
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {internal.map((s) => {
            const current = s.value ?? s.defaultValue;
            const shown = typeof current === "string" ? current : JSON.stringify(current);
            return (
              <li key={s.key} className="flex flex-wrap items-start justify-between gap-4 p-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-medium text-foreground">
                    {s.label}{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      ({s.value === null ? "default" : "set for this company"})
                    </span>
                  </p>
                  <p className="text-sm text-muted-foreground">{s.description}</p>
                </div>
                <form action={setCompanySetting} className="flex items-center gap-2">
                  <input type="hidden" name="orgId" value={company.id} />
                  <input type="hidden" name="key" value={s.key} />
                  <input
                    name="value"
                    aria-label={s.label}
                    defaultValue={shown}
                    required
                    className="h-8 w-56 rounded-md border border-border bg-transparent px-2 text-sm"
                  />
                  <button
                    type="submit"
                    className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-secondary"
                  >
                    Save
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      </section>

      {company.recentChanges.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">Recent changes (UTC)</h2>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {company.recentChanges.map((c, i) => (
              <li key={i}>
                {dateTime.format(new Date(c.createdAt))} · {c.action} ·{" "}
                {JSON.stringify(c.detail)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
