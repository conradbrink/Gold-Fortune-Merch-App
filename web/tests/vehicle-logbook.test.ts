// Vehicle logbook (Stage 8 Part 6): the page's arithmetic and the exported
// logbook, on the rows `vehicle_logbook()` returns. The database side is
// supabase/tests/vehicle_logbook.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  companyToday,
  dayInputOf,
  dayProblem,
  kmNote,
  logbookError,
  logbookSheet,
  logbookTotals,
  normaliseRegistration,
  odometerKm,
  parseOdometer,
  vehicleProblem,
  type DayInput,
  type LogbookRow,
} from "@/lib/vehicle-logbook";
import { DEFAULT_TERMS } from "@/lib/terms";

const row = (over: Partial<LogbookRow>): LogbookRow => ({
  vehicle_day_id: "d1",
  vehicle_id: "car1",
  vehicle_name: "Silver Hilux",
  registration: "ND 123 GP",
  day: "2026-10-01",
  driver_id: "p1",
  driver_name: "Thandi",
  purpose: "business",
  km: 25.5,
  odometer_start: 1000,
  odometer_end: 1026,
  first_in: "2026-10-01T06:00:00Z",
  last_out: "2026-10-01T13:00:00Z",
  notes: null,
  ...over,
});

const input = (over: Partial<DayInput>): DayInput => ({
  day: "2026-10-01",
  vehicleId: "car1",
  driverId: "p1",
  purpose: "business",
  odometerStart: "",
  odometerEnd: "",
  notes: "",
  ...over,
});

test("totals split business and private km and count days not measured yet", () => {
  const t = logbookTotals([
    row({}),
    row({ vehicle_day_id: "d2", purpose: "private", km: 12.25 }),
    row({ vehicle_day_id: "d3", vehicle_id: "car2", km: 0.1 }),
    row({ vehicle_day_id: "d4", km: null }),
  ]);
  assert.deepEqual(t, { days: 4, vehicles: 2, businessKm: 25.6, privateKm: 12.3, unmeasured: 1 });
  assert.deepEqual(logbookTotals([]), { days: 0, vehicles: 0, businessKm: 0, privateKm: 0, unmeasured: 0 });
});

test("a day without km says why, never a blank that reads as nought", () => {
  assert.equal(kmNote(row({})), "");
  assert.equal(kmNote(row({ km: null, first_in: null, last_out: null })), "No workday started");
  assert.equal(kmNote(row({ km: null, last_out: null })), "Workday still open");
  assert.equal(kmNote(row({ km: null })), "Not measured yet");
});

test("the export is a travel logbook: one line per vehicle-day, totals above", () => {
  const sheet = logbookSheet(
    [row({}), row({ vehicle_day_id: "d2", day: "2026-10-02", purpose: "private", km: null, odometer_start: null, odometer_end: null, notes: "Weekend move" })],
    ["2026-10-01 to 2026-10-31"],
    "Africa/Johannesburg"
  );
  assert.equal(sheet.title, "Vehicle logbook");
  assert.deepEqual(
    sheet.columns.map((c) => c.header),
    ["Date", "Vehicle", "Registration", "Driver", "Purpose", "Opening odometer", "Closing odometer", "Km", "From", "To", "Notes"]
  );
  assert.deepEqual(sheet.context, [
    "2026-10-01 to 2026-10-31",
    "Business km: 25.5, Private km: 0, Total km: 25.5, 1 day has no measured distance yet",
  ]);
  // The company's clock: 06:00 UTC is 08:00 in Johannesburg.
  assert.deepEqual(sheet.rows[0], {
    day: "2026-10-01",
    vehicle: "Silver Hilux",
    registration: "ND 123 GP",
    driver: "Thandi",
    purpose: "Business",
    odoStart: 1000,
    odoEnd: 1026,
    km: 25.5,
    from: "08:00",
    to: "15:00",
    notes: "",
  });
  assert.equal(sheet.rows[1].purpose, "Private");
  assert.equal(sheet.rows[1].odoStart, "");
  assert.equal(sheet.rows[1].km, "");
  assert.equal(sheet.rows[1].notes, "Not measured yet. Weekend move");
  // Numbers stay numbers, so a spreadsheet adds them up.
  for (const key of ["odoStart", "odoEnd", "km"]) {
    assert.equal(sheet.columns.find((c) => c.key === key)?.numeric, true);
  }
});

test("odometer readings: whole kilometres, blank is not read", () => {
  assert.equal(parseOdometer(""), null);
  assert.equal(parseOdometer("  "), null);
  assert.equal(parseOdometer("123 456"), 123456);
  assert.equal(parseOdometer("12,345"), 12345);
  assert.ok(Number.isNaN(parseOdometer("12.5")));
  assert.ok(Number.isNaN(parseOdometer("-4")));
  assert.ok(Number.isNaN(parseOdometer("12345678")));
  assert.equal(odometerKm(row({})), 26);
  assert.equal(odometerKm(row({ odometer_end: null })), null);
});

test("a vehicle day as typed: what is missing or wrong, in the company's words", () => {
  const t = DEFAULT_TERMS;
  assert.equal(dayProblem(input({}), t), null);
  assert.equal(dayProblem(input({ day: "" }), t), "Pick the date.");
  assert.equal(dayProblem(input({ vehicleId: "" }), t), "Pick the vehicle.");
  assert.match(dayProblem(input({ driverId: "" }), t) ?? "", new RegExp(`Pick the ${t.staff.one.toLowerCase()}`));
  assert.equal(dayProblem(input({ odometerStart: "1000", odometerEnd: "990" }), t), "The closing odometer is below the opening one.");
  assert.equal(dayProblem(input({ odometerStart: "abc" }), t), "An odometer reading is a whole number of kilometres.");
  assert.equal(dayProblem(input({ odometerStart: "1000" }), t), null);
});

test("a row goes back into the form unchanged", () => {
  assert.deepEqual(dayInputOf(row({ notes: "Client in Pretoria" })), input({
    odometerStart: "1000",
    odometerEnd: "1026",
    notes: "Client in Pretoria",
  }));
  assert.equal(dayInputOf(row({ purpose: "private" })).purpose, "private");
});

test("vehicles: a name and a registration, written as the plate reads", () => {
  assert.equal(vehicleProblem({ name: "Hilux", registration: "ABC 123", notes: "", active: true }), null);
  assert.match(vehicleProblem({ name: " ", registration: "ABC 123", notes: "", active: true }) ?? "", /name/);
  assert.match(vehicleProblem({ name: "Hilux", registration: "", notes: "", active: true }) ?? "", /registration/);
  assert.equal(normaliseRegistration("  nd 123   gp "), "ND 123 GP");
});

test("the database's refusals in words a person can act on", () => {
  assert.match(logbookError({ code: "23505", message: "duplicate key" }, "vehicle"), /registration/);
  assert.match(logbookError({ code: "23505", message: "duplicate key" }, "day"), /already in the logbook/);
  assert.match(
    logbookError({ code: "23514", message: 'violates check constraint "vehicle_days_odometer_order"' }, "day"),
    /closing odometer/
  );
  assert.equal(logbookError({ code: "42501", message: "permission denied" }, "day"), "permission denied");
});

test("today is the company's date, not the viewer's", () => {
  // 23:30 UTC on 1 October is already 2 October in Johannesburg.
  assert.equal(companyToday("Africa/Johannesburg", new Date("2026-10-01T23:30:00Z")), "2026-10-02");
  assert.equal(companyToday("UTC", new Date("2026-10-01T23:30:00Z")), "2026-10-01");
});
