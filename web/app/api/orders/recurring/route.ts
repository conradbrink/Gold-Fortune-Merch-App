import { timingSafeEqual } from "node:crypto";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * Places every recurring order that has fallen due.
 *
 * The rule lives in the database (`recurring_orders_run_due`): each due
 * recurring order is placed once, as a new order, on its organisation's own
 * today, and a recurring order that missed several dates is placed once rather
 * than once per date. `recurring_order_runs` is unique per recurring order and
 * day, so this route running twice in a morning places nothing twice.
 *
 * `web/vercel.json` runs it at `0 4 * * *` — 06:00 in Botswana (UTC+2), and
 * the Hobby plan may fire it any time up to 06:59 — so the morning's standing
 * orders are waiting before the warehouse starts. Same auth as the auto-end
 * job: `Authorization: Bearer $CRON_SECRET`, refused when it is not set.
 */

export const runtime = "nodejs";

function adminClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

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

  const { data, error } = await adminClient().rpc("recurring_orders_run_due");
  if (error) {
    console.error(`[recurring] morning run failed: ${error.message}`);
    return Response.json({ error: error.message }, { status: 500 });
  }
  const placed = data ?? [];
  console.info(`[recurring] placed ${placed.length} order${placed.length === 1 ? "" : "s"}`);
  return Response.json({ placed: placed.length, orders: placed });
}

function matches(offered: string, expected: string): boolean {
  const a = Buffer.from(offered, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
