import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The settings pages' layout: one bordered surface per page, its sections
 * split by a line, each with its name on the left and its controls on the
 * right (stacked on a phone). No card inside a card, no paragraph of
 * explanation: a section says what it is in a few words.
 */
export function SettingsPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <h1 className="text-xl font-semibold tracking-tight text-balance text-foreground">{title}</h1>
      {children}
    </div>
  );
}

export function SettingsSurface({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("divide-y divide-border rounded-xl border border-border bg-card", className)}>{children}</div>
  );
}

export function SettingsSection({
  title,
  description,
  children,
  id,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={id ? `${id}-title` : undefined}
      className="grid gap-4 p-5 sm:p-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8"
    >
      <div className="space-y-1">
        <h2 id={id ? `${id}-title` : undefined} className="text-sm font-semibold text-foreground">
          {title}
        </h2>
        {description && <p className="text-sm text-pretty text-muted-foreground">{description}</p>}
      </div>
      <div className="min-w-0 space-y-5">{children}</div>
    </section>
  );
}

/**
 * The foot of a section or a page: its one Save button and what happened.
 * The message is announced, and an error replaces "Saved".
 */
export function SaveRow({
  onSave,
  busy,
  dirty,
  saved,
  error,
  label = "Save changes",
}: {
  onSave: () => void;
  busy: boolean;
  dirty: boolean;
  saved: boolean;
  error: string | null;
  label?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border px-5 py-3 sm:px-6">
      <p aria-live="polite" className={cn("mr-auto text-sm", error ? "text-destructive" : "text-muted-foreground")}>
        {error ?? (saved && !dirty ? "Saved." : "")}
      </p>
      <Button onClick={onSave} disabled={busy || !dirty}>
        {busy ? "Saving…" : label}
      </Button>
    </div>
  );
}

/** A small set of choices shown side by side, one of them chosen: days, distances. */
export function ChoiceButtons<T extends string | number>({
  options,
  value,
  onChange,
  label,
  disabled,
  multiple,
}: {
  options: { value: T; label: string; title?: string }[];
  value: T | T[];
  onChange: (value: T) => void;
  label: string;
  disabled?: boolean;
  /** Each button toggles on its own (working days) rather than one being chosen. */
  multiple?: boolean;
}) {
  const on = (v: T) => (Array.isArray(value) ? value.includes(v) : value === v);
  return (
    <div role={multiple ? "group" : "radiogroup"} aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role={multiple ? undefined : "radio"}
          aria-checked={multiple ? undefined : on(o.value)}
          aria-pressed={multiple ? on(o.value) : undefined}
          title={o.title}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex h-9 min-w-12 items-center justify-center rounded-lg border px-3 text-sm font-medium tabular-nums transition-colors duration-150 outline-none",
            "focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50",
            on(o.value)
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-background text-foreground hover:bg-muted"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
