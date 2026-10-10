import type { Metadata } from "next";
import Link from "next/link";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { verifyLink } from "@/lib/email/links";

export const metadata: Metadata = {
  title: "Confirm your email address",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * "Confirm my email address", from the email a new trial's owner gets at
 * sign-up (20261010250000). Public: it is opened from an inbox, perhaps on
 * another device. The link's signature is checked on the server, and, as on
 * the unsubscribe page, opening it changes nothing (mail scanners open
 * links): the button confirms, which lets the company email its clients.
 */

function admin() {
  return createAdminClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function confirm(formData: FormData): Promise<boolean> {
  "use server";
  const org = verifyLink("confirm_email", String(formData.get("token") ?? ""));
  if (!org) return false;
  const { data, error } = await admin().rpc("confirm_company_email", { p_org: org });
  return !error && data === true;
}

export default async function ConfirmEmailPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const done = query.done === "1";
  const failed = query.failed === "1";
  const org = verifyLink("confirm_email", token);
  let company: string | null = null;
  if (org) {
    const { data } = await admin().from("organizations").select("name").eq("id", org).maybeSingle();
    company = data?.name?.trim() || null;
  }

  return (
    <main className="min-h-dvh bg-secondary/40 px-4 py-10">
      <div className="mx-auto w-full max-w-md space-y-4 rounded-xl bg-card p-6 ring-1 ring-foreground/10">
        {!org || !company ? (
          <>
            <h1 className="text-lg font-semibold text-foreground">This link does not work</h1>
            <p className="text-sm text-pretty text-muted-foreground">
              It may have been copied only in part. Use the button in the email itself, or send a new link from your
              dashboard.
            </p>
          </>
        ) : done ? (
          <>
            <h1 className="text-lg font-semibold text-foreground">Your email address is confirmed</h1>
            <p className="text-sm text-pretty text-muted-foreground">
              {company} can now email invoices, quotes, statements and job reports to clients.
            </p>
            <Link
              href="/"
              className="inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-transform hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.98]"
            >
              Open Tickd
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold text-foreground">Confirm your email address</h1>
            <p className="text-sm text-pretty text-muted-foreground">
              This confirms the address for {company}&apos;s Tickd account, so it can email clients.
            </p>
            {failed && (
              <p role="alert" className="text-sm text-destructive">
                That did not go through. Please try again in a moment.
              </p>
            )}
            <form
              action={async (fd) => {
                "use server";
                const ok = await confirm(fd);
                const { redirect } = await import("next/navigation");
                redirect(`/c/confirm/${encodeURIComponent(token)}?${ok ? "done=1" : "failed=1"}`);
              }}
            >
              <input type="hidden" name="token" value={token} />
              <button
                type="submit"
                className="inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-transform hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.98]"
              >
                Confirm my email address
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
