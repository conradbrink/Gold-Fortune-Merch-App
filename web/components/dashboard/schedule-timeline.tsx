import { cn } from "@/lib/utils";
import { visitStatusColor } from "@/components/dashboard/status-pill";
import type { VisitStatus } from "@/lib/mock-data";

export type TimelineRep = {
  id: string;
  name: string;
};

export type TimelineVisit = {
  id: string;
  repId: string;
  place: string;
  startHour: number;
  endHour: number;
  status: VisitStatus;
};

const START_HOUR = 7;
const END_HOUR = 18;
const HOURS = Array.from(
  { length: END_HOUR - START_HOUR + 1 },
  (_, i) => START_HOUR + i
);

function formatHour(h: number) {
  const period = h >= 12 ? "pm" : "am";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}${period}`;
}

export function ScheduleTimeline({
  reps,
  visits,
}: {
  reps: TimelineRep[];
  visits: TimelineVisit[];
}) {
  const totalHours = END_HOUR - START_HOUR;

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <div className="min-w-[900px]">
        <div className="grid grid-cols-[180px_1fr] border-b border-border bg-secondary/40">
          <div className="px-4 py-2 text-sm font-semibold text-foreground">
            Representatives
          </div>
          <div className="grid" style={{ gridTemplateColumns: `repeat(${totalHours}, 1fr)` }}>
            {HOURS.slice(0, -1).map((h) => (
              <div
                key={h}
                className="border-l border-border px-2 py-2 text-xs text-muted-foreground"
              >
                {formatHour(h)}
              </div>
            ))}
          </div>
        </div>

        {reps.map((rep) => {
          const repVisits = visits.filter((v) => v.repId === rep.id);
          return (
            <div
              key={rep.id}
              className="grid grid-cols-[180px_1fr] border-b border-border last:border-b-0"
            >
              <div className="flex items-center px-4 py-3 text-sm font-medium text-primary">
                {rep.name}
              </div>
              <div className="relative" style={{ height: 48 }}>
                <div
                  className="absolute inset-0 grid"
                  style={{ gridTemplateColumns: `repeat(${totalHours}, 1fr)` }}
                >
                  {HOURS.slice(0, -1).map((h) => (
                    <div key={h} className="border-l border-border" />
                  ))}
                </div>
                {repVisits.map((visit) => {
                  const left =
                    ((visit.startHour - START_HOUR) / totalHours) * 100;
                  const width =
                    ((visit.endHour - visit.startHour) / totalHours) * 100;
                  return (
                    <div
                      key={visit.id}
                      className={cn(
                        "absolute top-2 flex h-8 items-center truncate rounded px-2 text-xs font-medium text-white shadow-sm",
                        visitStatusColor[visit.status]
                      )}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      title={visit.place}
                    >
                      {visit.place}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {reps.length === 0 && (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No reps found for this org.
          </div>
        )}
      </div>
    </div>
  );
}
