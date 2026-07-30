"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, MapPin, Phone, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { createClient } from "@/lib/supabase/client";
import {
  fetchLeads,
  localToday,
  setLeadStage,
  STAGES,
  type Lead,
  type Stage,
} from "@/lib/leads";

/**
 * Leads — the pipeline of sales calls on shops that are not customers yet.
 *
 * A board rather than a table: the question a manager asks here is "what is
 * sitting at each stage and what is overdue", which a column answers at a
 * glance and a sortable list does not.
 *
 * Cards move two ways, and both are kept on purpose. Dragging is what a board
 * invites you to do with a mouse. The select underneath is what works with a
 * keyboard, with a screen reader, and on the phone in a car — HTML5 drag
 * events do not fire for touch at all, so a drag-only board would be a board
 * half the audience cannot use.
 */
export default function LeadsPage() {
  const supabase = createClient();

  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [repFilter, setRepFilter] = useState("all");
  /** The card under the cursor, and the column it is currently over. */
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<Stage | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setLeads(await fetchLeads(supabase));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const reps = useMemo(() => {
    const seen = new Map<string, string>();
    for (const l of leads) {
      if (l.rep_id) seen.set(l.rep_id, l.rep_name ?? "Unnamed");
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [leads]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return leads.filter((l) => {
      if (repFilter !== "all" && l.rep_id !== repFilter) return false;
      if (!q) return true;
      return `${l.company_name} ${l.contact_name ?? ""} ${l.purpose}`
        .toLowerCase()
        .includes(q);
    });
  }, [leads, query, repFilter]);

  const today = localToday();
  const overdue = visible.filter(
    (l) => l.follow_up_required && l.follow_up_on && l.follow_up_on < today
  ).length;

  async function move(lead: Lead, stage: Stage) {
    setMoving(lead.id);
    setError(null);
    // Moved locally first: the board is the manager's train of thought, and a
    // card that hesitates before jumping columns breaks it. Reverted below if
    // the write is refused.
    const before = leads;
    setLeads((prev) =>
      prev.map((l) => (l.id === lead.id ? { ...l, stage } : l))
    );
    try {
      await setLeadStage(supabase, lead.id, stage);
    } catch (e) {
      setLeads(before);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMoving(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Leads
          </h1>
          <p className="text-sm text-muted-foreground">
            Sales calls on shops that are not customers yet · {visible.length}{" "}
            {visible.length === 1 ? "lead" : "leads"}
            {overdue > 0 && ` · ${overdue} follow-up${overdue === 1 ? "" : "s"} overdue`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Input
            placeholder="Search company, contact or purpose…"
            className="w-64"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <NativeSelect
            value={repFilter}
            onChange={(e) => setRepFilter(e.target.value)}
            aria-label="Filter by rep"
          >
            <option value="all">Every rep</option>
            {reps.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {loading ? (
        <div className="grid gap-3 lg:grid-cols-5">
          {STAGES.map((s) => (
            <div key={s.value} className="h-40 animate-pulse rounded-md bg-muted/50" />
          ))}
        </div>
      ) : leads.length === 0 ? (
        <div className="rounded-lg border border-border bg-card py-16 text-center">
          <p className="text-sm font-medium text-foreground">No leads yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            A lead appears here when a rep logs a sales visit from the phone —
            Unscheduled visit → Sales visit.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-5">
          {STAGES.map((stage) => {
            const cards = visible.filter((l) => l.stage === stage.value);
            return (
              <section
                key={stage.value}
                aria-label={stage.label}
                // preventDefault on dragOver is what marks a element as a drop
                // target; without it the browser refuses the drop silently.
                onDragOver={(e) => {
                  if (!dragging) return;
                  e.preventDefault();
                  setDragOver(stage.value);
                }}
                onDragLeave={(e) => {
                  // Fires when crossing onto a child too, so only clear when
                  // the pointer has genuinely left the column.
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setDragOver((s) => (s === stage.value ? null : s));
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(null);
                  const id = e.dataTransfer.getData("text/plain") || dragging;
                  setDragging(null);
                  const lead = leads.find((l) => l.id === id);
                  // Dropping a card back where it started is not a move.
                  if (lead && lead.stage !== stage.value) move(lead, stage.value);
                }}
                className={
                  dragOver === stage.value
                    ? "flex min-w-0 flex-col rounded-md border-2 border-primary bg-primary/5"
                    : "flex min-w-0 flex-col rounded-md border border-border bg-muted/20"
                }
              >
                <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                  <span className="text-sm font-medium text-foreground">
                    {stage.label}
                  </span>
                  <Badge variant="secondary">{cards.length}</Badge>
                </header>

                <div className="space-y-2 p-2">
                  {cards.length === 0 ? (
                    <p className="px-1 py-6 text-center text-xs text-muted-foreground">
                      Nothing here.
                    </p>
                  ) : (
                    cards.map((lead) => {
                      const isOverdue =
                        lead.follow_up_required &&
                        lead.follow_up_on !== null &&
                        lead.follow_up_on < today;
                      return (
                        <article
                          key={lead.id}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData("text/plain", lead.id);
                            e.dataTransfer.effectAllowed = "move";
                            setDragging(lead.id);
                          }}
                          onDragEnd={() => {
                            setDragging(null);
                            setDragOver(null);
                          }}
                          className={
                            dragging === lead.id
                              ? "space-y-1.5 rounded-md border border-border bg-card p-2.5 opacity-40 shadow-sm"
                              : "cursor-grab space-y-1.5 rounded-md border border-border bg-card p-2.5 shadow-sm active:cursor-grabbing"
                          }
                        >
                          <p className="text-sm font-medium leading-tight text-foreground">
                            {lead.company_name}
                          </p>
                          <p className="line-clamp-2 text-xs text-muted-foreground">
                            {lead.purpose}
                          </p>

                          {lead.outcome && (
                            <p className="line-clamp-2 text-xs text-foreground">
                              {lead.outcome}
                            </p>
                          )}

                          <div className="space-y-0.5 text-[11px] text-muted-foreground">
                            {lead.contact_name && (
                              <p className="flex items-center gap-1">
                                <User className="h-3 w-3 shrink-0" />
                                {lead.contact_name}
                              </p>
                            )}
                            {lead.contact_phone && (
                              <p className="flex items-center gap-1">
                                <Phone className="h-3 w-3 shrink-0" />
                                {lead.contact_phone}
                              </p>
                            )}
                            {lead.follow_up_required && lead.follow_up_on && (
                              <p
                                className={
                                  isOverdue
                                    ? "flex items-center gap-1 font-medium text-destructive"
                                    : "flex items-center gap-1"
                                }
                              >
                                <CalendarClock className="h-3 w-3 shrink-0" />
                                {isOverdue ? "Overdue " : "Follow up "}
                                {new Date(
                                  `${lead.follow_up_on}T00:00:00`
                                ).toLocaleDateString("en-GB", {
                                  day: "numeric",
                                  month: "short",
                                })}
                              </p>
                            )}
                            {lead.start_lat !== null && lead.start_lng !== null && (
                              <p className="flex items-center gap-1">
                                <MapPin className="h-3 w-3 shrink-0" />
                                Position recorded
                              </p>
                            )}
                          </div>

                          <p className="text-[11px] text-muted-foreground">
                            {lead.rep_name ?? "Unknown rep"} ·{" "}
                            {new Date(lead.started_at).toLocaleDateString("en-GB", {
                              day: "numeric",
                              month: "short",
                            })}
                            {lead.status === "in_progress" && " · in progress"}
                          </p>

                          <NativeSelect
                            aria-label={`Stage for ${lead.company_name}`}
                            className="h-7 text-xs"
                            value={lead.stage}
                            disabled={moving === lead.id}
                            onChange={(e) => move(lead, e.target.value as Stage)}
                          >
                            {STAGES.map((s) => (
                              <option key={s.value} value={s.value}>
                                {s.label}
                              </option>
                            ))}
                          </NativeSelect>
                        </article>
                      );
                    })
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {!loading && leads.length > 0 && (
        <Button variant="outline" size="sm" onClick={load}>
          Refresh
        </Button>
      )}
    </div>
  );
}
