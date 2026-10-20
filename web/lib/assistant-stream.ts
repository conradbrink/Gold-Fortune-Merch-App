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
  /** A drafted month of visits, saved only when the person presses the button. */
  | { type: "plan"; plan: PlanDraft }
  /** Not about the business: the fixed refusal, and nothing else. */
  | { type: "refused"; text: string }
  | { type: "error"; text: string }
  /** The answer is complete. Questions left, when they could be counted. */
  | { type: "done"; left: QuestionsLeft | null };

export type QuestionsLeft = { hour: number; day: number };

/**
 * Questions left, from what is left this hour and today: nobody has more
 * left this hour than today. Null when either could not be counted.
 */
export function questionsLeft(hour: number | null, day: number | null): QuestionsLeft | null {
  return hour === null || day === null ? null : { hour: Math.min(hour, day), day };
}

/** What "Add to schedule" saves: the new visits, by day, for one person. */
export type PlanDraft = {
  staffId: string;
  staffName: string;
  /** YYYY-MM */
  month: string;
  /** "November 2026" */
  monthLabel: string;
  days: { date: string; siteIds: string[] }[];
  visits: number;
};

/** One chat turn as the panel keeps it and sends it back for context. */
export type ChatTurn = { role: "user" | "assistant"; text: string };

/** The counters `LIMITS` in lib/rate-limit.ts keeps the questions in. */
export const QUESTION_BUCKETS = { hour: "assistant_hour", day: "assistant_day" } as const;

/** Questions per person (owner, 19 Oct 2026). `LIMITS` in lib/rate-limit.ts counts them. */
export const QUESTIONS_PER_HOUR = 10;
export const QUESTIONS_PER_DAY = 40;

/** The limits on what the route accepts, shared so the panel stops at the same place. */
export const MAX_QUESTION_CHARS = 500;
/** Earlier turns sent for context. Older ones drop off; the panel still shows them. */
export const MAX_HISTORY_TURNS = 8;
const MAX_TURN_CHARS = 4000;

/** A turn as the panel shows it: an answer can be unfinished, refused or failed. */
export type ShownTurn = ChatTurn & {
  pending?: boolean;
  refused?: boolean;
  error?: string;
  planSaved?: { added: number; already: number };
};

/**
 * The turns sent back for context: answered questions with their answers, the
 * newest few. A question that was refused, failed or never finished goes with
 * its answer, so an off-topic request cannot ride along unanswered behind the
 * next good one.
 */
export function history(messages: readonly ShownTurn[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (let i = 0; i < messages.length; i++) {
    const q = messages[i];
    const a = messages[i + 1];
    if (q.role !== "user" || !a || a.role !== "assistant") continue;
    i++;
    if (a.pending || a.error || a.refused || !a.text.trim()) continue;
    // The assistant cannot see the button: tell it what pressing it did, so
    // "did it save?" gets a true answer.
    const saved = a.planSaved
      ? `\n\n(The person pressed Add to schedule: ${a.planSaved.added} added, ${a.planSaved.already} were already there.)`
      : "";
    turns.push({ role: "user", text: q.text }, { role: "assistant", text: a.text + saved });
  }
  return turns.slice(-MAX_HISTORY_TURNS);
}

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
