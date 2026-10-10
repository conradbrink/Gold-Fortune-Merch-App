"use client";

import { forgetCompanyConfig } from "@/lib/use-company-config";
import { forgetSitesView } from "@/lib/map-centre";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  ChevronDown,
  LogOut,
  Menu,
  UserRound,
  X,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient } from "@/lib/supabase/client";
import { GlobalSearch } from "@/components/layout/global-search";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { NotificationsBell } from "@/components/hr/notifications-bell";
import { AlertsBell } from "@/components/alerts/alerts-bell";
import { WorkdayControl } from "@/components/workday/workday-control";
import { can } from "@/lib/permissions";
import { usePermissions } from "@/lib/use-permissions";
import { useCompanyConfig } from "@/lib/use-company-config";
import { moduleEnabled } from "@/lib/modules";

export function TopBar({ onOpenNav }: { onOpenNav?: () => void }) {
  const router = useRouter();
  const supabase = createClient();
  const permissions = usePermissions();
  const company = useCompanyConfig();
  // HR notifications only exist with the HR module; without it the bell would
  // poll a table the database answers with nothing.
  const hasHr = company !== null && moduleEnabled(company.modules, "hr");
  // Alerts (Stage 8.4) are for the people who read how the field went, at a
  // company with the module; the database refuses everyone else.
  const hasAlerts =
    company !== null &&
    moduleEnabled(company.modules, "owner_notifications") &&
    permissions !== null &&
    can(permissions, "insights");
  // Global search spans four modules, not one. It used to follow the store
  // estate alone, which was wrong in both directions: a warehouse-and-resources
  // person got no box at all, and somebody with only the store estate got a box
  // that searched products, forms and files as well and offered them links that
  // bounce at the proxy. Offered when at least one source is open; which ones
  // are searched is decided inside, from the same set.
  const canSearch =
    permissions !== null &&
    (can(permissions, "sales_coverage") ||
      can(permissions, "team") ||
      can(permissions, "resources"));
  // Neutral until the user is known: these used to start as "Gold Fortune
  // User" and "GF", which every other company's staff would have seen too.
  const [label, setLabel] = useState("Signed in");
  /** Empty when there is no name or email to take them from: a person icon. */
  const [initials, setInitials] = useState("");
  /** Below `sm` the search box is hidden; this is what the button reveals. */
  const [searchRevealed, setSearchRevealed] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const meta = data.user?.user_metadata as { full_name?: string } | undefined;
      const name = meta?.full_name?.trim() || data.user?.email || "";
      if (!name) return;
      setLabel(name);
      const parts = name.split(/\s+/);
      setInitials(
        parts.length > 1
          ? `${parts[0][0]}${parts[1][0]}`.toUpperCase()
          : name.slice(0, 2).toUpperCase()
      );
    });
  }, [supabase]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    // This tab's caches belong to the person leaving: whoever signs in next
    // here must not be shown their company's configuration or map view.
    forgetCompanyConfig();
    forgetSitesView();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-4 sm:px-6">
      {/* Hidden while the mobile search is open — the box needs the whole row. */}
      <Button
        variant="ghost"
        size="icon"
        className={searchRevealed ? "hidden" : "md:hidden"}
        onClick={onOpenNav}
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </Button>

      {canSearch && permissions !== null && (
        <GlobalSearch permissions={permissions} revealed={searchRevealed} />
      )}

      <div className="ml-auto flex items-center gap-2 text-muted-foreground sm:gap-4">
        {canSearch && (
          <Button
            variant="ghost"
            size="icon"
            className="sm:hidden"
            aria-label={searchRevealed ? "Close search" : "Search"}
            aria-expanded={searchRevealed}
            onClick={() => setSearchRevealed((s) => !s)}
          >
            {searchRevealed ? <X className="h-5 w-5" /> : <Search className="h-5 w-5" />}
          </Button>
        )}
        {/* Mail and Bell used to sit here as bare icons — not buttons, no
            handler, nothing behind them, an advertisement for a feature that
            did not exist. Mail still does not. The bell is back because the HR
            module gave it something to show: leave requests to decide, reviews
            to acknowledge, cases waiting on somebody. It renders nothing at all
            when the feed is empty or unreadable.

            Ungated by role, like the theme toggle below it: a rep with a
            pending leave decision needs telling as much as a manager does. */}
        {/* Ahead of the bell, because it is the one control in this bar that
            somebody comes to the app specifically to press. Renders nothing for
            anybody without the `workday` permission. */}
        <WorkdayControl />
        {hasAlerts && <AlertsBell />}
        {hasHr && <NotificationsBell />}
        {/* Outside the manager gate, unlike search and settings. How the screen
            looks is nobody's permission to grant, and warehouse staff work the
            same long shifts on the same screens. */}
        <ThemeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 outline-none">
            <Avatar className="h-7 w-7 shrink-0">
              <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                {initials || <UserRound className="h-4 w-4" />}
              </AvatarFallback>
            </Avatar>
            <ChevronDown className="h-4 w-4 shrink-0" />
          </DropdownMenuTrigger>
          {/* The name lives in the menu, not the bar: a truncated email beside
              the avatar was the widest thing in the header and said the least. */}
          <DropdownMenuContent align="end">
            <div className="max-w-[16rem] truncate px-2 py-1.5 text-xs text-muted-foreground">
              {label}
            </div>
            <DropdownMenuItem onClick={handleSignOut} className="gap-2">
              <LogOut className="h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
