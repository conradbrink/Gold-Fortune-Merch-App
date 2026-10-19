// Range (owner, 19 Oct 2026): which products each store should carry, worked
// out by Tickd from the orders. The rule itself is in the database
// (supabase/tests/store_range.sql proves it); these tests hold how the web
// counts and words its answer, so the card, the page and the export agree.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bestSellers,
  callLabel,
  newProductsLine,
  productCalls,
  reasonWords,
  resultWords,
  shortNames,
  similarStores,
  summariseNewProducts,
  summariseRange,
  type RangeLine,
  type RangeProductRow,
  type RangeStoreRow,
} from "@/lib/store-range";
import { cellWords, pinLabel, type GridCell } from "@/lib/range-grid";
import { RANGE_SHOWS, rangeShowFromQuery, rangeStoreFromQuery, storeRangeHref } from "@/lib/dashboard-links";

function line(over: Partial<RangeLine> = {}): RangeLine {
  return {
    product_id: "p1",
    status: "have",
    in_range: true,
    reason: "share",
    share: 72,
    cluster_stores: 18,
    own_orders: 0,
    last_ordered: null,
    boxes: null,
    value: null,
    est_boxes_month: null,
    est_value_month: null,
    excluded: null,
    ...over,
  };
}

function store(over: Partial<RangeStoreRow> = {}): RangeStoreRow {
  return {
    store_id: "s1",
    store_name: "Choppies Phakalane",
    city: "Gaborone",
    store_group_id: "g1",
    size: "big",
    size_source: "sales",
    level: 1,
    learning: false,
    quiet: false,
    ordering_stores: 126,
    min_stores: 5,
    lines: [],
    ...over,
  };
}

function product(over: Partial<RangeProductRow> = {}): RangeProductRow {
  return {
    product_id: "p1",
    stage: "new",
    result: "trying",
    added_on: "2026-08-02",
    launch_on: "2026-08-03",
    tried: 0,
    chances: 0,
    repeats: 0,
    repeat_pct: null,
    ros: null,
    similar_ros: null,
    groups_tried: [],
    min_chances: 5,
    untried_days: 30,
    ...over,
  };
}

test("short names keep what tells two flavours apart", () => {
  const names = shortNames([
    { id: "a", name: "OKSO 12000 Puff (5%) Disposable - Grape Ice" },
    { id: "b", name: "OKSO Crystal Bar 800 Puff (5%) Disposable - Grape Ice" },
    { id: "c", name: "OKSO 12000 Puff (5%) Disposable - Kiwi Passion Fruit" },
    { id: "d", name: "Newport Butane Gas 300ml" },
  ]);
  assert.equal(names.get("a"), "12000 Grape Ice");
  assert.equal(names.get("b"), "Crystal Bar 800 Grape Ice");
  assert.equal(names.get("c"), "Kiwi Passion Fruit");
  assert.equal(names.get("d"), "Newport Butane Gas 300ml");
});

test("the summary counts only stores that ordered lately, and money only when it was given", () => {
  const rows = [
    store({
      lines: [
        line({ product_id: "a", status: "have" }),
        line({ product_id: "b", status: "gap", est_boxes_month: 2, est_value_month: 1000 }),
        line({ product_id: "c", status: "stopped", est_boxes_month: 1, est_value_month: 500 }),
        // Ordered outside its range: not part of the range.
        line({ product_id: "d", status: "off_range", in_range: false, reason: null }),
      ],
    }),
    // Ordered nothing lately: not counted, not a gap.
    store({ store_id: "s2", quiet: true, lines: [line({ product_id: "a", status: "quiet" })] }),
  ];
  const s = summariseRange(rows);
  assert.equal(s.inRange, 3);
  assert.equal(s.have, 1);
  assert.equal(s.missing, 1);
  assert.equal(s.stopped, 1);
  assert.equal(s.filledPct, 33);
  assert.equal(s.missingValue, 1500);
  assert.equal(s.storesMissing, 1);
  assert.equal(s.quietStores, 1);
  assert.equal(s.learning, false);

  // Without invoicing every amount is null: no money line, not "P0".
  const noMoney = summariseRange([store({ lines: [line({ status: "gap", est_boxes_month: 2 })] })]);
  assert.equal(noMoney.missingValue, null);
});

test("a company with no stores, or every store still learning, is learning", () => {
  assert.equal(summariseRange([]).learning, true);
  const s = summariseRange([store({ learning: true, level: 0, ordering_stores: 2, min_stores: 5 })]);
  assert.equal(s.learning, true);
  assert.equal(s.orderingStores, 2);
  assert.equal(s.minStores, 5);
});

test("each reason reads as a sentence, naming the stores compared", () => {
  assert.equal(similarStores(1, "Choppies Group", "big", "Stores"), "Choppies Group big stores");
  assert.equal(similarStores(2, "Choppies Group", "big", "Stores"), "Choppies Group stores");
  assert.equal(similarStores(3, null, "small", "Stores"), "your small stores");
  assert.equal(similarStores(1, null, "small", "Stores", "with no chain"), "small stores with no chain");
  assert.equal(similarStores(2, null, "small", "Stores", "with no chain"), "stores with no chain");
  assert.equal(similarStores(4, null, "small", "Stores"), "your stores");
  const r = store();
  assert.equal(
    reasonWords(line({ share: 72.4, cluster_stores: 18 }), r, "Choppies Group", "Store", "Stores"),
    "72% of Choppies Group big stores take it (18 compared).",
  );
  assert.equal(
    reasonWords(line({ reason: "own", own_orders: 3 }), r, null, "Store", "Stores"),
    "They have ordered it on 3 orders.",
  );
  assert.match(reasonWords(line({ reason: "launch" }), r, null, "Store", "Stores"), /proven new product/i);
  assert.match(
    reasonWords(line({ reason: "excluded", excluded: "No shelf space" }), r, null, "Store", "Stores"),
    /No shelf space/,
  );
});

