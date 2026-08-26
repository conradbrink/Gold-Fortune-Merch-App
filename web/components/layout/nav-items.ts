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
  Gauge,
  TrendingUp,
  Warehouse,
  Boxes,
  ClipboardCheck,
  Settings2,
  PieChart,
  Contact,
  CalendarCheck,
  CalendarOff,
  FolderLock,
  Star,
  ShieldAlert,
  SlidersHorizontal,
  UserRound,
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
  /** Null renders the items with no heading — used for Dashboard and My HR. */
  label: string | null;
  items: NavItem[];
};

/** Who runs the HR module. Mirrors `isHrRole` in lib/roles.ts. */
const HR_ROLES: AppRole[] = ["manager", "hr_manager"];

export const navGroups: NavGroup[] = [
  {
    label: null,
    items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    // Directly under Dashboard, because it answers the same question at the
    // same altitude: the dashboard is today, this is the trend behind it. It
    // used to sit last, below Resources, which put the reporting a manager
    // opens daily underneath the files they open monthly.
    //
    // Manager-only throughout, by the `roles` default. Every item here is
    // management information about a colleague — revenue by rep, fulfilment
    // time by clerk — and `canAccessPath` refuses all three for the other
    // roles, so the menu hiding them is the second guard rather than the only
    // one.
    label: "Insights",
    items: [
      { href: "/sales", label: "Sales", icon: TrendingUp },
      { href: "/reports", label: "Reports", icon: BarChart3 },
      // Moved out of Warehouse & Fulfilment. It reads as warehouse work
      // because of its URL, but it ranks staff by fulfilment time and
      // accuracy — which is the same kind of thing as Sales, and not the
      // day-to-day "what is going out today?" the rest of that group answers.
      // Its own icon rather than Reports' bar chart: the two sat adjacent with
      // the same glyph, which read as one entry duplicated. A gauge also says
      // what it is — fulfilment speed and accuracy, not another report.
      { href: "/warehouse/insights", label: "Warehouse insights", icon: Gauge },
    ],
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
        href: "/orders",
        label: "Orders",
        icon: ClipboardCheck,
        roles: ["manager", "warehouse"],
      },
      {
        href: "/inventory",
        label: "Inventory",
        icon: Boxes,
        roles: ["manager", "warehouse"],
      },
      // Reachable by clerks on purpose: adding the driver who started this
      // morning should not wait for a manager, and RLS already permits it. The
      // manager-only tabs inside are gated by the page and by RLS.
      {
        href: "/warehouse/settings",
        label: "Warehouse setup",
        icon: Settings2,
        roles: ["manager", "warehouse"],
      },
    ],
  },
  {
    label: "Team",
    items: [{ href: "/representatives", label: "Representatives", icon: Users }],
  },
  {
    // The whole HR module, and the only group an `hr_manager` account sees.
    //
    // Eight destinations under one heading rather than a collapsing sub-menu:
    // the sidebar has no nesting today, and adding a second interaction model
    // for one group would make HR the odd section rather than a section. The
    // group heading does the work the parent item would have done.
    label: "Human Resources",
    items: [
      { href: "/hr", label: "HR dashboard", icon: PieChart, roles: HR_ROLES },
      { href: "/hr/employees", label: "Employees", icon: Contact, roles: HR_ROLES },
      { href: "/hr/attendance", label: "Attendance", icon: CalendarCheck, roles: HR_ROLES },
      { href: "/hr/leave", label: "Leave", icon: CalendarOff, roles: HR_ROLES },
      { href: "/hr/documents", label: "Documents", icon: FolderLock, roles: HR_ROLES },
      { href: "/hr/performance", label: "Performance", icon: Star, roles: HR_ROLES },
      { href: "/hr/disciplinary", label: "Disciplinary", icon: ShieldAlert, roles: HR_ROLES },
      { href: "/hr/settings", label: "HR settings", icon: SlidersHorizontal, roles: HR_ROLES },
    ],
  },
  {
    // Everybody, including a rep who otherwise never sees this shell. Its own
    // group rather than an entry under Human Resources, because for three of
    // the four roles it is the only HR destination there is, and a lone item
    // under a heading called "Human Resources" would read as a module they had
    // been given and could not open.
    label: null,
    items: [
      {
        href: "/hr/me",
        label: "My HR",
        icon: UserRound,
        roles: ["manager", "hr_manager", "warehouse", "rep"],
      },
    ],
  },
  {
    label: "Resources",
    items: [
      { href: "/products", label: "Products", icon: Package },
      { href: "/forms", label: "Forms", icon: FileText },
      { href: "/files", label: "Files", icon: Folder },
    ],
  },
];

/** Flat list, for anything that only needs the destinations. */
export const navItems: NavItem[] = navGroups.flatMap((g) => g.items);

/**
 * The one destination that counts as "where you are", or null.
 *
 * Longest match wins, and that is the whole point: `/warehouse/insights` starts
 * with `/warehouse`, so a plain `startsWith` per item lights up two entries at
 * once. That was survivable while both sat in the same group and merely looked
 * untidy; with Insights lifted to the top it would highlight in two separate
 * groups and claim you are in two places.
 *
 * `/` is matched exactly, or it prefixes every path in the app.
 */
export function activeHref(pathname: string): string | null {
  let best: string | null = null;
  for (const item of navItems) {
    const hit =
      item.href === "/"
        ? pathname === "/"
        : pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (hit && (best === null || item.href.length > best.length)) best = item.href;
  }
  return best;
}

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
