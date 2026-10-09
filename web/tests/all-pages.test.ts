// Report rows past the API's 1,000-row limit (CodeRabbit on #102).
import { test } from "node:test";
import assert from "node:assert/strict";
import { allPages } from "@/lib/all-pages";

const source = Array.from({ length: 2345 }, (_, i) => i);
const page = (from: number, to: number) => Promise.resolve({ data: source.slice(from, to + 1), error: null });

test("every row comes back, in order, across pages", async () => {
  assert.deepEqual(await allPages(page), source);
  assert.deepEqual(await allPages(page, 500), source);
});

test("an exact multiple of the page size ends on an empty page", async () => {
  const calls: number[] = [];
  const rows = await allPages((from, to) => {
    calls.push(from);
    return Promise.resolve({ data: source.slice(0, 2000).slice(from, to + 1), error: null });
  });
  assert.equal(rows.length, 2000);
  assert.deepEqual(calls, [0, 1000, 2000]);
});

test("an error on any page fails the whole fetch", async () => {
  await assert.rejects(
    allPages((from) => Promise.resolve(from === 1000 ? { data: null, error: { message: "boom" } } : { data: source.slice(0, 1000), error: null })),
    /boom/
  );
});
