import type { DateRange } from "@/lib/date-range";

/**
 * Deliberately short. The panel sits above the charts, which carry the detail —
 * so the briefing is a headline plus what to do, capped at three of each by the
 * server.
 */
export type Insight = {
  headline: string;
  anomalies: { subject: string; detail: string; severity: "low" | "medium" | "high" }[];
  actions: string[];
  data_caveat: string | null;
};

export type InsightRequest = {
  range: DateRange;
  templateId?: string | null;
};

/** Identifies a briefing so an unchanged filter set doesn't pay for a second call. */
export function insightCacheKey({ range, templateId }: InsightRequest): string {
  return [
    range.from.toISOString(),
    range.to.toISOString(),
    templateId ?? "none",
  ].join("|");
}

/**
 * Requests a briefing from `/api/insights`.
 *
 * The key never reaches the browser — this only ever talks to our own origin.
 * The handler returns `{error}` with a real status code rather than redirecting,
 * which is why `proxy.ts` excludes /api from its matcher.
 */
export async function fetchInsight(req: InsightRequest): Promise<Insight> {
  const res = await fetch("/api/insights", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      from: req.range.from.toISOString(),
      to: req.range.to.toISOString(),
      templateId: req.templateId ?? undefined,
    }),
  });

  // Read as text first: a proxy or platform error page is HTML, and calling
  // .json() on it throws a parse error that hides the real status.
  const raw = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error(`Unexpected ${res.status} response from the insights endpoint.`);
  }

  if (!res.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : `Request failed (${res.status}).`;
    throw new Error(message);
  }

  return body as Insight;
}
