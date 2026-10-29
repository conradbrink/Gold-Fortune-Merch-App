// A driver's or a rep's stops put in order by Google: the request, and the
// answer read back into ids (lib/route-plan.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isLatLng,
  MAX_STOPS,
  orderFromAnswer,
  plannedIds,
  routesRequest,
  stopFor,
  stopForRoute,
  type Stop,
} from "@/lib/route-plan";
import { LIMITS } from "@/lib/rate-limit";

// Klerksdorp, with Potchefstroom 45 km east and Orkney 25 km south-west.
const warehouse = { lat: -26.85, lng: 26.66 };
const potch: Stop = { id: "potch", at: { lat: -26.71, lng: 27.1 }, address: null };
const orkney: Stop = { id: "orkney", at: { lat: -26.98, lng: 26.67 }, address: null };
const stilfontein: Stop = { id: "stil", at: { lat: -26.84, lng: 26.77 }, address: null };
const noPin: Stop = { id: "nopin", at: null, address: "Main Road, Hartbeesfontein" };

test("Google's request ends at the furthest stop and orders the rest", () => {
  const plan = routesRequest(warehouse, [potch, orkney, noPin, stilfontein]);
  assert.equal(plan.endId, "potch");
  assert.deepEqual(plan.middleIds, ["orkney", "nopin", "stil"]);
  const body = plan.body as {
    optimizeWaypointOrder: boolean;
    routingPreference: string;
    intermediates: unknown[];
    destination: unknown;
  };
  assert.equal(body.optimizeWaypointOrder, true);
  assert.notEqual(body.routingPreference, "TRAFFIC_AWARE_OPTIMAL");
  assert.deepEqual(body.intermediates[1], { address: "Main Road, Hartbeesfontein" });
  assert.deepEqual(body.destination, { location: { latLng: { latitude: -26.71, longitude: 27.1 } } });
});

test("with no pins at all, the last stop is the end", () => {
  const a: Stop = { id: "a", at: null, address: "A" };
  const b: Stop = { id: "b", at: null, address: "B" };
  assert.equal(routesRequest(warehouse, [a, b]).endId, "b");
});

test("one stop, or too many, is not sent to Google", () => {
  assert.throws(() => routesRequest(warehouse, [potch]));
  const many = Array.from({ length: MAX_STOPS + 1 }, (_, i) => ({ ...potch, id: `s${i}` }));
  assert.throws(() => routesRequest(warehouse, many));
});

test("Google's order is read back into ids, the end last", () => {
  const plan = { endId: "potch", middleIds: ["orkney", "nopin", "stil"] };
  const got = orderFromAnswer(
    { routes: [{ optimizedIntermediateWaypointIndex: [2, 0, 1], distanceMeters: 81000, duration: "4200s" }] },
    plan
  );
  assert.deepEqual(got, { order: ["stil", "orkney", "nopin", "potch"], distanceMeters: 81000, durationSeconds: 4200 });
});

test("an answer that drops or repeats a stop is refused", () => {
  const plan = { endId: "e", middleIds: ["a", "b", "c"] };
  assert.equal(orderFromAnswer({ routes: [{ optimizedIntermediateWaypointIndex: [0, 1] }] }, plan), null);
  assert.equal(orderFromAnswer({ routes: [{ optimizedIntermediateWaypointIndex: [0, 0, 1] }] }, plan), null);
  assert.equal(orderFromAnswer({ routes: [{ optimizedIntermediateWaypointIndex: [0, 1, 3] }] }, plan), null);
  assert.equal(orderFromAnswer({ routes: [] }, plan), null);
});

test("one stop in the middle may come back with no index", () => {
  assert.deepEqual(
    orderFromAnswer({ routes: [{}] }, { endId: "e", middleIds: ["a"] })?.order,
    ["a", "e"]
  );
});

test("a typed delivery address beats the pin; the pin beats the shop's address", () => {
  const store = { name: "Spar", address: "1 Church St", city: "Potchefstroom", state: null, lat: -26.7, lng: 27.1 };
  assert.deepEqual(stopFor({ id: "d", order: { delivery_address: " Back gate, 3 Wolmarans St ", store } }), {
    id: "d",
    at: null,
    address: "Back gate, 3 Wolmarans St",
  });
  assert.deepEqual(stopFor({ id: "d", order: { delivery_address: null, store } }).at, { lat: -26.7, lng: 27.1 });
  assert.equal(
    stopFor({ id: "d", order: { delivery_address: "", store: { ...store, lat: null, lng: null } } }).address,
    "Spar, 1 Church St, Potchefstroom"
  );
  assert.equal(stopFor({ id: "d", order: null }).address, null);
});

test("only a real latitude and longitude is a place", () => {
  assert.ok(isLatLng({ lat: -26.8, lng: 26.6 }));
  assert.ok(!isLatLng({ lat: 91, lng: 0 }));
  assert.ok(!isLatLng({ lat: "1", lng: 2 }));
  assert.ok(!isLatLng(null));
});

test("Plan my route is ten Google calls a day per person (owner, 29 Oct 2026)", () => {
  assert.equal(LIMITS.routePlan.limit, 10);
  assert.equal(LIMITS.routePlan.windowSeconds, 86_400);
});

test("a rep's visit is found by the shop's pin, else its name and address", () => {
  const store = { name: "Spar", address: "1 Church St", city: "Potchefstroom", state: null, lat: -26.7, lng: 27.1 };
  assert.deepEqual(stopForRoute({ id: "r", store }), { id: "r", at: { lat: -26.7, lng: 27.1 }, address: null });
  assert.equal(stopForRoute({ id: "r", store: { ...store, lat: null } }).address, "Spar, 1 Church St, Potchefstroom");
  assert.equal(stopForRoute({ id: "r", store: null }).address, null);
});

test("the phone asks for deliveries or visits, never both, each once", () => {
  assert.deepEqual(plannedIds({ dispatchIds: ["a", "b", "a", 3] }), { kind: "dispatches", ids: ["a", "b"] });
  assert.deepEqual(plannedIds({ routeIds: ["r1", "r2"] }), { kind: "routes", ids: ["r1", "r2"] });
  assert.equal(plannedIds({ dispatchIds: ["a"], routeIds: ["r"] }), null);
  assert.equal(plannedIds({ routeIds: "r1" }), null);
  assert.equal(plannedIds({}), null);
  assert.equal(plannedIds(null), null);
});
