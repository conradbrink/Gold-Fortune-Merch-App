// One store group for a whole page: Stores due for an order and Store health
// (owner, 15 Oct 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_STORE_GROUP, resolveStoreGroup, storeGroupChoices, storeGroupOf, storeGroupWords } from "@/lib/store-groups";
import { DEFAULT_TERMS, type Terms } from "@/lib/terms";

const groups = {
  groups: [
    { id: "g-choppies", name: "Choppies Group" },
    { id: "g-empty", name: "Empty Group" },
    { id: "g-forecourts", name: "Forecourts" },
  ],
  // Only the stores in a group are read: s4 is in none.
  groupOf: new Map([
    ["s1", "g-choppies"],
    ["s2", "g-choppies"],
    ["s3", "g-forecourts"],
  ]),
};
const ids = ["s1", "s2", "s3", "s4", "s5"];

test("links carry the stores in no group as ?group=none", () => {
  // Shared links depend on the literal; changing it would break them quietly.
  assert.equal(NO_STORE_GROUP, "none");
});

test("the picker offers the groups with a row on the list, and No group last", () => {
  assert.deepEqual(storeGroupChoices(ids, groups, DEFAULT_TERMS), [
    { id: "g-choppies", name: "Choppies Group", n: 2 },
    { id: "g-forecourts", name: "Forecourts", n: 1 },
    // s4 has no group, and s5 was added after the groups were read.
    { id: "none", name: "No group", n: 2 },
  ]);
  assert.equal(storeGroupOf("s1", groups.groupOf), "g-choppies");
  assert.equal(storeGroupOf("s5", groups.groupOf), "none");
  // An order keyed in without a store counts as in no group.
  assert.equal(storeGroupOf(null, groups.groupOf), "none");
  // Every row in a group: no "No group" to choose.
  assert.deepEqual(
    storeGroupChoices(["s1", "s2", "s3"], groups, DEFAULT_TERMS).map((g) => g.id),
    ["g-choppies", "g-forecourts"]
  );
  // The group already chosen stays on offer with nothing on the list.
  assert.deepEqual(storeGroupChoices(["s1"], groups, DEFAULT_TERMS, "g-empty"), [
    { id: "g-choppies", name: "Choppies Group", n: 1 },
    { id: "g-empty", name: "Empty Group", n: 0 },
  ]);
  // No named group on the list: nothing to choose, not a lone "No group".
  assert.deepEqual(storeGroupChoices(["s4", "s5"], groups, DEFAULT_TERMS), []);
});

test("the group a link asks for is checked against the company's groups", () => {
  const view = (chosen: string, on = ids, sg = groups) => resolveStoreGroup(chosen, on, sg, DEFAULT_TERMS);
  assert.equal(view("").active, "");
  assert.equal(view("g-choppies").active, "g-choppies");
  assert.equal(view("none").active, "none");
  // A group with nothing on this list still counts, so its empty texts can say so.
  assert.equal(view("g-empty").active, "g-empty");
  assert.equal(view("g-empty").missing, false);
  // A group the company does not have (any more): every group, and said.
  assert.deepEqual([view("g-deleted").active, view("g-deleted").missing], ["", true]);
  // A company without groups ignores the choice, "none" included, and says nothing.
  const noGroups = { groups: [], groupOf: new Map<string, string>() };
  assert.deepEqual(view("none", ids, noGroups), { choices: [], active: "", missing: false });
  assert.deepEqual(view("g-deleted", ids, noGroups), { choices: [], active: "", missing: false });
});

test("the page says which group it is showing, and nothing for every group", () => {
  const every = storeGroupWords("", "", DEFAULT_TERMS);
  assert.deepEqual([every.phrase, every.chip, every.context], ["", "", []]);
  assert.equal(every.within("Every site had a visit."), "Every site had a visit.");

  const choppies = storeGroupWords("g-choppies", "Choppies Group", DEFAULT_TERMS);
  assert.equal(choppies.phrase, "in Choppies Group");
  assert.equal(choppies.chip, "Choppies Group only · every group");
  assert.deepEqual(choppies.context, ["Group: Choppies Group"]);
  assert.equal(choppies.within("No site has stopped ordering."), "In Choppies Group, no site has stopped ordering.");

  const none = storeGroupWords(NO_STORE_GROUP, "No group", DEFAULT_TERMS);
  assert.equal(none.phrase, "not in a group");
  assert.equal(none.chip, "Not in a group · every group");
  assert.deepEqual(none.context, ["Not in a group"]);
  assert.equal(none.within("Every site has placed an order."), "Of the sites not in a group, every site has placed an order.");
});

test("a company's own word for groups takes its own article", () => {
  const areas: Terms = {
    ...DEFAULT_TERMS,
    site: { one: "Store", many: "Stores", article: null },
    site_group: { one: "Area", many: "Areas", article: null },
  };
  const none = storeGroupWords(NO_STORE_GROUP, "No area", areas);
  assert.equal(none.chip, "Not in an area · every area");
  assert.deepEqual(none.context, ["Not in an area"]);
  assert.equal(none.within("No store is due."), "Of the stores not in an area, no store is due.");
  // The company's own override wins.
  const unit: Terms = { ...areas, site_group: { one: "Unit", many: "Units", article: "a" } };
  assert.equal(storeGroupWords(NO_STORE_GROUP, "No unit", unit).phrase, "not in a unit");
});
