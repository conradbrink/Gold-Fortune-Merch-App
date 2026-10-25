import OpenAI from "openai";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit, quotaLeft, requireFeature, LIMITS } from "@/lib/rate-limit";
import { moduleEnabled } from "@/lib/modules";
import { currencySymbol } from "@/lib/money";
import { readAsker } from "@/lib/assistant-session";
import { draftAction, isAction } from "@/lib/assistant-act";
import type { AssistantContext } from "@/lib/assistant-prompt";
import { runTool } from "@/lib/assistant-data";
import { answerQuestion } from "@/lib/assistant-answer";
import { encodeEvent, parseConversation, questionsLeft } from "@/lib/assistant-stream";

/**
 * Ask: questions about the company's own business, answered from its data.
 *
 * Locked to the company in two ways. What it can read: a fixed set of lookups
 * (`lib/assistant-data.ts`), each run with the asker's own session, offered
 * only when the asker may open the page it mirrors. What it will talk about: a
 * separate check reads every question first and anything not about the
 * business gets a fixed refusal, never the assistant.
 *
 * Nothing is stored. The panel sends the recent turns with each question; the
 * only thing the server keeps is the count of questions, for the limits. The
 * model provider is told not to store the exchange either (`store: false`).
 *
 * Like `/api/insights`, `proxy.ts` does not cover /api, so this handler does
 * its own authentication and answers in JSON with real status codes until the
 * answer starts streaming.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = process.env.OPENAI_MODEL ?? "gpt-5.5";
/** The off-topic check. The same model unless a cheaper one is configured. */
const GUARD_MODEL = process.env.OPENAI_GUARD_MODEL ?? MODEL;
function json(error: string, status: number, headers?: HeadersInit) {
  return Response.json({ error }, { status, headers });
}

/** The limiter's 429, said as the person needs to hear it. */
function limitReached(response: Response, period: "hour" | "day"): Response {
  if (response.status !== 429) return response;
  const seconds = Number(response.headers.get("Retry-After") ?? "3600");
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  const when =
    period === "hour"
      ? `in ${minutes} ${minutes === 1 ? "minute" : "minutes"}`
      : minutes > 90
        ? `in about ${Math.round(minutes / 60)} hours`
        : `in ${minutes} minutes`;
  const limit = period === "hour" ? LIMITS.assistantHour.limit : LIMITS.assistantDay.limit;
  return json(
    `You've used your ${limit} questions for this ${period}. You can ask again ${when}.`,
    429,
    { "Retry-After": String(seconds) }
  );
}

/**
 * How many questions the signed-in person has left, without using one.
 *
 * The panel asks when it opens, so the count is right after signing in again
 * or on another device; it used to show the full allowance until the first
 * answer. Read with the person's own session through `rate_limit_left`, which
 * only ever reads the caller's own counter.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json("Not signed in.", 401);

  const [hour, day] = await Promise.all([
    quotaLeft(supabase, LIMITS.assistantHour),
    quotaLeft(supabase, LIMITS.assistantDay),
  ]);
  return Response.json({ left: questionsLeft(hour, day) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json("Not signed in.", 401);

  const body = await request.json().catch(() => null);
  const conversation = parseConversation(body);
  if (!conversation.ok) return json(conversation.error, 400);

  // Who is asking and what they may see, from the database with their session.
  const read = await readAsker(supabase);
  if (!read.ok) return json(read.error, read.status);
  const { env, tools, config } = read.asker;
  if (tools.length === 0) {
    return json("There's nothing in your access that Ask can look up yet.", 403);
  }

  // After authorisation, so an anonymous caller learns nothing about the setup.
  if (!process.env.OPENAI_API_KEY) return json("Ask is not set up on this server yet.", 503);

  // The operator's off switch for paid AI, shared with the insights briefing.
  const live = await requireFeature(supabase, "insights", "Ask");
  if (!live.ok) return live.response;

  // Every question counts, refused or not, and is counted before anything is
  // spent. The hour first: somebody stopped by it keeps their day.
  const hour = await enforceRateLimit(supabase, LIMITS.assistantHour, 1, { failClosed: true });
  if (!hour.ok) return limitReached(hour.response, "hour");
  const dayGate = await enforceRateLimit(supabase, LIMITS.assistantDay, 1, { failClosed: true });
  if (!dayGate.ok) return limitReached(dayGate.response, "day");
  const left = questionsLeft(hour.remaining, dayGate.remaining);

  const ctx: AssistantContext = {
    terms: config.terms,
    companyName: config.branding.name ?? "",
    merchandising: moduleEnabled(config.modules, "distribution"),
    today: env.today,
    timeZone: config.timezone,
    currency: config.settings.currency_code,
    currencySymbol: currencySymbol(config.settings.currency_code),
  };

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort());

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await answerQuestion({
          client,
          model: MODEL,
          guardModel: GUARD_MODEL,
          ctx,
          tools,
          turns: conversation.turns,
          // An action only drafts its card here; nothing is written until the person presses it.
          run: (name, args) => (isAction(name) ? draftAction(name, args, env) : runTool(name, args, env)),
          send: (event) => {
            try {
              controller.enqueue(encoder.encode(encodeEvent(event)));
            } catch {
              // The reader has gone; nothing to tell.
            }
          },
          abort,
          left,
        });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed by a cancelled reader
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
