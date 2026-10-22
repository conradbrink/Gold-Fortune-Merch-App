import { timingSafeEqual } from "node:crypto";
import { platformAdminClient } from "@/lib/platform";
import { paystackConfig } from "@/lib/billing/paystack";
import { chargeSaved } from "@/lib/billing/server";

/**
 * The daily billing run (Stage 6; Paystack since 22 Oct 2026).
 *
 * `billing_prepare_due` does everything that is only a date comparison, in one
 * transaction: a grace period that ran out makes the company read-only (an
 * ended pilot too, only if `trial_end_read_only` is on); a plan cancelled at
 * the end of its period ends; each plan whose period has ended gets one
 * renewal charge, for the reps it has now. It returns the charges due now (new
 * renewals, and retries on days 3 and 7) for companies with a saved card, and
 * this route puts each one to the card on Paystack (`charge_authorization`,
 * queued) and records the answer. A failed renewal emails the company a link
 * to pay. Running twice in a day charges nothing twice: a renewal is unique
 * per company and period, a failed one waits for its next retry day, and a
 * queued one is looked up before it is tried again.
 *
 * `web/vercel.json` runs it at `0 6 * * *` UTC (08:00 in South Africa). Same
 * auth as the other crons: `Authorization: Bearer $CRON_SECRET`, refused when
 * it is not set — this charges cards.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Stop starting new charges after this long. One charge can take up to two
 * 20-second Paystack calls, so this leaves room inside maxDuration; a run cut
 * short loses nothing (the next looks up each try before charging again).
 */
const BUDGET_MS = 15_000;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ error: "CRON_SECRET is not configured on the server." }, { status: 503 });
  }
  if (!matches(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return Response.json({ error: "Not authorised." }, { status: 401 });
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: "Supabase is not configured on the server." }, { status: 503 });
  }

  const config = paystackConfig();
  const admin = platformAdminClient();
  const { data, error } = await admin.rpc("billing_prepare_due", {});
  if (error) {
    console.error(`[billing] daily run failed: ${error.message}`);
    return Response.json({ error: error.message }, { status: 500 });
  }

  const due = (data ?? {}) as {
    trials_ended?: number;
    grace_ended?: number;
    cancelled?: number;
    renewals_written?: number;
    charge?: { charge_id: string }[];
    errors?: { org_id: string; error: string }[];
  };
  for (const e of due.errors ?? []) console.error(`[billing] renewal not written for ${e.org_id}: ${e.error}`);

  // One at a time, within a time budget: a handful a day, and Paystack is
  // happier unhurried. What is left over is still due tomorrow, and a charge
  // that throws is logged without stopping the others.
  const started = Date.now();
  const outcomes: Record<string, number> = {};
  let leftOver = 0;
  for (const c of config ? (due.charge ?? []) : []) {
    if (Date.now() - started > BUDGET_MS) {
      leftOver++;
      continue;
    }
    try {
      const outcome = await chargeSaved(admin, config!, c.charge_id);
      outcomes[outcome.kind] = (outcomes[outcome.kind] ?? 0) + 1;
      if (outcome.kind === "error") console.error(`[billing] charge ${c.charge_id}: ${outcome.message}`);
    } catch (e) {
      outcomes.error = (outcomes.error ?? 0) + 1;
      console.error(`[billing] charge ${c.charge_id} threw: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const summary = {
    trials_ended: due.trials_ended ?? 0,
    grace_ended: due.grace_ended ?? 0,
    cancelled: due.cancelled ?? 0,
    renewals_written: due.renewals_written ?? 0,
    renewal_errors: (due.errors ?? []).length,
    charged: outcomes,
    ...(leftOver ? { left_for_tomorrow: leftOver } : {}),
    ...(config ? {} : { not_charged: "PAYSTACK_SECRET_KEY is not set, or does not suit this database", due: (due.charge ?? []).length }),
  };
  // Logged as well as returned: nobody reads a cron's response body.
  console.info(`[billing] daily run: ${JSON.stringify(summary)}`);
  return Response.json(summary);
}

/** Constant-time compare — see /api/workday/road-distance for why. */
function matches(offered: string, expected: string): boolean {
  const a = Buffer.from(offered, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
