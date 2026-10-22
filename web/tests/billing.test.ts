// Billing (Stage 6; Paystack since 22 Oct 2026): Paystack's formats (the
// webhook signature, references, what we send, what comes back), settling a
// payment once however often Paystack reports it, amounts, the banners and
// refusals, and who may open /billing. The database half — prices from
// price_list, charges, invoices, refusals, the card, retries — is
// supabase/tests/billing_paystack.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  assertCents,
  chargeAuthorizationBody,
  initializeBody,
  loggable,
  makeReference,
  paidInFull,
  parseReference,
  paystackConfig,
  readTransaction,
  signatureValid,
  stillOpen,
  webhookSignature,
  type ChargeMetadata,
  type PaystackConfig,
} from "@/lib/billing/paystack";
import { settle } from "@/lib/billing/server";
import {
  accountNotice,
  billingErrorMessage,
  cardText,
  formatRand,
  formatRandExact,
  normalisePlan,
  parseAccount,
  parseCard,
  parseChangePreview,
  parsePlan,
  parseQuote,
  type Account,
} from "@/lib/billing";
import { canAccessPath, toPermissionSet } from "@/lib/permissions";

const SECRET = "sk_test_0123456789abcdef0123456789abcdef01234567";
const config: PaystackConfig = { secretKey: SECRET, publicKey: "pk_test_x", test: true };
const ORG = "71170c8a-d53c-4a07-bdd4-97704a3cf4bc";
const CHARGE = "0b9f6c1e-2c35-4a7e-9a59-2f8d3c1b7e01";
const REF = `TKD-71170c8a-0b9f6c1e2c354a7e9a592f8d3c1b7e01-1761150000000`;

// ---------------------------------------------------------------- configuration

test("configuration needs a secret key that looks like one; test mode from its prefix", () => {
  assert.equal(paystackConfig({}), null);
  assert.equal(paystackConfig({ PAYSTACK_SECRET_KEY: "  " }), null);
  assert.equal(paystackConfig({ PAYSTACK_SECRET_KEY: "pk_test_abc" }), null, "a public key in the secret's place");
  assert.deepEqual(paystackConfig({ PAYSTACK_SECRET_KEY: ` ${SECRET} `, PAYSTACK_PUBLIC_KEY: "pk_test_x" }), config);
  assert.equal(paystackConfig({ PAYSTACK_SECRET_KEY: "sk_live_abc123" })!.test, false);
});

// ---------------------------------------------------------------- webhook signature

test("the webhook signature is HMAC SHA512 of the raw body with the secret key", () => {
  const body = JSON.stringify({ event: "charge.success", data: { reference: REF, amount: 449500 } });
  const sig = createHmac("sha512", SECRET).update(body).digest("hex");
  assert.equal(webhookSignature(body, SECRET), sig);
  assert.equal(signatureValid(body, sig, SECRET), true);
  assert.equal(signatureValid(body, sig.toUpperCase(), SECRET), true, "hex case does not matter");
});

test("a webhook is refused when the signature is missing, malformed, from another key, or the body changed", () => {
  const body = JSON.stringify({ event: "charge.success", data: { reference: REF, amount: 449500 } });
  const sig = webhookSignature(body, SECRET);
  assert.equal(signatureValid(body, null, SECRET), false);
  assert.equal(signatureValid(body, "", SECRET), false);
  assert.equal(signatureValid(body, "abc", SECRET), false);
  assert.equal(signatureValid(body, sig.slice(0, 127), SECRET), false);
  assert.equal(signatureValid(body, webhookSignature(body, "sk_test_someoneelse"), SECRET), false);
  // One cent more in the same body: the signature no longer fits.
  assert.equal(signatureValid(body.replace("449500", "449501"), sig, SECRET), false);
  // Re-serialised JSON is a different body: the raw text is what is signed.
  assert.equal(signatureValid(JSON.stringify(JSON.parse(body), null, 1), sig, SECRET), false);
});

// ---------------------------------------------------------------- references

