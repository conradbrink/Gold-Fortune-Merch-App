"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Building2, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { navGroups } from "@/components/layout/nav-items";

/** Remembered across navigations and reloads — a width you have to re-set on
    every page is worse than no control at all. */
const COLLAPSED_KEY = "gf.sidebarCollapsed";

export function SidebarContent({
  onNavigate,
  collapsed = false,
  onToggleCollapse,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
  /** Omitted by the mobile drawer, which has a close button of its own. */
  onToggleCollapse?: () => void;
}) {
  const pathname = usePathname();

  const toggle = onToggleCollapse && (
    <button
      type="button"
      onClick={onToggleCollapse}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-expanded={!collapsed}
      title={collapsed ? "Expand" : "Collapse"}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
    >
      {collapsed ? (
        <PanelLeftOpen className="h-4 w-4" />
      ) : (
        <PanelLeftClose className="h-4 w-4" />
      )}
    </button>
  );

  return (
    <>
      {/* Collapsed there is no room for the mark and the control side by side
          at 64px, so the control takes the header and the mark steps aside —
          the tab already carries the branding. */}
      <div
        className={cn(
          "flex h-16 items-center gap-2",
          collapsed ? "justify-center px-2" : "px-5"
        )}
      >
        {!collapsed && (
          <Image
            src="/logo.png"
            alt="Gold Fortune"
            width={32}
            height={32}
            className="h-8 w-8 shrink-0 rounded-md object-cover"
          />
        )}
        {!collapsed && (
          <div className="flex min-w-0 flex-col leading-none">
            <span className="truncate text-sm font-bold tracking-tight text-sidebar-foreground">
              Gold Fortune
            </span>
            <span className="text-[11px] font-medium text-muted-foreground">
              Merchandising
            </span>
          </div>
        )}
        {toggle && <div className={cn(!collapsed && "ml-auto")}>{toggle}</div>}
        {collapsed && !toggle && (
          <Image
            src="/logo.png"
            alt="Gold Fortune"
            width={32}
            height={32}
            className="h-8 w-8 shrink-0 rounded-md object-cover"
          />
        )}
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-2">
        {navGroups.map((group, index) => (
          <div key={group.label ?? "standalone"} className={index > 0 ? "mt-4" : ""}>
            {/* Collapsed to icons there is no room for a heading, and a rule
                separates the groups more clearly than truncated text would. */}
            {group.label &&
              (collapsed ? (
                <div className="mx-2 mb-2 border-t border-sidebar-border" />
              ) : (
                <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </p>
              ))}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    // The label is the only affordance when expanded, so
                    // collapsed needs the tooltip or the icons are a guessing
                    // game. Collapsed it also carries the group, which is the
                    // only place that information survives.
                    title={
                      collapsed
                        ? group.label
                          ? `${group.label} · ${item.label}`
                          : item.label
                        : undefined
                    }
                    className={cn(
                      "flex items-center gap-3 rounded-md py-2 text-sm font-medium transition-colors",
                      collapsed ? "justify-center px-2" : "px-3",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {!collapsed && item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-sidebar-border p-3">
        <Link
          href="/settings/company"
          onClick={onNavigate}
          title={collapsed ? "Company profile" : undefined}
          className={cn(
            "flex items-center gap-3 rounded-md py-2.5 text-sm font-medium transition-colors",
            collapsed ? "justify-center px-2" : "px-3",
            pathname.startsWith("/settings")
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
          )}
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Building2 className="h-4 w-4" />
          </div>
          {!collapsed && (
            <div className="flex flex-col leading-tight">
              <span>Gold Fortune Inc.</span>
              <span className="text-[11px] font-normal text-muted-foreground">
                Company profile
              </span>
            </div>
          )}
        </Link>
      </div>
    </>
  );
}

export function SidebarNav() {
  // Starts expanded and corrects itself after mount. Reading localStorage
  // during render would make the server and the client disagree on the width
  // and React would complain about the mismatch.
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(COLLAPSED_KEY) === "true");
  }, []);

  function toggle() {
    setCollapsed((previous) => {
      const next = !previous;
      window.localStorage.setItem(COLLAPSED_KEY, String(next));
      return next;
    });
  }

  return (
    <aside
      className={cn(
        "hidden shrink-0 border-r border-sidebar-border bg-sidebar transition-[width] duration-200 md:flex md:flex-col",
        collapsed ? "w-16" : "w-56"
      )}
    >
      <SidebarContent collapsed={collapsed} onToggleCollapse={toggle} />
    </aside>
  );
}
