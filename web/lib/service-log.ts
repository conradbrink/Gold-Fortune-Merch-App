import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { DateRange } from "@/lib/date-range";
import type { ExportSheet } from "@/lib/export";
import { lower, type Terms } from "@/lib/terms";
import { fileSlug } from "@/lib/export-filename";
import { drawMoneyPdf } from "@/lib/money-pdf";
import { fetchQuoteSeller } from "@/lib/quotes";

/**
 * Proof of service: every finished {job} in a period, per {site}, with what
 * shows it happened (who, in and out, on site or not, forms, photos). The
 * report a client asks for ("prove you were there"), and the one the industry
 * research calls the most valuable outside distribution. `service_log()`.
 */
export type ServiceLogRow = Database["public"]["Functions"]["service_log"]["Returns"][number];

export async function fetchServiceLog(
  supabase: SupabaseClient<Database>,
  range: DateRange,
  storeId: string | null
): Promise<ServiceLogRow[]> {
  const { data, error } = await supabase.rpc("service_log", {
    p_from: range.from.toISOString(),
    p_to: range.to.toISOString(),
    p_store_id: storeId,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export type ServiceLogTotals = {
  jobs: number;
  /** Check-ins within the place's radius, and those with a GPS fix at all. */
  onSite: number;
  withFix: number;
  photos: number;
  forms: number;
  minutes: number;
  places: number;
  /** The longest time between two check-ins at one place on one day, in minutes. */
  longestGap: number | null;
};

export function serviceLogTotals(rows: readonly ServiceLogRow[]): ServiceLogTotals {
  const places = new Set<string>();
  const t: ServiceLogTotals = { jobs: 0, onSite: 0, withFix: 0, photos: 0, forms: 0, minutes: 0, places: 0, longestGap: null };
  for (const r of rows) {
    t.jobs += 1;
    places.add(r.store_id);
    if (r.on_site !== null) t.withFix += 1;
    if (r.on_site) t.onSite += 1;
    t.photos += r.photos;
    t.forms += r.forms;
    t.minutes += r.minutes ?? 0;
    if (r.gap_minutes !== null && (t.longestGap === null || r.gap_minutes > t.longestGap)) t.longestGap = r.gap_minutes;
  }
  t.places = places.size;
  return t;
}

/** "On site", "Away", or "No GPS" when the phone had no fix: unknown, never a fail. */
export function onSiteLabel(v: boolean | null): string {
  return v === null ? "No GPS" : v ? "On site" : "Away";
}

/** "2 h 05" for 125 minutes; "45 min" under an hour. */
export function minutesLabel(m: number | null): string {
  if (m === null) return "-";
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}

const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "";

export function serviceLogSheet(rows: readonly ServiceLogRow[], t: Terms, context: string[]): ExportSheet {
  return {
    title: "Proof of service",
    filename: "proof-of-service",
    context,
    columns: [
      { header: t.site.one, key: "site" },
      { header: "Date", key: "day" },
      { header: t.staff.one, key: "staff" },
      { header: "In", key: "in" },
      { header: "Out", key: "out" },
      { header: "Minutes", key: "minutes", numeric: true },
      { header: "GPS", key: "gps" },
      { header: "Forms", key: "forms", numeric: true },
      { header: "Photos", key: "photos", numeric: true },
      { header: "Planned", key: "planned" },
      { header: "Minutes since the last check-in", key: "gap", numeric: true },
    ],
    rows: rows.map((r) => ({
      site: r.store_name,
      day: r.day,
      staff: r.staff_name ?? "",
      in: time(r.checkin_at),
      out: time(r.checkout_at),
      minutes: r.minutes ?? "",
      gps: onSiteLabel(r.on_site),
      forms: r.forms,
      photos: r.photos,
      planned: r.planned ? "Yes" : "No",
      gap: r.gap_minutes ?? "",
    })),
  };
}

/**
 * One {site}'s proof of service as a PDF on the company's own letterhead, to
 * send to the client. The rows must all be the one {site}'s.
 */
export async function downloadServiceLogPdf(
  supabase: SupabaseClient<Database>,
  rows: readonly ServiceLogRow[],
  period: { from: string; to: string },
  t: Terms
) {
  const first = rows[0];
  if (!first) return;
  const seller = await fetchQuoteSeller(supabase);
  const totals = serviceLogTotals(rows);
  await drawMoneyPdf({
    heading: "PROOF OF SERVICE",
    fileName: `${fileSlug(first.store_name)} proof of service ${period.from} to ${period.to}`,
    seller: {
      name: seller.legal_name || seller.name,
      address: seller.address,
      registrationNumber: seller.registration_number,
      taxNumber: seller.tax_number,
      vatNumber: seller.vat_number,
      phone: seller.phone,
      email: seller.support_email,
      logoPath: seller.logo_path,
    },
    meta: [
      ["From", period.from],
      ["To", period.to],
    ],
    billTo: { label: "FOR", name: first.store_name, address: first.store_address },
    head: ["Date", t.staff.one, "In", "Out", "Minutes", "GPS", "Forms", "Photos"],
    numeric: [4, 6, 7],
    rows: rows.map((r) => [
      r.day,
      r.staff_name ?? "",
      time(r.checkin_at),
      time(r.checkout_at),
      r.minutes === null ? "" : String(r.minutes),
      onSiteLabel(r.on_site),
      String(r.forms),
      String(r.photos),
    ]),
    totals: [
      [`${t.job.many} done`, String(totals.jobs)],
      ["Checked in on site", `${totals.onSite} of ${totals.withFix}`],
      ["Photos", String(totals.photos)],
      ["Hours on site", (Math.round(totals.minutes / 6) / 10).toLocaleString("en-GB")],
    ],
    notes: [
      `"On site" means the check-in was within the ${lower(t.site.one)}'s radius. "No GPS" means the phone had no position at check-in.`,
    ],
  });
}
