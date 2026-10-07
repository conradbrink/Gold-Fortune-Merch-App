// The stores screens' lib text in the company's words: the location exceptions
// list and the store import. Gold Fortune's must read as it did before the
// terminology system, apart from the decided changes ("shop" meaning the place
// now says the site word, which for Gold Fortune is "store").
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TERMS, parseTerms } from "@/lib/terms";
import { confirmLocation, dataProblems, repositionLocation, reviewReasons } from "@/lib/store-review";
import { buildDrafts, detectColumns, importStores } from "@/lib/import/stores";
import type { Tables } from "@/lib/supabase/types";

const goldFortune = parseTerms({
  site: { one: "Store", many: "Stores" },
  site_group: { one: "Chain", many: "Chains" },
  job: { one: "Visit", many: "Visits" },
  staff: { one: "Rep", many: "Reps" },
});

/** A store row with only what the review helpers read. */
function store(over: Partial<Tables<"stores">>): Tables<"stores"> {
  return { id: "s1", name: "Spar Riverwalk", city: "Gaborone", address: "Plot 1", active: true, ...over } as Tables<"stores">;
}

/** A client whose update matches no row, which the helpers must report. */
const noMatch = {
  from: () => ({
    update: () => ({ eq: () => ({ select: async () => ({ data: [], error: null }) }) }),
  }),
} as never;

test("Gold Fortune's exception reasons read as they always did", () => {
  const r = reviewReasons(goldFortune);
  assert.equal(r.drift.label, "Reps keep checking in somewhere else");
  assert.equal(
    r.drift.blurb,
    "Visits to this store consistently land a long way from the point on file. Where they land is tightly grouped, which points at the record rather than at the reps — the stored position is probably wrong, and no rep can replace it because a rep set it."
  );
  assert.equal(r.collapsed.label, "Same listing as another store");
  assert.equal(r.shared.label, "Shares a point with another store");
  assert.equal(
    r.shared.blurb,
    "Another store sits on this exact coordinate. That is occasionally genuine — two branches in one centre — but it is worth a look."
  );
  assert.equal(r.bad_record.label, "The store's own details are unusable");
  assert.equal(
    r.bad_record.blurb,
    "No town, no address, or a name that belongs to another store too. A rep can fix a coordinate by standing in the store; they cannot fix a row nobody can identify."
  );
  // The order the list is worked in does not depend on the words.
  assert.deepEqual(
    [r.drift.rank, r.collapsed.rank, r.shared.rank, r.bad_record.rank],
    [0, 1, 2, 3]
  );
});

test("the neutral defaults name sites and staff", () => {
  const r = reviewReasons(DEFAULT_TERMS);
  assert.equal(r.drift.label, "Staff keep checking in somewhere else");
  assert.match(r.drift.blurb, /^Jobs to this site /);
  assert.match(r.drift.blurb, /no staff member can replace it because a staff member set it\.$/);
  assert.equal(r.bad_record.label, "The site's own details are unusable");
  assert.match(r.bad_record.blurb, /A staff member can fix a coordinate by standing in the site;/);
});

test("data problems in both vocabularies", () => {
  const me = store({ id: "a", name: "Spar", city: null });
  const twin = store({ id: "b", name: "spar " });
  const gf = dataProblems(me, [me, twin], goldFortune);
  assert.deepEqual(
    gf.map((p) => p.label),
    ["No town on file", "Another store has this exact name", "Name is a single word"]
  );
  assert.match(gf[0].detail, /^Nothing says which town this store is in,/);
  assert.match(gf[1].detail, /^1 other active store share this name\./);
  assert.equal(
    gf[2].detail,
    "A name with no branch in it matches the chain's generic listing rather than this store, which is how several branches end up sharing one coordinate."
  );

  const neutral = dataProblems(me, [me, twin, store({ id: "c", name: "SPAR" })], DEFAULT_TERMS);
  assert.equal(neutral[1].label, "Another site has this exact name");
  assert.match(neutral[1].detail, /^2 other active sites share this name\./);
  assert.match(neutral[2].detail, /the group's generic listing rather than this site,/);
});

test("an update that lands nowhere says which kind of record", async () => {
  await assert.rejects(confirmLocation(noMatch, "s1", "p1", goldFortune), {
    message: "That store could not be updated — reload and try again.",
  });
  await assert.rejects(repositionLocation(noMatch, "s1", 0, 0, "p1", DEFAULT_TERMS), {
    message: "That site could not be updated — reload and try again.",
  });
});

test("the import flags a chain header in the company's words", () => {
  const rows = [{ Name: "Choppies Group" }, { Name: "Choppies Group:Choppies Mall" }];
  const map = detectColumns(["Name"]);
  assert.equal(buildDrafts(rows, map, goldFortune, "BW")[0].issues[0], "Chain header, not a store");
  assert.equal(buildDrafts(rows, map, DEFAULT_TERMS, null)[0].issues[0], "Group header, not a site");
});

test("a failed import batch counts what already landed", async () => {
  const failing = {
    from: (table: string) =>
      table === "store_groups"
        ? { select: async () => ({ data: [], error: null }) }
        : { insert: () => ({ select: async () => ({ data: null, error: { message: "boom" } }) }) },
  } as never;
  const drafts = buildDrafts([{ Name: "Spar Riverwalk" }], detectColumns(["Name"]), goldFortune, "BW");
  await assert.rejects(importStores(failing, "org", drafts, "weekly", goldFortune), {
    message: "boom — 0 stores were already created before this failed.",
  });
  await assert.rejects(importStores(failing, "org", drafts, "weekly", DEFAULT_TERMS), {
    message: "boom — 0 sites were already created before this failed.",
  });
});

test("a row from another country is set aside, by name or code", () => {
  const map = detectColumns(["Name", "Country"]);
  const rows = [
    { Name: "Spar Riverwalk", Country: "Botswana" },
    { Name: "Spar Sandton", Country: "South Africa" },
    { Name: "Spar Main", Country: "BW" },
  ];
  const gf = buildDrafts(rows, map, goldFortune, "BW");
  assert.deepEqual(gf.map((d) => d.issues.includes("Country is South Africa")), [false, true, false]);
  // No company country: nothing is refused for its country.
  assert.ok(buildDrafts(rows, map, goldFortune, null).every((d) => !d.issues.some((i) => i.startsWith("Country"))));
});
