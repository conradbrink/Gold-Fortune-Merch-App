import OpenAI from "openai";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit, requireFeature, LIMITS } from "@/lib/rate-limit";
import { requireModule } from "@/lib/require-module";
import {
  fetchComplianceTrends,
  fetchCoverageGaps,
  fetchFormReport,
  fetchRepScorecard,
  formatDuration,
  type FieldReport,
} from "@/lib/reports";
import {
  WEEKDAYS,
  fetchCallCycleGaps,
  fetchCallCycleReview,
  type CallCycleDay,
  type CallCycleGaps,
} from "@/lib/schedule";
import { fetchOrgSettings, type OrgSettings } from "@/lib/org-settings";
import { parseCompanyConfig } from "@/lib/company-config";
import { moduleEnabled } from "@/lib/modules";
import { DEFAULT_TERMS, lower, type Terms } from "@/lib/terms";
import {
  callCyclePrompt,
  noCallCycleBriefing,
  promptWords,
  reportsLead,
  reportsPrompt,
  type PromptContext,
} from "@/lib/insights-prompt";

/**
 * Manager insights.
 *
 * The app's first server-side code, and it exists for one reason: an API key
 * cannot live in a browser bundle. `OPENAI_API_KEY` has no NEXT_PUBLIC_ prefix,
 * so Next keeps it server-only.
 *
 * `proxy.ts` deliberately excludes /api from its matcher, so this handler owns
 * its own auth — the Next docs are explicit that proxy is not a security
 * boundary, and a redirect here would replay the POST against an HTML page.
 */

export const runtime = "nodejs";
// A long report can outrun the default serverless ceiling.
export const maxDuration = 60;

const MODEL = process.env.OPENAI_MODEL ?? "gpt-5.5";

// The prompts themselves are in `lib/insights-prompt.ts`, written in the
// company's words.

/**
 * The shape the model must answer in. A function of the words because the
 * model reads the field descriptions too, and "the store, rep or metric" would
 * pull a cleaning company's briefing back into a retailer's vocabulary.
 */
function briefingSchema(words: Terms) {
  const t = promptWords(words);
  return {
    type: "object",
    properties: {
      headline: {
        type: "string",
        description: "One sentence: the single most important thing this period.",
      },
      // No `findings` array: it was the bulk of the length and duplicated what
      // the charts directly below the panel already show.
      anomalies: {
        type: "array",
        maxItems: 3,
        description:
          "At most 3 outliers worth investigating. Empty array if none genuinely stand out — do not pad.",
        items: {
          type: "object",
          properties: {
            subject: {
              type: "string",
              description: `The ${lower(t.site.one)}, ${lower(t.staff.one)} or metric.`,
            },
            detail: {
              type: "string",
              description: "One sentence, 25 words maximum.",
            },
            severity: { type: "string", enum: ["low", "medium", "high"] },
          },
          required: ["subject", "detail", "severity"],
          additionalProperties: false,
        },
      },
      actions: {
        type: "array",
        maxItems: 3,
        description:
          "At most 3 next steps, highest impact first. Each one sentence, 20 words maximum.",
        items: { type: "string" },
      },
      // Plain string rather than a nullable union: structured outputs support a
      // narrow slice of JSON Schema, and an empty string reads the same to the UI.
      data_caveat: {
        type: "string",
        description:
          "Set when the period is too sparse to draw firm conclusions; empty string otherwise.",
      },
    },
    required: ["headline", "anomalies", "actions", "data_caveat"],
    additionalProperties: false,
  } as const;
}

/**
 * Strips everything that is not an aggregate.
 *
 * Photo storage paths and free-text answers (competitor notes, OOS SKUs) never
 * leave the database — the manager chose aggregates-only. Dropping them here,
 * at the point of egress, means a future field type cannot silently start
 * leaking content just by existing.
 */
function toAggregate(fields: FieldReport[]) {
  return fields
    .filter((f) => f.field_type !== "photo" && f.field_type !== "text")
    .map((f) => ({
      question: f.label,
      type: f.field_type,
      metric: f.metric_key,
      responses: f.response_count,
      stats: f.stats,
    }));
}

