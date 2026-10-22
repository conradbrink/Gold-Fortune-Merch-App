import { redirect } from "next/navigation";

/**
 * Plan and billing is Settings > Plan since 22 Oct 2026. This address stays
 * for the links already out there (emails, bookmarks, Paystack's way back),
 * and keeps what they carry (`?checkout=paid`, `?card=updated`).
 */
export default async function BillingRedirect({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, v);
  }
  const query = params.toString();
  redirect(query ? `/settings/plan?${query}` : "/settings/plan");
}
