import { operatorCheck } from "@/lib/operator";
import { PlatformNav } from "@/components/platform/platform-nav";

/**
 * The operator area's frame: the navigation row, shown only to an operator.
 * Each page still makes its own `is_platform_admin()` check and answers
 * everyone else with a 404; this layout only decides whether to draw the nav,
 * so a non-operator never learns what the area contains.
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const { isOperator } = await operatorCheck();
  if (!isOperator) return children;
  return (
    <>
      <PlatformNav />
      {children}
    </>
  );
}