test("new products: the card line names only what there is, and a result carries its proof", () => {
  const products = [
    product({
      product_id: "a",
      result: "proven",
      tried: 79,
      chances: 27,
      repeats: 21,
      repeat_pct: 78,
      groups_tried: ["g1", "g2"],
    }),
    product({ product_id: "b", result: "not_taking", tried: 30, chances: 7, repeats: 1, repeat_pct: 14 }),
    product({ product_id: "c", stage: "not_ordered", result: "untried", launch_on: null, untried_days: 45 }),
    product({ product_id: "d", stage: "established", result: "proven" }),
    product({ product_id: "e", result: "trying", tried: 19, chances: 0 }),
  ];
  const s = summariseNewProducts(products);
  assert.deepEqual(s, { proven: 1, slow: 0, notTaking: 1, trying: 1, untried: 1, waiting: 0 });
  assert.equal(newProductsLine(s), "1 proven, 1 not taking off, 1 being tried, 1 not ordered yet");
  assert.equal(newProductsLine(summariseNewProducts([])), "No new products");

  const names = (id: string) => (id === "g1" ? "Liquorama" : "Sefalana");
  assert.equal(
    resultWords(products[0], names, "Store", "Stores"),
    "21 of 27 stores that could have ordered it again did (78%). Tickd added it to the big stores in Liquorama, Sefalana.",
  );
  assert.equal(
    resultWords(products[4], names, "Store", "Stores"),
    "19 stores ordered it. Tickd needs 5 more to order again before it can judge it.",
  );
  assert.match(resultWords(products[2], names, "Store", "Stores"), /^No store has ordered it in the 45 days/);
});

test("best sellers so far: the products most stores ordered", () => {
  const best = bestSellers([
    product({ product_id: "a", tried: 3 }),
    product({ product_id: "b", tried: 9 }),
    product({ product_id: "c", tried: 0 }),
  ]);
  assert.deepEqual(
    best.map((p) => p.product_id),
    ["b", "a"],
  );
});

test("what to do with each product: speed and spread against the medians", () => {
  const spread = new Map([
    ["push", { inRange: 10, have: 2 }],
    ["protect", { inRange: 10, have: 9 }],
    ["check", { inRange: 10, have: 9 }],
    ["big_only", { inRange: 10, have: 1 }],
  ]);
  const calls = productCalls(
    [
      product({ product_id: "push", tried: 5, ros: 2 }),
      product({ product_id: "protect", tried: 5, ros: 2 }),
      product({ product_id: "check", tried: 5, ros: 0.5 }),
      product({ product_id: "big_only", tried: 5, ros: 0.5 }),
      product({ product_id: "none", tried: 0 }),
    ],
    (id) => spread.get(id),
  );
  for (const id of ["push", "protect", "check", "big_only", "none"]) assert.equal(calls.get(id), id);
  assert.equal(callLabel("push", "Stores"), "Push it into more stores");
});

test("the Ranges tab's words", () => {
  const cell = (over: Partial<GridCell>): GridCell => ({
    product_id: "p",
    size: "big",
    stores: 4,
    level: 1,
    cluster_stores: 18,
    takers: 13,
    share: 72.2,
    cluster_in: true,
    cluster_reason: "share",
    own_in: 0,
    pin_rule: null,
    pin_min_size: null,
    stage: null,
    result: null,
    ...over,
  });
  assert.equal(cellWords(cell({}), "Chain", "Stores"), "72% of 18 take it");
  assert.equal(cellWords(cell({ level: 2 }), "Chain", "Stores"), "72% of the chain's 18 take it");
  assert.equal(cellWords(cell({ level: 3 }), "Chain", "Stores"), "72% of your 18 big stores take it");
  assert.equal(cellWords(cell({ level: 4 }), "Chain", "Stores"), "72% of all your 18 stores take it");
  assert.equal(cellWords(cell({ cluster_reason: "launch" }), "Chain", "Stores"), "Proven new product");
  assert.equal(cellWords(cell({ cluster_reason: null, level: 0, share: null }), "Chain", "Stores"), "Still learning");
  assert.equal(pinLabel({ rule: "always", from: "medium" }, "Store", "Stores"), "Always: medium and big stores");
  assert.equal(pinLabel({ rule: "always", from: "small" }, "Store", "Stores"), "Always: every store");
  assert.equal(pinLabel({ rule: "auto" }, "Store", "Stores"), "Tickd decides");
});

test("every Range link goes through its parser", () => {
  const q = (href: string) => new URLSearchParams(href.split("?")[1] ?? "");
  assert.equal(storeRangeHref(), "/stores/range");
  for (const s of RANGE_SHOWS) assert.equal(rangeShowFromQuery(q(storeRangeHref(s))), s);
  assert.equal(rangeShowFromQuery(q("/stores/range?show=nonsense")), null);
  const id = "71170c8a-d53c-4a07-bdd4-97704a3cf4bc";
  assert.equal(rangeStoreFromQuery(q(storeRangeHref(undefined, undefined, id))), id);
  assert.equal(rangeStoreFromQuery(q("/stores/range?store=not-an-id")), null);
});
