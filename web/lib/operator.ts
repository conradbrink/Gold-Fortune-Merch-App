import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * The operator gate for a page: a session (else sign in, and come back), then
 * `is_platform_admin()` (else a 404, so the page does not confirm it exists).
 * Same rule as /platform; see app/platform/page.tsx for why it is here and not
 * in proxy.ts.
 */
export async function requireOperator(returnTo: string): Promise<{ id: string }> {
  const { user, isOperator, error } = await operatorCheck();
  if (!user) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  if (error) throw error;
  if (!isOperator) notFound();
  return { id: user.id };
}

/**
 * Who is asking and whether they are an operator, asked once per request:
 * React's `cache` shares the answer between app/platform/layout.tsx (which
 * only decides whether to draw the nav) and the page's own gate.
 */
export const operatorCheck = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, isOperator: false, error: null };
  const { data, error } = await supabase.rpc("is_platform_admin");
  return { user, isOperator: data === true, error };
});
