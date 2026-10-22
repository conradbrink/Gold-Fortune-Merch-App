import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { brandStyleSheet, parseBranding } from "@/lib/branding";
import { parseAccount, type Account } from "@/lib/billing";
import { AccountNotice } from "@/components/billing/account-notice";

/**
 * Fetches the company's configuration once, on the server, so its colours are
 * in the first paint (the style sheet below) and its words and name are in the
 * client cache before the shell renders. A failed lookup is not fatal: the
 * page renders with the product's own colours and the client fetches again.
 *
 * The account's state (Stage 6) comes with it, for the read-only and
 * failed-payment line every user sees; a failed lookup shows no line.
 */
export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let config: unknown = null;
  let account: Account | null = null;
  try {
    const supabase = await createClient();
    const [{ data, error }, state] = await Promise.all([
      supabase.rpc("my_company_config"),
      supabase.rpc("my_account"),
    ]);
    if (!error) config = data;
    if (!state.error) account = parseAccount(state.data);
  } catch {
    config = null;
  }
  const branding =
    config !== null && typeof config === "object"
      ? parseBranding((config as Record<string, unknown>).branding)
      : null;

  return (
    <>
      {branding && (
        <style
          // Built only from validated #RRGGBB values (lib/branding.ts).
          dangerouslySetInnerHTML={{ __html: brandStyleSheet(branding) }}
        />
      )}
      <DashboardShell initialConfig={config}>
        {account && <AccountNotice account={account} />}
        {children}
      </DashboardShell>
    </>
  );
}
