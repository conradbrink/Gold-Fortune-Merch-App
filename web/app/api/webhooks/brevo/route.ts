import { timingSafeEqual } from "node:crypto";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * Delivery news from Brevo (Stage 8.1): a hard bounce, a spam complaint, a
 * block or an unsubscribe stops further mail to that address
 * (`record_message_event`). Brevo does not sign its webhooks, so the URL set
 * in Brevo carries a token: /api/webhooks/brevo?token=$BREVO_WEBHOOK_TOKEN.
 */

export const runtime = "nodejs";

const EVENTS = new Set(["hard_bounce", "spam", "complaint", "blocked", "unsubscribed"]);

function matches(given: string, want: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const token = process.env.BREVO_WEBHOOK_TOKEN;
  if (!token) return Response.json({ error: "BREVO_WEBHOOK_TOKEN is not configured." }, { status: 503 });
  if (!matches(new URL(request.url).searchParams.get("token") ?? "", token)) {
    return Response.json({ error: "Not authorised." }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | Record<string, unknown>[] | null;
  const events = Array.isArray(body) ? body : body ? [body] : [];
  const admin = createAdminClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let recorded = 0;
  for (const e of events) {
    const event = String(e.event ?? "");
    const id = String(e["message-id"] ?? e.messageId ?? "");
    if (!EVENTS.has(event) || !id) continue;
    const { error } = await admin.rpc("record_message_event", { p_provider_id: id, p_event: event });
    if (!error) recorded++;
  }
  return Response.json({ recorded });
}
