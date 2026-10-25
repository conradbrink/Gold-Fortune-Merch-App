import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { readAsker } from "@/lib/assistant-session";
import { toolSpec } from "@/lib/assistant-tools";
import { ActionError, applyAction, isAction, readActionInput } from "@/lib/assistant-act";
import { writeRefusal } from "@/lib/write-refusal";

/**
 * Makes a change the AI Manager drafted, when the person presses the button
 * on its card.
 *
 * The assistant never writes: it only drafts the card. This runs only from
 * that button, as the person, with their own session, so every rule the page
 * follows still applies. The card comes back from the browser, so nothing in
 * it is trusted: access is read again (`readAsker`), the input is read as if
 * typed by hand (`readActionInput`), and the action checks it against the
 * database again before writing with the page's own function.
 *
 * Each change is recorded first (who, which action, what it was asked to
 * change), and the record says how it ended. If the record can't be written,
 * nothing is changed. The chat itself is never stored.
 */

export const runtime = "nodejs";

function json(error: string, status: number) {
  return Response.json({ error }, { status });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json("Not signed in.", 401);

  const body = (await request.json().catch(() => null)) as { name?: unknown; input?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name : "";
  if (!isAction(name)) return json("That change could not be read. Ask the AI Manager for it again.", 400);

  const read = await readAsker(supabase);
  if (!read.ok) return json(read.error, read.status);
  const { env, tools } = read.asker;
  // The rule that offered the card, read again now: somebody whose access
  // changed since it was drafted is refused here.
  const spec = toolSpec(name);
  if (!spec || !tools.includes(spec)) return json("Your access in Tickd doesn't let you change that.", 403);

  const parsed = readActionInput(name, body?.input);
  if (!parsed.ok) return json(parsed.error, 400);

  const gate = await enforceRateLimit(supabase, LIMITS.assistantAction, 1, { failClosed: true });
  if (!gate.ok) return gate.response;

  // Not in the generated types until they are next generated from the database.
  const db = supabase as unknown as SupabaseClient;
  const { data: recordId, error: recordError } = await db.rpc("assistant_action_start", {
    p_action: name,
    p_input: parsed.input,
  });
  if (recordError || typeof recordId !== "string") {
    const plain = writeRefusal(recordError?.message);
    if (!plain) console.error("assistant act: the record could not be started", recordError?.message);
    return json(plain ?? "The change couldn't be recorded, so nothing was changed. Try again in a moment.", plain ? 403 : 503);
  }

  const finish = async (ok: boolean, result: string, targetId: string | null) => {
    const { error } = await db.rpc("assistant_action_finish", {
      p_id: recordId,
      p_ok: ok,
      p_result: result,
      p_target: targetId,
    });
    // The change itself stands either way; the record is left saying it did not finish.
    if (error) console.error("assistant act: the record could not be finished", error.message);
  };

  try {
    const applied = await applyAction(name, parsed.input, env);
    await finish(true, applied.text, applied.targetId);
    return Response.json({ done: applied.text, href: applied.href });
  } catch (reason) {
    const plain = reason instanceof ActionError ? reason.message : writeRefusal(reason);
    if (!plain) console.error(`assistant act: ${name} failed`, reason instanceof Error ? reason.message : reason);
    const message = plain ?? "That couldn't be saved. Try again in a moment.";
    await finish(false, message, null);
    return json(message, plain ? 409 : 500);
  }
}
