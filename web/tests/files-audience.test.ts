// Who a shared file is for, in the company's words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { audienceLabels } from "@/lib/files";
import { DEFAULT_TERMS, parseTerms } from "@/lib/terms";

const goldFortune = parseTerms({
  site_group: { one: "Chain", many: "Chains" },
  staff: { one: "Rep", many: "Reps" },
});

test("Gold Fortune's audience choices read as they always have", () => {
  assert.deepEqual(audienceLabels(goldFortune), {
    everyone: "Everyone",
    reps: "Selected reps",
    groups: "By chain",
  });
});

test("the neutral words name staff and groups", () => {
  assert.deepEqual(audienceLabels(DEFAULT_TERMS), {
    everyone: "Everyone",
    reps: "Selected staff",
    groups: "By group",
  });
});
