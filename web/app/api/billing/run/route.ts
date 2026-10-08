import { timingSafeEqual } from "node:crypto";
import { platformAdminClient } from "@/lib/platform";
import { chargeSaved } from "@/lib/billing/server";

/**
 * The daily billing run (Stage 6).
 *
 * `billing_prepare_due` does everything that is only a date comparison, in one
 * transaction: a trial that ended unpaid and a grace period that ran out make
 * the company read-only; a plan cancelled at the end of its period ends; each
 * plan whose period has ended gets one renewal charge. It returns the charges
 * due now (new renewals, and retries on their retry days) for companies with a
 * saved card, and this route puts each one to the card and records the answer.
 * Running twice in a day charges nothing twice: a renewal is unique per company
 * and period, and a failed one waits for its next retry day.
 *
 * `web/vercel.json` runs it at `0 6 * * *` UTC (08:00 in South Africa). Same
 * auth as the other crons: `Authorization: Bearer $CRON_SECRET`, refused when
 * it is not set — this charges cards.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

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
  };
  const outcomes: Record<string, number> = {};
  for (const c of due.charge ?? []) {
    // One at a time: a handful a day, and Payfast is happier unhurried.
    const outcome = await chargeSaved(admin, c.charge_id);
    outcomes[outcome.kind] = (outcomes[outcome.kind] ?? 0) + 1;
    if (outcome.kind === "error") console.error(`[billing] charge ${c.charge_id}: ${outcome.message}`);
  }

  const summary = {
    trials_ended: due.trials_ended ?? 0,
    grace_ended: due.grace_ended ?? 0,
    cancelled: due.cancelled ?? 0,
    renewals_written: due.renewals_written ?? 0,
    charged: outcomes,
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
