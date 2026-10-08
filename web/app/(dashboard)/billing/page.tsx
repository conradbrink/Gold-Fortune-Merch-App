import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { platformAdminClient, salesContact } from "@/lib/platform";
import { cardUpdateUrl, payfastConfig } from "@/lib/billing/payfast";
import { originFrom } from "@/lib/billing/server";
import { parseAccount, parsePlan, parseQuote, type Period } from "@/lib/billing";
import { BillingPanel, type AddonChoice, type InvoiceRow } from "@/components/billing/billing-panel";

/**
 * Billing (Stage 6): the company's plan, paying for it, changing it, and its
 * invoices. Replaces the Stage 5 "Plans" page (`/plans` redirects here).
 *
 * Everything shown is read with the caller's own session — the account row
 * (less the card token, which no API caller can read), the price list, the
 * company's own charges and invoices (company-settings managers only, by RLS).
 * The one exception is the card-update link, which carries the token: it is
 * built on the server for a caller already allowed here (proxy permission map:
 * `company_settings`), and the token alone cannot charge anything.
 */

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing" };

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: accountRaw }, { data: row }, { data: prices }, { data: modules }, { data: invoices }, { data: charges }, contact] =
    await Promise.all([
      supabase.rpc("my_account"),
      supabase
        .from("company_account")
        .select("org_id, status, period, plan, plan_next, custom_price_cents, period_start, period_end, setup_charged, billing_email, cancel_at_period_end")
        .maybeSingle(),
      supabase.from("price_list").select("code, kind, period, unit, tier_min, tier_max, amount_cents, included_users, label, active_from, active_to"),
      supabase.from("modules").select("code, name, plan_type, is_built"),
      supabase
        .from("billing_invoices")
        .select("id, number, kind, issued_at, period_start, period_end, total_cents, paid_method")
        .order("issued_at", { ascending: false })
        .limit(50),
      supabase
        .from("billing_charges")
        .select("id, reason, status, total_cents, attempts, next_retry_at, last_error, created_at")
        .in("status", ["pending", "failed"])
        .eq("reason", "renewal")
        .order("created_at", { ascending: false })
        .limit(1),
      salesContact(),
    ]);

  const account = parseAccount(accountRaw);
  const plan = parsePlan(row?.plan);
  const planNext = parsePlan(row?.plan_next);
  const period: Period | null = row?.period === "yearly" ? "yearly" : row?.period === "monthly" ? "monthly" : null;

  // What the next renewal will cost, from the same function every price comes from.
  let nextCents: number | null = null;
  if (period && (planNext ?? plan)) {
    const p = planNext ?? plan!;
    const { data } = await supabase.rpc("billing_quote", { p_period: period, p_seats: p.seats, p_addons: p.addons });
    if (data) nextCents = parseQuote(data).totalCents;
  }

  // Add-ons a company can buy: built add-on modules with a price today.
  const today = new Date().toISOString().slice(0, 10);
  const live = (prices ?? []).filter((p) => p.active_from <= today && (!p.active_to || p.active_to > today));
  const addons: AddonChoice[] = (modules ?? [])
    .filter((m) => m.plan_type === "addon" && m.is_built)
    .map((m) => {
      const rows = live.filter((p) => p.kind === "addon" && p.code === m.code);
      if (rows.length === 0) return null;
      return {
        code: m.code,
        name: m.name,
        perUnit: rows[0].unit === "quantity",
        prices: rows
          .filter((p) => p.period === "monthly")
          .sort((a, b) => (a.tier_min ?? 0) - (b.tier_min ?? 0))
          // "HR, up to 5 employees" is listed under "HR": drop the repeat.
          .map((p) => ({ label: p.label.startsWith(`${m.name}, `) ? p.label.slice(m.name.length + 2) : p.label, cents: p.amount_cents })),
      };
    })
    .filter((a): a is AddonChoice => a !== null);
  const base = live.find((p) => p.kind === "base" && p.period === "monthly");

  // The card-update link carries the token, so it is made here, for this caller only.
  let updateCardUrl: string | null = null;
  const config = payfastConfig();
  if (config && account.canManage && row?.org_id && ["active", "past_due", "read_only", "cancelled"].includes(account.status)) {
    const { data: tokenRow } = await platformAdminClient()
      .from("company_account")
      .select("provider_token")
      .eq("org_id", row.org_id)
      .maybeSingle();
    if (tokenRow?.provider_token) {
      updateCardUrl = cardUpdateUrl(config, tokenRow.provider_token, `${originFrom(await headers())}/billing?card=updated`);
    }
  }

  const params = await searchParams;
  const checkout = typeof params.checkout === "string" ? params.checkout : null;
  const unpaid = charges?.[0] ?? null;

  const invoiceRows: InvoiceRow[] = (invoices ?? []).map((i) => ({
    id: i.id,
    number: i.number,
    kind: i.kind === "credit_note" ? "credit_note" : "invoice",
    issuedAt: i.issued_at,
    periodStart: i.period_start,
    periodEnd: i.period_end,
    totalCents: i.total_cents,
    paidMethod: i.paid_method,
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold tracking-tight text-foreground">Billing</h1>
      <BillingPanel
        account={account}
        period={period}
        plan={plan}
        planNext={planNext}
        customPriceCents={row?.custom_price_cents ?? null}
        periodEnd={row?.period_end ?? null}
        nextCents={nextCents}
        includedUsers={base?.included_users ?? 0}
        addons={addons}
        invoices={invoiceRows}
        unpaid={
          unpaid
            ? { totalCents: unpaid.total_cents, lastError: unpaid.last_error, nextRetryAt: unpaid.next_retry_at }
            : null
        }
        payfastReady={config !== null}
        updateCardUrl={updateCardUrl}
        defaultEmail={row?.billing_email ?? user.email ?? ""}
        checkout={checkout === "done" || checkout === "cancelled" ? checkout : null}
        cardUpdated={params.card === "updated"}
        contact={contact}
      />
    </div>
  );
}