/**
 * The call cycle as the model sees it.
 *
 * Note what cannot appear here even by accident: `call_cycle_review` returns
 * city names and a derived `span_km`, never `lat`/`lng`, so the aggregates-only
 * rule is enforced by the shape of the RPC rather than by remembering to strip
 * fields at this layer.
 */
function buildCallCyclePayload(
  days: CallCycleDay[],
  gaps: CallCycleGaps | null,
  weeks: number,
  settings: OrgSettings
) {
  const byRep = new Map<string, CallCycleDay[]>();
  for (const d of days) {
    const key = d.rep_name ?? d.rep_id;
    if (!byRep.has(key)) byRep.set(key, []);
    byRep.get(key)!.push(d);
  }

  return {
    horizon_weeks: weeks,
    // No avg_visit_minutes: the old figure came from demo data that has been
    // deleted, and a model given a number will quote it.
    full_day_stores: settings.storesPerDay,
    working_days: settings.workingDays.length,
    reps: [...byRep.entries()].map(([rep, rows]) => ({
      rep,
      days_worked: rows.length,
      // Peak load summed across the week, against what those days can hold.
      // Both sides are peaks, so they compare like with like.
      peak_week_stores: rows.reduce((n, r) => n + r.peak_stores, 0),
      peak_week_capacity: rows.length * settings.storesPerDay,
      days: rows.map((r) => ({
        day: WEEKDAYS.find((w) => w.value === r.day_of_week)?.long ?? "?",
        peak_stores: r.peak_stores,
        avg_stores: r.avg_stores,
        cities: r.cities,
        stores_without_location: r.stores_without_city,
        // Explicitly named so the model cannot mistake it for a drive time.
        span_km_straight_line: r.span_km,
        frequency_mix: r.frequency_mix,
      })),
    })),
    gaps,
  };
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    // Proxy no longer guards /api, so authenticate here — and return JSON, not
    // a redirect, so the client sees a real status code.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profile?.role !== "manager") {
      return Response.json(
        { error: "Insights are available to managers only." },
        { status: 403 }
      );
    }

    // Insights are part of the Reports module. Checked in the database, like
    // every module gate, and before anything is spent.
    const moduleGate = await requireModule(supabase, "reports");
    if (!moduleGate.ok) return moduleGate.response;

    // Deliberately after authz: an anonymous caller should learn nothing about
    // how this server is configured, including whether a key is set.
    if (!process.env.OPENAI_API_KEY) {
      return Response.json(
        { error: "OPENAI_API_KEY is not configured on the server." },
        { status: 503 }
      );
    }

    // One long completion over the whole estate per call, so this is the most
    // expensive thing a signed-in user can trigger. Charged before the prompt
    // is built, let alone sent.
    const live = await requireFeature(supabase, "insights", "AI insights");
    if (!live.ok) return live.response;

    const gate = await enforceRateLimit(supabase, LIMITS.insights);
    if (!gate.ok) return gate.response;

    // The company's words and name, so a cleaning company is briefed about
    // sites and cleaners. Read with the caller's session, like everything
    // else here. A failed lookup is not worth losing the briefing over: the
    // neutral words are still correct English, just not the company's own.
    const { data: rawConfig, error: configError } = await supabase.rpc(
      "my_company_config"
    );
    if (configError) {
      console.error("insights: company configuration lookup failed", configError);
    }
    const config = configError ? null : parseCompanyConfig(rawConfig);
    const ctx: PromptContext = {
      terms: config?.terms ?? DEFAULT_TERMS,
      companyName: config?.branding.name ?? "",
      merchandising: config ? moduleEnabled(config.modules, "distribution") : false,
    };

    const body = (await request.json()) as {
      reportType?: string;
      templateId?: string;
      from?: string;
      to?: string;
      weeks?: number;
    };

    // Unknown values fall back to the reports briefing, which is what every
    // caller asked for before this field meant anything.
    const reportType = body.reportType === "call_cycle" ? "call_cycle" : "reports";

    let instructions: string;
    let userContent: string;

    if (reportType === "call_cycle") {
      // A call cycle has a horizon, not a date range — from/to are meaningless
      // here, so they are neither required nor read.
      const weeks = Number(body.weeks ?? 8);
      if (!Number.isFinite(weeks) || weeks < 1 || weeks > 52) {
        return Response.json(
          { error: "weeks must be between 1 and 52." },
          { status: 400 }
        );
      }

      const [days, gaps, settings] = await Promise.all([
        fetchCallCycleReview(supabase, weeks),
        fetchCallCycleGaps(supabase),
        fetchOrgSettings(supabase),
      ]);

      // Nothing is planned yet — the common first state. Answer it directly
      // rather than paying for a call whose only possible output is invention:
      // a model handed an empty plan will find something to say about it.
      if (days.length === 0) {
        return Response.json(
          noCallCycleBriefing(ctx.terms, gaps?.unplanned_assignments ?? null)
        );
      }

      instructions = callCyclePrompt(ctx, settings.storesPerDay);
      userContent =
        `${promptWords(ctx.terms).schedule_cycle.one} over the next ${weeks} weeks.\n\n` +
        JSON.stringify(buildCallCyclePayload(days, gaps, weeks, settings));
    } else {
      if (!body.from || !body.to) {
        return Response.json({ error: "from and to are required." }, { status: 400 });
      }
      const range = { from: new Date(body.from), to: new Date(body.to) };
      if (Number.isNaN(range.from.getTime()) || Number.isNaN(range.to.getTime())) {
        return Response.json({ error: "Invalid date range." }, { status: 400 });
      }

      // Same fetchers the UI uses, run with the caller's cookie session — so RLS
      // scopes these to the caller's own org exactly as it does in the browser.
      const [gaps, reps, trends] = await Promise.all([
        fetchCoverageGaps(supabase, range),
        fetchRepScorecard(supabase, range),
        fetchComplianceTrends(supabase, range, "week"),
      ]);

      const form = body.templateId
        ? await fetchFormReport(supabase, body.templateId, range)
        : [];

      const payload = {
        period: { from: body.from, to: body.to },
        coverage: gaps.map((g) => ({
          store: g.store_name,
          group: g.store_group,
          days_since_last_visit: g.days_since,
          visits_in_period: g.visits_in_period,
          responsible_rep: g.assigned_reps,
        })),
        reps: reps.map((r) => ({
          rep: r.rep_name,
          visits_total: r.visits_total,
          visits_completed: r.visits_completed,
          completion_rate: r.completion_rate,
          // Pre-formatted, not raw seconds. The model quotes whatever it is given,
          // and "3,354 seconds" is not how anyone discusses a store visit. Sending
          // the formatted string makes the wrong unit unreachable rather than
          // merely discouraged by the prompt.
          avg_visit_duration: formatDuration(r.avg_duration_seconds),
          overall_score: r.score,
          form_compliance_rate: r.form_compliance_rate,
          location_verified_rate: r.verified_rate,
        })),
        weekly_compliance: trends,
        audit_questions: toAggregate(form),
      };

      const totalSubmissions = trends.reduce(
        (n, t) => n + Number(t.submissions ?? 0),
        0
      );

      instructions = reportsPrompt(ctx);
      userContent =
        reportsLead(ctx, body.from, body.to, totalSubmissions) +
        JSON.stringify(payload);
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await client.responses.create({
      model: MODEL,
      instructions,
      input: [{ role: "user", content: userContent }],
      text: {
        format: {
          type: "json_schema",
          name: "manager_briefing",
          schema: briefingSchema(ctx.terms) as unknown as Record<string, unknown>,
          strict: true,
        },
      },
    });

    const text = response.output_text;
    if (!text) {
      return Response.json(
        { error: "The model returned no output." },
        { status: 502 }
      );
    }

    const parsed = JSON.parse(text) as {
      anomalies?: unknown[];
      actions?: unknown[];
    };

    // Belt and braces. `maxItems` is not reliably enforced inside strict
    // structured outputs, and "the briefing is too long" must not be able to
    // regress just because the model felt thorough on a given day.
    return Response.json({
      ...parsed,
      anomalies: (parsed.anomalies ?? []).slice(0, 3),
      actions: (parsed.actions ?? []).slice(0, 3),
    });
  } catch (reason) {
    // Mirrors the lib/ convention: throw Error(message), surface message.
    const message =
      reason instanceof Error ? reason.message : "Unexpected error generating insights.";
    return Response.json({ error: message }, { status: 500 });
  }
}
