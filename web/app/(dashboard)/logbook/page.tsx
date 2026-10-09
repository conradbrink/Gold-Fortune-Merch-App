"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Car, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { ExportMenu } from "@/components/export-menu";
import { ErrorBanner, EmptyRow } from "@/components/warehouse/stat-tile";
import { fetchOrgId } from "@/lib/representatives";
import { companyRange, companyTime } from "@/lib/company-time";
import { rangeForPreset, toLocalDateInput, type DateRange } from "@/lib/date-range";
import { getCompanyConfig, useTerms } from "@/lib/use-company-config";
import { lower, withArticle } from "@/lib/terms";
import {
  companyToday,
  createVehicleDay,
  dayInputOf,
  dayProblem,
  deleteVehicleDay,
  fetchDrivers,
  fetchLogbook,
  fetchVehicles,
  kmNote,
  logbookSheet,
  logbookTotals,
  purposeLabel,
  updateVehicleDay,
  type DayInput,
  type Driver,
  type LogbookRow,
  type LogbookVehicle,
} from "@/lib/vehicle-logbook";

const blank = (day: string): DayInput => ({
  day,
  vehicleId: "",
  driverId: "",
  purpose: "business",
  odometerStart: "",
  odometerEnd: "",
  notes: "",
});

/** The day before an exclusive end, for the export's heading. */
function dayBefore(exclusiveEnd: Date): Date {
  const d = new Date(exclusiveEnd);
  d.setDate(d.getDate() - 1);
  return d;
}

/**
 * The travel logbook: who drove which vehicle on which day, and how far, from
 * the road distance Tickd measures for each person's workday. The office puts
 * a vehicle in the logbook for a day here; the business and private totals
 * and the export are what a tax return asks for.
 */
