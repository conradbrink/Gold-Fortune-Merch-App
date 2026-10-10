"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Smartphone, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { PRODUCT_MARK, PRODUCT_NAME } from "@/lib/product";
import { moduleEnabled } from "@/lib/modules";
import { getCompanyConfig } from "@/lib/use-company-config";

export default function RepNoticePage() {
  const router = useRouter();
  const supabase = createClient();
  // Whether the company has HR. No template switches it on, and offering
  // "My HR" without it led to a "not enabled" page. Unknown until loaded;
  // a failed lookup shows the link, as before.
  const [hasHr, setHasHr] = useState<boolean | null>(null);
  useEffect(() => {
    getCompanyConfig()
      .then((c) => setHasHr(c ? moduleEnabled(c.modules, "hr") : true))
      .catch(() => setHasHr(true));
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-secondary/40 px-4 text-center">
      {/* The product's mark, not the company's: this page sits outside the
          dashboard layout, so the company's configuration is never loaded
          here, and fetching it for one picture is not worth a request. */}
      <Image src={PRODUCT_MARK} alt={PRODUCT_NAME} width={56} height={56} className="rounded-lg" />
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <Smartphone className="h-6 w-6" />
      </div>
      <div className="max-w-sm space-y-2">
        <h1 className="text-xl font-bold text-foreground">Use the mobile app</h1>
        <p className="text-sm text-muted-foreground">
          Field staff check in, fill forms and capture photos in the{" "}
          {PRODUCT_NAME} mobile app. This web dashboard is for managers.
        </p>
        {/* The one exception, and worth saying out loud: leave, payslips-to-be,
            reviews and the acknowledgements that go with them are not in the
            app, and this page used to be a dead end for field staff who needed
            them. */}
        {hasHr && (
          <p className="text-sm text-muted-foreground">
            Your own HR record — leave, attendance, documents and reviews — is
            here on the web.
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {hasHr && (
          <Button nativeButton={false} render={<Link href="/hr/me" />}>
            <UserRound className="mr-1.5 h-4 w-4" />
            My HR
          </Button>
        )}
        <Button variant="outline" onClick={handleSignOut}>
          Sign out
        </Button>
      </div>
    </div>
  );
}
