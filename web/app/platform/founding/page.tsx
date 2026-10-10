import Link from "next/link";
import { requireOperator } from "@/lib/operator";
import { listTemplates, platformAdminClient } from "@/lib/platform";
import { HOW_RUN_LABEL, checkAttribution, describeAttribution, type HowRun } from "@/lib/founding";
import { linkFoundingApplication } from "@/app/platform/actions";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";

/**
 * Platform operator: the Founding 10 applications, newest first, in one list.
 *
 * They arrive from the sales site's /founding form and are also emailed to the
 * owner. Once the operator has made a company for an applicant, they link the
 * two here (`linkFoundingApplication`, audit-logged), which is what lets the
 * Acquisition pages follow a visitor from the advert to a company. The operator gate is the same as the companies page:
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

export default async function FoundingApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireOperator("/platform/founding");

  const admin = platformAdminClient();
  const [{ data: rows, error: listError }, { data: left }, templates, { data: orgs, error: orgError }] = await Promise.all([
    admin.from("founding_applications").select("*").order("created_at", { ascending: false }),
    admin.rpc("founding_spots_left"),
    listTemplates().catch(() => []),
    admin.from("organizations").select("id, name").order("name"),
  ]);
  if (listError) throw listError;
  if (orgError) throw orgError;
  const companies = orgs ?? [];
  const companyName = new Map(companies.map((c) => [c.id, c.name]));
  const linked = new Set((rows ?? []).map((r) => r.organization_id).filter(Boolean));
  const params = await searchParams;
  const problem = typeof params.error === "string" ? params.error : null;
  const trade = (code: string) => templates.find((t) => t.code === code)?.name ?? code;
  const applications = rows ?? [];

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-foreground">Founding applications</h1>
        <p className="text-sm text-muted-foreground">
          {applications.length} so far. The site shows {typeof left === "number" ? `${left} of 10` : "?"} spots left. Change it
          in platform_settings, key founding_spots_left. Times are UTC.
        </p>
      </header>

      {problem && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {problem}
        </p>
      )}

      {applications.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">No applications yet.</p>
      ) : (
        <ul className="space-y-3">
          {applications.map((a) => (
            <li key={a.id} id={a.id} className="scroll-mt-4 space-y-3 rounded-lg border border-border bg-card p-4 text-sm">
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
                  <dt className="text-muted-foreground">How they found us</dt>
                  <dd>{describeAttribution(checkAttribution(a.attribution)) ?? "not known"}</dd>
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
              <form action={linkFoundingApplication} className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                <input type="hidden" name="applicationId" value={a.id} />
                {a.organization_id ? (
                  <>
                    <span className="text-muted-foreground">Company:</span>
                    <Link href={`/platform/companies/${a.organization_id}`} className="font-medium hover:underline">
                      {companyName.get(a.organization_id) ?? a.organization_id}
                    </Link>
                    <input type="hidden" name="orgId" value="" />
                    <Button type="submit" variant="ghost" size="sm">
                      Unlink
                    </Button>
                  </>
                ) : (
                  <>
                    <label htmlFor={`org-${a.id}`} className="text-muted-foreground">
                      Company made from this application:
                    </label>
                    <div className="w-64">
                      <NativeSelect id={`org-${a.id}`} name="orgId" required defaultValue="">
                        <option value="" disabled>
                          Choose a company
                        </option>
                        {companies
                          .filter((c) => !linked.has(c.id))
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                      </NativeSelect>
                    </div>
                    <Button type="submit" variant="outline" size="sm">
                      Link
                    </Button>
                  </>
                )}
              </form>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
