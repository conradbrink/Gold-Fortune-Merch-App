import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listTemplates, platformAdminClient } from "@/lib/platform";
import { HOW_RUN_LABEL, type HowRun } from "@/lib/founding";

/**
 * Platform operator: the Founding 10 applications, newest first, in one list.
 *
 * Read only. They arrive from the sales site's /founding form and are also
 * emailed to the owner. The operator gate is the same as the companies page:
 * a session, then `is_platform_admin()`, and a 404 for anyone else. The spots
 * the site shows ("10 of 10 spots left") are one setting, shown here but
 * changed by the owner by hand: platform_settings `founding_spots_left`.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Platform · Founding applications" };

const dateTime = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

const yn = (b: boolean) => (b ? "Yes" : "No");

export default async function FoundingApplicationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isOperator, error } = await supabase.rpc("is_platform_admin");
  if (error) throw error;
  if (!isOperator) notFound();

  const admin = platformAdminClient();
  const [{ data: rows, error: listError }, { data: left }, templates] = await Promise.all([
    admin.from("founding_applications").select("*").order("created_at", { ascending: false }),
    admin.rpc("founding_spots_left"),
    listTemplates().catch(() => []),
  ]);
  if (listError) throw listError;
  const trade = (code: string) => templates.find((t) => t.code === code)?.name ?? code;
  const applications = rows ?? [];

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
      <header className="space-y-1">
        <Link href="/platform" className="text-sm text-muted-foreground hover:underline">
          ← Companies
        </Link>
        <h1 className="text-2xl font-bold text-foreground">Founding applications</h1>
        <p className="text-sm text-muted-foreground">
          {applications.length} so far. The site shows {typeof left === "number" ? `${left} of 10` : "?"} spots left. Change it
          in platform_settings, key founding_spots_left. Times are UTC.
        </p>
      </header>

      {applications.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">No applications yet.</p>
      ) : (
        <ul className="space-y-3">
          {applications.map((a) => (
            <li key={a.id} className="space-y-3 rounded-lg border border-border bg-card p-4 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-base font-semibold text-foreground">
                  {a.business_name} <span className="font-normal text-muted-foreground">· {a.name}</span>
                </p>
                <p className="text-muted-foreground">
                  {dateTime.format(new Date(a.created_at))} · <span className="font-medium text-foreground">{a.status}</span>
                  {a.notified_at ? "" : " · email not sent"}
                </p>
              </div>
              <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground">WhatsApp</dt>
                  <dd>
                    <a className="underline" href={`https://wa.me/${a.whatsapp}`} target="_blank" rel="noreferrer">
                      +{a.whatsapp}
                    </a>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Type of work</dt>
                  <dd>{trade(a.trade)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">People in the field</dt>
                  <dd>{a.team_size}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Town or city</dt>
                  <dd>{a.town}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Runs jobs on</dt>
                  <dd>{HOW_RUN_LABEL[a.how_run as HowRun] ?? a.how_run}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Came from</dt>
                  <dd>{a.source ?? "not known"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Whole team, every workday</dt>
                  <dd>{yn(a.whole_team)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Video and Google review</dt>
                  <dd>{yn(a.video_review)}</dd>
                </div>
              </dl>
              <p>
                <span className="text-muted-foreground">Costs them the most: </span>
                <span className="whitespace-pre-wrap">{a.biggest_cost}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