test("a reference names the company and the charge, and leads back to the charge", () => {
  const ref = makeReference(ORG, CHARGE, new Date(1761150000000));
  assert.equal(ref, REF);
  assert.deepEqual(parseReference(ref), { orgPrefix: "71170c8a", chargeId: CHARGE });
  assert.equal(parseReference("T_123"), null);
  assert.equal(parseReference(`${REF}x`), null);
  assert.equal(parseReference(null), null);
  assert.throws(() => makeReference("not-a-uuid", CHARGE));
  // Only the characters Paystack allows in a reference.
  assert.match(ref, /^[A-Za-z0-9.=-]+$/);
});

// ---------------------------------------------------------------- amounts and what we send

test("amounts are whole, positive cents or nothing is sent", () => {
  assert.equal(assertCents(449500), 449500);
  for (const bad of [0, -100, 4495.5, Number.NaN, "449500", null, 2 ** 60]) {
    assert.throws(() => assertCents(bad), `${String(bad)} was accepted`);
  }
});

const metadata: ChargeMetadata = {
  organization_id: ORG, charge_id: CHARGE, reason: "subscribe", reps: 4, period: "monthly",
  includes_setup_fee: true, method: "checkout", purpose: "subscribe",
};

test("checkout: the charge's amount in cents, ZAR, card only, our reference and callback", () => {
  const body = initializeBody({
    email: "owner@example.com", amountCents: 449500, reference: REF,
    callbackUrl: "https://app.tickd.co.za/billing/callback", metadata,
  });
  assert.deepEqual(body, {
    email: "owner@example.com", amount: 449500, currency: "ZAR", channels: ["card"], reference: REF,
    callback_url: "https://app.tickd.co.za/billing/callback", metadata,
  });
  assert.throws(() => initializeBody({ email: "x@y.z", amountCents: 4495.0001, reference: REF, callbackUrl: "", metadata }));
});

test("a saved-card charge is queued, in ZAR, for the charge's cents", () => {
  const body = chargeAuthorizationBody({
    authorizationCode: "AUTH_abc123", email: "owner@example.com", amountCents: 199500, reference: REF,
    metadata: { ...metadata, method: "saved_card", reason: "renewal", includes_setup_fee: false },
  });
  assert.equal(body.queue, true);
  assert.equal(body.currency, "ZAR");
  assert.equal(body.amount, 199500);
  assert.equal(body.authorization_code, "AUTH_abc123");
});

// ---------------------------------------------------------------- what comes back

const paystackTx = {
  id: 4099260516,
  status: "success",
  reference: REF,
  amount: 449500,
  currency: "ZAR",
  gateway_response: "Successful",
  paid_at: "2026-10-22T19:00:00.000Z",
  channel: "card",
  metadata: JSON.stringify(metadata),
  authorization: {
    authorization_code: "AUTH_8dfhjjdt", bin: "408408", last4: "4081", exp_month: "12", exp_year: "2030",
    channel: "card", card_type: "visa ", bank: "TEST BANK", country_code: "ZA", brand: "visa", reusable: true,
    signature: "SIG_yEXu7dLBeqG0kU7g95Ke",
  },
  customer: { email: "owner@example.com", customer_code: "CUS_xnxdt6s1zg1f4nx" },
};

test("a transaction is read field by field, metadata as object or string", () => {
  const tx = readTransaction(paystackTx);
  assert.equal(tx.status, "success");
  assert.equal(tx.amountCents, 449500);
  assert.equal(tx.currency, "ZAR");
  assert.equal(tx.metadata.charge_id, CHARGE);
  assert.equal(tx.card?.authorization_code, "AUTH_8dfhjjdt");
  assert.equal(tx.card?.reusable, true);
  assert.equal(tx.card?.email, "owner@example.com");
  assert.equal(readTransaction({ ...paystackTx, metadata }).metadata.method, "checkout");
  assert.equal(readTransaction({ ...paystackTx, amount: "449500" }).amountCents, null, "an amount must be a number");
  assert.equal(readTransaction({ ...paystackTx, authorization: {} }).card, null);
  assert.equal(readTransaction(null).status, "");
});

