import type OpenAI from "openai";
import type {
  FunctionTool,
  ResponseInputItem,
  ResponseOutputItem,
} from "openai/resources/responses/responses";
import {
  parseArgs,
  showsTable,
  toolParameters,
  toolSpec,
  type ToolName,
  type ToolSpec,
} from "@/lib/assistant-tools";
import {
  GUARD_SCHEMA,
  assistantInstructions,
  guardInput,
  guardInstructions,
  parseGuardVerdict,
  refusalText,
  type AssistantContext,
} from "@/lib/assistant-prompt";
import type { ToolResult } from "@/lib/assistant-data";
import type { AssistantEvent, ChatTurn, QuestionsLeft } from "@/lib/assistant-stream";

/**
 * One question, answered: the topic check, the lookups, the streamed answer.
 *
 * Kept apart from the route so it can be run with sample lookups against the
 * real model (the lookups are the only part that needs a signed-in session).
 * `run` does the lookups; `send` writes each event to the person.
 */

/** Lookup rounds per question. Enough to find a name and then ask about it. */
const MAX_ROUNDS = 5;

type Verdict = "on" | "off" | "failed";

/** The topic check could not run, so nothing was answered. */
class CheckFailed extends Error {}

/**
 * What the model reads back from a lookup that can show a table: its result,
 * plus whether the person can see the rows. It never points at a table that
 * isn't there, and knows when it must answer from the rows in words.
 */
function withTableNote(model: unknown, shown: boolean): unknown {
  return model !== null && typeof model === "object" && !Array.isArray(model)
    ? { ...model, shown_as_table: shown }
    : model;
}

export type AnswerOptions = {
  client: OpenAI;
  model: string;
  /** The off-topic check's model. */
  guardModel: string;
  ctx: AssistantContext;
  /** What this person may look up. Anything else the model asks for is refused. */
  tools: readonly ToolSpec[];
  turns: readonly ChatTurn[];
  run: (name: ToolName, args: string) => Promise<ToolResult>;
  send: (event: AssistantEvent) => void;
  /** Aborted when the person goes away, and by a failed topic check. */
  abort: AbortController;
  left: QuestionsLeft | null;
};

