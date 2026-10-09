import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { DateRange } from "@/lib/date-range";
import type { ExportSheet } from "@/lib/export";
import { lower, type Terms } from "@/lib/terms";
import { companyTime } from "@/lib/company-time";
import { allPages } from "@/lib/all-pages";

/**
 * The vehicle logbook: which vehicle each person drove on a company day,
 * business or private, beside the kilometres Tickd measured along the roads
 * for that person that day (`vehicle_logbook()`). The office assigns the
 * vehicles for now; the phone will, with the odometer, from app 1.2.0.
 *
 * The vehicles are `logbook_vehicles`, not the warehouse's delivery fleet.
 */

type Client = SupabaseClient<Database>;

export type LogbookVehicle = Database["public"]["Tables"]["logbook_vehicles"]["Row"];
export type LogbookRow = Database["public"]["Functions"]["vehicle_logbook"]["Returns"][number];
export type Purpose = "business" | "private";
export type Driver = { id: string; full_name: string | null };

/**
 * The database's refusals, in words a person can act on. The check and unique
 * constraints are named by Postgres; anything else keeps its own message.
 */
export function logbookError(error: { code?: string; message: string }, what: "vehicle" | "day"): string {
  if (error.code === "23505") {
    return what === "vehicle"
      ? "A vehicle with that registration is already on the list."
      : "That vehicle is already in the logbook for this person on that day.";
  }
  if (error.code === "23514" && /odometer_order/.test(error.message)) {
    return "The closing odometer is below the opening one.";
  }
  if (error.code === "23514") return "Check the values: one of them is out of range.";
  return error.message;
}

function fail(error: { code?: string; message: string } | null, what: "vehicle" | "day") {
  if (error) throw new Error(logbookError(error, what));
}

export async function fetchVehicles(supabase: Client): Promise<LogbookVehicle[]> {
  const { data, error } = await supabase
    .from("logbook_vehicles")
    .select("*")
    .order("active", { ascending: false })
    .order("name")
    .order("id");
  fail(error, "vehicle");
  return data ?? [];
}

export type VehicleInput = { name: string; registration: string; notes: string; active: boolean };

/** What is wrong with a vehicle as typed, or null. */
export function vehicleProblem(v: VehicleInput): string | null {
  if (v.name.trim() === "") return "A vehicle needs a name, like \"Silver Hilux\".";
  if (v.name.trim().length > 80) return "A name is up to 80 characters.";
  if (v.registration.trim() === "") return "A vehicle needs its registration number.";
  if (v.registration.trim().length > 20) return "A registration is up to 20 characters.";
  if (v.notes.length > 1000) return "Notes are up to 1,000 characters.";
  return null;
}

/** Registrations are written the way the plate reads: capitals, single spaces. */
export function normaliseRegistration(text: string): string {
  return text.trim().replace(/\s+/g, " ").toUpperCase();
}

export async function createVehicle(supabase: Client, orgId: string, v: VehicleInput): Promise<void> {
  const { error } = await supabase.from("logbook_vehicles").insert({
    org_id: orgId,
    name: v.name.trim(),
    registration: normaliseRegistration(v.registration),
    notes: v.notes.trim() || null,
    active: v.active,
  });
  fail(error, "vehicle");
}

export async function updateVehicle(supabase: Client, id: string, v: VehicleInput): Promise<void> {
  const { error } = await supabase
    .from("logbook_vehicles")
    .update({
      name: v.name.trim(),
      registration: normaliseRegistration(v.registration),
      notes: v.notes.trim() || null,
      active: v.active,
    })
    .eq("id", id);
  fail(error, "vehicle");
}

export async function setVehicleActive(supabase: Client, id: string, active: boolean): Promise<void> {
  const { error } = await supabase.from("logbook_vehicles").update({ active }).eq("id", id);
  fail(error, "vehicle");
}

/** Everyone active in the company, by name: anyone may drive. */
export async function fetchDrivers(supabase: Client): Promise<Driver[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("is_active", true)
    .order("full_name")
    .order("id");
  fail(error, "day");
  return (data ?? []) as Driver[];
}

/** The logbook's rows for a period of company days, in date order. */
export async function fetchLogbook(supabase: Client, range: DateRange, vehicleId: string | null): Promise<LogbookRow[]> {
  const rows = await allPages((from, to) =>
    supabase
      .rpc("vehicle_logbook", {
        p_from: range.from.toISOString(),
        p_to: range.to.toISOString(),
        p_vehicle_id: vehicleId,
      })
      .order("day")
      .order("vehicle_name")
      .order("vehicle_day_id")
      .range(from, to)
  );
  return rows.map((r) => ({ ...r, km: r.km === null ? null : Number(r.km) }));
}

export type DayInput = {
  day: string;
  vehicleId: string;
  driverId: string;
  purpose: Purpose;
  /** As typed: blank is "not read". */
  odometerStart: string;
  odometerEnd: string;
  notes: string;
};

/** A whole number of kilometres on the clock, or null for blank. NaN for anything else. */
export function parseOdometer(text: string): number | null {
  const t = text.trim().replace(/[\s,]/g, "");
  if (t === "") return null;
  return /^\d{1,7}$/.test(t) ? Number(t) : NaN;
}

/** What is wrong with a vehicle day as typed, or null. */
export function dayProblem(d: DayInput, t: Terms): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.day)) return "Pick the date.";
  if (!d.vehicleId) return "Pick the vehicle.";
  if (!d.driverId) return `Pick the ${lower(t.staff.one)} who drove it.`;
  const start = parseOdometer(d.odometerStart);
  const end = parseOdometer(d.odometerEnd);
  if (Number.isNaN(start) || Number.isNaN(end)) return "An odometer reading is a whole number of kilometres.";
  if (start !== null && end !== null && end < start) return "The closing odometer is below the opening one.";
  if (d.notes.length > 500) return "Notes are up to 500 characters.";
  return null;
}

