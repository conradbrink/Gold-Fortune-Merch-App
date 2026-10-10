// Reading Google Analytics for the Acquisition pages: the settings, the signed
// sign-in, and a report, with Google's two endpoints stood in for by a fake fetch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { gaConfig, gaSetup, resetGaCache, runReport, signedAssertion, TICKD_PROPERTY_ID } from "@/lib/ga4";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const email = "tickd-ga-reader@tickd-analytics.iam.gserviceaccount.com";

test("not connected until both secrets are set; the property defaults to Tickd's", () => {
  assert.equal(gaConfig({}), null);
  assert.equal(gaConfig({ GA4_CLIENT_EMAIL: email }), null);
  assert.equal(gaConfig({ GA4_CLIENT_EMAIL: "someone@gmail.com", GA4_PRIVATE_KEY: pem }), null);
  const c = gaConfig({ GA4_CLIENT_EMAIL: email, GA4_PRIVATE_KEY: pem.replace(/\n/g, "\\n") });
  assert.ok(c);
  assert.equal(c.propertyId, TICKD_PROPERTY_ID);
  assert.ok(c.privateKey.includes("\n"), "escaped newlines from Vercel are restored");
  assert.equal(gaConfig({ GA4_CLIENT_EMAIL: email, GA4_PRIVATE_KEY: pem, GA4_PROPERTY_ID: "G-7Q710H1MSW" }), null);
});

test("the sign-in is a JWT signed with the key, for read-only Analytics", () => {
  const jwt = signedAssertion({ propertyId: "1", clientEmail: email, privateKey: pem }, 1_000_000);
  const [h, c, sig] = jwt.split(".");
  const claims = JSON.parse(Buffer.from(c, "base64url").toString());
  assert.equal(claims.iss, email);
  assert.equal(claims.scope, "https://www.googleapis.com/auth/analytics.readonly");
  assert.equal(claims.exp - claims.iat, 3600);
  const verify = createVerify("RSA-SHA256");
  verify.update(`${h}.${c}`);
  assert.ok(verify.verify(publicKey, Buffer.from(sig, "base64url")));
});

test("a report signs in once, asks the property, and reads the rows", async () => {
  resetGaCache();
  const calls: { url: string; body: string }[] = [];
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? "") });
    if (String(url).includes("oauth2")) return Response.json({ access_token: "tok", expires_in: 3600 });
    return Response.json({
      rows: [{ dimensionValues: [{ value: "/founding" }], metricValues: [{ value: "12" }, { value: "0.5" }] }],
    });
  }) as typeof fetch;
  const config = { propertyId: "558341664", clientEmail: email, privateKey: pem };
  const report = { dateRanges: [{ startDate: "2026-10-01", endDate: "2026-10-10" }], dimensions: ["pagePath"], metrics: ["totalUsers", "engagementRate"] };
  const r = await runReport(report, config, fake);
  assert.deepEqual(r, { ok: true, rows: [{ dimensions: ["/founding"], metrics: [12, 0.5] }] });
  assert.ok(calls[1].url.endsWith("/properties/558341664:runReport"));
  assert.deepEqual(JSON.parse(calls[1].body).metrics, [{ name: "totalUsers" }, { name: "engagementRate" }]);
  // Asked again: the answer is kept, Google is not called.
  await runReport(report, config, fake);
  assert.equal(calls.length, 2);
});

test("failures are answers, never thrown", async () => {
  resetGaCache();
  assert.deepEqual(await runReport({ dateRanges: [], metrics: ["totalUsers"] }, null), { ok: false, reason: "not-connected" });
  const refused = (async (url: string | URL | Request) =>
    String(url).includes("oauth2")
      ? Response.json({ error_description: "Invalid JWT Signature." }, { status: 400 })
      : Response.json({})) as typeof fetch;
  const r = await runReport({ dateRanges: [], metrics: ["totalUsers"] }, { propertyId: "1", clientEmail: email, privateKey: pem }, refused);
  assert.equal(r.ok, false);
  assert.match((r as { message?: string }).message ?? "", /Invalid JWT Signature/);
  resetGaCache();
  const denied = (async (url: string | URL | Request) =>
    String(url).includes("oauth2")
      ? Response.json({ access_token: "tok" })
      : Response.json({ error: { message: "User does not have sufficient permissions for this property." } }, { status: 403 })) as typeof fetch;
  const d = await runReport({ dateRanges: [], metrics: ["totalUsers"] }, { propertyId: "1", clientEmail: email, privateKey: pem }, denied);
  assert.deepEqual(d, { ok: false, reason: "error", message: "User does not have sufficient permissions for this property." });
});

test("the usual pasting slips are forgiven", () => {
  const escaped = pem.trim().replace(/\n/g, "\\n");
  // Quote marks and the trailing comma copied from the key file.
  const quoted = gaConfig({ GA4_CLIENT_EMAIL: `"${email}",`, GA4_PRIVATE_KEY: `"${escaped}\\n",` });
  assert.ok(quoted);
  assert.equal(quoted.clientEmail, email);
  assert.ok(quoted.privateKey.startsWith("-----BEGIN PRIVATE KEY-----\n"));
  // The whole key file pasted into either variable.
  const file = JSON.stringify({ type: "service_account", client_email: email, private_key: pem });
  const whole = gaConfig({ GA4_CLIENT_EMAIL: file, GA4_PRIVATE_KEY: file });
  assert.equal(whole?.clientEmail, email);
});

test("a setup that can't be used says which variable, never its value", () => {
  const problem = (env: Record<string, string>) => {
    const r = gaSetup(env);
    return r.ok ? null : r.problem;
  };
  assert.match(problem({}) ?? "", /^GA4_CLIENT_EMAIL isn't set/);
  assert.match(problem({ GA4_CLIENT_EMAIL: "someone@gmail.com" }) ?? "", /^GA4_CLIENT_EMAIL doesn't look like/);
  assert.match(problem({ GA4_CLIENT_EMAIL: email }) ?? "", /^GA4_PRIVATE_KEY isn't set/);
  assert.match(problem({ GA4_CLIENT_EMAIL: email, GA4_PRIVATE_KEY: "MIIEvQIBADAN" }) ?? "", /part of it is missing/);
  const cut = pem.slice(0, 200) + "\n-----END PRIVATE KEY-----\n";
  const cutProblem = problem({ GA4_CLIENT_EMAIL: email, GA4_PRIVATE_KEY: cut }) ?? "";
  assert.match(cutProblem, /couldn't be read as a key/);
  assert.ok(!cutProblem.includes("MII"), "the key itself is never shown");
  assert.equal(problem({ GA4_CLIENT_EMAIL: email, GA4_PRIVATE_KEY: pem }), null);
});
