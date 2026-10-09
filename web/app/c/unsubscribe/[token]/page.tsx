import type { Metadata } from "next";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { verifyLink } from "@/lib/email/links";

export const metadata: Metadata = {
  title: "Stop these emails",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * "Stop these emails", from the foot of an email to a company's client
 * (Stage 8.1). Public: the person has no login. The link's signature is
 * checked on the server; opening the page changes nothing (mail scanners open
 * links), and the button stops that company emailing this address
 * (`unsubscribe_message`), which is the person's choice under POPIA.
 */

function admin() {
  return createAdminClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Whether the address is now suppressed. */
async function stop(formData: FormData): Promise<boolean> {
  "use server";
  const id = verifyLink("unsubscribe", String(formData.get("token") ?? ""));
  if (!id) return false;
  const { error } = await admin().rpc("unsubscribe_message", { p_message_id: id });
  return !error;
}

export default async function UnsubscribePage({
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
  const id = verifyLink("unsubscribe", token);
  let company: string | null = null;
  let address: string | null = null;
  if (id) {
    const db = admin();
    const { data: row } = await db.from("message_outbox").select("to_address, org_id").eq("id", id).maybeSingle();
    address = row?.to_address ?? null;
    if (row?.org_id) {
      const { data: org } = await db.from("organizations").select("name").eq("id", row.org_id).maybeSingle();
      company = org?.name?.trim() || null;
    }
  }

  return (
    <main className="min-h-dvh bg-secondary/40 px-4 py-10">
      <div className="mx-auto w-full max-w-md space-y-4 rounded-xl bg-card p-6 ring-1 ring-foreground/10">
        {!id || !address ? (
          <>
            <h1 className="text-lg font-semibold text-foreground">This link does not work</h1>
            <p className="text-sm text-pretty text-muted-foreground">
              It may have been copied only in part. Use the link at the foot of the email itself.
            </p>
          </>
        ) : done ? (
          <>
            <h1 className="text-lg font-semibold text-foreground">You will not get these emails again</h1>
            <p className="text-sm text-pretty text-muted-foreground">
              {company ?? "The company"} will no longer email {address} through Tickd. To hear from them again, ask them
              directly.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold text-foreground">Stop emails from {company ?? "this company"}?</h1>
            <p className="text-sm text-pretty text-muted-foreground">
              {address} will no longer get reports or updates from {company ?? "them"} sent through Tickd.
            </p>
            {failed && (
              <p role="alert" className="text-sm text-destructive">
                That did not go through. Please try again in a moment.
              </p>
            )}
            <form
              action={async (fd) => {
                "use server";
                const ok = await stop(fd);
                const { redirect } = await import("next/navigation");
                redirect(`/c/unsubscribe/${encodeURIComponent(token)}?${ok ? "done=1" : "failed=1"}`);
              }}
            >
              <input type="hidden" name="token" value={token} />
              <button
                type="submit"
                className="inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-transform hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.98]"
              >
                Stop these emails
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
