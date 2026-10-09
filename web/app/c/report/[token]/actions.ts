"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { verifyLink } from "@/lib/email/links";

/**
 * The client signs a job's report (Stage 8.3). The link's signature is checked
 * again here (the page could have been open for a while), then the database
 * keeps the name, the strokes, the time and the device, once only.
 */
export async function signReport(
  token: string,
  name: string,
  strokes: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = verifyLink("report", token);
  if (!id) return { ok: false, error: "This link does not work any more. Ask for a new one." };
  if (!name.trim()) return { ok: false, error: "Type your name to sign." };
  if (!/^[ML0-9 .,-]{5,100000}$/.test(strokes)) return { ok: false, error: "Sign in the box first." };
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  const admin = createAdminClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await admin.rpc("job_report_sign", {
    p_report_id: id,
    p_name: name.trim().slice(0, 120),
    p_signature_path: strokes,
    p_ip: ip,
    p_user_agent: h.get("user-agent"),
  });
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "This report was already signed, or its link has expired." };
  revalidatePath(`/c/report/${token}`);
  return { ok: true };
}
