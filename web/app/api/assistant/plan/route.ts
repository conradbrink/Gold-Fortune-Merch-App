import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { parseCompanyConfig } from "@/lib/company-config";
import { planVisits } from "@/lib/store-reorder";
import { addDays } from "@/lib/visit-plan";

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function json(error: string, status: number) {
  return Response.json({ error }, { status });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json("Not signed in.", 401);

  const [{ data: role, error: roleError }, { data: rawConfig, error: configError }] = await Promise.all([
    supabase.rpc("current_role"),
    supabase.rpc("my_company_config"),
  ]);
  if (roleError || configError) return json("Your access could not be checked. Try again shortly.", 503);
  if (role !== "manager") return json("Only a manager can change the schedule.", 403);
  const config = parseCompanyConfig(rawConfig);
  if (!config) return json("Your company could not be loaded. Try again shortly.", 503);

  const body = (await request.json().catch(() => null)) as {
    staffId?: unknown;
    days?: unknown;
  } | null;
  const staffId = typeof body?.staffId === "string" && UUID.test(body.staffId) ? body.staffId : null;
  const rawDays = Array.isArray(body?.days) ? body.days : null;
  if (!staffId || !rawDays || rawDays.length === 0 || rawDays.length > 31) {
    return json("That plan could not be read.", 400);
  }

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone }).format(new Date());
  const latest = addDays(today, 100);
  const days: { date: string; siteIds: string[] }[] = [];
  let pastDays = 0;
  for (const d of rawDays as { date?: unknown; siteIds?: unknown }[]) {
    const date = typeof d?.date === "string" && DAY.test(d.date) ? d.date : null;
    const siteIds = Array.isArray(d?.siteIds) ? d.siteIds : null;
    if (!date || !siteIds || siteIds.length === 0 || siteIds.length > 50) {
      return json("That plan could not be read.", 400);
    }
    if (date > latest || !siteIds.every((id): id is string => typeof id === "string" && UUID.test(id))) {
      return json("That plan could not be read.", 400);
    }
    // Today and earlier are the schedule's own rule: nobody re-plans a day that
    // has started. A draft saved a day late keeps the days still ahead.
    if (date <= today) {
      pastDays++;
      continue;
    }
    days.push({ date, siteIds: [...new Set(siteIds)] });
  }
  if (days.length === 0) return json("Every day in this plan has passed. Ask for a new draft.", 400);

  const gate = await enforceRateLimit(supabase, LIMITS.assistantPlanSave);
  if (!gate.ok) return gate.response;

  // The person and every site must be this company's: row-level security only
  // shows a manager their own company, so anything it does not return is not.
  const { data: person, error: personError } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("id", staffId)
    .eq("org_id", config.orgId)
    .maybeSingle();
  if (personError) return json("The plan could not be checked. Try again shortly.", 503);
  if (!person) return json("That person isn't at your company.", 400);

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
      const r = await planVisits(supabase, config.orgId, staffId, d.siteIds, d.date);
      added += r.added;
      already += r.already;
    } catch (reason) {
      console.error("assistant plan: saving a day failed", reason);
      return Response.json(
        { error: `Saving stopped on ${d.date}. ${added} were added before that; open the schedule to check.`, added, already },
        { status: 500 }
      );
    }
  }
  return Response.json({ added, already, pastDays });
}
