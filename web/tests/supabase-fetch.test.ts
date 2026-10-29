// Every Supabase client sends a request once more when the API refuses a good
// token as "JWT issued at future" (PGRST303), and only then. It also reports to
// Sentry the failures that mean something is broken, even when the page
// catches them, and not the refusals that are the app working.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SKEW_RETRY_DELAY_MS,
  failureOf,
  withFailureReport,
  withSkewRetry,
  type SupabaseFailure,
} from "@/lib/supabase/fetch";
import { REPORT_QUIET_MS, firstInAWhile, scrubEvent } from "@/lib/monitoring";

const issuedAtFuture = () =>
  new Response(JSON.stringify({ code: "PGRST303", details: null, hint: null, message: "JWT issued at future" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
const ok = (body: unknown = [{ value: 60 }]) => new Response(JSON.stringify(body), { status: 200 });

/** A fetch that answers from a list, and remembers what it was asked. */
function scripted(...answers: Array<() => Response>) {
  const calls: Array<{ input: unknown; init: RequestInit | undefined }> = [];
  const fetch = (async (input: unknown, init?: RequestInit) => {
    calls.push({ input, init });
    const next = answers.shift();
    if (!next) throw new Error("asked once too often");
    return next();
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

function sleeper() {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
}

test("a request refused as issued in the future is sent once more, after a pause", async () => {
  const api = scripted(issuedAtFuture, ok);
  const { waits, sleep } = sleeper();
  const response = await withSkewRetry(api.fetch, sleep)("https://x.supabase.co/rest/v1/platform_settings", {
    method: "GET",
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [{ value: 60 }]);
  assert.equal(api.calls.length, 2);
  assert.deepEqual(waits, [SKEW_RETRY_DELAY_MS]);
});

test("a write is sent again with the same body", async () => {
  const api = scripted(issuedAtFuture, () => new Response(null, { status: 201 }));
  const { sleep } = sleeper();
  const init = { method: "POST", body: JSON.stringify({ store_id: "s1" }) };
  const response = await withSkewRetry(api.fetch, sleep)("https://x.supabase.co/rest/v1/visits", init);
  assert.equal(response.status, 201);
  assert.equal(api.calls[1].init?.body, init.body);
});

test("it is sent again only once: a second refusal reaches the caller", async () => {
  const api = scripted(issuedAtFuture, issuedAtFuture);
  const { sleep } = sleeper();
  const response = await withSkewRetry(api.fetch, sleep)("https://x.supabase.co/rest/v1/stores");
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "PGRST303");
  assert.equal(api.calls.length, 2);
});

test("other refusals and answers are not sent again, and can still be read", async () => {
  const expired = () =>
    new Response(JSON.stringify({ code: "PGRST301", message: "JWT expired" }), { status: 401 });
  const notJson = () => new Response("Unauthorized", { status: 401 });
  for (const answer of [expired, notJson, ok]) {
    const api = scripted(answer);
    const { waits, sleep } = sleeper();
    const response = await withSkewRetry(api.fetch, sleep)("https://x.supabase.co/rest/v1/stores");
    assert.equal(api.calls.length, 1);
    assert.deepEqual(waits, []);
    assert.ok((await response.text()).length > 0, "the caller can still read the body");
  }
});

test("a body that may already have been read is never sent twice", async () => {
  const stream = new ReadableStream({ start: (c) => c.close() });
  for (const [input, init] of [
    ["https://x.supabase.co/storage/v1/object/files/a.pdf", { method: "POST", body: stream, duplex: "half" }],
    [new Request("https://x.supabase.co/rest/v1/stores"), undefined],
  ] as Array<[string | Request, RequestInit | undefined]>) {
    const api = scripted(issuedAtFuture);
    const { sleep } = sleeper();
    const response = await withSkewRetry(api.fetch, sleep)(input, init);
    assert.equal(response.status, 401);
    assert.equal(api.calls.length, 1);
  }
});

test("in a page render the GET is really sent again, not handed the first refusal back", async () => {
  // Next's fetch during a render (next/dist/server/lib/dedupe-fetch.js): a GET
  // it has seen before comes back from its cache unless it carries a signal.
  let sent = 0;
  const answers = [issuedAtFuture, ok];
  const seen = new Map<string, Response>();
  const nextFetch = (async (input: unknown, init?: RequestInit) => {
    const key = String(input);
    if (!init?.signal && seen.has(key)) return seen.get(key)!.clone();
    sent += 1;
    const response = answers.shift()!();
    if (!init?.signal) seen.set(key, response.clone());
    return response;
  }) as typeof globalThis.fetch;
  const { sleep } = sleeper();
  const response = await withSkewRetry(nextFetch, sleep)("https://x.supabase.co/rest/v1/platform_settings", {
    method: "GET",
  });
  assert.equal(sent, 2);
  assert.equal(response.status, 200);
});

test("a caller's own signal is kept on the second request", async () => {
  const api = scripted(issuedAtFuture, ok);
  const { sleep } = sleeper();
  const signal = new AbortController().signal;
  await withSkewRetry(api.fetch, sleep)("https://x.supabase.co/rest/v1/stores", { signal });
  assert.equal(api.calls[1].init?.signal, signal);
});

// ------------------------------------------------- reporting failures

const API = "https://x.supabase.co";
const answer = (status: number, body: unknown) => () =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** What `withFailureReport` reported for one answer, and what the caller got. */
async function reportedFor(url: string, init: RequestInit | undefined, reply: () => Response) {
  const api = scripted(reply);
  const reports: SupabaseFailure[] = [];
  const response = await withFailureReport(api.fetch, (f) => void reports.push(f))(url, init);
  return { reports, response };
}

test("a broken request is reported with the table, the code and the database's sentence, not the values", async () => {
  const { reports, response } = await reportedFor(
    `${API}/rest/v1/orders?select=id,store_name&id=eq.5b1e`,
    { method: "PATCH", body: JSON.stringify({ notes: "Choppies Mahikeng" }) },
    answer(400, { code: "42703", message: 'column orders.store_name does not exist', details: "Choppies", hint: null })
  );
  assert.deepEqual(reports, [
    { service: "database", method: "PATCH", resource: "orders", status: 400, code: "42703", message: "column orders.store_name does not exist" },
  ]);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "42703", "the caller still reads the answer");
});

test("what counts as broken", () => {
  const broken: Array<[string, number, unknown]> = [
    ["/rest/v1/rpc/save_job_role", 500, { code: "XX000", message: "internal" }],
    ["/rest/v1/rpc/save_job_role", 404, { code: "PGRST202", message: "Could not find the function" }],
    ["/rest/v1/visits", 400, { code: "PGRST204", message: "Could not find the 'x' column" }],
    ["/rest/v1/visits", 403, { code: "42501", message: 'new row violates row-level security policy for table "visits"' }],
    ["/rest/v1/stores", 409, { code: "23503", message: "update or delete on table violates foreign key constraint" }],
    ["/rest/v1/stores", 400, { code: "23502", message: 'null value in column "name"' }],
    ["/rest/v1/stores", 400, { code: "22P02", message: "invalid input syntax for type uuid" }],
    ["/rest/v1/rpc/report_sales", 500, { code: "57014", message: "canceling statement due to statement timeout" }],
    ["/rest/v1/rpc/f", 400, { code: "42883", message: "function does not exist" }],
    ["/storage/v1/object/fulfilment-docs/org/a.png", 400, { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" }],
    ["/storage/v1/object/fulfilment-docs/org/a.png", 502, null],
    ["/auth/v1/token", 500, { code: "unexpected_failure", message: "Database error" }],
    ["/functions/v1/send-email", 503, null],
  ];
  for (const [path, status, body] of broken) {
    assert.ok(failureOf(`${API}${path}`, "POST", status, body), `${path} ${status} should be reported`);
  }
});

test("the app working is not reported: its own refusals, sign-in mistakes, no row, the signed-out", () => {
  const fine: Array<[string, number, unknown]> = [
    ["/rest/v1/rpc/store_add_from_phone", 400, { code: "22023", message: "Choose a price group." }],
    ["/rest/v1/rpc/store_year_sales", 403, { code: "42501", message: "Only managers can see money." }],
    ["/rest/v1/rpc/require_module", 403, { code: "42501", message: "Deliveries is not on your plan.", hint: "module:distribution" }],
    ["/rest/v1/territories", 409, { code: "23505", message: "duplicate key value violates unique constraint" }],
    ["/rest/v1/vehicle_logbook", 400, { code: "23514", message: "violates check constraint odometer_order" }],
    ["/rest/v1/rpc/get_order", 400, { code: "P0002", message: "That order was not found." }],
    ["/rest/v1/orders", 406, { code: "PGRST116", message: "Cannot coerce the result to a single JSON object" }],
    ["/rest/v1/orders", 416, { code: "PGRST103", message: "Requested range not satisfiable" }],
    ["/rest/v1/rpc/current_role", 401, { code: "42501", message: "permission denied for function current_role" }],
    ["/auth/v1/token", 400, { code: "invalid_credentials", message: "Invalid login credentials" }],
    ["/auth/v1/user", 403, { code: "session_not_found", message: "Session not found" }],
    ["/storage/v1/object/files/a.pdf", 400, { statusCode: "404", error: "not_found", message: "Object not found" }],
    ["/functions/v1/send-email", 400, { error: "Missing recipient" }],
    ["/rest/v1/orders", 200, []],
    ["/rest/v1/rpc/workday_close", 500, { code: "40001", message: "That workday was closed by someone else a moment ago." }],
    ["/rest/v1/rpc/store_set_location", 500, { code: "55000", message: "This store already has a location." }],
    ["/rest/v1/rpc/send_test_email", 500, { code: "54000", message: "Five test emails an hour is the limit." }],
  ];
  for (const [path, status, body] of fine) {
    assert.equal(failureOf(`${API}${path}`, "POST", status, body), null, `${path} ${status} should not be reported`);
  }
});

test("a file's path and a request's ids never reach the report", () => {
  const f = failureOf(`${API}/storage/v1/object/fulfilment-docs/org-1/Choppies%20POD.png`, "POST", 500, null);
  assert.equal(f?.resource, "object/fulfilment-docs");
  const g = failureOf(`${API}/rest/v1/rpc/delivery_confirm?p_id=5b1e`, "POST", 500, null);
  assert.equal(g?.resource, "rpc/delivery_confirm");
  for (const path of ["object/sign/fulfilment-docs/a.png", "object/list/fulfilment-docs", "object/upload/sign/fulfilment-docs/a.png", "object/public/fulfilment-docs/a.png"]) {
    assert.equal(failureOf(`${API}/storage/v1/${path}`, "POST", 500, null)?.resource, "object/fulfilment-docs", path);
  }
  const typed = failureOf(`${API}/rest/v1/stores`, "GET", 400, { code: "22P02", message: 'invalid input syntax for type uuid: "Choppies"' });
  assert.equal(typed?.message, "invalid input syntax for type uuid");
});

test("one failure is reported once, then not again for ten minutes", () => {
  const t = 1_000_000;
  assert.equal(firstInAWhile("database GET stores 42703", t), true);
  assert.equal(firstInAWhile("database GET stores 42703", t + 1000), false);
  assert.equal(firstInAWhile("database GET orders 42703", t + 1000), true, "another failure is its own");
  assert.equal(firstInAWhile("database GET stores 42703", t + REPORT_QUIET_MS), true);
});

test("a database error's details never reach Sentry, even through console.error", () => {
  const event = {
    environment: "production",
    extra: { arguments: ["insights: lookup failed", { code: "23505", message: "duplicate key", details: "Key (name)=(Choppies) already exists" }] },
  } as unknown as Parameters<typeof scrubEvent>[0];
  const sent = scrubEvent(event, {});
  assert.deepEqual((sent?.extra?.arguments as unknown[])[1], { code: "23505", message: "duplicate key", details: "[redacted]" });
});

test("the refusal that was retried and then worked is not reported", async () => {
  const api = scripted(issuedAtFuture, ok);
  const reports: SupabaseFailure[] = [];
  const { sleep } = sleeper();
  const response = await withFailureReport(withSkewRetry(api.fetch, sleep), (f) => void reports.push(f))(`${API}/rest/v1/stores`);
  assert.equal(response.status, 200);
  assert.deepEqual(reports, []);
});

test("a reporter that throws, or an answer that is not JSON, changes nothing for the caller", async () => {
  const api = scripted(() => new Response("Bad gateway", { status: 502 }));
  const response = await withFailureReport(api.fetch, () => {
    throw new Error("Sentry is down");
  })(`${API}/rest/v1/stores`);
  assert.equal(response.status, 502);
  assert.equal(await response.text(), "Bad gateway");
});

test("the method is reported in capitals, also a Request's own", async () => {
  const { reports } = await reportedFor(`${API}/rest/v1/stores`, { method: "delete" }, answer(500, null));
  assert.equal(reports[0]?.method, "DELETE");
  const api = scripted(answer(500, null));
  const seen: SupabaseFailure[] = [];
  await withFailureReport(api.fetch, (f) => void seen.push(f))(new Request(`${API}/rest/v1/stores`, { method: "POST" }));
  assert.equal(seen[0]?.method, "POST");
});