test("paid in full only for success, ZAR and the charge's exact amount", () => {
  const tx = readTransaction(paystackTx);
  assert.equal(paidInFull(tx, 449500), true);
  assert.equal(paidInFull(tx, 449501), false);
  assert.equal(paidInFull({ ...tx, currency: "NGN" }, 449500), false);
  assert.equal(paidInFull({ ...tx, status: "abandoned" }, 449500), false);
  assert.equal(stillOpen({ ...tx, status: "queued" }), true);
  assert.equal(stillOpen({ ...tx, status: "failed" }), false);
});

test("the payment log never keeps the code that charges the card", () => {
  const kept = JSON.stringify(loggable(paystackTx));
  assert.doesNotMatch(kept, /AUTH_/);
  assert.doesNotMatch(kept, /SIG_/);
  assert.match(kept, /4081/);
});

// ---------------------------------------------------------------- settling once

type Call = [string, Record<string, unknown>];

/**
 * A stand-in for the service-role client: the charge as the database has it,
 * and `billing_paystack_paid` as the database answers it — the first success
 * for a charge is "paid", any later one "duplicate", a wrong amount or
 * currency "refused" (supabase/tests/billing_paystack.sql proves the real one).
 */
function fakeDatabase(charge: { id: string; org_id: string; reason: string; status: string; total_cents: number }) {
  const calls: Call[] = [];
  const logged: Record<string, unknown>[] = [];
  let invoices = 0;
  const admin = {
    from(table: string) {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: table === "billing_charges" ? charge : null, error: null }),
        insert: async (row: Record<string, unknown>) => {
          logged.push(row);
          return { error: null };
        },
      };
      return q;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push([name, args]);
      if (name === "billing_paystack_paid") {
        if (args.p_currency !== "ZAR" || args.p_amount_cents !== charge.total_cents) {
          return { data: { outcome: "refused", reason: charge.reason }, error: null };
        }
        if (charge.status === "paid") return { data: { outcome: "duplicate", reason: charge.reason }, error: null };
        charge.status = "paid";
        invoices += charge.reason === "card" ? 0 : 1;
        return {
          data: { outcome: "paid", reason: charge.reason, invoice_id: charge.reason === "card" ? null : "inv-1", card_saved: args.p_card !== null },
          error: null,
        };
      }
      return { data: null, error: null };
    },
  };
  return { admin: admin as never, calls, logged, invoices: () => invoices, charge };
}

test("the same successful reference from the webhook, the callback and our own charge is one payment", async () => {
  const db = fakeDatabase({ id: CHARGE, org_id: ORG, reason: "subscribe", status: "pending", total_cents: 449500 });
  const tx = readTransaction(paystackTx);
  const first = await settle(db.admin, config, tx, paystackTx, "verify");
  const second = await settle(db.admin, config, tx, paystackTx, "webhook");
  const third = await settle(db.admin, config, tx, paystackTx, "charge");
  assert.deepEqual(first, { kind: "paid", reason: "subscribe", invoiceId: "inv-1", cardSaved: true });
  assert.equal(second.kind, "duplicate");
  assert.equal(third.kind, "duplicate");
  assert.equal(db.invoices(), 1);
  // Every call hands the database the charge, the reference and Paystack's own amount and currency.
  for (const [name, args] of db.calls) {
    assert.equal(name, "billing_paystack_paid");
    assert.equal(args.p_charge, CHARGE);
    assert.equal(args.p_reference, REF);
    assert.equal(args.p_amount_cents, 449500);
    assert.equal(args.p_currency, "ZAR");
    assert.doesNotMatch(JSON.stringify(args.p_payload), /AUTH_/);
  }
});

