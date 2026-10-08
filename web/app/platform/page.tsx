import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { billingOverview, listCompanies } from "@/lib/platform";
import { STATUS_LABEL, formatRand, parseStatus } from "@/lib/billing";

/**
 * Platform operator: every company on the service.
 *
 * Lists every company; each links to its page, where the operator switches
 * modules (`setCompanyModule`, audit-logged) and manages its billing; "Add
 * company" creates one from industry templates (`companies/new`). Each row
 * shows the company's billing state and what its plan comes to a month, and
 * companies read-only for longer than `read_only_days` are listed as due for
 * deletion — the operator decides; nothing is deleted automatically.
 * Impersonation comes later.
 *
 * The gate is here, on the server, not in `proxy.ts`. The proxy's permission
 * map is about what a person may do *inside their own company*, and an
 * operator's access is not one of those permissions — a company's
 * Administrator holds `admin` and must still be refused. So the proxy only
 * insists on a session for this path, and the page asks the database
 * `is_platform_admin()` before it reads anything. Anyone else gets a 404, not a
 * 403: the page does not confirm that it exists.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Platform · Companies" };

const dateTime = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

export default async function PlatformPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isOperator, error } = await supabase.rpc("is_platform_admin");
  if (error) throw error;
  if (!isOperator) notFound();

  const [companies, billing] = await Promise.all([listCompanies(), billingOverview()]);
  const monthlyTotal = [...billing.monthlyCents.values()].reduce((a, b) => a + b, 0);
  const names = new Map(companies.map((c) => [c.id, c.name]));

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-foreground">Companies</h1>
          <p className="text-sm text-muted-foreground">
            Every company on the platform. Open one to switch its modules or manage its billing. Times are UTC.
          </p>
          <p className="text-sm text-foreground">Paying plans come to {formatRand(monthlyTotal)} a month.</p>
        </div>
        <Link
          href="/platform/companies/new"
          className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm text-primary-foreground hover:bg-primary/90"
        >
          Add company
        </Link>
      </header>

      {billing.dueForDeletion.length > 0 && (
        <section className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <h2 className="text-sm font-semibold text-foreground">Due for deletion</h2>
          <p className="text-sm text-muted-foreground">
            Read-only for longer than the retention period. Deleting a company cannot be undone; nothing here deletes automatically.
          </p>
          <ul className="text-sm">
            {billing.dueForDeletion.map((d) => (
              <li key={d.orgId}>
                <Link href={`/platform/companies/${d.orgId}`} className="hover:underline">
                  {names.get(d.orgId) ?? d.orgId}
                </Link>{" "}
                · read-only since {dateTime.format(new Date(d.since))}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Company</th>
              <th className="px-4 py-2 font-medium">Industry</th>
              <th className="px-4 py-2 font-medium">Billing</th>
              <th className="px-4 py-2 text-right font-medium">A month</th>
              <th className="px-4 py-2 text-right font-medium">Active users</th>
              <th className="px-4 py-2 text-right font-medium">Inactive</th>
              <th className="px-4 py-2 font-medium">Last workday started</th>
              <th className="px-4 py-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2">
                  <Link
                    href={`/platform/companies/${c.id}`}
                    className="font-medium text-foreground hover:underline"
                  >
                    {c.name}
                  </Link>
                  <div className="font-mono text-xs text-muted-foreground">{c.id}</div>
                </td>
                <td className="px-4 py-2">{c.industry ?? "—"}</td>
                <td className="px-4 py-2">
                  {billing.status.has(c.id) ? STATUS_LABEL[parseStatus(billing.status.get(c.id))] : "Outside the app"}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {billing.monthlyCents.has(c.id) ? formatRand(billing.monthlyCents.get(c.id)!) : "—"}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{c.activeUsers}</td>
                <td className="px-4 py-2 text-right tabular-nums">{c.inactiveUsers}</td>
                <td className="px-4 py-2">
                  {c.lastWorkdayAt ? dateTime.format(new Date(c.lastWorkdayAt)) : "Never"}
                </td>
                <td className="px-4 py-2">{dateTime.format(new Date(c.createdAt))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