function dayRow(d: DayInput) {
  return {
    day: d.day,
    vehicle_id: d.vehicleId,
    profile_id: d.driverId,
    purpose: d.purpose,
    odometer_start: parseOdometer(d.odometerStart),
    odometer_end: parseOdometer(d.odometerEnd),
    notes: d.notes.trim() || null,
  };
}

export async function createVehicleDay(supabase: Client, orgId: string, d: DayInput): Promise<void> {
  const { error } = await supabase.from("vehicle_days").insert({ org_id: orgId, ...dayRow(d) });
  fail(error, "day");
}

export async function updateVehicleDay(supabase: Client, id: string, d: DayInput): Promise<void> {
  const { error } = await supabase.from("vehicle_days").update(dayRow(d)).eq("id", id);
  fail(error, "day");
}

export async function deleteVehicleDay(supabase: Client, id: string): Promise<void> {
  const { error } = await supabase.from("vehicle_days").delete().eq("id", id);
  fail(error, "day");
}

/** A row back into the form, to change it. */
export function dayInputOf(r: LogbookRow): DayInput {
  return {
    day: r.day,
    vehicleId: r.vehicle_id,
    driverId: r.driver_id,
    purpose: r.purpose === "private" ? "private" : "business",
    odometerStart: r.odometer_start === null ? "" : String(r.odometer_start),
    odometerEnd: r.odometer_end === null ? "" : String(r.odometer_end),
    notes: r.notes ?? "",
  };
}

/** Kilometres on the clock for the day, when both readings are there. */
export function odometerKm(r: Pick<LogbookRow, "odometer_start" | "odometer_end">): number | null {
  return r.odometer_start !== null && r.odometer_end !== null ? r.odometer_end - r.odometer_start : null;
}

export type LogbookTotals = {
  days: number;
  vehicles: number;
  businessKm: number;
  privateKm: number;
  /** Days with no measured road distance yet: no workday, still open, or not measured overnight. */
  unmeasured: number;
};

export function logbookTotals(rows: readonly LogbookRow[]): LogbookTotals {
  const vehicles = new Set<string>();
  const t: LogbookTotals = { days: 0, vehicles: 0, businessKm: 0, privateKm: 0, unmeasured: 0 };
  for (const r of rows) {
    vehicles.add(r.vehicle_id);
    t.days += 1;
    if (r.km === null) t.unmeasured += 1;
    else if (r.purpose === "private") t.privateKm += r.km;
    else t.businessKm += r.km;
  }
  t.vehicles = vehicles.size;
  t.businessKm = Math.round(t.businessKm * 10) / 10;
  t.privateKm = Math.round(t.privateKm * 10) / 10;
  return t;
}

/** Why a day has no km: said in words, never left as a blank that reads as zero. */
export function kmNote(r: Pick<LogbookRow, "km" | "first_in" | "last_out">): string {
  if (r.km !== null) return "";
  if (!r.first_in) return "No workday started";
  if (!r.last_out) return "Workday still open";
  return "Not measured yet";
}

export const purposeLabel = (p: string) => (p === "private" ? "Private" : "Business");

/** "1,026" for an odometer reading; "" for none. */
const reading = (n: number | null) => (n === null ? "" : n);

/**
 * The logbook as a travel logbook is kept on paper: one line per vehicle-day,
 * date first, the opening and closing odometer when they were read, the
 * kilometres, the purpose, and the hours the trip ran. The business and
 * private totals go above the table, which is where a tax practitioner looks
 * for them. Times are the company's clock, like the dates.
 */
export function logbookSheet(rows: readonly LogbookRow[], context: string[], timeZone: string): ExportSheet {
  const time = (iso: string | null) => companyTime(iso, timeZone);
  const totals = logbookTotals(rows);
  const summary = [
    `Business km: ${totals.businessKm}`,
    `Private km: ${totals.privateKm}`,
    `Total km: ${Math.round((totals.businessKm + totals.privateKm) * 10) / 10}`,
    ...(totals.unmeasured > 0
      ? [`${totals.unmeasured} ${totals.unmeasured === 1 ? "day has" : "days have"} no measured distance yet`]
      : []),
  ].join(", ");
  return {
    title: "Vehicle logbook",
    filename: "vehicle-logbook",
    context: [...context, summary],
    columns: [
      { header: "Date", key: "day" },
      { header: "Vehicle", key: "vehicle" },
      { header: "Registration", key: "registration" },
      { header: "Driver", key: "driver" },
      { header: "Purpose", key: "purpose" },
      { header: "Opening odometer", key: "odoStart", numeric: true },
      { header: "Closing odometer", key: "odoEnd", numeric: true },
      { header: "Km", key: "km", numeric: true },
      { header: "From", key: "from" },
      { header: "To", key: "to" },
      { header: "Notes", key: "notes" },
    ],
    rows: rows.map((r) => ({
      day: r.day,
      vehicle: r.vehicle_name,
      registration: r.registration,
      driver: r.driver_name ?? "",
      purpose: purposeLabel(r.purpose),
      odoStart: reading(r.odometer_start),
      odoEnd: reading(r.odometer_end),
      km: r.km ?? "",
      from: time(r.first_in),
      to: time(r.last_out),
      notes: [kmNote(r), r.notes].filter(Boolean).join(". "),
    })),
  };
}

/** Today's date on the company's calendar, for the form's default. */
export function companyToday(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
