"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, MapPin, Phone, Trash2, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import {
  deleteLead,
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
  /**
   * The dragged card lives in a ref as well as in state.
   *
   * `dragover` fires before React has re-rendered from `dragstart`, so a
   * handler that reads the state variable sees null on the first events and
   * skips `preventDefault` — and a column that does not preventDefault is not
   * a drop target, which is why dropping used to do nothing. The ref is set
   * synchronously; the state exists only to drive the styling.
   */
  const draggingRef = useRef<string | null>(null);
  /** Newest move per lead id, so an older one cannot roll back or reload over it. */
  const moveSeq = useRef(new Map<string, number>());
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<Stage | null>(null);
  /** The card the confirm dialog is about, and null when it is closed. */
  const [deleteTarget, setDeleteTarget] = useState<Lead | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  // The mount fetch. `load` sets `loading` synchronously, which the rule reports
  // as an error, and it is right that this is not synchronising with an external
  // system — but the first render is the skeleton either way, and there is no
  // cascade. Suppressed here rather than left to fail a lint-gated build.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  /**
   * Deletes the card the dialog is about, then reloads.
   *
   * Not optimistic, unlike `move`. A card that slides to another column and
   * slides back is a visible correction; a card that vanishes and reappears
   * reads as the board being broken, and the one thing a manager must trust
   * about a delete is whether it happened.
   */
  async function remove() {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteLead(supabase, deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  async function move(lead: Lead, stage: Stage) {
    // Per-card sequence. Rolling back the one card fixed the cross-card damage,
    // but not the same card moved twice: an older failure would revert to a stage
    // the newer move has already replaced, and its `load()` would then publish
    // the server's older view over the newer one still in flight. Only the newest
    // move for a card may roll it back or reload.
    const seq = (moveSeq.current.get(lead.id) ?? 0) + 1;
    moveSeq.current.set(lead.id, seq);
    const isLatest = () => moveSeq.current.get(lead.id) === seq;

    setMoving(lead.id);
    setError(null);
    // Moved locally first: the board is the manager's train of thought, and a
    // card that hesitates before jumping columns breaks it. Reverted below if
    // the write is refused.
    // This card's own stage, not a snapshot of the whole board: dragging is
    // never disabled, so two moves can be in flight, and restoring the array
    // from this closure would put the other card back where it no longer is.
    const previousStage = lead.stage;
    setLeads((prev) =>
      prev.map((l) => (l.id === lead.id ? { ...l, stage } : l))
    );
    try {
      await setLeadStage(supabase, lead.id, stage);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!isLatest()) return;
      setLeads((prev) =>
        prev.map((l) => (l.id === lead.id ? { ...l, stage: previousStage } : l))
      );
      // Whatever went wrong, this board disagrees with the database — a card
      // that refuses to move and then sits there is worse than one that
      // disappears because somebody else dealt with it. Re-read rather than
      // leave the manager dragging at something that is not there.
      //
      // The message is set *after* the reload, because load() clears the
      // banner: setting it first meant the card vanished with no explanation.
      await load();
      setError(message);
    } finally {
      // Only the newest move for this card owns the disabled state.
      if (isLatest()) setMoving(null);
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
      ) : leads.length === 0 && !error ? (
        // Only when the load succeeded and found nothing. A failed fetch also
        // leaves `leads` empty, and "No leads yet" would then state as fact the
        // one thing the page does not know: whether there are any.
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
                // preventDefault is what marks an element as a drop target, and
                // it has to happen on *every* dragover — skipping it even once
                // leaves the browser showing a "no entry" cursor. dropEffect is
                // set explicitly rather than left to the browser's default.
                onDragOver={(e) => {
                  if (!draggingRef.current) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDragOver((s) => (s === stage.value ? s : stage.value));
                }}
                onDragLeave={(e) => {
                  // Also fires when crossing onto a child, so only clear when
                  // the pointer has genuinely left the column.
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setDragOver((s) => (s === stage.value ? null : s));
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain") || draggingRef.current;
                  draggingRef.current = null;
                  setDragOver(null);
                  setDragging(null);
                  const lead = leads.find((l) => l.id === id);
                  // Dropping a card back where it started is not a move.
                  if (lead && lead.stage !== stage.value) move(lead, stage.value);
                }}
                className={[
                  // Always border-2: switching width on hover shifts every card
                  // by a pixel, which reads as a flinch.
                  "flex min-w-0 flex-col rounded-md border-2 transition-colors duration-150",
                  dragOver === stage.value
                    ? "border-dashed border-primary bg-primary/10"
                    : "border-border bg-muted/20",
                ].join(" ")}
              >
                <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                  <span className="text-sm font-medium text-foreground">
                    {stage.label}
                  </span>
                  <Badge variant="secondary">{cards.length}</Badge>
                </header>

                {/* min-h so an empty column is still a target you can hit —
                    a 20px strip of text is not something you can drop onto. */}
                <div className="min-h-28 flex-1 space-y-2 p-2">
                  {cards.length === 0 ? (
                    <p className="px-1 py-6 text-center text-xs text-muted-foreground">
                      {dragOver === stage.value ? "Drop to move here" : "Nothing here."}
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
                            draggingRef.current = lead.id;
                            // Deferred by a frame: the browser snapshots the
                            // drag image straight after this handler, and
                            // fading the card now makes it snapshot the faded
                            // version — a ghost you can barely see.
                            requestAnimationFrame(() => setDragging(lead.id));
                          }}
                          onDragEnd={() => {
                            draggingRef.current = null;
                            setDragging(null);
                            setDragOver(null);
                          }}
                          className={[
                            "space-y-1.5 rounded-md border border-border bg-card p-2.5 shadow-sm",
                            "transition-[opacity,box-shadow] duration-150",
                            dragging === lead.id
                              ? "opacity-40"
                              : "cursor-grab hover:shadow-md active:cursor-grabbing",
                          ].join(" ")}
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

                          <div className="flex items-center gap-1">
                            <NativeSelect
                              aria-label={`Stage for ${lead.company_name}`}
                              className="h-7 flex-1 text-xs"
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
                            {/* Deleting is the rare action and 'Lost' is the
                                ordinary one, so it is an icon beside the stage
                                picker rather than a button competing with it. */}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                              aria-label={`Delete ${lead.company_name}`}
                              disabled={moving === lead.id}
                              onClick={() => setDeleteTarget(lead)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
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

      {/* Also when the load failed and left the board empty — that is the case
          where retrying is the whole point, and it used to be the one case with
          no button to do it from. */}
      {!loading && (leads.length > 0 || error) && (
        <Button variant="outline" size="sm" onClick={load}>
          Refresh
        </Button>
      )}

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this lead?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p>
              <strong>{deleteTarget?.company_name}</strong> and everything
              recorded on the call — the purpose, the outcome, the notes, the
              contact and any position recorded — are removed for good. This
              cannot be undone.
            </p>
            <p className="text-muted-foreground">
              If the call really happened and went nowhere, move it to{" "}
              <strong>Lost</strong> instead: that keeps the record of the work.
            </p>
            {/* The one case that can come back on its own, and the rep never
                sees why. Shown only for `in_progress`, because a lead the
                server holds as completed has both outbox entries acknowledged
                and gone. */}
            {deleteTarget?.status === "in_progress" && (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-amber-700 dark:text-amber-500">
                This call is still in progress. If the rep&apos;s phone is
                holding it unsent, deleting it now can either recreate the card
                when the phone next syncs, or leave that phone retrying for ever
                on a call it cannot finish. Safer to wait until it shows as
                completed.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              onClick={remove}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete lead"}
            </Button>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
