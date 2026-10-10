"use client";

import { CompanyConfigProvider } from "@/lib/use-company-config";

/** The wizard's page: the company's words seeded before any step renders, and one column. */
export function SetupShell({
  initialConfig,
  children,
}: Readonly<{
  /** `my_company_config()` as the server got it; null if it could not. */
  initialConfig: unknown;
  children: React.ReactNode;
}>) {
  return (
    <CompanyConfigProvider initialConfig={initialConfig}>
      <div className="min-h-dvh bg-secondary/40">
        <main className="mx-auto w-full max-w-4xl px-4 py-6 sm:py-10">{children}</main>
      </div>
    </CompanyConfigProvider>
  );
}