test("a success for another amount or currency is refused, not paid", async () => {
  const db = fakeDatabase({ id: CHARGE, org_id: ORG, reason: "subscribe", status: "pending", total_cents: 449500 });
  assert.equal((await settle(db.admin, config, readTransaction({ ...paystackTx, amount: 100 }), paystackTx, "webhook")).kind, "refused");
  assert.equal((await settle(db.admin, config, readTransaction({ ...paystackTx, currency: "NGN" }), paystackTx, "webhook")).kind, "refused");
  assert.equal(db.charge.status, "pending");
  assert.equal(db.invoices(), 0);
});

test("a card Paystack cannot charge again is not handed to the database to keep", async () => {
  const db = fakeDatabase({ id: CHARGE, org_id: ORG, reason: "subscribe", status: "pending", total_cents: 449500 });
  const once = { ...paystackTx, authorization: { ...paystackTx.authorization, reusable: false } };
  await settle(db.admin, config, readTransaction(once), once, "verify");
  assert.equal(db.calls[0][1].p_card, null);
});

test("not our reference: left alone, nothing recorded", async () => {
  const db = fakeDatabase({ id: CHARGE, org_id: ORG, reason: "subscribe", status: "pending", total_cents: 449500 });
  const outcome = await settle(db.admin, config, readTransaction({ ...paystackTx, reference: "T_somewhere_else" }), {}, "webhook");
  assert.equal(outcome.kind, "ignored");
  assert.equal(db.calls.length, 0);
});

test("a failed saved-card charge is a failed try; a failure on Paystack's page is only logged", async () => {
  const failed = { ...paystackTx, status: "failed", gateway_response: "Insufficient Funds" };
  const renewal = fakeDatabase({ id: CHARGE, org_id: ORG, reason: "renewal", status: "pending", total_cents: 199500 });
  const r = await settle(renewal.admin, config, readTransaction({ ...failed, metadata: { ...metadata, method: "saved_card" } }), failed, "charge");
  assert.deepEqual(r, { kind: "failed", message: "Insufficient Funds" });
  assert.equal(renewal.calls[0][0], "billing_record_failure");
  assert.equal(renewal.calls[0][1].p_detail, "Paystack: Insufficient Funds");

  const page = fakeDatabase({ id: CHARGE, org_id: ORG, reason: "subscribe", status: "pending", total_cents: 449500 });
  await settle(page.admin, config, readTransaction(failed), failed, "verify");
  assert.equal(page.calls.length, 0);
  assert.equal(page.logged.length, 1);
  assert.equal(page.logged[0].outcome, "event");
});

test("a paid card check is refunded once, however often it is reported", async () => {
  const db = fakeDatabase({ id: CHARGE, org_id: ORG, reason: "card", status: "pending", total_cents: 100 });
  const tx = readTransaction({ ...paystackTx, amount: 100 });
  const refunds: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    refunds.push(`${url} ${String(init.body)}`);
    return new Response(JSON.stringify({ status: true, message: "Refund has been queued for processing", data: {} }), { status: 200 });
  }) as typeof fetch;
  try {
    assert.equal((await settle(db.admin, config, tx, paystackTx, "verify")).kind, "paid");
    assert.equal((await settle(db.admin, config, tx, paystackTx, "webhook")).kind, "duplicate");
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(refunds.length, 1);
  assert.match(refunds[0], /^https:\/\/api\.paystack\.co\/refund /);
  assert.ok(refunds[0].includes(REF));
  assert.equal(db.invoices(), 0);
  assert.equal(db.logged.find((l) => l.source === "refund")?.outcome, "refunded");
});

// ---------------------------------------------------------------- the page's words

test("rand is written like the sales site, and exactly on invoices", () => {
  assert.equal(formatRand(199500), "R1,995");
  assert.equal(formatRand(116347), "R1,163.47");
  assert.equal(formatRand(-100000), "-R1,000");
  assert.equal(formatRandExact(199500), "R1,995.00");
  assert.equal(formatRandExact(5), "R0.05");
});

