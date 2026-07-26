"use client";

import { useEffect, useState } from "react";
import {
  Users,
  Store,
  ClipboardCheck,
  MapPin,
  XCircle,
  CheckCircle2,
} from "lucide-react";
import { StatTile } from "@/components/dashboard/stat-tile";
import { CoverageDonut } from "@/components/dashboard/coverage-donut";
import { UnitsTrendChart } from "@/components/dashboard/units-trend-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

function toDateInput(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function InsightsDashboardPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalVisits: 0,
    visitsWithForms: 0,
    contributingReps: 0,
    totalStores: 0,
    checkedOutVisits: 0,
    missedVisits: 0,
    storesCovered: 0,
    activeStores: 0,
  });
  const [visitsByDay, setVisitsByDay] = useState<{ week: string; units: number }[]>([]);

  useEffect(() => {
    async function load() {
      setLoading(true);

      const { count: totalVisits } = await supabase
        .from("visits")
        .select("id", { count: "exact", head: true });

      const { data: submissionRows } = await supabase
        .from("form_submissions")
        .select("visit_id");
      const distinctVisitsWithForms = new Set(
        (submissionRows ?? []).map((r) => r.visit_id)
      ).size;

      const { data: checkedOutRows } = await supabase
        .from("visits")
        .select("rep_id, store_id")
        .eq("status", "checked_out");
      const contributingReps = new Set(
        (checkedOutRows ?? []).map((r) => r.rep_id)
      ).size;
      const storesCovered = new Set(
        (checkedOutRows ?? []).map((r) => r.store_id)
      ).size;

      const { count: missedVisits } = await supabase
        .from("visits")
        .select("id", { count: "exact", head: true })
        .eq("status", "missed");

      const { count: totalStores } = await supabase
        .from("stores")
        .select("id", { count: "exact", head: true });
      const { count: activeStores } = await supabase
        .from("stores")
        .select("id", { count: "exact", head: true })
        .eq("active", true);

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
      const { data: routeRows } = await supabase
        .from("routes")
        .select("scheduled_date")
        .gte("scheduled_date", toDateInput(sevenDaysAgo));

      const countsByDate: Record<string, number> = {};
      for (const r of routeRows ?? []) {
        countsByDate[r.scheduled_date] = (countsByDate[r.scheduled_date] ?? 0) + 1;
      }
      const trend = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(sevenDaysAgo);
        d.setDate(d.getDate() + i);
        const key = toDateInput(d);
        return {
          week: d.toLocaleDateString("en-US", { weekday: "short" }),
          units: countsByDate[key] ?? 0,
        };
      });
      setVisitsByDay(trend);

      setStats({
        totalVisits: totalVisits ?? 0,
        visitsWithForms: distinctVisitsWithForms,
        contributingReps,
        totalStores: totalStores ?? 0,
        checkedOutVisits: checkedOutRows?.length ?? 0,
        missedVisits: missedVisits ?? 0,
        storesCovered,
        activeStores: activeStores ?? 0,
      });
      setLoading(false);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pctWithForms =
    stats.totalVisits > 0
      ? Math.round((stats.visitsWithForms / stats.totalVisits) * 100)
      : 0;
  const coveragePct =
    stats.activeStores > 0
      ? Math.round((stats.storesCovered / stats.activeStores) * 100)
      : 0;

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card py-16 text-center text-sm text-muted-foreground">
        Loading dashboard…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Insights Dashboard
        </h1>
        <p className="text-sm text-muted-foreground">
          Detailed field reporting — live from your Gold Fortune data
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Total Visits"
          value={stats.totalVisits.toLocaleString()}
          icon={<Store className="h-5 w-5 opacity-80" />}
          href="/visits"
        />
        <StatTile
          label="Visits w/Forms Submitted"
          value={stats.visitsWithForms.toLocaleString()}
          sublabel={`${pctWithForms}% of All Visits`}
          icon={<ClipboardCheck className="h-5 w-5 opacity-80" />}
          href="/visits?filter=with-forms"
        />
        <StatTile
          label="Contributing Reps"
          value={stats.contributingReps}
          icon={<Users className="h-5 w-5 opacity-80" />}
          tone="outline"
        />
        <StatTile
          label="Total Stores"
          value={stats.totalStores.toLocaleString()}
          icon={<MapPin className="h-5 w-5 opacity-80" />}
          tone="outline"
          href="/stores"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Coverage %</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            <CoverageDonut
              covered={coveragePct}
              notCovered={100 - coveragePct}
            />
            <div className="flex w-full items-center justify-center gap-6 text-sm">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-gold" />
                <span className="text-muted-foreground">Covered</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                <span className="text-muted-foreground">Not Covered</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Visits Scheduled — Last 7 Days</CardTitle>
          </CardHeader>
          <CardContent>
            <UnitsTrendChart data={visitsByDay} />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatTile
          label="Checked-out Visits"
          value={stats.checkedOutVisits.toLocaleString()}
          icon={<CheckCircle2 className="h-5 w-5 opacity-80" />}
          tone="outline"
        />
        <StatTile
          label="Missed Visits"
          value={stats.missedVisits.toLocaleString()}
          icon={<XCircle className="h-5 w-5 opacity-80" />}
          tone="outline"
        />
      </div>
    </div>
  );
}
