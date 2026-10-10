"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { SidebarContent } from "@/components/layout/sidebar-nav";
import { activeItem, mobilePrimary } from "@/components/layout/nav-items";
import { useNav } from "@/components/layout/nav-context";
import { Button } from "@/components/ui/button";

/** The full menu on a phone, opened from "More". */
export function MobileNav({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-sidebar-border bg-sidebar shadow-xl">
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute top-4 right-3"
          onClick={onClose}
          aria-label="Close menu"
        >
          <X className="h-4 w-4" />
        </Button>
        <SidebarContent onNavigate={onClose} />
      </aside>
    </div>
  );
}

/**
 * The phone's main navigation: the four places used most, along the bottom
 * where a thumb reaches, and "More" for everything else.
 *
 * Not the desktop sidebar shrunk: on a phone the owner is usually checking
 * today's work or looking someone up, so those come first, and the rest is one
 * tap away in the full menu.
 */
export function MobileTabBar({ onOpenMore }: { onOpenMore: () => void }) {
  const pathname = usePathname();
  const groups = useNav();
  if (!groups) return null;
  const primary = mobilePrimary(groups);
  const current = activeItem(groups, pathname)?.id ?? null;
  const elsewhere = current !== null && !primary.some((i) => i.id === current);

  const cell =
    "flex min-h-14 flex-col items-center justify-center gap-1 px-1 text-[11px] leading-none transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring";

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden print:hidden"
    >
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${primary.length + 1}, minmax(0, 1fr))` }}>
        {primary.map((item) => {
          const Icon = item.icon;
          const active = item.id === current;
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(cell, active ? "font-semibold text-foreground" : "font-medium text-muted-foreground")}
              >
                <Icon className={cn("h-5 w-5", active && "text-gold")} aria-hidden />
                <span className="max-w-full truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={onOpenMore}
            aria-haspopup="dialog"
            className={cn(cell, "w-full", elsewhere ? "font-semibold text-foreground" : "font-medium text-muted-foreground")}
          >
            <Menu className={cn("h-5 w-5", elsewhere && "text-gold")} aria-hidden />
            <span>More</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
