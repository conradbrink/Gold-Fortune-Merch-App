"use client";

import { useState } from "react";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { MobileNav } from "@/components/layout/mobile-nav";
import { TopBar } from "@/components/layout/top-bar";

export default function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [navOpen, setNavOpen] = useState(false);

  return (
    /*
     * The three `data-app-*` attributes are print hooks, and nothing reads them
     * on screen. `components/rep-report/report-print.css` uses them to drop the
     * sidebar and the top bar from a printed page and to unwind `main`'s scroll
     * container, which would otherwise clip a printed document to one screen's
     * worth. Structural classes would have done the same job until somebody
     * changed one; an attribute that exists only to be printed against says so.
     */
    <div className="flex h-full min-h-screen" data-app-shell>
      <SidebarNav />
      <MobileNav open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col" data-app-body>
        <TopBar onOpenNav={() => setNavOpen(true)} />
        <main
          data-app-main
          className="min-w-0 flex-1 overflow-y-auto bg-background p-4 sm:p-6"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
