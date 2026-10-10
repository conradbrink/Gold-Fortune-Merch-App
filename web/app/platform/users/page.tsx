import Link from "next/link";
import { requireOperator } from "@/lib/operator";
import { listPlatformUsers } from "@/lib/platform";
import { filterUsers, readStatus, summarise } from "@/lib/platform-users";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";

/**
 * Platform operator: every person on the service, across companies.
 *
 * Gated like `/platform`: a session (the proxy), then `is_platform_admin()`
 * here before anything is read; anyone else gets a 404. The filters are a
 * plain GET form, so a filtered list is a URL that can be bookmarked.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Platform · Users" };

const dateTime = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

const date = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default async function PlatformUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireOperator("/platform/users");

  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const company = typeof params.company === "string" ? params.company : "";
  const status = readStatus(params.status);

  const users = await listPlatformUsers();
  const shown = filterUsers(users, { q, company: company || undefined, status });
  const totals = summarise(users, new Date());
  const filtered = Boolean(q || company || status);

  const companies = [
    ...new Map(
      users.filter((u) => u.companyId && u.companyName).map((u) => [u.companyId!, u.companyName!])
    ),
  ].sort((a, b) => a[1].localeCompare(b[1]));

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-foreground">Users</h1>
        <p className="text-sm text-muted-foreground">
          {plural(totals.people, "person", "people")} in {plural(companies.length, "company", "companies")}.{" "}
          {totals.active} active, and {totals.signedInThisWeek} signed in during the last 7 days.
          {totals.noCompany > 0 &&
            ` ${plural(totals.noCompany, "login belongs", "logins belong")} to no company.`}{" "}
          Times are UTC.
        </p>
      </header>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1 space-y-1.5">
          <Label htmlFor="q">Search</Label>
          <Input id="q" name="q" type="search" defaultValue={q} placeholder="Name, email, phone or company" />
        </div>
        <div className="w-48 space-y-1.5">
          <Label htmlFor="company">Company</Label>
          <NativeSelect id="company" name="company" defaultValue={company}>
            <option value="">All companies</option>
            {companies.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="w-40 space-y-1.5">
          <Label htmlFor="status">Status</Label>
          <NativeSelect id="status" name="status" defaultValue={status ?? ""}>
            <option value="">Everyone</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="no-company">No company</option>
          </NativeSelect>
        </div>
        <Button type="submit">Filter</Button>
        {filtered && (
          <Link href="/platform/users" className="inline-flex h-8 items-center text-sm text-muted-foreground hover:underline">
            Clear filters
          </Link>
        )}
      </form>

      {filtered && (
        <p className="text-sm text-muted-foreground">
          Showing {shown.length} of {users.length}.
        </p>
      )}

      {shown.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          {users.length === 0 ? (
            "Nobody has a login yet."
          ) : (
            <>
              Nobody matches these filters.{" "}
              <Link href="/platform/users" className="text-foreground underline">
                Clear filters
              </Link>
            </>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Signs in with</th>
                <th className="px-4 py-2 font-medium">Company</th>
                <th className="px-4 py-2 font-medium">Role</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Last sign-in</th>
                <th className="px-4 py-2 font-medium">Added</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => (
                <tr
                  key={u.id}
                  className={`border-b border-border last:border-0 ${u.isActive === true ? "" : "text-muted-foreground"}`}
                >
                  <td className="px-4 py-2">
                    <div className="font-medium">
                      {u.name ?? "No name"}
                      {u.id === user.id && <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span>}
                    </div>
                    {u.jobTitle && <div className="text-xs text-muted-foreground">{u.jobTitle}</div>}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">{u.login ?? "Not set"}</td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {u.companyId ? (
                      <Link href={`/platform/companies/${u.companyId}`} className="hover:underline">
                        {u.companyName ?? u.companyId}
                      </Link>
                    ) : (
                      "No company"
                    )}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">{u.role ?? "Not set"}</td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {u.isActive === true ? "Active" : u.isActive === false ? "Inactive" : "No profile"}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap tabular-nums">
                    {u.lastSignInAt ? dateTime.format(new Date(u.lastSignInAt)) : "Never"}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap tabular-nums">{date.format(new Date(u.createdAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
