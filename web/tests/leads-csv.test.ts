// The Founding leads file: one cell is safe to open in Excel, and a row has what
// the owner needs to write to the person.
import { test } from "node:test";
import assert from "node:assert/strict";
import { csvCell, leadsCsv } from "@/lib/leads-csv";

test("a cell with a comma or quote is quoted", () => {
  assert.equal(csvCell('Smith, "Joe"'), '"Smith, ""Joe"""');
});

test("a formula a person typed is defused", () => {
  assert.equal(csvCell('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
  assert.equal(csvCell("+27821234567"), "'+27821234567");
});

test("a cell stays on one line, and nothing is an empty cell", () => {
  assert.equal(csvCell("a\nb"), "a b");
  assert.equal(csvCell(null), "");
});

test("the file has the header, a line per lead, and the trade's name", () => {
  const csv = leadsCsv(
    [
      {
        created_at: "2026-10-10T08:15:30.000Z",
        name: "Thandi Nkosi",
        email: "thandi@example.com",
        whatsapp: "27820000000",
        business_name: "Nkosi Cleaning",
        trade: "cleaning",
        town: "Pretoria",
        status: "new",
        source: null,
      },
      {
        created_at: "2026-10-09T08:00:00.000Z",
        name: "Old One",
        email: null,
        whatsapp: "27821111111",
        business_name: "B",
        trade: "x",
        town: "T",
        status: "waitlist",
        source: "facebook",
      },
    ],
    (c) => (c === "cleaning" ? "Cleaning" : c),
  );
  const lines = csv.replace("﻿", "").trim().split("\r\n");
  assert.equal(lines[0], "Name,Email,WhatsApp (with country code),Business,Type of work,Town or city,Status,Came from,Applied (UTC)");
  assert.equal(lines[1], "Thandi Nkosi,thandi@example.com,27820000000,Nkosi Cleaning,Cleaning,Pretoria,new,,2026-10-10 08:15");
  assert.ok(lines[2].startsWith("Old One,,27821111111,B,x,T,waitlist,facebook"));
});

test("a lone carriage return does not hide a formula", () => {
  assert.equal(csvCell("\r=1+1"), " =1+1");
});
