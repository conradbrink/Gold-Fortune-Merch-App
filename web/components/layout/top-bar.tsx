"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Search,
  Settings,
  ChevronDown,
  LogOut,
  Menu,
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
import { useCurrentRole } from "@/lib/use-current-role";

export function TopBar({ onOpenNav }: { onOpenNav?: () => void }) {
  const router = useRouter();
  const supabase = createClient();
  const role = useCurrentRole();
  // Global search spans stores, reps, forms and files, and every result links
  // to a page only a manager can open. Scoping it to the warehouse's own
  // records is worth doing once there are orders to find; offering it now
  // would be offering a box that only returns dead ends.
  const isManager = role === "manager";
  const [label, setLabel] = useState("Gold Fortune User");
  const [initials, setInitials] = useState("GF");
  /** Below `sm` the search box is hidden; this is what the button reveals. */
  const [searchRevealed, setSearchRevealed] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const meta = data.user?.user_metadata as { full_name?: string } | undefined;
      const name = meta?.full_name || data.user?.email || "Gold Fortune User";
      setLabel(name);
      const parts = name.trim().split(/\s+/);
      setInitials(
        parts.length > 1
          ? `${parts[0][0]}${parts[1][0]}`.toUpperCase()
          : name.slice(0, 2).toUpperCase()
      );
    });
  }, [supabase]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background px-4 sm:px-6">
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

      {isManager && <GlobalSearch revealed={searchRevealed} />}

      <div className="ml-auto flex items-center gap-2 text-muted-foreground sm:gap-4">
        {isManager && (
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
        <NotificationsBell />
        {/* Outside the manager gate, unlike search and settings. How the screen
            looks is nobody's permission to grant, and warehouse staff work the
            same long shifts on the same screens. */}
        <ThemeToggle />
        {isManager && (
          <>
            <Button
              variant="ghost"
              size="icon"
              nativeButton={false}
              className="hidden lg:inline-flex"
              title="Company settings"
              aria-label="Company settings"
              render={
                <Link href="/settings/company">
                  <Settings className="h-5 w-5" />
                </Link>
              }
            />
            <div className="mx-1 hidden h-6 w-px bg-border lg:block" />
          </>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 outline-none">
            <Avatar className="h-7 w-7 shrink-0">
              <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                {initials}
              </AvatarFallback>
            </Avatar>
            <span className="hidden max-w-[12rem] truncate text-sm font-medium text-foreground lg:block">
              {label}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
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
