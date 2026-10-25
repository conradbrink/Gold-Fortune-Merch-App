import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { platformAdminClient } from "@/lib/platform";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { readAsker } from "@/lib/assistant-session";
import { toolSpec } from "@/lib/assistant-tools";
import { ActionError, applyAction, isAction, readActionInput } from "@/lib/assistant-act";
import { dbError, writeRefusal } from "@/lib/write-refusal";

/**
 * Makes a change the AI Manager drafted, when the person presses the button
 * on its card.
 *
 * The assistant never writes: it only drafts the card. This runs only from
 * that button, as the person, with their own session, so every rule the page
 * follows still applies. The card comes back from the browser, so nothing in
 * it is trusted:
 * - access is read again (`readAsker`);
 * - the input is read as if typed by hand (`readActionInput`);
 * - the action checks it against the database again before writing with the
 *   page's own function.
 *
 * Each card's change is recorded before it is made: who, which action, and
 * what it was asked to change. The record then says how it ended. The record:
 * - is written with the service role, so nobody can write one of their own;
 * - carries the company and the person this route read with their own session;
 * - is keyed on the card, so a card's change is made once, however often its
 *   button reaches here.
 * If the record can't be started, nothing is changed. The chat itself is
 * never stored.
 */

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(error: string, status: number) {
  return Response.json({ error }, { status });
}

type Started = { record_id: string; fresh: boolean; was_ok: boolean | null; was_result: string | null };

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json("Not signed in.", 401);

  const body = (await request.json().catch(() => null)) as { name?: unknown; draftId?: unknown; input?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name : "";
  const draftId = typeof body?.draftId === "string" && UUID.test(body.draftId) ? body.draftId.toLowerCase() : null;
  if (!isAction(name) || !draftId) return json("That change could not be read. Ask the AI Manager for it again.", 400);

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
  const admin = platformAdminClient() as unknown as SupabaseClient;
  const { data: startedRows, error: startError } = await admin.rpc("assistant_action_start", {
    p_org: env.orgId,
    p_user: user.id,
    p_draft: draftId,
    p_action: name,
    p_input: parsed.input,
  });
  const started = ((startedRows ?? []) as Started[])[0];
  if (startError || !started) {
    const plain = startError ? writeRefusal(dbError(startError)) : null;
    if (!plain) console.error("assistant act: the record could not be started", startError?.message);
    return json(plain ?? "The change couldn't be recorded, so nothing was changed. Try again in a moment.", plain ? 403 : 503);
  }
  if (!started.fresh) {
    // This card's change was made, or is being made: answered from its record.
    if (started.was_ok) return Response.json({ done: started.was_result ?? "Done.", href: spec.page });
    return json("This change is already under way. Give it a moment, then open the page to check it.", 409);
  }

  const finish = async (ok: boolean, result: string, targetId: string | null) => {
    const { error } = await admin.rpc("assistant_action_finish", {
      p_id: started.record_id,
      p_ok: ok,
      p_result: result,
      p_target: targetId,
    });
    // The change itself stands either way. The record is left saying it did
    // not finish, and the card answers "under way" rather than doing it again.
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
