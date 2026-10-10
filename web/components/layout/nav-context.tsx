"use client";

import { createContext, useContext, useMemo } from "react";
import { usePermissions } from "@/lib/use-permissions";
import { useCompanyConfig } from "@/lib/use-company-config";
import { visibleNavGroups, type NavGroup } from "@/components/layout/nav-items";

/**
 * The menu as this person sees it, worked out once for the whole shell.
 *
 * The sidebar, the tab row at the top of a page and the phone's bottom bar all
 * read the same groups, so they cannot disagree about what exists. One
 * provider also means one `my_permissions` call, not one per component.
 *
 * Null until both the permissions and the company's configuration are known:
 * see `usePermissions` for why this does not fall back to the manager menu.
 */
const NavContext = createContext<NavGroup[] | null>(null);

export function NavProvider({ children }: { children: React.ReactNode }) {
  const permissions = usePermissions();
  const company = useCompanyConfig();
  const groups = useMemo(
    () =>
      permissions && company
        ? visibleNavGroups(permissions, company.modules, company.terms, company.settings)
        : null,
    [permissions, company]
  );
  return <NavContext.Provider value={groups}>{children}</NavContext.Provider>;
}

export function useNav(): NavGroup[] | null {
  return useContext(NavContext);
}
