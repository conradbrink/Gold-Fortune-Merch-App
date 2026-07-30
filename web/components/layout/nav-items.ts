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
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
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
