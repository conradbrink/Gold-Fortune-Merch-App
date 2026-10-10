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

test("Gold Fortune's manager note names its own things", () => {
  assert.equal(
    baseRoleNotes(goldFortune).manager,
    "Uses the website, not the phone app. Where the tick boxes below do not reach yet (sales, stores, visits, leads, forms, files), sees everything."
  );
});

test("the neutral words name sites, jobs and leads", () => {
  assert.equal(
    baseRoleNotes(DEFAULT_TERMS).manager,
    "Uses the website, not the phone app. Where the tick boxes below do not reach yet (sales, sites, jobs, leads, forms, files), sees everything."
  );
  assert.equal(
    baseRoleNotes(DEFAULT_TERMS).rep,
    "Uses the phone app. Where the tick boxes below do not reach yet (sales, sites, jobs, leads, forms, files), sees only their own."
  );
});
