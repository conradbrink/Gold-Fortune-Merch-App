// The WhatsApp welcome for a new staff member (Stage 7 Part 2): it must tell
// them exactly what to type into today's app, which has only an Email box.
import { test } from "node:test";
import assert from "node:assert/strict";
import { welcomeMessage } from "@/lib/welcome-message";
import { DEFAULT_TERMS } from "@/lib/terms";

const base = {
  fullName: "Thabo Mokoena",
  company: "Sparkle Clean",
  password: "K7mp-Qx4r",
  downloadUrl: "https://app.example.com/download",
  terms: DEFAULT_TERMS,
};

test("a phone login is spelled out for the Email box", () => {
  const m = welcomeMessage({ ...base, login: "27825550142@staff.tickd.co.za" });
  assert.match(m, /^Hi Thabo, this is Sparkle Clean\./);
  assert.match(m, /In the Email box type 27825550142@staff\.tickd\.co\.za and the password K7mp-Qx4r/);
  assert.match(m, /https:\/\/app\.example\.com\/download/);
  assert.match(m, /Tap "Start workday"/);
});

test("an email login is named as it is", () => {
  const m = welcomeMessage({ ...base, login: "thabo@example.com" });
  assert.match(m, /Use thabo@example\.com and the password K7mp-Qx4r/);
  assert.doesNotMatch(m, /Email box/);
});

test("the company's word for a workday", () => {
  const terms = { ...DEFAULT_TERMS, workday: { one: "Shift", many: "Shifts", article: null } };
  assert.match(welcomeMessage({ ...base, login: "thabo@example.com", terms }), /Tap "Start shift"/);
});