export default function LogbookPage() {
  const supabase = createClient();
  const t = useTerms();
  const [range, setRange] = useState<DateRange>(() => rangeForPreset("30d"));
  const [vehicleFilter, setVehicleFilter] = useState("");
  const [rows, setRows] = useState<LogbookRow[]>([]);
  const [vehicles, setVehicles] = useState<LogbookVehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [timeZone, setTimeZone] = useState("UTC");
  const [draft, setDraft] = useState<DayInput>(() => blank(toLocalDateInput(new Date())));
  const [editing, setEditing] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Only the newest load may write: an older range returning late must not win. */
  const loadSeq = useRef(0);
  /** The form, brought into view when a row below is opened to change. */
  const formRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const runId = ++loadSeq.current;
    const isStale = () => runId !== loadSeq.current;
    setLoading(true);
    try {
      const cfg = await getCompanyConfig();
      if (!cfg) throw new Error("Your company's settings could not be read.");
      // The logbook's days are the company's days, so it is asked for the
      // company's midnights, as the Hours report is.
      const [org, list, people, logbook] = await Promise.all([
        fetchOrgId(supabase),
        fetchVehicles(supabase),
        fetchDrivers(supabase),
        fetchLogbook(supabase, companyRange(range, cfg.timezone), vehicleFilter || null),
      ]);
      if (isStale()) return;
      setTimeZone(cfg.timezone);
      setOrgId(org);
      setVehicles(list);
      setDrivers(people);
      setRows(logbook);
      setError(null);
    } catch (e) {
      if (isStale()) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!isStale()) setLoading(false);
    }
  }, [supabase, range, vehicleFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const active = useMemo(() => vehicles.filter((v) => v.active), [vehicles]);
  const totals = useMemo(() => logbookTotals(rows), [rows]);
  const time = (iso: string | null) => companyTime(iso, timeZone) || "-";

  function startNew() {
    setEditing(null);
    setDraft(blank(companyToday(timeZone)));
    setError(null);
  }

  async function save() {
    const p = dayProblem(draft, t);
    if (p) return setError(p);
    if (!orgId) return;
    setBusy(true);
    setError(null);
    try {
      if (editing) await updateVehicleDay(supabase, editing, draft);
      else await createVehicleDay(supabase, orgId, draft);
      // Keep the date, vehicle and purpose: the next line is usually the same
      // day or the same car.
      setEditing(null);
      setDraft({ ...draft, driverId: "", odometerStart: "", odometerEnd: "", notes: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: LogbookRow) {
    if (!window.confirm(`Take ${r.vehicle_name} on ${r.day} (${r.driver_name ?? "no name"}) out of the logbook?`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteVehicleDay(supabase, r.vehicle_day_id);
      if (editing === r.vehicle_day_id) startNew();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function exportContext(): string[] {
    const picked = vehicles.find((v) => v.id === vehicleFilter);
    return [
      `${toLocalDateInput(range.from)} to ${toLocalDateInput(dayBefore(range.to))}`,
      picked ? `Vehicle: ${picked.name} (${picked.registration})` : null,
    ].filter((line): line is string => line !== null);
  }

  // A vehicle out of use is still offered while editing a day that used it.
  const vehicleChoices = active.some((v) => v.id === draft.vehicleId)
    ? active
    : [...active, ...vehicles.filter((v) => v.id === draft.vehicleId)];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Vehicle logbook</h1>
          <p className="text-sm text-pretty text-muted-foreground">
            Who drove which vehicle each day, with the kilometres measured along the roads from their workday.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" nativeButton={false} render={<Link href="/logbook/vehicles" />}>
            <Car className="mr-1.5 h-4 w-4" /> Vehicles
          </Button>
          <ExportMenu
            build={() => (rows.length === 0 ? null : logbookSheet(rows, exportContext(), timeZone))}
            disabled={loading}
            label="Export logbook"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3">
        <DateRangePicker value={range} onChange={setRange} />
        <NativeSelect
          aria-label="Vehicle"
          className="w-full sm:w-56"
          value={vehicleFilter}
          onChange={(e) => setVehicleFilter(e.target.value)}
        >
          <option value="">All vehicles</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} ({v.registration})
            </option>
          ))}
        </NativeSelect>
      </div>

      <ErrorBanner message={error} />

      <Card ref={formRef} className="scroll-mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{editing ? "Change this day" : "Put a vehicle in the logbook"}</CardTitle>
          <p className="text-xs text-pretty text-muted-foreground">
            The {lower(t.staff.one)} who drove it that day. The kilometres come from their workday; add the odometer if you have it.
          </p>
        </CardHeader>
        <CardContent>
          {!loading && active.length === 0 && !editing ? (
            <p className="text-sm text-muted-foreground">
              No vehicles in use yet.{" "}
              <Link href="/logbook/vehicles" className="font-medium text-primary hover:underline">
                Add your vehicles
              </Link>{" "}
              to start the logbook.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field id="lb-day" label="Date">
                <Input
                  id="lb-day"
                  type="date"
                  value={draft.day}
                  onChange={(e) => setDraft({ ...draft, day: e.target.value })}
                />
              </Field>
              <Field id="lb-vehicle" label="Vehicle">
                <NativeSelect
                  id="lb-vehicle"
                  value={draft.vehicleId}
                  onChange={(e) => setDraft({ ...draft, vehicleId: e.target.value })}
                >
                  <option value="">Pick a vehicle</option>
                  {vehicleChoices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} ({v.registration})
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="lb-driver" label="Driver">
                <NativeSelect
                  id="lb-driver"
                  value={draft.driverId}
                  onChange={(e) => setDraft({ ...draft, driverId: e.target.value })}
                >
                  <option value="">Pick {withArticle(t, "staff")}</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.full_name ?? "No name"}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="lb-purpose" label="Purpose">
                <NativeSelect
                  id="lb-purpose"
                  value={draft.purpose}
                  onChange={(e) => setDraft({ ...draft, purpose: e.target.value === "private" ? "private" : "business" })}
                >
                  <option value="business">Business</option>
                  <option value="private">Private</option>
                </NativeSelect>
              </Field>
              <Field id="lb-odo-start" label="Opening odometer">
                <Input
                  id="lb-odo-start"
                  inputMode="numeric"
                  value={draft.odometerStart}
                  onChange={(e) => setDraft({ ...draft, odometerStart: e.target.value })}
                  placeholder="Optional"
                />
              </Field>
              <Field id="lb-odo-end" label="Closing odometer">
                <Input
                  id="lb-odo-end"
                  inputMode="numeric"
                  value={draft.odometerEnd}
                  onChange={(e) => setDraft({ ...draft, odometerEnd: e.target.value })}
                  placeholder="Optional"
                />
              </Field>
              <Field id="lb-notes" label="Notes" className="sm:col-span-2">
                <Input
                  id="lb-notes"
                  value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                  placeholder="Where to and why (optional)"
                />
              </Field>
              <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
                <Button disabled={busy || loading} onClick={save}>
                  {editing ? "Save changes" : "Add to logbook"}
                </Button>
                {editing && (
                  <Button variant="outline" disabled={busy} onClick={startNew}>
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Logbook</CardTitle>
          {!loading && rows.length > 0 && (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground tabular-nums">{totals.businessKm.toLocaleString("en-GB")}</span> business km
              and <span className="tabular-nums">{totals.privateKm.toLocaleString("en-GB")}</span> private km over{" "}
              <span className="tabular-nums">{totals.days}</span> {totals.days === 1 ? "day" : "days"}
              {totals.unmeasured > 0 && (
                <>
                  ; <span className="tabular-nums">{totals.unmeasured}</span> {totals.unmeasured === 1 ? "day has" : "days have"} no
                  measured distance yet
                </>
              )}
              .
            </p>
          )}
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="hidden sm:table-cell">Date</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead className="hidden sm:table-cell">Driver</TableHead>
                  <TableHead className="hidden md:table-cell">Purpose</TableHead>
                  <TableHead className="text-right">Km</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Odometer</TableHead>
                  <TableHead className="hidden text-right md:table-cell">From</TableHead>
                  <TableHead className="hidden text-right md:table-cell">To</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* A reload after a save keeps the rows on screen rather than flashing "Loading". */}
                {loading && rows.length === 0 && <EmptyRow colSpan={9}>Loading…</EmptyRow>}
                {!loading && rows.length === 0 && (
                  <EmptyRow colSpan={9}>Nothing in the logbook for this period yet. Put a vehicle in it above.</EmptyRow>
                )}
                {rows.map((r) => (
                    <TableRow key={r.vehicle_day_id} className={editing === r.vehicle_day_id ? "bg-muted/50" : undefined}>
                      <TableCell className="hidden tabular-nums whitespace-nowrap sm:table-cell">{r.day}</TableCell>
                      <TableCell className="max-w-44">
                        <span className="block truncate font-medium">{r.vehicle_name}</span>
                        <span className="block text-xs tabular-nums text-muted-foreground">{r.registration}</span>
                        {/* On a phone the date and driver sit under the vehicle rather than in their own columns. */}
                        <span className="block truncate text-xs text-muted-foreground sm:hidden">
                          <span className="tabular-nums">{r.day}</span>, {r.driver_name ?? "No name"}
                          {r.purpose === "private" && ", private"}
                        </span>
                      </TableCell>
                      <TableCell className="hidden max-w-40 truncate sm:table-cell">{r.driver_name ?? "-"}</TableCell>
                      <TableCell className="hidden md:table-cell">{purposeLabel(r.purpose)}</TableCell>
                      <TableCell className="text-right tabular-nums whitespace-nowrap">
                        {r.km === null ? (
                          <span className="text-xs text-muted-foreground">{kmNote(r)}</span>
                        ) : (
                          r.km.toLocaleString("en-GB")
                        )}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums whitespace-nowrap lg:table-cell">
                        {r.odometer_start === null && r.odometer_end === null
                          ? "-"
                          : `${r.odometer_start ?? "?"} to ${r.odometer_end ?? "?"}`}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">{time(r.first_in)}</TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">{time(r.last_out)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            setEditing(r.vehicle_day_id);
                            setDraft(dayInputOf(r));
                            setError(null);
                            formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Take ${r.vehicle_name} on ${r.day} out of the logbook`}
                          disabled={busy}
                          onClick={() => remove(r)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  id,
  label,
  className,
  children,
}: {
  id: string;
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <Label htmlFor={id} className="mb-1.5 text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
