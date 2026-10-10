import "server-only";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * The operator gate for a page: a session (else sign in, and come back), then
 * `is_platform_admin()` (else a 404, so the page does not confirm it exists).
 * Same rule as /platform; see app/platform/page.tsx for why it is here and not
 * in proxy.ts.
 */
export async function requireOperator(returnTo: string): Promise<{ id: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  const { data: isOperator, error } = await supabase.rpc("is_platform_admin");
  if (error) throw error;
  if (!isOperator) notFound();
  return { id: user.id };
}
