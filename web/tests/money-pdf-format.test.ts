// The same invoice PDF printed "3 000,00" from a South African browser and
// "3,000.00" from a US one; the amounts on a money document must not depend on
// who downloads it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { money } from "@/lib/money-pdf";

test("amounts print one way whatever the viewer's locale", () => {
  assert.equal(money(3000), "3,000.00");
  assert.equal(money(1500.5), "1,500.50");
  assert.equal(money(0), "0.00");
  assert.equal(money(-12.345), "-12.35");
  // No no-break or narrow spaces, which the PDF font cannot draw.
  assert.doesNotMatch(money(1234567.89), /[  ]/);
});
