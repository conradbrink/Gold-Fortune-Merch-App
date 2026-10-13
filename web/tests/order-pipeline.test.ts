// The Orders pipeline card opened up as a page (13 Oct 2026). Its tiles must be
// the card's counts, so the stage rule here is the one dashboard_business
// counts by: new and confirmed are "To confirm", delivered only counts while its
// proof of delivery is outstanding.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeWait,
  enteredAtOf,
  stageFromQuery,
  stageOf,
  stagesInView,
  waitBand,
} from "@/lib/order-pipeline";
import { pipelineHref } from "@/lib/dashboard-links";

test("each status lands in the card's stage", () => {
  assert.equal(stageOf({ status: "new" }), "to_confirm");
  assert.equal(stageOf({ status: "confirmed" }), "to_confirm");
  assert.equal(stageOf({ status: "picking" }), "picking");
  assert.equal(stageOf({ status: "packed" }), "packed");
  assert.equal(stageOf({ status: "dispatched" }), "dispatched");
  assert.equal(stageOf({ status: "delivered", pod_status: "outstanding" }), "no_pod");
  assert.equal(stageOf({ status: "delivered", pod_status: "received" }), null);
  assert.equal(stageOf({ status: "delivered", pod_status: "not_required" }), null);
  assert.equal(stageOf({ status: "cancelled" }), null);
});

test("an order waits from when it reached its stage, falling back to the step before", () => {
  const base = {
    created_at: "2026-10-01T08:00:00Z",
    confirmed_at: "2026-10-02T08:00:00Z",
    picking_started_at: null,
    packed_at: "2026-10-04T08:00:00Z",
    dispatched_at: null,
    delivered_at: null,
  };
  assert.equal(enteredAtOf({ ...base, status: "new" }), base.created_at);
  assert.equal(enteredAtOf({ ...base, status: "confirmed" }), base.confirmed_at);
  // No picking stamp: it has been waiting since it was confirmed, not since now.
  assert.equal(enteredAtOf({ ...base, status: "picking" }), base.confirmed_at);
  assert.equal(enteredAtOf({ ...base, status: "packed" }), base.packed_at);
  assert.equal(enteredAtOf({ ...base, status: "dispatched" }), base.packed_at);
});

test("waits fall into four plain bands", () => {
  assert.equal(waitBand(0), "today");
  assert.equal(waitBand(1), "one_two");
  assert.equal(waitBand(2), "one_two");
  assert.equal(waitBand(3), "three_seven");
  assert.equal(waitBand(7), "three_seven");
  assert.equal(waitBand(8), "over_week");
  assert.equal(describeWait(0), "Today");
  assert.equal(describeWait(1), "1 day");
  assert.equal(describeWait(9), "9 days");
});

test("no stage chosen is the headline's 'needing action': everything not yet delivered", () => {
  assert.deepEqual(stagesInView(null), ["to_confirm", "picking", "packed", "dispatched"]);
  assert.deepEqual(stagesInView("no_pod"), ["no_pod"]);
});

test("every stage link opens its stage", () => {
  for (const s of ["to_confirm", "picking", "packed", "dispatched", "no_pod"] as const) {
    assert.equal(stageFromQuery(new URLSearchParams(pipelineHref(s).split("?")[1])), s);
  }
  assert.equal(pipelineHref(), "/orders/pipeline");
  assert.equal(stageFromQuery(new URLSearchParams("stage=shipped")), null);
});
