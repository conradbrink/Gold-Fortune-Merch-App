// The Today card's line (Stage 7 Part 3): done and under way are counted
// against the plan, so work nobody planned cannot make the plan look done.
import { test } from "node:test";
import assert from "node:assert/strict";
import { todayProgress, type TodayJob } from "@/lib/dashboard-numbers";

const job = (id: string, status: TodayJob["status"], planned: boolean): TodayJob => ({
  id,
  staff: "",
  site: "",
  status,
  at: null,
  planned,
});

test("unplanned work done does not count towards the plan", () => {
  const jobs = [
    job("a", "not_started", true),
    job("b", "not_started", true),
    job("c", "not_started", true),
    job("x", "done", false),
    job("y", "done", false),
  ];
  assert.deepEqual(todayProgress(jobs), { done: 0, underway: 0, of: 3 });
});

test("the plan's own progress", () => {
  const jobs = [job("a", "done", true), job("b", "in_progress", true), job("c", "not_started", true), job("x", "in_progress", false)];
  assert.deepEqual(todayProgress(jobs), { done: 1, underway: 1, of: 3 });
});

test("nothing planned: everything done today counts", () => {
  const jobs = [job("x", "done", false), job("y", "in_progress", false)];
  assert.deepEqual(todayProgress(jobs), { done: 1, underway: 1, of: 2 });
  assert.deepEqual(todayProgress([]), { done: 0, underway: 0, of: 0 });
});
