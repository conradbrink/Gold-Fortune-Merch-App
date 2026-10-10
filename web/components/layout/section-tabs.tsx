"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { tabsFor } from "@/components/layout/nav-items";
import { useNav } from "@/components/layout/nav-context";

/**
 * The pages of one area, as tabs across the top of each of them.
 *
 * This is what lets the sidebar stay short: Statements, Contracts and the
 * Price list are tabs on Invoices rather than three more lines in the menu.
 * Underlined links, unlike the filled tabs inside a page, because each one is
 * a page of its own with its own address. Drawn only on the pages it lists,
 * and only when the person may open at least two of them.
 */
export function SectionTabs() {
  const pathname = usePathname();
  const groups = useNav();
  const row = groups ? tabsFor(groups, pathname) : null;
  if (!row) return null;

  return (
    <nav aria-label="Pages in this section" className="-mt-1 mb-5 border-b border-border print:hidden">
      <ul className="-mb-px flex gap-5 overflow-x-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
        {row.tabs.map((tab) => {
          const active = tab.href === row.current;
          return (
            <li key={tab.href} className="shrink-0">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-10 items-center border-b-2 text-sm transition-colors duration-150",
                  "focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                  active
                    ? "border-gold font-semibold text-foreground"
                    : "border-transparent font-medium text-muted-foreground hover:border-border hover:text-foreground"
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
