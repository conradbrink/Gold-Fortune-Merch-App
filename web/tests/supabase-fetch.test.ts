// Every Supabase client sends a request once more when the API refuses a good
// token as "JWT issued at future" (PGRST303), and only then.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SKEW_RETRY_DELAY_MS, withSkewRetry } from "@/lib/supabase/fetch";

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
