import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { companyBilling, getCompany } from "@/lib/platform";
import {
  cancelCharge,
  extendTrial,
  issueCreditNote,
  markChargePaid,
  setCompanyModule,
  setCustomPrice,
  setExempt,
} from "@/app/platform/actions";
import { trialState } from "@/lib/onboarding";
import { STATUS_LABEL, formatRand, parsePlan, parseStatus } from "@/lib/billing";

/**
 * Platform operator: one company's billing (Stage 6) and modules.
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
  const [company, billing] = await Promise.all([getCompany(id), companyBilling(id)]);
  if (!company) notFound();
  const trialEndsAt = billing?.trialEndsAt ?? null;
  const trial = trialState(billing?.status === "trial" || billing?.status === "read_only" ? trialEndsAt : null);
  const status = billing ? parseStatus(billing.status) : null;
  const plan = parsePlan(billing?.plan);
  const input = "h-8 rounded-md border border-border bg-transparent px-2 text-sm";
  const button = "inline-flex h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-secondary";

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

      <section className="space-y-4 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Billing</h2>
          <p className="text-sm text-foreground">
            {status ? STATUS_LABEL[status] : "No account row: billed outside the app"}
            {billing?.hasCard ? " · card on file" : ""}
            {billing?.billingEmail ? ` · receipts to ${billing.billingEmail}` : ""}
          </p>
        </div>

        {plan && billing?.period && (
          <p className="text-sm text-muted-foreground">
            {plan.seats} users, {billing.period}
            {Object.keys(plan.addons).length > 0 ? `, add-ons ${Object.entries(plan.addons).map(([k, q]) => `${k}×${q}`).join(", ")}` : ""}
            {billing.periodEnd ? ` · paid to ${dateTime.format(new Date(billing.periodEnd))} UTC` : ""}
            {billing.cancelAtPeriodEnd ? " · cancels at period end" : ""}
            {billing.graceEndsAt ? ` · grace ends ${dateTime.format(new Date(billing.graceEndsAt))} UTC` : ""}
          </p>
        )}
        {billing?.readOnlySince && (status === "read_only" || status === "cancelled") && (
          <p className="text-sm text-destructive">Read-only since {dateTime.format(new Date(billing.readOnlySince))} UTC.</p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-foreground">
            {trial.kind === "none"
              ? "Not on a free trial."
              : trial.kind === "ended"
                ? `Free trial ended ${dateTime.format(new Date(trialEndsAt!))} UTC.`
                : `Free trial ends ${dateTime.format(new Date(trialEndsAt!))} UTC (${trial.daysLeft} ${trial.daysLeft === 1 ? "day" : "days"} left).`}
          </p>
          {status !== "exempt" && status !== "active" && status !== "past_due" && (
            <form action={extendTrial} className="flex items-center gap-2">
              <input type="hidden" name="orgId" value={company.id} />
              <label className="text-sm text-muted-foreground" htmlFor="extend-days">
                {trial.kind === "none" ? "Start a trial of" : "Extend by"}
              </label>
              <input id="extend-days" name="days" type="number" min={1} max={365} required className={`${input} w-20`} />
              <span className="text-sm text-muted-foreground">days</span>
              <button type="submit" className={button}>Save</button>
            </form>
          )}
        </div>

        <div className="flex flex-wrap gap-6">
          <form action={setCustomPrice} className="flex items-center gap-2">
            <input type="hidden" name="orgId" value={company.id} />
            <label className="text-sm text-muted-foreground" htmlFor="custom-price">Custom price per period (R)</label>
            <input
              id="custom-price"
              name="rands"
              defaultValue={billing?.customPriceCents != null ? String(billing.customPriceCents / 100) : ""}
              placeholder="price list"
              className={`${input} w-28`}
            />
            <button type="submit" className={button}>Save</button>
          </form>

          {status === "exempt" ? (
            <form action={setExempt} className="flex items-center gap-2">
              <input type="hidden" name="orgId" value={company.id} />
              <input type="hidden" name="exempt" value="false" />
              <label className="text-sm text-muted-foreground" htmlFor="unexempt-days">Not exempt: trial of</label>
              <input id="unexempt-days" name="days" type="number" min={1} max={365} required className={`${input} w-20`} />
              <span className="text-sm text-muted-foreground">days</span>
              <button type="submit" className={button}>Save</button>
            </form>
          ) : (
            <form action={setExempt}>
              <input type="hidden" name="orgId" value={company.id} />
              <input type="hidden" name="exempt" value="true" />
              <button type="submit" className={button}>Make exempt (billed outside the app)</button>
            </form>
          )}
        </div>

        {billing && billing.charges.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Charges</h3>
            <ul className="divide-y divide-border text-sm">
              {billing.charges.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {dateTime.format(new Date(c.createdAt))} · {c.reason} · {formatRand(c.totalCents)} · {c.status}
                    {c.attempts > 0 ? ` · ${c.attempts} attempt${c.attempts === 1 ? "" : "s"}` : ""}
                    {c.lastError ? ` · ${c.lastError}` : ""}
                  </span>
                  {(c.status === "pending" || c.status === "failed") && (
                    <span className="flex flex-wrap items-center gap-2">
                      <form action={markChargePaid} className="flex items-center gap-2">
                        <input type="hidden" name="orgId" value={company.id} />
                        <input type="hidden" name="chargeId" value={c.id} />
                        <input name="reference" required placeholder="EFT reference" className={`${input} w-36`} />
                        <button type="submit" className={button}>Mark paid</button>
                      </form>
                      <form action={cancelCharge}>
                        <input type="hidden" name="orgId" value={company.id} />
                        <input type="hidden" name="chargeId" value={c.id} />
                        <button type="submit" className={button}>Stop collecting</button>
                      </form>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {billing && billing.invoices.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Invoices</h3>
            <ul className="divide-y divide-border text-sm">
              {billing.invoices.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {i.number} · {dateTime.format(new Date(i.issuedAt))} · {formatRand(i.totalCents)}
                    {i.kind === "credit_note" ? " · credit note" : i.paidMethod ? ` · ${i.paidMethod}` : ""}
                  </span>
                  {i.kind === "invoice" && (
                    <form action={issueCreditNote} className="flex items-center gap-2">
                      <input type="hidden" name="orgId" value={company.id} />
                      <input type="hidden" name="invoiceId" value={i.id} />
                      <input name="rands" required placeholder="R" className={`${input} w-24`} />
                      <input name="reason" required placeholder="Reason" className={`${input} w-40`} />
                      <button type="submit" className={button}>Credit</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
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
