"use client";

import { useState } from "react";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { MobileNav } from "@/components/layout/mobile-nav";
import { TopBar } from "@/components/layout/top-bar";
import { CompanyConfigProvider } from "@/lib/use-company-config";

/**
 * The signed-in frame: sidebar, top bar, scrolling main. Client-side for the
 * mobile nav's open state; the server layout around it has already fetched the
 * company configuration and hands it in here.
 */
export function DashboardShell({
  initialConfig,
  children,
}: Readonly<{
  /** `my_company_config()` as the server got it; null if it could not. */
  initialConfig: unknown;
  children: React.ReactNode;
}>) {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <CompanyConfigProvider initialConfig={initialConfig}>
      {/*
       * The three `data-app-*` attributes are print hooks, and nothing reads them
       * on screen. `components/rep-report/report-print.css` uses them to drop the
       * sidebar and the top bar from a printed page and to unwind `main`'s scroll
       * container, which would otherwise clip a printed document to one screen's
       * worth. Structural classes would have done the same job until somebody
       * changed one; an attribute that exists only to be printed against says so.
       */}
      <div className="flex h-full min-h-screen" data-app-shell>
        <SidebarNav />
        <MobileNav open={navOpen} onClose={() => setNavOpen(false)} />
        <div className="flex min-w-0 flex-1 flex-col" data-app-body>
          <TopBar onOpenNav={() => setNavOpen(true)} />
          <main
            data-app-main
            className="min-w-0 flex-1 overflow-y-auto bg-background p-4 sm:px-8 sm:py-7"
          >
            {children}
          </main>
        </div>
      </div>
    </CompanyConfigProvider>
  );
}
