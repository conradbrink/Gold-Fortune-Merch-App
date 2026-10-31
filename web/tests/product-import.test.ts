// A product import matches rows to products by SKU code and barcode. Since
// 20261031172300 a barcode can be on several products (one per quantity band,
// owner 31 Oct), so a barcode alone may no longer pick one out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDrafts, detectColumns, type ProductRow } from "@/lib/import/products";

const headers = ["Detail", "Unit barcode", "Shrink barcode", "SKU code", "Shrink price excl VAT"];
const map = detectColumns(headers);

function product(id: string, name: string, p: Partial<ProductRow> = {}): ProductRow {
  return {
    id,
    name,
    unit_barcode: null,
    shrink_barcode: null,
    sku_code: null,
    brand: null,
    category: null,
    units_per_shrink: 4,
    shrink_price_excl_vat: null,
    shrink_price_incl_vat: null,
    ...p,
  } as ProductRow;
}

function row(r: { name: string; unit?: string; shrink?: string; sku?: string; price?: string }) {
  return {
    Detail: r.name,
    "Unit barcode": r.unit ?? "",
    "Shrink barcode": r.shrink ?? "",
    "SKU code": r.sku ?? "",
    "Shrink price excl VAT": r.price ?? "",
  };
}

// Aqua Blast's 4 x 5L, one product per quantity band, all with one barcode.
const bands = [
  product("b1", "4 x 5L (up to 6)", { shrink_barcode: "0745853789817", sku_code: "5L-1" }),
  product("b2", "4 x 5L (7-12)", { shrink_barcode: "0745853789817", sku_code: "5L-2" }),
  product("b3", "4 x 5L (13-24)", { shrink_barcode: "0745853789817" }),
];
const single = product("s1", "6 x 1.5L", { unit_barcode: "6008460100548", shrink_barcode: "0745853789824" });

test("the columns are found", () => {
  assert.equal(map.unit_barcode, "Unit barcode");
  assert.equal(map.shrink_barcode, "Shrink barcode");
  assert.equal(map.sku_code, "SKU code");
});

test("a barcode on one product still updates that product", () => {
  const [d] = buildDrafts([row({ name: "6 x 1.5L", shrink: "0745853789824", price: "49" })], map, [single, ...bands]);
  assert.equal(d.action, "update");
  assert.equal(d.matchedId, "s1");
  assert.equal(d.matchedOn, "shrink barcode 0745853789824");
  assert.deepEqual(d.issues, []);
});

test("a barcode on several products updates none of them, and says which", () => {
  const [d] = buildDrafts([row({ name: "4 x 5L", shrink: "0745853789817", price: "58" })], map, [single, ...bands]);
  assert.equal(d.action, "conflict");
  assert.equal(d.include, false);
  assert.equal(d.matchedId, null);
  assert.equal(d.issues.length, 1);
  assert.match(d.issues[0], /^Shrink barcode 0745853789817 is on 3 products: "4 x 5L \(up to 6\)", "4 x 5L \(7-12\)", "4 x 5L \(13-24\)"\./);
  assert.match(d.issues[0], /SKU code/);
});

test("the SKU code picks one product out of those sharing the barcode", () => {
  const [d] = buildDrafts(
    [row({ name: "4 x 5L (7-12)", shrink: "0745853789817", sku: "5L-2", price: "58" })],
    map,
    [single, ...bands]
  );
  assert.equal(d.action, "update");
  assert.equal(d.matchedId, "b2");
  assert.equal(d.matchedOn, "SKU 5L-2");
  assert.deepEqual(d.changes.map((c) => c.field), ["shrink_price_excl_vat"]);
});

test("the other barcode picks one out when only one of them has it", () => {
  const withUnit = bands.map((b) => (b.id === "b3" ? { ...b, unit_barcode: "6009626680102" } : b));
  const [d] = buildDrafts(
    [row({ name: "4 x 5L (13-24)", unit: "6009626680102", shrink: "0745853789817" })],
    map,
    withUnit
  );
  assert.equal(d.action, "update");
  assert.equal(d.matchedId, "b3");
  assert.equal(d.matchedOn, "unit barcode 6009626680102");
});

test("a SKU and a barcode that point at different products is still a conflict", () => {
  const [d] = buildDrafts(
    [row({ name: "6 x 1.5L", shrink: "0745853789817", sku: "X" })],
    map,
    [single, product("x", "Other", { sku_code: "X" }), ...bands]
  );
  assert.equal(d.action, "conflict");
  assert.match(d.issues[0], /^This row matches two different products: "Other" \(SKU X\) and "4 x 5L \(up to 6\)", "4 x 5L \(7-12\)", "4 x 5L \(13-24\)" \(shrink barcode 0745853789817\)\.$/);
});

test("a barcode nobody has makes a new product", () => {
  const [d] = buildDrafts([row({ name: "New", shrink: "123" })], map, [single, ...bands]);
  assert.equal(d.action, "create");
  assert.equal(d.include, true);
});

test("two rows in one sheet with the same barcode are still held back", () => {
  const drafts = buildDrafts(
    [row({ name: "A", shrink: "999" }), row({ name: "B", shrink: "999" })],
    map,
    []
  );
  assert.equal(drafts[0].action, "create");
  assert.equal(drafts[1].action, "conflict");
  assert.match(drafts[1].issues[0], /Row 2 in this sheet has the same shrink barcode/);
});

test("when only shared barcodes pick a product out, the match names both", () => {
  const a = product("a", "A", { unit_barcode: "111", shrink_barcode: "900" });
  const b = product("b", "B", { unit_barcode: "111", shrink_barcode: "222" });
  const c = product("c", "C", { unit_barcode: "333", shrink_barcode: "222" });
  const [d] = buildDrafts([row({ name: "B", unit: "111", shrink: "222" })], map, [a, b, c]);
  assert.equal(d.action, "update");
  assert.equal(d.matchedId, "b");
  assert.equal(d.matchedOn, "unit barcode 111 and shrink barcode 222");
});
