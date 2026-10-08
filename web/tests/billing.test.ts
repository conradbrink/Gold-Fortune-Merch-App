// Billing (Stage 6): Payfast's formats (signing, the payment form, reading a
// notification, the ad-hoc API's answer), amounts, the banners and refusals,
// and who may open /billing. The database half — prices, charges, invoices,
// the read-only gate — is supabase/tests/billing.sql.
//
// The signing tests rebuild the string Payfast's documentation describes by
// hand and compare digests, rather than replaying a published example; the
// sandbox run (Stage 6 plan) is what proves Payfast agrees.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  amountToCents,
  apiSignature,
  apiTimestamp,
  callerAddress,
  cardUpdateUrl,
  centsToAmount,
  checkoutFields,
  notificationParamString,
  notificationSignatureValid,
  parseNotification,
  payfastConfig,
  phpUrlEncode,
  processUrl,
  readChargeResponse,
  readNotification,
  signOrdered,
  type PayfastConfig,
} from "@/lib/billing/payfast";
import {
  accountNotice,
  billingErrorMessage,
  formatRand,
  formatRandExact,
  normalisePlan,
  parseAccount,
  parseChangePreview,
  parsePlan,
  parseQuote,
  type Account,
} from "@/lib/billing";
import { canAccessPath, toPermissionSet } from "@/lib/permissions";

const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
const config: PayfastConfig = { merchantId: "10000100", merchantKey: "46f0cd694581a", passphrase: "jt7NOE43FZPn", sandbox: true };

test("configuration needs all three keys; sandbox unless PAYFAST_MODE is live", () => {
  assert.equal(payfastConfig({}), null);
  assert.equal(payfastConfig({ PAYFAST_MERCHANT_ID: "1", PAYFAST_MERCHANT_KEY: "k" }), null);
  const c = payfastConfig({ PAYFAST_MERCHANT_ID: " 1 ", PAYFAST_MERCHANT_KEY: "k", PAYFAST_PASSPHRASE: "p" })!;
  assert.deepEqual(c, { merchantId: "1", merchantKey: "k", passphrase: "p", sandbox: true });
  assert.equal(payfastConfig({ PAYFAST_MERCHANT_ID: "1", PAYFAST_MERCHANT_KEY: "k", PAYFAST_PASSPHRASE: "p", PAYFAST_MODE: "live" })!.sandbox, false);
  assert.equal(processUrl(c), "https://sandbox.payfast.co.za/eng/process");
});

test("values are encoded the way PHP's urlencode does it", () => {
  assert.equal(phpUrlEncode("Tickd subscription"), "Tickd+subscription");
  assert.equal(phpUrlEncode("a@b.co.za"), "a%40b.co.za");
  assert.equal(phpUrlEncode("https://x.co/billing?checkout=done"), "https%3A%2F%2Fx.co%2Fbilling%3Fcheckout%3Ddone");
  // encodeURIComponent leaves these alone; PHP does not.
  assert.equal(phpUrlEncode("!'()*~"), "%21%27%28%29%2A%7E");
  assert.equal(phpUrlEncode("-_."), "-_.");
});

test("a signature covers non-empty fields in order, then the passphrase", () => {
  const sig = signOrdered([["merchant_id", "10000100"], ["name_first", ""], ["amount", " 100.00 "], ["item_name", "Plan A"]], "pass word");
  assert.equal(sig, md5("merchant_id=10000100&amount=100.00&item_name=Plan+A&passphrase=pass+word"));
});

test("amounts: cents to Payfast's rands and back", () => {
  assert.equal(centsToAmount(399900), "3999.00");
  assert.equal(centsToAmount(116347), "1163.47");
  assert.equal(centsToAmount(5), "0.05");
  assert.throws(() => centsToAmount(1.5));
  assert.throws(() => centsToAmount(-1));
  assert.equal(amountToCents("3999.00"), 399900);
  assert.equal(amountToCents("1163.4"), 116340);
  assert.equal(amountToCents("12"), 1200);
  assert.equal(amountToCents("-1.00"), null);
  assert.equal(amountToCents("1,000.00"), null);
  assert.equal(amountToCents(null), null);
});

