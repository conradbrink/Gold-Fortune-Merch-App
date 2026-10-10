"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { activeItem, type NavItem } from "@/components/layout/nav-items";
import { useNav } from "@/components/layout/nav-context";
import { useCompanyConfig } from "@/lib/use-company-config";
import { CompanyMark } from "@/components/layout/company-mark";

/** Remembered across navigations and reloads: a width you have to re-set on
    every page is worse than no control at all. */
const COLLAPSED_KEY = "gf.sidebarCollapsed";

export function SidebarContent({
  onNavigate,
  collapsed = false,
  onToggleCollapse,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
  /** Omitted by the phone's menu, which has a close button of its own. */
  onToggleCollapse?: () => void;
}) {
  const pathname = usePathname();
  const groups = useNav() ?? [];
  const company = useCompanyConfig();
  const branding = company?.branding ?? null;
  const current = activeItem(groups, pathname)?.id ?? null;

  const toggle = onToggleCollapse && (
    <button
      type="button"
      onClick={onToggleCollapse}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-expanded={!collapsed}
      title={collapsed ? "Expand" : "Collapse"}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/60 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
    </button>
  );

  return (
    <>
      {/* Collapsed there is no room for the mark and the control side by side
          at 64px, so the control takes the header and the mark steps aside.
          The company's own logo and name, from its configuration. */}
      <div
        className={cn(
          "flex h-14 shrink-0 items-center gap-2",
          collapsed ? "justify-center px-2" : "px-5",
          // In the phone's menu the close button sits over the right of this
          // row; a long company name would otherwise run underneath it.
          !onToggleCollapse && !collapsed && "pr-12"
        )}
      >
        {!collapsed && <CompanyMark branding={branding} />}
        {!collapsed && (
          <span className="min-w-0 truncate text-sm font-bold leading-none tracking-tight text-sidebar-foreground">
            {branding?.name}
          </span>
        )}
        {toggle && <div className={cn(!collapsed && "ml-auto")}>{toggle}</div>}
        {collapsed && !toggle && <CompanyMark branding={branding} />}
      </div>
      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 pt-2 pb-6">
        {groups.map((group, index) => (
          <div
            // Keyed on the first item when there is no heading: the Dashboard
            // and Reports both stand alone. Reports gets a group's spacing, or
            // it reads as the last line of the group above it.
            key={group.label ?? group.items[0]?.id ?? String(index)}
            className={cn(index > 0 && "mt-6")}
          >
            {group.label &&
              (collapsed ? (
                // No room for a heading at 64px; a rule separates the groups.
                <div className="mx-2 mb-2 border-t border-sidebar-border" />
              ) : (
                <div className="px-3 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </div>
              ))}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.id}>
                  <SidebarLink
                    item={item}
                    active={item.id === current}
                    collapsed={collapsed}
                    // The Dashboard is where the day starts, so it reads
                    // first: a touch larger and in full ink.
                    primary={item.id === "/"}
                    title={collapsed ? (group.label ? `${group.label}: ${item.label}` : item.label) : undefined}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </>
  );
}

function SidebarLink({
  item,
  active,
  collapsed,
  primary,
  title,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  primary: boolean;
  title?: string;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      title={title}
      className={cn(
        "relative flex items-center gap-3 rounded-md text-sm transition-colors duration-150",
        "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
        collapsed ? "justify-center px-2" : "px-3",
        primary ? "py-2" : "py-1.5",
        // A quiet tint and a gold rail: the highlight only has to answer
        // "where am I", and a filled pill out-shouts everything on the page.
        active
          ? "bg-muted font-semibold text-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-gold"
          : primary
            ? "font-semibold text-foreground hover:bg-muted/70"
            : "font-medium text-sidebar-foreground/75 hover:bg-muted/70 hover:text-foreground"
      )}
    >
      <Icon className={cn("shrink-0", primary ? "h-[18px] w-[18px]" : "h-4 w-4")} aria-hidden />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );
}

export function SidebarNav() {
  // Starts expanded and corrects itself after mount. Reading localStorage
  // during render would make the server and the client disagree on the width.
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(window.localStorage.getItem(COLLAPSED_KEY) === "true");
    } catch {
      // Storage blocked: stay expanded.
    }
  }, []);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem(COLLAPSED_KEY, String(next));
    } catch {
      // Storage blocked: the width still changes for this page.
    }
  }

  return (
    <aside
      className={cn(
        "hidden shrink-0 border-r border-sidebar-border bg-sidebar transition-[width] duration-200 md:flex md:flex-col print:hidden",
        collapsed ? "w-16" : "w-60"
      )}
    >
      <SidebarContent collapsed={collapsed} onToggleCollapse={toggle} />
    </aside>
  );
}
