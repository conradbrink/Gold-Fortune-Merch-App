// Geocoding in the company's own country instead of always Botswana. For Gold
// Fortune (BW) the query Google sees must be exactly what it always was.
import { test } from "node:test";
import assert from "node:assert/strict";
import { countryName, inCountry, normaliseCountry, siteQuery } from "@/lib/geocode-country";

const store = { name: "Choppies Hyper", address: "Game City", city: "Gaborone" };

test("Gold Fortune's query is unchanged", () => {
  // The old route built [name, address, city, "Botswana"].join(", ").
  assert.equal(siteQuery(store, "BW"), "Choppies Hyper, Game City, Gaborone, Botswana");
});

test("another country, and none", () => {
  assert.equal(siteQuery(store, "ZA"), "Choppies Hyper, Game City, Gaborone, South Africa");
  assert.equal(siteQuery(store, null), "Choppies Hyper, Game City, Gaborone");
  assert.equal(siteQuery({ name: "Depot", address: null, city: null }, "KE"), "Depot, Kenya");
});

test("the setting is read strictly", () => {
  assert.equal(normaliseCountry("bw"), "BW");
  assert.equal(normaliseCountry(""), null);
  assert.equal(normaliseCountry("Botswana"), null);
  assert.equal(normaliseCountry(undefined), null);
  assert.equal(countryName("BW"), "Botswana");
});

test("a result is in the country by its code, else by its address", () => {
  assert.equal(inCountry("BW", { formattedAddress: "x", countryCode: "BW" }), true);
  assert.equal(inCountry("BW", { formattedAddress: "Gaborone, Botswana", countryCode: "ZA" }), false);
  assert.equal(inCountry("BW", { formattedAddress: "Game City, Gaborone, Botswana" }), true);
  assert.equal(inCountry("BW", { formattedAddress: "Sandton, Johannesburg, South Africa" }), false);
  assert.equal(inCountry(null, { formattedAddress: "anywhere" }), true);
});
