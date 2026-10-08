import { createClient } from "@/lib/supabase/server";
import { SetupShell } from "@/components/setup/setup-shell";
import { brandStyleSheet, parseBranding } from "@/lib/branding";

/**
 * The set-up wizard's frame: the company's configuration fetched once on the
 * server, as the dashboard does, but no sidebar. The wizard is one thing to
 * do, so nothing else is offered next to it.
 */
export default async function SetupLayout({
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
      <SetupShell initialConfig={config}>{children}</SetupShell>
    </>
  );
}
