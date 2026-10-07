import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

/**
 * Where `proxy.ts` sends a request for a page whose module the company does
 * not have. Explained rather than bounced home: a link that silently lands on
 * the dashboard reads as broken, and the person cannot tell whether to report
 * a fault or ask about their plan.
 *
 * The module's name comes from the catalogue (`modules`), so a module added
 * later is named correctly here without a code change.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Not part of your plan" };

export default async function NotEnabledPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const raw = (await searchParams).module;
  const code = typeof raw === "string" ? raw : null;

  let name: string | null = null;
  let description: string | null = null;
  if (code) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("modules")
      .select("name, description")
      .eq("code", code)
      .maybeSingle();
    name = data?.name ?? null;
    description = data?.description ?? null;
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 py-12 text-center">
      <h1 className="text-xl font-semibold text-foreground">
        {name ? `${name} is not part of your plan` : "This is not part of your plan"}
      </h1>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
      <p className="text-sm text-muted-foreground">
        Your company does not have this module switched on. Ask whoever manages
        your account if you need it.
      </p>
      <Link
        href="/"
        className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
      >
        Back to the start
      </Link>
    </div>
  );
}
