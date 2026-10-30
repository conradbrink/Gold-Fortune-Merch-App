import { timingSafeEqual } from "node:crypto";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { supabaseFetch } from "@/lib/supabase/fetch";
import type { Database } from "@/lib/supabase/types";
import { sageConfig } from "@/lib/accounting/sage";
import { secretKey } from "@/lib/accounting/secret";
import { runAccountingSync } from "@/lib/accounting/sync";
import { supabaseSyncDb } from "@/lib/accounting/sync-db";

/**
 * Sends what is due in the accounting queue to Sage (lib/accounting/sync.ts).
 *
 * With no SAGE_API_KEY or ACCOUNTING_SECRET_KEY on the server nothing is
 * claimed: rows wait, queued, until both exist. Vercel Cron calls it every
 * five minutes with `Authorization: Bearer $CRON_SECRET`.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

function matches(given: string, want: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET is not configured on the server." }, { status: 503 });
  if (!matches(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return Response.json({ error: "Not authorised." }, { status: 401 });
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: "Supabase is not configured on the server." }, { status: 503 });
  }
  const config = sageConfig();
  const key = secretKey();
  if (!config || !key) {
    return Response.json({ error: "SAGE_API_KEY or ACCOUNTING_SECRET_KEY is not configured; nothing was sent." }, { status: 503 });
  }

  const admin = createAdminClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: supabaseFetch },
  });
  // Nothing new is started after 45 seconds: a Sage call may take 20 and the
  // function has 60. What is left waits for the next run.
  try {
    const result = await runAccountingSync({
      db: supabaseSyncDb(admin),
      config,
      secretKey: key,
      deadline: Date.now() + 45_000,
    });
    return Response.json(result);
  } catch (err) {
    console.error("accounting: run failed", err);
    return Response.json({ error: err instanceof Error ? err.message : "The run failed." }, { status: 500 });
  }
}