test("the payment form: documented order, tokenization on, signed with the passphrase", () => {
  const fields = checkoutFields(config, {
    chargeId: "0b9f6c1e-2c35-4a7e-9a59-2f8d3c1b7e01",
    totalCents: 399900,
    itemName: "Tickd subscription",
    email: "owner@example.com",
    returnUrl: "https://app.example/billing?checkout=done",
    cancelUrl: "https://app.example/billing?checkout=cancelled",
    notifyUrl: "https://app.example/api/payfast/notify",
  });
  const keys = fields.map(([k]) => k);
  assert.deepEqual(keys, [
    "merchant_id", "merchant_key", "return_url", "cancel_url", "notify_url", "email_address",
    "m_payment_id", "amount", "item_name", "subscription_type", "signature",
  ]);
  const get = (k: string) => fields.find(([key]) => key === k)![1];
  assert.equal(get("amount"), "3999.00");
  assert.equal(get("subscription_type"), "2");
  const unsigned = fields.filter(([k]) => k !== "signature");
  assert.equal(get("signature"), md5(unsigned.map(([k, v]) => `${k}=${phpUrlEncode(v)}`).join("&") + "&passphrase=jt7NOE43FZPn"));
});

test("a notification is read field by field and its signature checked in the order sent", () => {
  const unsigned: [string, string][] = [
    ["m_payment_id", "0b9f6c1e-2c35-4a7e-9a59-2f8d3c1b7e01"],
    ["pf_payment_id", "1089250"],
    ["payment_status", "COMPLETE"],
    ["item_name", "Tickd subscription"],
    ["item_description", ""],
    ["amount_gross", "3999.00"],
    ["amount_fee", "-119.97"],
    ["amount_net", "3879.03"],
    ["merchant_id", "10000100"],
    ["token", "dc0521d3-55fe-269b-fa00-b647310d760f"],
  ];
  const signature = md5(unsigned.map(([k, v]) => `${k}=${phpUrlEncode(v)}`).join("&") + "&passphrase=jt7NOE43FZPn");
  const body = new URLSearchParams([...unsigned, ["signature", signature]]).toString();
  const pairs = parseNotification(body);
  assert.equal(notificationSignatureValid(pairs, config.passphrase), true);
  assert.equal(notificationSignatureValid(pairs, "another passphrase"), false);
  // Tampering with the amount breaks it.
  const tampered = pairs.map(([k, v]) => [k, k === "amount_gross" ? "1.00" : v] as [string, string]);
  assert.equal(notificationSignatureValid(tampered, config.passphrase), false);
  assert.equal(notificationSignatureValid(unsigned, config.passphrase), false);

  assert.equal(notificationParamString(pairs).includes("signature"), false);
  assert.deepEqual(readNotification(pairs), {
    chargeId: "0b9f6c1e-2c35-4a7e-9a59-2f8d3c1b7e01",
    pfPaymentId: "1089250",
    status: "COMPLETE",
    amountCents: 399900,
    token: "dc0521d3-55fe-269b-fa00-b647310d760f",
    merchantId: "10000100",
  });
  assert.equal(readNotification([["m_payment_id", "not-a-charge"]]), null);
});

test("the API signature sorts every field with the passphrase", () => {
  const sig = apiSignature({ "merchant-id": "10000100", version: "v1", timestamp: "2026-10-08T06:00:00+00:00", amount: 149900, item_name: "Plan" }, "pp");
  assert.equal(
    sig,
    md5("amount=149900&item_name=Plan&merchant-id=10000100&passphrase=pp&timestamp=2026-10-08T06%3A00%3A00%2B00%3A00&version=v1")
  );
  assert.equal(apiTimestamp(new Date("2026-10-08T06:00:00.123Z")), "2026-10-08T06:00:00+00:00");
});

test("only an explicit success from the ad-hoc API counts as paid", () => {
  const ok = readChargeResponse(200, { code: 200, status: "success", data: { response: true, message: "Transaction was successful (00)", pf_payment_id: 1124148 } });
  assert.deepEqual(ok.ok && ok.pfPaymentId, "1124148");
  assert.equal(readChargeResponse(200, { code: 200, status: "success", data: { response: false, message: "Declined" } }).ok, false);
  assert.equal(readChargeResponse(400, { code: 400, status: "failed", data: { response: "Invalid token" } }).ok, false);
  assert.equal(readChargeResponse(500, null).ok, false);
  const declined = readChargeResponse(200, { code: 200, status: "success", data: { response: false, message: "Insufficient funds" } });
  assert.equal(!declined.ok && declined.message, "Insufficient funds");
});

test("the caller's address and the card-update link", () => {
  assert.equal(callerAddress("41.74.179.194, 10.0.0.1", null), "41.74.179.194");
  assert.equal(callerAddress(null, " 197.97.145.145 "), "197.97.145.145");
  assert.equal(callerAddress(null, null), null);
  assert.equal(
    cardUpdateUrl(config, "tok en", "https://app.example/billing?card=updated"),
    "https://sandbox.payfast.co.za/eng/recurring/update/tok%20en?return=https%3A%2F%2Fapp.example%2Fbilling%3Fcard%3Dupdated"
  );
});

