// A sign-in can end on another device, and the browser that still holds it has
// to come back cleanly: its dead cookie cleared on the first answer, including
// a redirect; nothing reported to Sentry, because nothing is broken; and
// signing out here never ends the same person's session somewhere else.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { NextResponse } from "next/server.js";
import { carryCookies } from "@/lib/carry-cookies";
import { scrubEvent } from "@/lib/monitoring";

type SentryEvent = Parameters<typeof scrubEvent>[0];

/** What captureConsoleIntegration makes of `console.error(authError)`. */
function consoleError(type: string, value: string): SentryEvent {
  return {
    environment: "production",
    exception: { values: [{ type, value, mechanism: { type: "auto.core.capture_console", handled: true } }] },
  } as unknown as SentryEvent;
}

test("a refresh refused because the session has ended is not reported", () => {
  const event = consoleError("AuthApiError", "Invalid Refresh Token: Refresh Token Not Found");
  assert.equal(scrubEvent(event, {}), null);
  // Recognised by the error's code too, whatever the SDK names its class.
  const error = Object.assign(new Error("Invalid Refresh Token: Refresh Token Not Found"), {
    code: "refresh_token_not_found",
    status: 400,
  });
  assert.equal(scrubEvent(consoleError("Error", "[Object]"), { originalException: error }), null);
});

test("the same refusal thrown by our own code and left uncaught is still reported", () => {
  const event = {
    environment: "production",
    exception: {
      values: [
        {
          type: "AuthApiError",
          value: "Invalid Refresh Token: Refresh Token Not Found",
          mechanism: { type: "auto.function.nextjs.on_request_error", handled: false },
        },
      ],
    },
  } as unknown as SentryEvent;
  assert.notEqual(scrubEvent(event, { originalException: { code: "refresh_token_not_found" } }), null);
});

test("a token sent twice, or any other sign-in failure, is still reported", () => {
  const twice = consoleError("AuthApiError", "Invalid Refresh Token: Already Used");
  assert.notEqual(scrubEvent(twice, {}), null);
  const other = consoleError("AuthApiError", "Database error granting user");
  assert.notEqual(scrubEvent(other, {}), null);
  const notAuth = consoleError("TypeError", "Refresh Token Not Found is not a function");
  assert.notEqual(scrubEvent(notAuth, {}), null);
});

test("a redirect takes the session's cookies with it", () => {
  const response = NextResponse.next();
  // What @supabase/ssr writes when the server no longer knows the session...
  response.cookies.set("sb-ref-auth-token", "", { path: "/", maxAge: 0 });
  // ...and when it has just refreshed one.
  response.cookies.set("sb-ref-auth-token.0", "base64-new", { path: "/", maxAge: 400 * 24 * 3600, sameSite: "lax" });

  const redirect = carryCookies(response, NextResponse.redirect("https://app.example/login"));

  assert.equal(redirect.status, 307);
  assert.equal(redirect.headers.get("location"), "https://app.example/login");
  const cleared = redirect.cookies.get("sb-ref-auth-token");
  assert.equal(cleared?.value, "");
  assert.equal(cleared?.maxAge, 0);
  const refreshed = redirect.cookies.get("sb-ref-auth-token.0");
  assert.equal(refreshed?.value, "base64-new");
  assert.equal(refreshed?.sameSite, "lax");
});

test("every sign-out in the web app ends this browser's session only", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name)) files.push(path);
    }
  };
  for (const dir of ["app", "components", "lib"]) walk(join(root, dir));

  const calls = files.flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/\.signOut\(([^)]*)\)/g)].map((m) => ({
      file: relative(root, file),
      args: m[1],
    }))
  );
  assert.ok(calls.length >= 3, "the sign-out buttons were not found");
  for (const call of calls) {
    assert.match(call.args, /scope:\s*"local"/, `${call.file} signs the person out on every device`);
  }
});
