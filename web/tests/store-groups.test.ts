// One store group for a whole page: Stores due for an order and Store health
// (owner, 15 Oct 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_STORE_GROUP, storeGroupChoices, storeGroupOf, storeGroupWords } from "@/lib/store-groups";
import { DEFAULT_TERMS } from "@/lib/terms";

const groups = {
  groups: [
    { id: "g-choppies", name: "Choppies Group" },
    { id: "g-empty", name: "Empty Group" },
    { id: "g-forecourts", name: "Forecourts" },
  ],
  groupOf: new Map<string, string | null>([
    ["s1", "g-choppies"],
    ["s2", "g-choppies"],
    ["s3", "g-forecourts"],
    ["s4", null],
  ]),
};
const rows = ["s1", "s2", "s3", "s4", "s5"].map((store_id) => ({ store_id }));

test("the picker offers the groups with a store on the list, and No group last", () => {
  assert.deepEqual(storeGroupChoices(rows, groups, DEFAULT_TERMS), [
    { id: "g-choppies", name: "Choppies Group", n: 2 },
    { id: "g-forecourts", name: "Forecourts", n: 1 },
    // s4 has no group, and s5 was added after the groups were read.
    { id: NO_STORE_GROUP, name: "No group", n: 2 },
  ]);
  assert.equal(storeGroupOf("s1", groups.groupOf), "g-choppies");
  assert.equal(storeGroupOf("s5", groups.groupOf), NO_STORE_GROUP);
  // Every store in a group: no "No group" to choose.
  assert.deepEqual(
    storeGroupChoices(rows.slice(0, 3), groups, DEFAULT_TERMS).map((g) => g.id),
    ["g-choppies", "g-forecourts"]
  );
});

test("the page says which group it is showing, and nothing for every group", () => {
  const every = storeGroupWords("", "", DEFAULT_TERMS);
  assert.deepEqual([every.phrase, every.chip, every.context], ["", "", ""]);
  assert.equal(every.within("Every store had a visit."), "Every store had a visit.");

  const choppies = storeGroupWords("g-choppies", "Choppies Group", DEFAULT_TERMS);
  assert.equal(choppies.phrase, "in Choppies Group");
  assert.equal(choppies.chip, "Choppies Group only · every group");
  assert.equal(choppies.context, "Group: Choppies Group");
  assert.equal(choppies.within("No store has stopped ordering."), "In Choppies Group, no store has stopped ordering.");

  const none = storeGroupWords(NO_STORE_GROUP, "No group", DEFAULT_TERMS);
  assert.equal(none.phrase, "not in a group");
  assert.equal(none.chip, "Not in a group · every group");
  assert.equal(none.context, "Not in a group");
  assert.equal(none.within("Every site has placed an order."), "Of the sites not in a group, every site has placed an order.");
});
