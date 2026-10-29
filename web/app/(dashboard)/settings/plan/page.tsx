import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { salesContact } from "@/lib/platform";
import { paystackConfig } from "@/lib/billing/paystack";
import { parseAccount, parseCard, parsePlan, parseQuote, type Period } from "@/lib/billing";
import { BillingPanel, type InvoiceRow } from "@/components/billing/billing-panel";
import { SettingsPage } from "@/components/settings/settings-section";

/**
 * Settings > Plan (Stage 6; Paystack since 22 Oct 2026; was /billing): the
 * company's plan and what it includes, how many reps it has, the next
 * payment, the card on file, paying, and its invoices.
 *
 * Everything shown is read with the caller's own session: the account row
 * (less anything that charges the card, which no API caller can read), the
 * card's brand, last 4 and expiry (`billing_card`), the company's own charges
 * and invoices (company-settings managers only, by RLS). Behind
 * `company_settings` in the proxy's permission map.
 */

export const dynamic = "force-dynamic";
export const metadata = { title: "Plan" };

const CHECKOUT_NOTES = ["paid", "pending", "failed", "refused", "refunded", "cancelled", "unknown"] as const;
type CheckoutNote = (typeof CHECKOUT_NOTES)[number];

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: accountRaw }, { data: row }, { count: reps }, { data: cardRaw }, { data: invoices }, { data: charges }, contact] =
    await Promise.all([
      supabase.rpc("my_account"),
      supabase
        .from("company_account")
        .select("status, period, plan, plan_next, custom_price_cents, period_end, billing_email, setup_charged")
        .maybeSingle(),
      supabase.from("profiles").select("id", { count: "exact", head: true }).in("role", ["rep", "driver"]).eq("is_active", true),
      supabase.rpc("billing_card"),
      supabase
        .from("billing_invoices")
        .select("id, number, kind, issued_at, period_start, period_end, total_cents, paid_method")
        .order("issued_at", { ascending: false })
        .limit(50),
      supabase
        .from("billing_charges")
        .select("id, total_cents, attempts, next_retry_at, last_error, created_at")
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
  const activeReps = reps ?? 0;

  // What the next renewal will cost, from the same function every price comes
  // from: the plan for the reps the company will have then (never fewer than
  // it has now, as the renewal itself counts them).
  let nextCents: number | null = null;
  let nextLabel: string | null = null;
  if (period && (planNext ?? plan)) {
    const p = planNext ?? plan!;
    const { data } = await supabase.rpc("billing_quote", {
      p_period: period,
      p_seats: Math.max(p.seats, activeReps, 1),
      p_addons: p.addons,
    });
    if (data) {
      const q = parseQuote(data);
      nextCents = q.lines.filter((l) => !l.once).reduce((sum, l) => sum + l.amountCents, 0);
      nextLabel = q.lines.find((l) => l.code === "base" || l.code === "custom")?.label ?? null;
    }
  }

  const params = await searchParams;
  const checkout = typeof params.checkout === "string" && (CHECKOUT_NOTES as readonly string[]).includes(params.checkout)
    ? (params.checkout as CheckoutNote)
    : null;
  const unpaid = charges?.[0] ?? null;
  // Straight to the part that changes the plan from View plans; and to
  // choosing a plan when a payment for one did not go through, so trying
  // again is one step (a cancelled card update on a paid plan opens nothing).
  const openChooser = params.choose === "1"
    ? "plans"
    : checkout === "failed" || checkout === "cancelled" || checkout === "refused"
      ? "retry"
      : null;

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
    <SettingsPage title="Plan">
      <BillingPanel
        account={account}
        period={period}
        plan={plan}
        planNext={planNext}
        activeReps={activeReps}
        customPriceCents={row?.custom_price_cents ?? null}
        periodEnd={row?.period_end ?? null}
        nextCents={nextCents}
        nextLabel={nextLabel}
        card={parseCard(cardRaw)}
        invoices={invoiceRows}
        unpaid={
          unpaid
            ? { totalCents: unpaid.total_cents, lastError: unpaid.last_error, nextRetryAt: unpaid.next_retry_at }
            : null
        }
        cardsReady={paystackConfig() !== null}
        defaultEmail={row?.billing_email ?? user.email ?? ""}
        checkout={checkout}
        cardUpdated={params.card === "updated"}
        contact={contact}
        openChooser={openChooser}
      />
    </SettingsPage>
  );
}
