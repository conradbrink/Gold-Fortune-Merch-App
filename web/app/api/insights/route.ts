import OpenAI from "openai";
import { createClient } from "@/lib/supabase/server";
import {
  fetchComplianceTrends,
  fetchCoverageGaps,
  fetchFormReport,
  fetchRepScorecard,
  formatDuration,
  type FieldReport,
} from "@/lib/reports";

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

const SYSTEM_PROMPT = `You are an analyst supporting a field-merchandising manager at an FMCG company.

You are given pre-aggregated metrics from their field team's store visits and
merchandising audits. Write a SHORT executive briefing.

The manager reads this on a phone between store visits, not at a desk. Assume
about fifteen seconds of attention. The charts below your briefing already show
the detail — your job is to say what matters and what to do, not to narrate
every metric.

Length:
- At most 3 anomalies and at most 3 actions. Fewer is better.
- Anomaly detail: one sentence, 25 words maximum.
- Action: one sentence, 20 words maximum.
- If nothing is genuinely wrong, return no anomalies and say so in the headline.
  Never pad the lists to reach three — a quiet period is a useful thing to report.

Accuracy:
- Ground every claim in the supplied numbers. Never invent a figure, a store, or
  a rep that does not appear in the data.
- If the data is too thin to support a conclusion (a handful of submissions, a
  range of a day or two, or a metric with a null rate), set data_caveat and say
  so plainly instead of describing a trend. Under-claiming is always better than
  a confident statement the numbers do not support.
- Rates arrive as decimals (0.1353 = 13.53%). Present them as percentages.
- A null rate means "not measured in this period", not zero.
- Durations are supplied pre-formatted ("56m", "1h 12m"). Quote them exactly as
  given. Never convert a duration to seconds — nobody discusses a store visit
  in seconds.
- Name the store or rep a number belongs to. "Ashley Williams completed 5 of 9"
  is useful; "some reps are underperforming" is not.
- Anomalies are outliers worth a second look, not every below-average value.
- Actions must be things this manager can actually do: schedule a visit, coach a
  named rep, escalate a price or stock issue. No generic advice.`;

const SCHEMA = {
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
          subject: { type: "string", description: "The store, rep or metric." },
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

    // Deliberately after authz: an anonymous caller should learn nothing about
    // how this server is configured, including whether a key is set.
    if (!process.env.OPENAI_API_KEY) {
      return Response.json(
        { error: "OPENAI_API_KEY is not configured on the server." },
        { status: 503 }
      );
    }

    const body = (await request.json()) as {
      reportType?: string;
      templateId?: string;
      from?: string;
      to?: string;
    };

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
        responsible_rep: g.primary_rep_name,
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

    const totalSubmissions = trends.reduce((n, t) => n + Number(t.submissions ?? 0), 0);

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await client.responses.create({
      model: MODEL,
      instructions: SYSTEM_PROMPT,
      input: [
        {
          role: "user",
          content:
            `Period ${body.from.slice(0, 10)} to ${body.to.slice(0, 10)}. ` +
            `${totalSubmissions} audit submissions in range.\n\n` +
            JSON.stringify(payload),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "manager_briefing",
          schema: SCHEMA as unknown as Record<string, unknown>,
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
