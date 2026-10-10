import { createClient } from "@/lib/supabase/server";
import { PlatformNav } from "@/components/platform/platform-nav";

/**
 * The operator area's frame: the navigation row, shown only to an operator.
 * Each page still makes its own `is_platform_admin()` check and answers
 * everyone else with a 404; this layout only decides whether to draw the nav,
 * so a non-operator never learns what the area contains.
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: isOperator } = user ? await supabase.rpc("is_platform_admin") : { data: false };
  if (!isOperator) return children;
  return (
    <>
      <PlatformNav />
      {children}
    </>
  );
}
