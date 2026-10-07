import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { brandStyleSheet, parseBranding } from "@/lib/branding";

/**
 * Fetches the company's configuration once, on the server, so its colours are
 * in the first paint (the style sheet below) and its words and name are in the
 * client cache before the shell renders. A failed lookup is not fatal: the
 * page renders with the product's own colours and the client fetches again.
 */
export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let config: unknown = null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("my_company_config");
    if (!error) config = data;
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
      <DashboardShell initialConfig={config}>{children}</DashboardShell>
    </>
  );
}