test("rand is written like the sales site, and exactly on invoices", () => {
  assert.equal(formatRand(149900), "R1,499");
  assert.equal(formatRand(116347), "R1,163.47");
  assert.equal(formatRand(-100000), "-R1,000");
  assert.equal(formatRandExact(149900), "R1,499.00");
  assert.equal(formatRandExact(5), "R0.05");
});

test("database answers are read field by field", () => {
  const q = parseQuote({
    lines: [{ code: "base", label: "Plan with 3 users", quantity: 1, unit_cents: 149900, amount_cents: 149900 },
            { code: "setup", label: "Setup", quantity: 1, unit_cents: 250000, amount_cents: 250000, once: true }],
    total_cents: 399900, custom: false, seats_used: 2, vat: { registered: false, vat_cents: 0 },
  });
  assert.equal(q.totalCents, 399900);
  assert.equal(q.lines[1].once, true);
  assert.equal(q.seatsUsed, 2);
  assert.equal(parseQuote(null).lines.length, 0);
  assert.deepEqual(parsePlan({ seats: 5, addons: { hr: 1, warehouse: 0 } }), { seats: 5, addons: { hr: 1 } });
  assert.equal(parsePlan({ seats: 0 }), null);
  assert.equal(parseChangePreview({ more: true, total_cents: "69800" }).totalCents, 69800);
  assert.equal(parseAccount({ status: "nonsense" }).status, "exempt");
  assert.equal(parseAccount({ status: "read_only", writable: false }).writable, false);
});

test("the plan as the page edits it is clamped to whole, sane numbers", () => {
  assert.deepEqual(normalisePlan(0, { hr: 1, warehouse: 2.7, "bad key": 1, assets: 0 }), { seats: 1, addons: { hr: 1, warehouse: 2 } });
  assert.deepEqual(normalisePlan(5000, { warehouse: 500 }), { seats: 1000, addons: { warehouse: 100 } });
});

const base: Account = {
  status: "active", writable: true, trialEndsAt: null, periodEnd: null, graceEndsAt: null,
  readOnlySince: null, cancelAtPeriodEnd: false, canManage: true,
};

test("the account line: red when it cannot save or a payment failed, amber when a plan is ending, else none", () => {
  const now = new Date("2026-10-08T09:00:00Z");
  assert.equal(accountNotice(base, now), null);
  assert.equal(accountNotice({ ...base, status: "trial", trialEndsAt: "2026-10-20T00:00:00Z" }, now), null);
  assert.equal(accountNotice({ ...base, status: "exempt" }, now), null);
  assert.match(accountNotice({ ...base, status: "read_only", trialEndsAt: "2026-10-01T00:00:00Z" }, now)!.text, /free trial has ended/);
  assert.match(accountNotice({ ...base, status: "read_only", trialEndsAt: "2026-09-01T00:00:00Z", periodEnd: "2026-10-01T00:00:00Z" }, now)!.text, /until the plan is paid/);
  assert.equal(accountNotice({ ...base, status: "past_due", graceEndsAt: "2026-10-15T00:00:00Z" }, now)!.tone, "red");
  assert.match(accountNotice({ ...base, status: "past_due", graceEndsAt: "2026-10-15T00:00:00Z" }, now)!.text, /15 October 2026/);
  assert.equal(accountNotice({ ...base, cancelAtPeriodEnd: true, periodEnd: "2026-11-01T00:00:00Z" }, now)!.tone, "amber");
});

test("refusals from the database are put in words for the screen", () => {
  assert.match(billingErrorMessage({ message: "x", hint: "read_only" })!, /read-only/);
  assert.match(billingErrorMessage({ message: "All 3 user places on your plan are taken.", hint: "user_limit" })!, /Billing page/);
  assert.equal(billingErrorMessage({ message: "Choose monthly or yearly." }), "Choose monthly or yearly.");
  assert.equal(billingErrorMessage(null), null);
});

test("only whoever manages the company settings opens Billing", () => {
  assert.equal(canAccessPath(toPermissionSet(["company_settings"]), "/billing"), true);
  assert.equal(canAccessPath(toPermissionSet(["company_settings"]), "/billing/invoices/0b9f6c1e-2c35-4a7e-9a59-2f8d3c1b7e01"), true);
  assert.equal(canAccessPath(toPermissionSet(["team"]), "/billing"), false);
  assert.equal(canAccessPath(toPermissionSet([]), "/plans"), false);
});
