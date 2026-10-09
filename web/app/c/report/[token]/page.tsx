import type { Metadata } from "next";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { verifyLink } from "@/lib/email/links";
import { logoUrl } from "@/lib/branding";
import { ClientReport, type View } from "@/components/client-report/client-report";

export const metadata: Metadata = {
  title: "Job report",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * A finished job's report, for the company's client (Stage 8.3): who did it,
 * when, whether they checked in on site, every checklist answer and the
 * photos, then the client's signature. Public: the client has no login. The
 * link is the report's id signed by the server; it stops working when the
 * report expires or is withdrawn. Photos are shown through links that last an
 * hour.
 */

function admin() {
  return createAdminClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export default async function ClientReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const id = verifyLink("report", token);
  const db = admin();
  const { data } = id ? await db.rpc("job_report_view", { p_report_id: id }) : { data: null };
  const v = data as View | null;

  if (!v) {
    return (
      <main className="min-h-dvh bg-secondary/40 px-4 py-10">
        <div className="mx-auto w-full max-w-md space-y-2 rounded-xl bg-card p-6 ring-1 ring-foreground/10">
          <h1 className="text-lg font-semibold text-foreground">This report link does not work</h1>
          <p className="text-sm text-pretty text-muted-foreground">
            It may have expired or been withdrawn, or only part of it was copied. Ask the company that sent it for a new one.
          </p>
        </div>
      </main>
    );
  }

  await db.rpc("job_report_opened", { p_report_id: v.report_id });
  const paths = [...new Set([...v.photos.map((p) => p.path), ...v.checklists.flatMap((c) => c.answers.map((a) => a.photo_path).filter((p): p is string => !!p))])];
  const signed = new Map<string, string>();
  if (paths.length) {
    const { data: urls } = await db.storage.from("visit-photos").createSignedUrls(paths, 3600);
    for (const u of urls ?? []) if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
  }
  const logo = process.env.NEXT_PUBLIC_SUPABASE_URL ? logoUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, v.company?.logo_path ?? null) : null;

  return <ClientReport v={v} signed={signed} logo={logo} token={token} />;
}
