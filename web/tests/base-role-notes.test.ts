// What a base role means, in the company's words: the manager's note names
// the modules by what they hold.
import { test } from "node:test";
import assert from "node:assert/strict";
import { baseRoleNotes } from "@/lib/access";
import { DEFAULT_TERMS, parseTerms } from "@/lib/terms";

const goldFortune = parseTerms({
  site: { one: "Store", many: "Stores" },
  job: { one: "Visit", many: "Visits" },
  prospect: { one: "Lead", many: "Leads" },
});

test("Gold Fortune's manager note reads as it always has", () => {
  assert.equal(
    baseRoleNotes(goldFortune).manager,
    "No Android app. In the modules not yet on permissions — sales, stores, visits, leads, forms, files — sees everything, whatever the tick boxes below say."
  );
});

test("the neutral words name sites, jobs and leads", () => {
  assert.equal(
    baseRoleNotes(DEFAULT_TERMS).manager,
    "No Android app. In the modules not yet on permissions — sales, sites, jobs, leads, forms, files — sees everything, whatever the tick boxes below say."
  );
  assert.equal(
    baseRoleNotes(DEFAULT_TERMS).rep,
    "Signs in to the Android app. In the modules not yet on permissions, sees only their own records."
  );
});
