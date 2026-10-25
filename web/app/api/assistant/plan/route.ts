import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { planVisits } from "@/lib/store-reorder";
import { readAsker } from "@/lib/assistant-session";
import { toolSpec } from "@/lib/assistant-tools";
import { readPlanSave } from "@/lib/plan-save";

/**
 * Saves a month of visits that Ask drafted, when the manager presses
 * "Add to schedule" under it.
 *
 * The assistant never writes. It only drafts, and this runs only from that
 * button. The write is the one the schedule's own "Add stop" makes
 * (`planVisits`: one-off stops, a site already on that day left as it is),
 * with the manager's own session, so the same row-level rules apply: only a
 * manager may change the schedule, and only at their own company. The plan
 * comes back from the browser, so it is checked here as if typed by hand.
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

  // The rule that offered the plan, read again now: the schedule page, the
  // manager role its tables' write policies ask for, and the company's modules.
  const asked = await readAsker(supabase);
  if (!asked.ok) return json(asked.error, asked.status);
  const { env, tools } = asked.asker;
  const spec = toolSpec("draft_visit_plan");
  if (!spec || !tools.includes(spec)) return json("Only a manager with the schedule can change it.", 403);
  const today = env.today;

  const read = readPlanSave(await request.json().catch(() => null), today);
  if (!read.ok) return json(read.error, 400);
  const { staffId, days, pastDays } = read.save;

  const gate = await enforceRateLimit(supabase, LIMITS.assistantPlanSave);
  if (!gate.ok) return gate.response;

  // The person and every site must be this company's: row-level security only
  // shows a manager their own company, so anything it does not return is not.
  const { data: person, error: personError } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("id", staffId)
    .eq("org_id", env.orgId)
    .eq("is_active", true)
    .maybeSingle();
  if (personError) return json("The plan could not be checked. Try again shortly.", 503);
  if (!person) return json("That person isn't active at your company any more.", 400);

  // In batches: a few hundred ids in one query string is past what a URL holds.
  const wanted = [...new Set(days.flatMap((d) => d.siteIds))];
  let seen = 0;
  for (let i = 0; i < wanted.length; i += 100) {
    const { data: found, error: sitesError } = await supabase
      .from("stores")
      .select("id")
      .in("id", wanted.slice(i, i + 100));
    if (sitesError) return json("The plan could not be checked. Try again shortly.", 503);
    seen += (found ?? []).length;
  }
  if (seen !== wanted.length) return json("The plan has a site that isn't at your company.", 400);

  let added = 0;
  let already = 0;
  for (const d of days) {
    try {
      const r = await planVisits(supabase, env.orgId, staffId, d.siteIds, d.date);
      added += r.added;
      already += r.already;
    } catch (reason) {
      console.error("assistant plan: saving a day failed", reason);
      const day = new Date(`${d.date}T12:00:00Z`).toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      });
      return Response.json(
        { error: `Saving stopped on ${day}. ${added} were added before that. Open the schedule to check.`, added, already },
        { status: 500 }
      );
    }
  }
  return Response.json({ added, already, pastDays });
}
