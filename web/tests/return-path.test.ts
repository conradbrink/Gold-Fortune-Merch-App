// Signing in returns to the page that was asked for, and never to another site.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextParam, returnPath } from "@/lib/return-path";

test("the page asked for travels to the login page", () => {
  assert.equal(nextParam("/platform", ""), "/platform");
  assert.equal(nextParam("/platform/companies/abc", "?tab=modules"), "/platform/companies/abc?tab=modules");
  assert.equal(nextParam("/", ""), null);
  assert.equal(nextParam("/login", ""), null);
});

test("a path on this site is returned to", () => {
  assert.equal(returnPath("/platform"), "/platform");
  assert.equal(returnPath("/platform/founding?x=1"), "/platform/founding?x=1");
});

test("anything else goes home", () => {
  assert.equal(returnPath(null), "/");
  assert.equal(returnPath(""), "/");
  assert.equal(returnPath("https://evil.example"), "/");
  assert.equal(returnPath("//evil.example"), "/");
  assert.equal(returnPath("/\\evil.example"), "/");
  assert.equal(returnPath("/\t/evil.example"), "/");
  assert.equal(returnPath("javascript:alert(1)"), "/");
  assert.equal(returnPath("/login"), "/");
  assert.equal(returnPath("/login?next=/platform"), "/");
});
