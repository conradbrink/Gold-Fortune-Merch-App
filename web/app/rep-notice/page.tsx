"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export default function RepNoticePage() {
  const router = useRouter();
  const supabase = createClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-secondary/40 px-4 text-center">
      <Image src="/logo.png" alt="Gold Fortune" width={56} height={56} className="rounded-lg" />
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <Smartphone className="h-6 w-6" />
      </div>
      <div className="max-w-sm space-y-2">
        <h1 className="text-xl font-bold text-foreground">Use the mobile app</h1>
        <p className="text-sm text-muted-foreground">
          Rep accounts check in to visits, fill forms, and capture photos from
          the Gold Fortune Merchandising mobile app. This web dashboard is for
          managers.
        </p>
      </div>
      <Button variant="outline" onClick={handleSignOut}>
        Sign out
      </Button>
    </div>
  );
}
