import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCompany } from "@/lib/platform";
import { setCompanyModule } from "@/app/platform/actions";

/**
 * Platform operator: one company's modules, switchable.
 *
 * Gated like `/platform`: a session is required by the proxy, and
 * `is_platform_admin()` is asked here before anything is read; everyone else
 * gets a 404. The switches post to `setCompanyModule`, which checks again —
 * this page hiding them is not what protects them.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Platform · Company modules" };

const dateTime = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

export default async function PlatformCompanyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: isOperator, error } = await supabase.rpc("is_platform_admin");
  if (error) throw error;
  if (!isOperator) notFound();

  const { id } = await params;
  // Not a company id at all: a 404, not a database cast error and a 500.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const company = await getCompany(id);
  if (!company) notFound();

  const raw = (await searchParams).error;
  const refusal = typeof raw === "string" ? raw : null;

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-8">
      <header className="space-y-1">
        <Link href="/platform" className="text-sm text-muted-foreground hover:underline">
          ← Companies
        </Link>
        <h1 className="text-2xl font-bold text-foreground">{company.name}</h1>
        {company.industries.length > 0 && (
          <p className="text-sm text-foreground">
            {company.industries
              .map((i) => (i.version === null ? i.name : `${i.name} (v${i.version})`))
              .join(" + ")}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          Modules switched here take effect on the company&apos;s next page load,
          and on phones at their next refresh. Every change is logged.
        </p>
      </header>

      {refusal && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Not changed: {refusal}
        </p>
      )}

      <ul className="divide-y divide-border rounded-lg border border-border bg-card">
        {company.modules.map((m) => (
          <li key={m.code} className="flex items-start justify-between gap-4 p-4">
            <div className="space-y-1">
              <p className="font-medium text-foreground">
                {m.name}{" "}
                <span className="text-xs font-normal text-muted-foreground">({m.planType})</span>
              </p>
              <p className="text-sm text-muted-foreground">{m.description}</p>
              {m.requires.length > 0 && (
                <p className="text-xs text-muted-foreground">Needs: {m.requires.join(", ")}</p>
              )}
            </div>
            <div className="shrink-0">
              {m.planType === "core" ? (
                <span className="text-sm text-muted-foreground">Always on</span>
              ) : !m.isBuilt ? (
                <span className="text-sm text-muted-foreground">Not built yet</span>
              ) : (
                <form action={setCompanyModule}>
                  <input type="hidden" name="orgId" value={company.id} />
                  <input type="hidden" name="module" value={m.code} />
                  <input type="hidden" name="enabled" value={m.enabled ? "false" : "true"} />
                  <button
                    type="submit"
                    className={
                      m.enabled
                        ? "inline-flex h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-secondary"
                        : "inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm text-primary-foreground hover:bg-primary/90"
                    }
                  >
                    {m.enabled ? "On · switch off" : "Off · switch on"}
                  </button>
                </form>
              )}
            </div>
          </li>
        ))}
      </ul>

      {company.recentChanges.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">Recent changes (UTC)</h2>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {company.recentChanges.map((c, i) => (
              <li key={i}>
                {dateTime.format(new Date(c.createdAt))} · {c.action} ·{" "}
                {JSON.stringify(c.detail)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
