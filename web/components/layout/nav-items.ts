import {
  LayoutDashboard,
  Target,
  Store,
  Map as MapIcon,
  Calendar,
  ClipboardList,
  BadgePercent,
  Users,
  Package,
  FileText,
  Folder,
  BarChart3,
  Warehouse,
  Boxes,
} from "lucide-react";
import { canAccessPath, type AppRole } from "@/lib/roles";

export type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /**
   * Who is offered this destination. Omitted means managers only, which is what
   * every item here was before a third role existed — so the default preserves
   * the behaviour rather than silently widening it.
   *
   * This is presentation, not enforcement. `canAccessPath` in `lib/roles.ts`
   * decides what is actually served, and the two are checked against each other
   * by `visibleNavGroups` below.
   */
  roles?: AppRole[];
};

/**
 * The sidebar, grouped by what a person came to do.
 *
 * A flat list of eleven destinations made the reader scan the whole thing every
 * time; the groups are the questions the app answers — who are we selling to,
 * what is happening in the field, who does it, what they need, and what came of
 * it.
 *
 * Dashboard sits outside the groups on purpose. It is the landing page and the
 * only item that is not part of a workflow, and putting it under a heading of
 * its own ("Overview") would give a one-item group a label that says less than
 * the item does.
 */
export type NavGroup = {
  /** Null renders the items with no heading — used for Dashboard alone. */
  label: string | null;
  items: NavItem[];
};

export const navGroups: NavGroup[] = [
  {
    label: null,
    items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Sales & Coverage",
    items: [
      { href: "/leads", label: "Leads", icon: Target },
      { href: "/stores", label: "Stores", icon: Store },
      { href: "/territories", label: "Territories", icon: MapIcon },
    ],
  },
  {
    label: "Field Operations",
    items: [
      { href: "/schedule", label: "Schedule", icon: Calendar },
      {
        // One destination, two names in the old menu. The feed is where a
        // manager starts, and the per-visit drill-down hangs off it.
        href: "/activities",
        label: "Visits & Activities",
        icon: ClipboardList,
      },
      { href: "/promotions", label: "Promotions", icon: BadgePercent },
    ],
  },
  {
    // The warehouse clerk's whole job, and the only group they see in full.
    // It sits above Team because for a manager it is a daily operational
    // question ("what is going out today?") rather than a reference one.
    label: "Warehouse & Fulfilment",
    items: [
      {
        href: "/warehouse",
        label: "Warehouse",
        icon: Warehouse,
        roles: ["manager", "warehouse"],
      },
      {
        href: "/inventory",
        label: "Inventory",
        icon: Boxes,
        roles: ["manager", "warehouse"],
      },
      // Manager-only: it ranks staff by fulfilment time and accuracy, which is
      // management information about a clerk's colleagues. `canAccessPath`
      // denies it for warehouse too, so this is not the only guard.
      { href: "/warehouse/insights", label: "Warehouse insights", icon: BarChart3 },
    ],
  },
  {
    label: "Team",
    items: [{ href: "/representatives", label: "Representatives", icon: Users }],
  },
  {
    label: "Resources",
    items: [
      { href: "/products", label: "Products", icon: Package },
      { href: "/forms", label: "Forms", icon: FileText },
      { href: "/files", label: "Files", icon: Folder },
    ],
  },
  {
    label: "Insights",
    items: [{ href: "/reports", label: "Reports", icon: BarChart3 }],
  },
];

/** Flat list, for anything that only needs the destinations. */
export const navItems: NavItem[] = navGroups.flatMap((g) => g.items);

/**
 * The groups this role should be shown, with empty groups dropped.
 *
 * The `roles` field says what we *intend* to offer; `canAccessPath` says what
 * the proxy will actually serve. Requiring both means the two can never drift
 * into offering a link that bounces: forget the allowlist entry and the item
 * quietly disappears from the menu rather than becoming a dead end. Forget the
 * `roles` field and the item is simply not offered, which is the safe default
 * this file already takes.
 */
export function visibleNavGroups(role: AppRole): NavGroup[] {
  return navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          (item.roles ?? ["manager"]).includes(role) &&
          canAccessPath(role, item.href)
      ),
    }))
    .filter((group) => group.items.length > 0);
}
