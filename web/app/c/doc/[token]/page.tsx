import type { Metadata } from "next";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { verifyLink } from "@/lib/email/links";
import { logoUrl } from "@/lib/branding";
import { sellerOf, todayIn, type DocumentView } from "@/lib/client-document";
import { ClientDocument } from "@/components/client-document/client-document";

export const metadata: Metadata = {
  title: "Your document",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * An invoice, a quote or a statement, for the company's client (Stage 8.10):
 * what it says now (what is still to pay, what was paid), in the company's own
 * look, with a PDF to download. Public: the client has no login. The link is
 * the document link's id signed by the server; it stops working when the link
 * expires or is withdrawn, or when its invoice is voided.
 */

function admin() {
  return createAdminClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export default async function ClientDocumentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const id = verifyLink("doc", token);
  const db = admin();
  const { data } = id ? await db.rpc("document_link_view", { p_link_id: id }) : { data: null };
  const v = data as DocumentView | null;

  if (!v) {
    return (
      <main className="min-h-dvh bg-secondary/40 px-4 py-10">
        <div className="mx-auto w-full max-w-md space-y-2 rounded-xl bg-card p-6 ring-1 ring-foreground/10">
          <h1 className="text-lg font-semibold text-foreground">This link does not work</h1>
          <p className="text-sm text-pretty text-muted-foreground">
            It may have expired or been withdrawn, or only part of it was copied. Ask the company that sent it for a new one.
          </p>
        </div>
      </main>
    );
  }

  await db.rpc("document_link_opened", { p_link_id: v.link_id });
  const logo = process.env.NEXT_PUBLIC_SUPABASE_URL ? logoUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, sellerOf(v).logoPath) : null;

  return <ClientDocument v={v} logo={logo} today={todayIn(v.timezone)} />;
}
