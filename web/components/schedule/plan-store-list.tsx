"use client";

import { MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/native-select";
import {
  FREQUENCIES,
  WEEKDAYS,
  describeCycle,
  type PlannedStore,
  type VisitFrequency,
} from "@/lib/schedule";

/**
 * The call cycle as a list of shops, grouped by town.
 *
 * The counterpart to `CycleGrid`: that one says what a given day holds, this
 * says how often a shop is called on, and this is still the better place to
 * change a frequency. Grouped by **city** because the single worst planning
 * mistake is sending a rep across two towns in one day, and a flat alphabetical
 * list hides exactly that.
 *
 * Purely presentational — every control calls back up to the planner, which owns
 * the optimistic write and the per-row busy set. Two rows can be in flight at
 * once, so `busy` is a set of assignment ids rather than a single id.
 */
export function PlanStoreList({
  groups,
  query,
  onQueryChange,
  busy,
  onChangeDay,
  onChangeWeek,
  onChangeFrequency,
}: {
  groups: { city: string; stores: PlannedStore[] }[];
  query: string;
  onQueryChange: (q: string) => void;
  /** Assignment ids currently being written. */
  busy: ReadonlySet<string>;
  onChangeDay: (s: PlannedStore, day: number | null) => void;
  onChangeWeek: (s: PlannedStore, week: number) => void;
  onChangeFrequency: (s: PlannedStore, frequency: VisitFrequency) => void;
}) {
  return (
      <>
        <Input
          // A placeholder is not an accessible name, and it disappears as soon
          // as anybody types.
          aria-label="Search stores or cities"
          placeholder="Search stores or cities…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />

        <div className="space-y-4">
          {groups.length === 0 && (
            <p className="rounded-lg border border-border bg-card py-8 text-center text-sm text-muted-foreground">
              No stores match &ldquo;{query}&rdquo;.
            </p>
          )}

          {groups.map((g) => (
            <div
              key={g.city}
              className="overflow-hidden rounded-lg border border-border"
            >
              <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold text-foreground">
                  {g.city}
                </span>
                <span className="text-xs text-muted-foreground">
                  {g.stores.length} {g.stores.length === 1 ? "store" : "stores"}
                </span>
              </div>

              <ul className="divide-y divide-border">
                {g.stores.map((s) => (
                  <li
                    key={s.assignment_id}
                    className={[
                      "flex flex-wrap items-end gap-3 px-3 py-3",
                      busy.has(s.assignment_id) ? "opacity-60" : "",
                    ].join(" ")}
                  >
                    <div className="min-w-[180px] flex-1">
                      <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <span className="truncate">{s.store_name}</span>
                        {s.is_primary && (
                          <Badge variant="secondary" className="shrink-0">
                            Primary
                          </Badge>
                        )}
                        {!s.active && (
                          <Badge variant="destructive" className="shrink-0">
                            Inactive
                          </Badge>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {describeCycle(s)}
                      </p>
                    </div>

                    <div className="w-32 space-y-1">
                      <Label
                        htmlFor={`day-${s.assignment_id}`}
                        className="text-xs text-muted-foreground"
                      >
                        Day
                      </Label>
                      <NativeSelect
                        id={`day-${s.assignment_id}`}
                        value={s.day_of_week === null ? "" : String(s.day_of_week)}
                        disabled={busy.has(s.assignment_id)}
                        onChange={(e) =>
                          onChangeDay(
                            s,
                            e.target.value === "" ? null : Number(e.target.value)
                          )
                        }
                      >
                        <option value="">Not planned</option>
                        {WEEKDAYS.map((w) => (
                          <option key={w.value} value={w.value}>
                            {w.long}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>

                    <div className="w-36 space-y-1">
                      <Label
                        htmlFor={`freq-${s.assignment_id}`}
                        className="text-xs text-muted-foreground"
                      >
                        Frequency
                      </Label>
                      <NativeSelect
                        id={`freq-${s.assignment_id}`}
                        value={s.visit_frequency}
                        disabled={busy.has(s.assignment_id)}
                        title="Frequency belongs to the store, so this changes it for every rep who covers it."
                        onChange={(e) =>
                          onChangeFrequency(s, e.target.value as VisitFrequency)
                        }
                      >
                        {FREQUENCIES.map((f) => (
                          <option key={f.value} value={f.value}>
                            {f.label}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>

                    {/* Week only means anything above weekly — rendering it
                        always would invite setting a value that is ignored. */}
                    {s.visit_frequency !== "weekly" && (
                      <div className="w-32 space-y-1">
                        <Label
                          htmlFor={`week-${s.assignment_id}`}
                          className="text-xs text-muted-foreground"
                        >
                          Week
                        </Label>
                        <NativeSelect
                          id={`week-${s.assignment_id}`}
                          value={String(s.week_of_cycle ?? 1)}
                          disabled={
                            busy.has(s.assignment_id) || s.day_of_week === null
                          }
                          onChange={(e) => onChangeWeek(s, Number(e.target.value))}
                        >
                          {s.visit_frequency === "biweekly" ? (
                            <>
                              <option value="1">Week A</option>
                              <option value="2">Week B</option>
                            </>
                          ) : (
                            <>
                              <option value="1">1st</option>
                              <option value="2">2nd</option>
                              <option value="3">3rd</option>
                              <option value="4">4th</option>
                            </>
                          )}
                        </NativeSelect>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </>
  );
}
