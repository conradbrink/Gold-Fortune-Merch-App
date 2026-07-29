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

/**
 * Two briefings share one endpoint.
 *
 * A discriminated union rather than optional fields everywhere: the two have
 * genuinely different inputs — reports look at a date *range*, the call cycle
 * looks forward over a *horizon* — and collapsing them into one loose shape
 * would make it possible to ask for a call-cycle review with a date range and
 * get silence back.
 */
export type InsightRequest =
  | { reportType: "reports"; range: DateRange; templateId?: string | null }
  | { reportType: "call_cycle"; weeks: number };

/** Identifies a briefing so an unchanged filter set doesn't pay for a second call. */
export function insightCacheKey(req: InsightRequest): string {
  if (req.reportType === "call_cycle") {
    return ["call_cycle", req.weeks].join("|");
  }
  return [
    "reports",
    req.range.from.toISOString(),
    req.range.to.toISOString(),
    req.templateId ?? "none",
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
  const requestBody =
    req.reportType === "call_cycle"
      ? { reportType: req.reportType, weeks: req.weeks }
      : {
          reportType: req.reportType,
          from: req.range.from.toISOString(),
          to: req.range.to.toISOString(),
          templateId: req.templateId ?? undefined,
        };

  const res = await fetch("/api/insights", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
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