export async function answerQuestion(o: AnswerOptions): Promise<void> {
  const { client, ctx, tools, send, abort, left } = o;

  const functionTools: FunctionTool[] = tools.map((spec) => ({
    type: "function",
    name: spec.name,
    description: spec.description(ctx.terms),
    parameters: toolParameters(spec, ctx.terms),
    strict: true,
  }));

  // The check runs alongside the first round, so an on-topic question waits
  // for nothing. Nothing reaches the person until it has said yes.
  const questions = o.turns.filter((t) => t.role === "user").map((t) => t.text);
  const guard = client.responses
    .create(
      {
        model: o.guardModel,
        instructions: guardInstructions(ctx),
        input: guardInput(questions),
        reasoning: { effort: "low" },
        max_output_tokens: 2000,
        store: false,
        text: {
          format: {
            type: "json_schema",
            name: "topic_check",
            schema: GUARD_SCHEMA as unknown as Record<string, unknown>,
            strict: true,
          },
        },
      },
      { signal: abort.signal }
    )
    .then((r): Verdict => (parseGuardVerdict(r.output_text) ? "on" : "off"))
    // A check that cannot run holds the answer back, and says so: it is not
    // an off-topic question, and must not be refused as one.
    .catch((reason): Verdict => {
      if (!abort.signal.aborted) console.error("assistant: topic check failed", reason);
      return "failed";
    });

  let cleared = false;
  /** True once the check says yes. False (and stopped) for a no. Throws when it could not run. */
  const allowed = async () => {
    if (cleared) return true;
    const verdict = await guard;
    if (verdict === "on") {
      cleared = true;
      return true;
    }
    abort.abort();
    if (verdict === "failed") throw new CheckFailed();
    return false;
  };

  const refuse = () => {
    send({ type: "refused", text: refusalText(ctx) });
    send({ type: "done", left });
  };

  try {
    send({ type: "status", text: "Reading your question" });

    const input: ResponseInputItem[] = o.turns.map((t) => ({ role: t.role, content: t.text }));
    const instructions = assistantInstructions(ctx, tools);

    let wrote = false;
    // A table was shown under this answer; a list was read but not shown.
    let tabled = false;
    let hidden = false;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const response = await client.responses.create(
        {
          model: o.model,
          instructions,
          input,
          tools: functionTools,
          reasoning: { effort: "low" },
          // Reasoning travels with the lookups between rounds without the
          // provider keeping the conversation (`store: false`).
          include: ["reasoning.encrypted_content"],
          max_output_tokens: 6000,
          store: false,
          stream: true,
        },
        { signal: abort.signal }
      );

      let output: ResponseOutputItem[] = [];
      let cutShort = false;
      for await (const event of response) {
        if (event.type === "response.output_text.delta") {
          if (!(await allowed())) return refuse();
          send({ type: "text", text: event.delta });
          wrote = true;
        } else if (event.type === "response.completed") {
          output = event.response.output;
        } else if (event.type === "response.incomplete") {
          output = event.response.output;
          cutShort = true;
        } else if (event.type === "response.failed") {
          throw new Error(event.response.error?.message ?? "The answer failed.");
        }
      }

      const calls = output.filter(
        (item): item is Extract<ResponseOutputItem, { type: "function_call" }> => item.type === "function_call"
      );
      if (calls.length === 0) {
        // Stopped at the length limit: say so, or half a list reads as the whole.
        if (cutShort && wrote) {
          const or = tabled ? ", or download the table" : hidden ? ", or ask to see it as a table" : "";
          send({ type: "text", text: `\n\nThat answer was cut short. Ask for a smaller part${or}.` });
        }
        break;
      }

      if (!(await allowed())) return refuse();
      // A few words before a lookup get a break after them.
      if (wrote) send({ type: "text", text: "\n\n" });

      input.push(...(output as ResponseInputItem[]));
      for (const call of calls) {
        const spec = toolSpec(call.name);
        // Only what was offered: a lookup this person may not use is refused here.
        if (!spec || !tools.includes(spec)) {
          input.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: JSON.stringify({ error: "That lookup is not available." }),
          });
          continue;
        }
        send({ type: "status", text: spec.working(ctx.terms) });
        const result = await o.run(spec.name, call.arguments);
        // Only a list the person asked to see. The rest still reach the model below.
        const { sheet } = result;
        const shown = sheet !== undefined && showsTable(spec, parseArgs(call.arguments));
        if (shown) send({ type: "table", sheet, href: spec.page });
        tabled ||= shown;
        hidden ||= sheet !== undefined && !shown;
        if (result.plan) send({ type: "plan", plan: result.plan });
        input.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify(spec.table ? withTableNote(result.model, shown) : result.model),
        });
      }

      if (round === MAX_ROUNDS - 1) {
        send({
          type: "text",
          text: "That needed more lookups than I can do for one question. Try asking it in smaller parts.",
        });
        wrote = true;
      }
    }

    if (!(await allowed())) return refuse();
    if (!wrote) send({ type: "text", text: "I couldn't find an answer to that. Try asking it another way." });
    send({ type: "done", left });
  } catch (reason) {
    if (reason instanceof CheckFailed) {
      send({ type: "error", text: "Ask couldn't check your question just now. Try again in a moment." });
      send({ type: "done", left });
      return;
    }
    if (abort.signal.aborted) {
      // Stopped by the topic check, or by the person leaving.
      if ((await guard) === "off") refuse();
      return;
    }
    console.error("assistant: answer failed", reason);
    send({ type: "error", text: "Something went wrong while answering. Try again in a moment." });
    send({ type: "done", left });
  }
}
