import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import {
  fetchComplianceTrends,
  fetchCoverageGaps,
  fetchFormReport,
  fetchRepScorecard,
  type FieldReport,
} from "@/lib/reports";

/**
 * Manager insights.
 *
 * The app's first server-side code, and it exists for one reason: an API key
 * cannot live in a browser bundle. `ANTHROPIC_API_KEY` has no NEXT_PUBLIC_
 * prefix, so Next keeps it server-only.
 *
 * `proxy.ts` deliberately excludes /api from its matcher, so this handler owns
 * its own auth — the Next docs are explicit that proxy is not a security
 * boundary, and a redirect here would replay the POST against an HTML page.
 */

export const runtime = "nodejs";
// A long report can outrun the default serverless ceiling.
export const maxDuration = 60;

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5";

const SYSTEM_PROMPT = `You are an analyst supporting a field-merchandising manager at an FMCG company.

You are given pre-aggregated metrics from their field team's store visits and
merchandising audits. Write a briefing for the manager.

Rules:
- Ground every claim in the supplied numbers. Never invent a figure, a store, or
  a rep that does not appear in the data.
- If the data is too thin to support a conclusion (a handful of submissions, a
  range of a day or two, or a metric with a null rate), say so plainly instead
  of describing a trend. Under-claiming is always better than a confident
  statement the numbers do not support.
- Rates arrive as decimals (0.1353 = 13.53%). Present them as percentages.
- A null rate means "not measured in this period", not zero.
- Be specific and brief. Name the store or rep the number belongs to.
- Anomalies are outliers worth a second look, not every below-average value.
- Actions must be things this manager can actually do: schedule a visit, coach a
  rep, escalate a price or stock issue. No generic advice.`;

const SCHEMA = {
  type: "object",
  properties: {
    headline: {
      type: "string",
      description: "One sentence: the single most important thing this period.",
    },
    findings: {
      type: "array",
      description: "Notable, number-grounded observations.",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          detail: { type: "string" },
        },
        required: ["title", "detail"],
        additionalProperties: false,
      },
    },
    anomalies: {
      type: "array",
      description: "Specific outliers worth investigating. Empty if none stand out.",
      items: {
        type: "object",
        properties: {
          subject: { type: "string", description: "The store, rep or metric." },
          detail: { type: "string" },
          severity: { type: "string", enum: ["low", "medium", "high"] },
        },
        required: ["subject", "detail", "severity"],
        additionalProperties: false,
      },
    },
    actions: {
      type: "array",
      description: "Concrete recommended next steps.",
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
  required: ["headline", "findings", "anomalies", "actions", "data_caveat"],
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
    if (!process.env.ANTHROPIC_API_KEY) {
      return Response.json(
        { error: "ANTHROPIC_API_KEY is not configured on the server." },
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
        avg_duration_seconds: r.avg_duration_seconds,
        form_compliance_rate: r.form_compliance_rate,
        location_verified_rate: r.verified_rate,
      })),
      weekly_compliance: trends,
      audit_questions: toAggregate(form),
    };

    const totalSubmissions = trends.reduce((n, t) => n + Number(t.submissions ?? 0), 0);

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: [
        // Cached: the system prompt is byte-identical across every briefing,
        // while the aggregates below change per request — so the stable half
        // is the prefix and the volatile half comes last.
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      // `medium` is the sweet spot here: the analysis is over a few hundred
      // pre-computed numbers, not an open-ended problem.
      output_config: {
        effort: "medium",
        format: {
          type: "json_schema",
          schema: SCHEMA as unknown as Record<string, unknown>,
        },
      },
      messages: [
        {
          role: "user",
          content:
            `Period ${body.from.slice(0, 10)} to ${body.to.slice(0, 10)}. ` +
            `${totalSubmissions} audit submissions in range.\n\n` +
            JSON.stringify(payload),
        },
      ],
    });

    // Check stop_reason before touching content: on a refusal the content array
    // is empty, and indexing into it would throw a confusing TypeError instead
    // of reporting what actually happened.
    if (response.stop_reason === "refusal") {
      return Response.json(
        { error: "The model declined to analyse this request." },
        { status: 502 }
      );
    }

    const text = response.content.find((b) => b.type === "text")?.text;
    if (!text) {
      return Response.json(
        { error: "The model returned no output." },
        { status: 502 }
      );
    }

    return Response.json(JSON.parse(text));
  } catch (reason) {
    // Mirrors the lib/ convention: throw Error(message), surface message.
    const message =
      reason instanceof Error ? reason.message : "Unexpected error generating insights.";
    return Response.json({ error: message }, { status: 500 });
  }
}
