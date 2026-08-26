"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Building2, ChevronDown, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { activeHref, visibleNavGroups } from "@/components/layout/nav-items";
import { createClient } from "@/lib/supabase/client";
import { fetchOrgName } from "@/lib/org-settings";
import { useCurrentRole } from "@/lib/use-current-role";

/** Remembered across navigations and reloads — a width you have to re-set on
    every page is worse than no control at all. */
const COLLAPSED_KEY = "gf.sidebarCollapsed";

/** Which groups are folded shut. Same reasoning as the width: a menu you have
    to re-fold on every page is worse than one that does not fold. */
const GROUPS_KEY = "gf.navGroupsClosed";

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
  const role = useCurrentRole();
  // Empty until the role is known — see `useCurrentRole` for why this does not
  // fall back to the manager menu.
  const groups = role ? visibleNavGroups(role) : [];
  const current = activeHref(pathname);

  /**
   * The groups the reader has folded shut, by label.
   *
   * Closed rather than open is what gets stored, so a group added later starts
   * open without needing a migration — the absence of a key means "not folded",
   * which is the state a new group should arrive in.
   *
   * Starts empty and corrects itself after mount, for the same hydration reason
   * the width does: reading localStorage during render makes the server and the
   * client disagree about what is on screen.
   */
  const [closed, setClosed] = useState<string[]>([]);

  /**
   * Whether storage has been read yet. Nothing is written before it has.
   *
   * Two bugs were caught here by clicking, neither by reading:
   *
   * 1. Computing the next list from `closed` read it from that render's
   *    closure, so folding two headings before React re-rendered wrote the
   *    second over the first and silently lost a fold. The updater in
   *    `toggleGroup` always sees the current value instead.
   * 2. Persisting on every change of `closed` then broke *reloading*: in
   *    development React mounts twice, and the second mount fired the write with
   *    the empty starting value, overwriting what had just been read back from
   *    storage. Folds survived until you refreshed, and then half came undone.
   *
   * Hence a flag rather than a ref holding the live list: a ref mutated in a
   * handler that an effect also assigns is what `react-hooks/immutability`
   * refuses, and syncing one during render is what `react-hooks/refs` refuses.
   */
  const [hydrated, setHydrated] = useState(false);

  /**
   * The company's own name for the footer, or null until it arrives.
   *
   * Fetched only for a manager, because the footer it feeds is manager-only and
   * a clerk asking for a row they are shown nothing of is a query for nothing.
   */
  const [orgName, setOrgName] = useState<string | null>(null);

  useEffect(() => {
    if (role !== "manager") return;
    let cancelled = false;
    (async () => {
      const name = await fetchOrgName(createClient());
      if (!cancelled) setOrgName(name);
    })();
    return () => {
      cancelled = true;
    };
  }, [role]);

  useEffect(() => {
    const raw = window.localStorage.getItem(GROUPS_KEY);
    try {
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      // Anything else in the key is somebody else's data or a bad write, and a
      // menu that throws on load is worse than a menu that opens everything.
      if (Array.isArray(parsed)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setClosed(parsed.filter((x): x is string => typeof x === "string"));
      }
    } catch {
      // Ignore: unparseable means unfolded.
    }
    // Raised on every path, including "nothing stored" and "stored rubbish" —
    // leaving it down in those cases would mean a fold made in this session was
    // never written at all.
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(GROUPS_KEY, JSON.stringify(closed));
  }, [closed, hydrated]);

  function toggleGroup(label: string) {
    setClosed((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]
    );
  }

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
        {groups.map((group, index) => {
          // Folding only exists in the expanded sidebar. At 64px there is no
          // heading to click and no label to read, so the icons stay visible
          // and the stored state is simply not consulted — a group that
          // vanished when the sidebar narrowed would look like lost navigation.
          const foldable = group.label !== null && !collapsed;
          const isClosed = foldable && closed.includes(group.label!);
          const holdsCurrent = group.items.some((i) => i.href === current);
          return (
          // Keyed on the first destination when there is no heading. There
          // used to be exactly one unlabelled group (Dashboard) and the literal
          // "standalone" was unique; My HR made a second, and React quietly
          // reported two children with the same key on every page.
          <div
            key={group.label ?? group.items[0]?.href ?? String(index)}
            className={index > 0 ? "mt-4" : ""}
          >
            {/* Collapsed to icons there is no room for a heading, and a rule
                separates the groups more clearly than truncated text would. */}
            {group.label &&
              (collapsed ? (
                <div className="mx-2 mb-2 border-t border-sidebar-border" />
              ) : (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.label!)}
                  aria-expanded={!isClosed}
                  aria-controls={`nav-group-${index}`}
                  className="flex w-full items-center gap-1.5 rounded-md px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:bg-sidebar-accent/40 hover:text-sidebar-accent-foreground"
                >
                  <ChevronDown
                    className={cn(
                      "h-3 w-3 shrink-0 transition-transform duration-150",
                      isClosed && "-rotate-90"
                    )}
                  />
                  {/* Not truncated: the chevron costs ~18px and "Warehouse &
                      Fulfilment" is the longest heading, which clipped to
                      "WAREHOUSE & FULFILME…". Wrapping is the lesser evil —
                      a heading that cannot be read is not a heading. */}
                  <span className="text-left leading-tight">{group.label}</span>
                  {/* Folded away, the highlighted item cannot be seen, and the
                      reader loses the answer to "where am I". A dot on the
                      heading keeps it. */}
                  {isClosed && holdsCurrent && (
                    <span
                      aria-hidden
                      className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-sidebar-accent-foreground/70"
                    />
                  )}
                </button>
              ))}
            <div id={`nav-group-${index}`} hidden={isClosed} className="space-y-0.5">
              {group.items.map((item) => {
                const active = item.href === current;
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
          );
        })}
      </nav>
      {/* The company profile is a manager's page — org details, capacity,
          members. Offering it to a clerk would be a link straight back to
          wherever they came from. */}
      {role === "manager" && (
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
            <div className="flex min-w-0 flex-col leading-tight">
              {/* The real company name, from Settings → Company. This was the
                  literal string "Gold Fortune Inc." — not what that screen says,
                  and somebody else's name entirely the day this is deployed for
                  another business. Nothing is shown until it loads, rather than
                  a placeholder that would be wrong for a moment on every page. */}
              {orgName && <span className="truncate">{orgName}</span>}
              <span className="text-[11px] font-normal text-muted-foreground">
                Company profile
              </span>
            </div>
          )}
        </Link>
      </div>
      )}
    </>
  );
}

export function SidebarNav() {
  // Starts expanded and corrects itself after mount. Reading localStorage
  // during render would make the server and the client disagree on the width
  // and React would complain about the mismatch.
  const [collapsed, setCollapsed] = useState(false);

  // Suppressed, not obeyed — for the reason the comment above gives: reading
  // localStorage during render is exactly the hydration mismatch this effect
  // exists to avoid, so a lazy initialiser is not available here.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapsed(window.localStorage.getItem(COLLAPSED_KEY) === "true");
  }, []);

  function toggle() {
    // Computed outside the updater. React may call an updater more than once
    // for a single update — in StrictMode it does so deliberately — and a
    // localStorage write inside one is a side effect that runs as many times.
    const next = !collapsed;
    setCollapsed(next);
    window.localStorage.setItem(COLLAPSED_KEY, String(next));
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
