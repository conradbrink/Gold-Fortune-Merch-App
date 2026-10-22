import { redirect } from "next/navigation";
import { settingsPathFromQuery } from "@/lib/settings-tabs";

/**
 * Company settings was one page of six tabs until 22 Oct 2026; it is now
 * Settings, four pages of their own (`lib/settings-tabs.ts`). This address
 * stays for the links already out there: `?tab=operations` opens Team &
 * Work, `?tab=money` the page nearest to what it held, and so on.
 */
export default async function CompanySettingsRedirect({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const tab = (await searchParams).tab;
  redirect(settingsPathFromQuery(typeof tab === "string" ? tab : null));
}
