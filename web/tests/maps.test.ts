import { test } from "node:test";
import assert from "node:assert/strict";
import { googleMapsEmbedUrl, googleMapsUrl, mapsQuery, sitesFoundByName } from "@/lib/maps";
import { siteQuery } from "@/lib/geocode-country";

// A property is found by its street address. The owner's own name for it
// ("Daniels Plot") is not on the map, and with it in the search Google shows a
// list of shops instead of the property.
const property = { name: "Daniels Plot", address: "Plot 120 Rivier Street", city: "Potchefstroom", state: "North West", zip: "2531" };
const outlet = { name: "Choppies Hyper", address: "Game City", city: "Gaborone", state: null, zip: null };

test("a property is searched by its street address, not its name", () => {
  assert.equal(mapsQuery(property), "Plot 120 Rivier Street, Potchefstroom, North West, 2531");
  assert.ok(!googleMapsUrl(property).includes("Daniels"));
  assert.ok(!googleMapsEmbedUrl(property).includes("Daniels"));
});

test("a company that finds its places by name still searches by name first", () => {
  assert.equal(mapsQuery(outlet, true), "Choppies Hyper, Game City, Gaborone");
  assert.equal(mapsQuery(property, true), "Daniels Plot, Plot 120 Rivier Street, Potchefstroom, North West, 2531");
});

test("exact coordinates win, and a place with no address is searched by its name", () => {
  assert.equal(mapsQuery({ ...property, lat: -26.71, lng: 27.1 }), "-26.71,27.1");
  assert.equal(mapsQuery({ name: "Depot", address: null, city: "Gaborone" }), "Depot, Gaborone");
  assert.equal(mapsQuery({ name: "Depot", address: "  ", city: null }), "Depot");
});

test("only a company that delivers to outlets finds its places by name", () => {
  assert.equal(sitesFoundByName(new Set(["distribution", "invoicing"])), true);
  assert.equal(sitesFoundByName(new Set(["invoicing"])), false);
});

test("the address lookup follows the same rule", () => {
  const site = { name: "Daniels Plot", address: "Plot 120 Rivier Street", city: "Potchefstroom" };
  assert.equal(siteQuery(site, "ZA", false), "Plot 120 Rivier Street, Potchefstroom, South Africa");
  assert.equal(siteQuery(site, "ZA", true), "Daniels Plot, Plot 120 Rivier Street, Potchefstroom, South Africa");
  assert.equal(siteQuery({ name: "Depot", address: null, city: null }, "KE", false), "Depot, Kenya");
});