test("database answers are read field by field", () => {
  const q = parseQuote({
    lines: [{ code: "base", label: "Plan for up to 5 reps", quantity: 1, unit_cents: 199500, amount_cents: 199500 },
            { code: "setup", label: "Setup", quantity: 1, unit_cents: 250000, amount_cents: 250000, once: true }],
    total_cents: 449500, custom: false, seats_used: 4, vat: { registered: false, vat_cents: 0 },
  });
  assert.equal(q.totalCents, 449500);
  assert.equal(q.lines[1].once, true);
  assert.equal(q.seatsUsed, 4);
  assert.equal(parseQuote(null).lines.length, 0);
  assert.deepEqual(parsePlan({ seats: 5, addons: { hr: 1, warehouse: 0 } }), { seats: 5, addons: { hr: 1 } });
  assert.equal(parsePlan({ seats: 0 }), null);
  assert.equal(parseChangePreview({ more: true, total_cents: "69800" }).totalCents, 69800);
  assert.equal(parseAccount({ status: "nonsense" }).status, "exempt");
  assert.equal(parseAccount({ status: "read_only", writable: false }).writable, false);
});

test("the card on file shows brand, last 4 and expiry, and nothing else", () => {
  const card = parseCard({ brand: "visa", last4: "4081", exp_month: 12, exp_year: 2030, authorization_code: "AUTH_x" });
  assert.deepEqual(card, { brand: "visa", last4: "4081", expMonth: 12, expYear: 2030 });
  assert.equal(cardText(card!), "Visa ending 4081, expires 12/2030");
  assert.equal(cardText({ brand: "mastercard", last4: "5100", expMonth: 3, expYear: 2029 }), "Mastercard ending 5100, expires 03/2029");
  assert.equal(parseCard(null), null);
  assert.equal(parseCard({ last4: "12" }), null);
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
  // An ended pilot that is still a pilot (trial_end_read_only off) shows no line.
  assert.equal(accountNotice({ ...base, status: "trial", trialEndsAt: "2026-10-01T00:00:00Z" }, now), null);
  assert.equal(accountNotice({ ...base, status: "exempt" }, now), null);
  assert.match(accountNotice({ ...base, status: "read_only", trialEndsAt: "2026-10-01T00:00:00Z" }, now)!.text, /free pilot has ended/);
  assert.match(accountNotice({ ...base, status: "read_only", trialEndsAt: "2026-09-01T00:00:00Z", periodEnd: "2026-10-01T00:00:00Z" }, now)!.text, /until the plan is paid/);
  assert.equal(accountNotice({ ...base, status: "past_due", graceEndsAt: "2026-10-15T00:00:00Z" }, now)!.tone, "red");
  assert.match(accountNotice({ ...base, status: "past_due", graceEndsAt: "2026-10-15T00:00:00Z" }, now)!.text, /15 October 2026/);
  assert.equal(accountNotice({ ...base, cancelAtPeriodEnd: true, periodEnd: "2026-11-01T00:00:00Z" }, now)!.tone, "amber");
});

test("refusals from the database are put in words for the screen", () => {
  assert.match(billingErrorMessage({ message: "x", hint: "read_only" })!, /read-only/);
  assert.match(billingErrorMessage({ message: "All 5 places on your plan are taken.", hint: "user_limit" })!, /Add places on the Plan and billing page/);
  assert.equal(billingErrorMessage({ message: "Choose monthly or yearly." }), "Choose monthly or yearly.");
  assert.equal(billingErrorMessage(null), null);
});

test("only whoever manages the company settings opens Billing and its callback", () => {
  assert.equal(canAccessPath(toPermissionSet(["company_settings"]), "/billing"), true);
  assert.equal(canAccessPath(toPermissionSet(["company_settings"]), "/billing/callback"), true);
  assert.equal(canAccessPath(toPermissionSet(["company_settings"]), "/billing/invoices/0b9f6c1e-2c35-4a7e-9a59-2f8d3c1b7e01"), true);
  assert.equal(canAccessPath(toPermissionSet(["team"]), "/billing"), false);
  assert.equal(canAccessPath(toPermissionSet([]), "/plans"), false);
});
