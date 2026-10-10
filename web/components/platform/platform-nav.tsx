"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The operator area's one row of navigation. Rendered by app/platform/layout.tsx
 * only after the operator check, so nobody else ever sees it. Kept short on
 * purpose (spec section 3): deeper pages are tabs inside each area.
 */
const ITEMS = [
  { href: "/platform", label: "Companies", exact: true },
  { href: "/platform/users", label: "Users" },
  { href: "/platform/acquisition", label: "Acquisition" },
  { href: "/platform/onboarding", label: "Onboarding" },
  { href: "/platform/founding", label: "Founding applications" },
];

export function PlatformNav() {
  const path = usePathname();
  const active = (href: string, exact?: boolean) =>
    exact ? path === href || path.startsWith("/platform/companies") : path === href || path.startsWith(href + "/");
  return (
    <nav aria-label="Tickd Control Centre" className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-4 sm:px-8">
        <span className="mr-3 whitespace-nowrap py-3 text-sm font-semibold text-foreground">Tickd Control Centre</span>
        {ITEMS.map((item) => {
          const on = active(item.href, item.exact);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={on ? "page" : undefined}
              className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm transition-colors ${
                on
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
