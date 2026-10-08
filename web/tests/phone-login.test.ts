// Phone-number sign-in for staff without email (Stage 7 Part 2). The login a
// number becomes is permanent, so these pin its exact form.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  browserCountries,
  displayLogin,
  formatPhone,
  isPhoneLogin,
  loginCandidates,
  loginPhone,
  normalisePhone,
  phoneLogin,
  whatsappLink,
} from "@/lib/phone-login";

test("a South African mobile number, typed any usual way, is one number", () => {
  for (const typed of ["082 555 0142", "0825550142", "082-555-0142", "+27 82 555 0142", "0027825550142", " +27825550142 "]) {
    assert.equal(normalisePhone(typed, "ZA"), "+27825550142", typed);
  }
});

test("a Botswana mobile number is read in Botswana", () => {
  assert.equal(normalisePhone("71 234 567", "BW"), "+26771234567");
  assert.equal(normalisePhone("+267 71 234 567", "ZA"), "+26771234567");
});

test("not a phone number: refused, not guessed", () => {
  assert.equal(normalisePhone("", "ZA"), null);
  assert.equal(normalisePhone("thabo", "ZA"), null);
  assert.equal(normalisePhone("12345", "ZA"), null);
  assert.equal(normalisePhone("0825550142", null), null); // no country and no +
  assert.equal(normalisePhone("082 555", "ZA"), null); // too short
  assert.equal(normalisePhone("082 555 0142 999", "ZA"), null); // too long
  assert.equal(normalisePhone("011 555 0142", "ZA"), null); // a landline: WhatsApp and the app need a mobile
});

test("the login a number becomes, and back", () => {
  assert.equal(phoneLogin("+27825550142"), "27825550142@staff.tickd.co.za");
  assert.equal(isPhoneLogin("27825550142@staff.tickd.co.za"), true);
  assert.equal(isPhoneLogin("27825550142@STAFF.TICKD.CO.ZA"), true);
  assert.equal(isPhoneLogin("thabo@staff.tickd.co.za"), false);
  assert.equal(isPhoneLogin("27825550142@tickd.co.za"), false);
  assert.equal(isPhoneLogin("27825550142@staff.tickd.co.za.evil.com"), false);
  assert.equal(isPhoneLogin(null), false);
  assert.equal(displayLogin("27825550142@staff.tickd.co.za"), "+27 82 555 0142");
  assert.equal(displayLogin("thabo@example.com"), "thabo@example.com");
  assert.equal(formatPhone("+26771234567"), "+267 71 234 567");
});

test("a phone login's own number, which the routes keep as the person's phone", () => {
  assert.equal(loginPhone("27825550142@staff.tickd.co.za"), "+27825550142");
  assert.equal(loginPhone("26771234567@STAFF.TICKD.CO.ZA"), "+26771234567");
  assert.equal(loginPhone(phoneLogin("+27825550142")), "+27825550142");
  assert.equal(loginPhone("thabo@example.com"), null);
  assert.equal(loginPhone("thabo@staff.tickd.co.za"), null);
  assert.equal(loginPhone(""), null);
  assert.equal(loginPhone(null), null);
});

test("sign-in: an email as typed; a number read in the browser's countries", () => {
  assert.deepEqual(loginCandidates(" Thabo@Example.com ", ["ZA"]), ["thabo@example.com"]);
  assert.deepEqual(loginCandidates("082 555 0142", ["ZA"]), ["27825550142@staff.tickd.co.za"]);
  assert.deepEqual(loginCandidates("+267 71 234 567", ["ZA"]), ["26771234567@staff.tickd.co.za"]);
  assert.deepEqual(loginCandidates("082 555 0142", ["US", "ZA"]), ["27825550142@staff.tickd.co.za"]);
  assert.deepEqual(loginCandidates("082 555 0142", []), []);
  assert.deepEqual(loginCandidates("thabo", ["ZA"]), []);
});

test("the browser's countries come from its languages, in order, once each", () => {
  assert.deepEqual(browserCountries(["en-ZA", "af-ZA", "en-US", "en", "tn_BW"]), ["ZA", "US", "BW"]);
  assert.deepEqual(browserCountries(["en"]), []);
});

test("WhatsApp: to the number when there is one, the text encoded", () => {
  assert.equal(whatsappLink("+27825550142", "Hi Thabo & co"), "https://wa.me/27825550142?text=Hi%20Thabo%20%26%20co");
  assert.equal(whatsappLink(null, "Hi"), "https://wa.me/?text=Hi");
});
