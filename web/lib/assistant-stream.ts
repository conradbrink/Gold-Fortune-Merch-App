import type { ExportSheet } from "@/lib/export";

/**
 * What the assistant route sends back, one JSON object per line.
 *
 * A line per event rather than plain text, because an answer is more than
 * words: what it is looking up while the person waits, the tables it read
 * (shown under the answer, ready to download), and how many questions are
 * left. Shared by the route that writes it and the panel that reads it.
 */
export type AssistantEvent =
  /** What it is doing now: "Adding up sales". */
  | { type: "status"; text: string }
  /** The next piece of the answer. */
  | { type: "text"; text: string }
  /** A list a lookup returned, with the page it came from. */
  | { type: "table"; sheet: ExportSheet; href: string }
  /** Not about the business: the fixed refusal, and nothing else. */
  | { type: "refused"; text: string }
  | { type: "error"; text: string }
  /** The answer is complete. Questions left, when they could be counted. */
  | { type: "done"; left: QuestionsLeft | null };

export type QuestionsLeft = { hour: number; day: number };

/** One chat turn as the panel keeps it and sends it back for context. */
export type ChatTurn = { role: "user" | "assistant"; text: string };

/** Questions per person (owner, 19 Oct 2026). `LIMITS` in lib/rate-limit.ts counts them. */
export const QUESTIONS_PER_HOUR = 10;
export const QUESTIONS_PER_DAY = 40;

/** The limits on what the route accepts, shared so the panel stops at the same place. */
export const MAX_QUESTION_CHARS = 500;
/** Earlier turns sent for context. Older ones drop off; the panel still shows them. */
export const MAX_HISTORY_TURNS = 8;
const MAX_TURN_CHARS = 4000;

export function encodeEvent(event: AssistantEvent): string {
  return JSON.stringify(event) + "\n";
}

/**
 * Splits a growing buffer into whole events, returning what is left over.
 *
 * A network chunk can end halfway through a line, so the tail is kept until
 * the next chunk completes it. A line that is not an event is skipped rather
 * than thrown: one bad line should not lose the rest of an answer.
 */
export function decodeEvents(buffer: string): { events: AssistantEvent[]; rest: string } {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const events: AssistantEvent[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as AssistantEvent;
      if (parsed && typeof parsed.type === "string") events.push(parsed);
    } catch {
      // skipped, see above
    }
  }
  return { events, rest };
}

/**
 * What the route accepts as a conversation, or why not.
 *
 * The panel sends the recent turns because the server keeps no chat history.
 * Each turn is checked and cut to size here, since the request is the one
 * thing a person fully controls.
 */
export function parseConversation(
  body: unknown
): { ok: true; turns: ChatTurn[]; question: string } | { ok: false; error: string } {
  const raw = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "Ask a question first." };

  const turns: ChatTurn[] = [];
  for (const m of raw.slice(-(MAX_HISTORY_TURNS + 1))) {
    const role = (m as { role?: unknown })?.role;
    const text = (m as { text?: unknown })?.text;
    if ((role !== "user" && role !== "assistant") || typeof text !== "string") {
      return { ok: false, error: "That conversation could not be read." };
    }
    turns.push({ role, text: text.slice(0, MAX_TURN_CHARS) });
  }

  const last = turns[turns.length - 1];
  if (last.role !== "user") return { ok: false, error: "Ask a question first." };
  const question = last.text.trim();
  if (!question) return { ok: false, error: "Ask a question first." };
  if (question.length > MAX_QUESTION_CHARS) {
    return { ok: false, error: `Keep the question under ${MAX_QUESTION_CHARS} characters.` };
  }
  return { ok: true, turns, question };
}
