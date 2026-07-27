"use client";

import { useState } from "react";
import { Sparkles, RefreshCw, AlertTriangle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fetchInsight, insightCacheKey, type Insight } from "@/lib/insights";
import type { DateRange } from "@/lib/date-range";

/**
 * AI briefing over the current filter set.
 *
 * Deliberately generated on demand rather than on every filter change: the
 * input is deterministic, so an unchanged filter set would pay for an identical
 * answer. The cache is keyed on the filters and cleared implicitly when they
 * change (the key stops matching).
 */
export function InsightsPanel({
  range,
  templateId,
}: {
  range: DateRange;
  templateId: string | null;
}) {
  const [insight, setInsight] = useState<Insight | null>(null);
  const [cacheKey, setCacheKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentKey = insightCacheKey({ range, templateId });
  const stale = insight !== null && cacheKey !== currentKey;

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchInsight({ range, templateId });
      setInsight(result);
      setCacheKey(currentKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setInsight(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-primary/30">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <Sparkles className="h-4 w-4 text-primary" />
          Manager briefing
        </CardTitle>
        <Button size="sm" variant="outline" onClick={generate} disabled={loading}>
          {loading ? (
            <>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              Analysing…
            </>
          ) : insight ? (
            <>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Regenerate
            </>
          ) : (
            "Generate"
          )}
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {!insight && !error && !loading && (
          <p className="text-sm text-muted-foreground">
            Summarise this period&rsquo;s coverage, rep performance and compliance
            metrics, and surface anomalies worth acting on. Only aggregated
            numbers are sent — no photos, locations or free-text answers.
          </p>
        )}

        {stale && (
          <p className="text-xs text-muted-foreground">
            Filters changed since this was generated — regenerate to refresh.
          </p>
        )}

        {insight && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-foreground">{insight.headline}</p>

            {insight.data_caveat && (
              <p className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {insight.data_caveat}
              </p>
            )}

            {insight.findings.length > 0 && (
              <Section title="Findings">
                <ul className="space-y-2">
                  {insight.findings.map((f, i) => (
                    <li key={i} className="text-sm">
                      <span className="font-medium text-foreground">{f.title}. </span>
                      <span className="text-muted-foreground">{f.detail}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {insight.anomalies.length > 0 && (
              <Section title="Anomalies">
                <ul className="space-y-2">
                  {insight.anomalies.map((a, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <Badge
                        variant={a.severity === "high" ? "destructive" : "secondary"}
                        className="mt-0.5 shrink-0 capitalize"
                      >
                        {a.severity}
                      </Badge>
                      <span>
                        <span className="font-medium text-foreground">{a.subject}. </span>
                        <span className="text-muted-foreground">{a.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {insight.actions.length > 0 && (
              <Section title="Recommended actions">
                <ul className="space-y-1.5">
                  {insight.actions.map((a, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                      {a}
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      {children}
    </div>
  );
}
