// The form presets in the company's words. The description is copied into the
// new form, so Gold Fortune's must read as it always has and a company with
// the neutral words must not be handed "store by store".
import { test } from "node:test";
import assert from "node:assert/strict";
import { findPreset, formPresets } from "@/lib/form-presets";
import { DEFAULT_TERMS, parseTerms } from "@/lib/terms";

const goldFortune = parseTerms({ site: { one: "Store", many: "Stores" } });

test("Gold Fortune's competitor audit reads as it always has", () => {
  const p = findPreset(goldFortune, "competitor-price-audit");
  assert.equal(p?.name, "Competitor Price Audit");
  assert.equal(
    p?.description,
    "Prices, promotions and shelf presence of competing brands, recorded store by store."
  );
});

test("the neutral words say site by site", () => {
  const p = findPreset(DEFAULT_TERMS, "competitor-price-audit");
  assert.equal(
    p?.description,
    "Prices, promotions and shelf presence of competing brands, recorded site by site."
  );
  assert.deepEqual(
    formPresets(DEFAULT_TERMS).map((x) => x.key),
    ["competitor-price-audit"]
  );
  assert.equal(findPreset(DEFAULT_TERMS, "nope"), undefined);
});
