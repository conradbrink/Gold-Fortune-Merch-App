"use client";

import { forgetCompanyConfig } from "@/lib/use-company-config";
import { forgetSitesView } from "@/lib/map-centre";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { PRODUCT_MARK, PRODUCT_NAME } from "@/lib/product";

/**
 * Where the people of a closed company are sent (proxy.ts): the database no
 * longer recognises them, so every other page would be empty. Says what
 * happened and lets them sign out. The company's name comes from
 * my_company_closed(), the one thing about it they can still read.
 */
export default function ClosedPage() {
  const router = useRouter();
  const supabase = createClient();
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    createClient()
      .rpc("my_company_closed")
      .then(({ data, error }) => {
        // Reopened since (or never closed): back to the dashboard.
        if (!error && data === null) {
          router.replace("/");
          return;
        }
        const n = (data as { name?: unknown } | null)?.name;
        if (typeof n === "string" && n) setName(n);
      });
  }, [router]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    // This tab's caches belong to the person leaving.
    forgetCompanyConfig();
    forgetSitesView();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-secondary/40 px-4 text-center">
      <Image src={PRODUCT_MARK} alt={PRODUCT_NAME} width={56} height={56} className="rounded-lg" />
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <Lock className="h-6 w-6" />
      </div>
      <div className="max-w-sm space-y-2">
        <h1 className="text-xl font-bold text-foreground">
          {name ? `${name}'s ${PRODUCT_NAME} account is closed` : `Your company's ${PRODUCT_NAME} account is closed`}
        </h1>
        <p className="text-sm text-muted-foreground">
          You can&apos;t use {PRODUCT_NAME} for this company at the moment. Nothing has been deleted. If you think
          this is a mistake, ask the person who runs your company, or email hello@tickd.co.za.
        </p>
      </div>
      <Button variant="outline" onClick={handleSignOut}>
        Sign out
      </Button>
    </div>
  );
}
