"use client";

import { useRef, useState } from "react";
import { ChevronDown, ChevronUp, GripVertical, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WIDGETS, findWidget } from "@/components/dashboard/widget-registry";

/**
 * Choosing which cards the dashboard shows, and in what order.
 *
 * Works on a draft copy and only writes on Save, so backing out of the dialog
 * leaves the dashboard alone. Reordering has arrows as well as drag: HTML5 drag
 * events never fire for touch, and a manager on a tablet would otherwise have no
 * way to move anything — the same reason the form builder keeps both.
 */
export function CustomiseDashboard({
  open,
  onOpenChange,
  layout,
  onSave,
  onReset,
  saving,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The layout in force, copied into the draft each time the dialog opens. */
  layout: string[];
  onSave: (widgetIds: string[]) => void;
  onReset: () => void;
  saving: boolean;
  error: string | null;
}) {
  const [draft, setDraft] = useState<string[]>(layout);
  /**
   * The row being dragged, held in a ref because `drop` must not depend on a
   * re-render having happened since `dragstart`.
   *
   * Reading it from state works only because a real drag spends a few hundred
   * milliseconds firing `dragover` in between, which is long enough for React to
   * commit. Dispatching `dragstart` and `drop` back to back reorders nothing —
   * verified, before this ref existed. The state copy is kept purely for the
   * drag-opacity style, which is allowed to be a frame late.
   */
  const dragIndexRef = useRef<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  /** Whether the draft has been taken from `layout` for the current opening. */
  const [seeded, setSeeded] = useState(open);

  // Seeded once per opening, so reopening shows what is actually stored rather
  // than last time's abandoned edits.
  //
  // Adjusted during render rather than in an effect: React re-renders straight
  // away without painting the stale value, whereas an effect would show one
  // frame of the old draft and trip the set-state-in-effect rule. Each branch
  // flips the flag it tests, so this cannot loop however `layout` is passed.
  if (open && !seeded) {
    setSeeded(true);
    setDraft(layout);
  } else if (!open && seeded) {
    setSeeded(false);
  }

  const hidden = WIDGETS.filter((w) => !draft.includes(w.id));

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= draft.length) return;
    const next = [...draft];
    [next[index], next[target]] = [next[target], next[index]];
    setDraft(next);
  }

  function handleDrop(targetIndex: number) {
    const from = dragIndexRef.current;
    dragIndexRef.current = null;
    setDragIndex(null);
    if (from === null || from === targetIndex) return;
    setDraft((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* `grid-cols-1` is load-bearing: DialogContent is a grid, and its implicit
          `auto` column is sized by content, so a long line of prose stretched the
          column past the dialog's own width and clipped the buttons on the right.
          `grid-cols-1` is `minmax(0, 1fr)`, which is allowed to shrink. */}
      <DialogContent className="grid-cols-1 max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Customise dashboard</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Choose the cards you want and drag them into the order you read them in.
          This is yours alone — it does not change what anyone else sees.
        </p>

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="space-y-1.5">
          <h3 className="text-sm font-semibold text-foreground">
            On your dashboard
          </h3>
          {draft.length === 0 && (
            <p className="rounded-md border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
              Nothing selected. The dashboard will be empty until you add a card.
            </p>
          )}
          {draft.map((id, index) => {
            const widget = findWidget(id);
            if (!widget) return null;
            return (
              <div
                key={id}
                draggable
                onDragStart={() => {
                  dragIndexRef.current = index;
                  setDragIndex(index);
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(index)}
                onDragEnd={() => {
                  dragIndexRef.current = null;
                  setDragIndex(null);
                }}
                className={`flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 ${
                  dragIndex === index ? "opacity-50" : ""
                }`}
              >
                <GripVertical className="hidden h-4 w-4 shrink-0 cursor-grab text-muted-foreground active:cursor-grabbing sm:block" />
                <div className="flex shrink-0 flex-col">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    aria-label={`Move ${widget.title} up`}
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground"
                    disabled={index === draft.length - 1}
                    onClick={() => move(index, 1)}
                    aria-label={`Move ${widget.title} down`}
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {widget.title}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {widget.description}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => setDraft(draft.filter((d) => d !== id))}
                  aria-label={`Remove ${widget.title}`}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
        </div>

        {hidden.length > 0 && (
          <div className="space-y-1.5">
            <h3 className="text-sm font-semibold text-foreground">Available</h3>
            {hidden.map((widget) => (
              <div
                key={widget.id}
                className="flex items-center gap-2 rounded-md border border-dashed border-border px-2 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {widget.title}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {widget.description}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 gap-1"
                  onClick={() => setDraft([...draft, widget.id])}
                  aria-label={`Add ${widget.title}`}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add
                </Button>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            className="mr-auto"
            disabled={saving}
            onClick={onReset}
          >
            Reset to default
          </Button>
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={saving}
            onClick={() => onSave(draft)}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving ? "Saving…" : "Save layout"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
