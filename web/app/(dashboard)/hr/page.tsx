"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import {
  Users,
  CalendarCheck,
  CalendarOff,
  FileWarning,
  Star,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatTile } from "@/components/dashboard/stat-tile";
import { createClient } from "@/lib/supabase/client";
import { useHrLoad } from "@/lib/hr/use-load";
import {
  fetchHrSummary,
  sweepExpiryNotifications,
  type HrSummary,
} from "@/lib/hr/dashboard";
import { formatDateOnly } from "@/lib/format-date";
import { formatScore, periodLabel, ratingBand } from "@/lib/hr/types";

/**
 * The HR dashboard.
 *
 * Every figure is one call to `hr_dashboard_summary`, which counts under the
 * caller's own row-level security — so an HR manager sees the organisation and
 * a line manager sees their team, without this page knowing which of the two it
 * is talking to.
 *
 * Tiles link to the screen that would answer the next question. A number a
 * manager cannot act on is decoration, and the whole point of "3 documents
 * expired" is to find out which three.
 */
export default function HrDashboardPage() {
  const supabase = createClient();
  const [summary, setSummary] = useState<HrSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchHrSummary(supabase);
      setSummary(data);
      // Standing in for a scheduler, and only ever a convenience: every figure
      // it turns into a notification is already on this page. See
      // `sweepExpiryNotifications` for why it lives on a page load.
      void sweepExpiryNotifications(supabase);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useHrLoad(load);

  if (error) {
    return (
      <div className="space-y-4">
        <Header asOf={null} />
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <p className="font-medium">Could not load the HR dashboard</p>
          <p className="mt-1">{error}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={load}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (loading || !summary) {
    return (
      <div className="space-y-4">
        <Header asOf={null} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg bg-muted/50" />
          ))}
        </div>
      </div>
    );
  }

  const s = summary;
  const attendance = s.attendance_today;
  const band = ratingBand(s.performance.average_score);

  return (
    <div className="space-y-6">
      <Header asOf={s.as_of} />

      <Section title="Workforce" icon={<Users className="h-4 w-4" />}>
        <StatTile
          label="Total employees"
          value={s.workforce.total}
          sublabel={`${s.workforce.active} active`}
          href="/hr/employees"
        />
        <StatTile
          tone="outline"
          label="On leave"
          value={s.workforce.on_leave}
          sublabel="Employment status, not today's absences"
          href="/hr/leave"
        />
        <StatTile
          tone="outline"
          label="Suspended"
          value={s.workforce.suspended}
          sublabel="Currently suspended"
          href="/hr/employees"
        />
        <StatTile
          tone="outline"
          label="Recently joined"
          value={s.workforce.recently_joined}
          sublabel="Started in the last 30 days"
          href="/hr/employees"
        />
        <StatTile
          tone="outline"
          label="Recently left"
          value={s.workforce.recently_terminated}
          sublabel="Ended in the last 30 days"
          href="/hr/employees"
        />
      </Section>

      <Section
        title="Attendance today"
        icon={<CalendarCheck className="h-4 w-4" />}
        note={`${attendance.expected} expected to be working today`}
      >
        <StatTile
          label="Working"
          value={attendance.working}
          sublabel={`of ${attendance.expected} expected`}
          href="/hr/attendance"
        />
        <StatTile
          tone="outline"
          label="Late"
          value={attendance.late}
          sublabel="Started after the threshold"
          href="/hr/attendance"
        />
        <StatTile
          tone="outline"
          label="Absent"
          value={attendance.absent}
          sublabel="No workday, no visits, no leave"
          href="/hr/attendance"
        />
        <StatTile
          tone="outline"
          label="Incomplete"
          value={attendance.incomplete}
          // The distinction that matters, said on the tile rather than left for
          // somebody to discover: these people were working.
          sublabel="Working, but no Start or Stop recorded"
          href="/hr/attendance"
        />
        <StatTile
          tone="outline"
          label="On leave"
          value={attendance.on_leave}
          sublabel="Approved leave covering today"
          href="/hr/leave"
        />
      </Section>

      <Section title="Leave" icon={<CalendarOff className="h-4 w-4" />}>
        <StatTile
          label="Pending requests"
          value={s.leave.pending_requests}
          sublabel="Waiting on a decision"
          href="/hr/leave"
        />
        <StatTile
          tone="outline"
          label="Away today"
          value={s.leave.on_leave_today}
          sublabel="Approved leave covering today"
          href="/hr/leave"
        />
      </Section>

      <Section
        title="Documents and contracts"
        icon={<FileWarning className="h-4 w-4" />}
      >
        <StatTile
          tone="outline"
          label="Expired documents"
          value={s.documents.expired}
          sublabel="Past their expiry date"
          href="/hr/documents"
        />
        <StatTile
          tone="outline"
          label="Expiring in 7 days"
          value={s.documents.expiring_7}
          sublabel="Renew now"
          href="/hr/documents"
        />
        <StatTile
          tone="outline"
          label="Expiring in 30 days"
          value={s.documents.expiring_30}
          sublabel="On the horizon"
          href="/hr/documents"
        />
        <StatTile
          tone="outline"
          label="Contracts expiring"
          value={s.contracts.expiring_soon}
          sublabel={
            s.contracts.expired > 0
              ? `${s.contracts.expired} already past their end date`
              : "None past their end date"
          }
          href="/hr/employees"
        />
      </Section>

      <Section
        title="Performance"
        icon={<Star className="h-4 w-4" />}
        note={`${periodLabel(
          s.performance.period.type,
          s.performance.period.year,
          s.performance.period.index
        )} · below ${s.performance.threshold} counts as below expectations`}
      >
        <StatTile
          label="Reviews due"
          value={s.performance.reviews_due}
          sublabel="Active staff with no completed review this period"
          href="/hr/performance"
        />
        <StatTile
          tone="outline"
          label="Reviews completed"
          value={s.performance.reviews_completed}
          sublabel="This period"
          href="/hr/performance"
        />
        <StatTile
          tone="outline"
          label="Average score"
          value={formatScore(s.performance.average_score)}
          // Each person's *latest* finished review, not the mean of every
          // review ever written — the question is where the team stands now.
          sublabel={band ? `${band} · latest review per person` : "No completed reviews yet"}
          href="/hr/performance"
        />
        <StatTile
          tone="outline"
          label="Below expectations"
          value={s.performance.below_expectations}
          sublabel={`Latest score under ${s.performance.threshold}`}
          href="/hr/performance"
        />
      </Section>

      <Section title="Disciplinary" icon={<ShieldAlert className="h-4 w-4" />}>
        <StatTile
          label="Open cases"
          value={s.disciplinary.open_cases}
          sublabel="Not yet closed"
          href="/hr/disciplinary"
        />
        <StatTile
          tone="outline"
          label="Under investigation"
          value={s.disciplinary.under_investigation}
          href="/hr/disciplinary"
        />
        <StatTile
          tone="outline"
          label="Awaiting a response"
          value={s.disciplinary.awaiting_response}
          sublabel="Employee has been asked to reply"
          href="/hr/disciplinary"
        />
        <StatTile
          tone="outline"
          label="Hearings pending"
          value={s.disciplinary.hearings_pending}
          href="/hr/disciplinary"
        />
        <StatTile
          tone="outline"
          label="Active warnings"
          value={s.disciplinary.active_warnings}
          sublabel="No expiry, or not yet lapsed"
          href="/hr/disciplinary"
        />
      </Section>
    </div>
  );
}

function Header({ asOf }: { asOf: string | null }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Human Resources
        </h1>
        <p className="text-sm text-muted-foreground">
          {asOf ? `As at ${formatDateOnly(asOf)}` : "Loading…"}
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/hr/employees" />}>
          Employees
        </Button>
        <Button size="sm" nativeButton={false} render={<Link href="/hr/attendance" />}>
          Attendance
        </Button>
      </div>
    </div>
  );
}

function Section({
  title,
  icon,
  note,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {icon}
          {title}
        </h2>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {children}
      </div>
    </section>
  );
}
