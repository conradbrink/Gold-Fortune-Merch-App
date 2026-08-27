"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Choose a store by typing part of its name.
 *
 * The estate is 230 outlets and was a `<select>`. Finding "Choppies Mogoditshane"
 * meant scrolling a list of 230 in alphabetical order, or knowing to type the
 * first letters fast enough that the browser's own type-ahead caught them —
 * which resets after a second, matches from the start of the name only, and
 * gives no feedback about what it matched.
 *
 * Matching is on name, city and code together, and on any part of them: a store
 * filed as "Spar Riverwalk" is found by "riverwalk", and a rep who knows a place
 * by its town finds it by the town. Case and spacing are ignored.
 *
 * Deliberately not a `<select>` underneath. A native select cannot hold a text
 * box, and every version of this that keeps one in the DOM for form semantics
 * ends up with two sources of truth for what is chosen.
 */

export type PickableStore = {
  id: string;
  name: string;
  city?: string | null;
  code?: string | null;
};

/** Everything about a store a person might type, folded for comparison. */
function haystack(store: PickableStore): string {
  return [store.name, store.city, store.code]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function StorePicker({
  stores,
  value,
  onChange,
  placeholder = "Search stores…",
  allLabel,
  id,
  className,
  disabled = false,
}: {
  stores: PickableStore[];
  /** The chosen store id, or `""` for none / all. */
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  /**
   * When set, a first option meaning "no filter" — "All stores". Absent on a
   * picker that must produce a store, like adding a stop.
   */
  allLabel?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const chosen = stores.find((s) => s.id === value) ?? null;

  const matches = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return stores;
    // Every word has to appear somewhere, so "spar gab" finds Spar Gaborone
    // without the words being adjacent or in that order.
    const words = q.split(/\s+/);
    return stores.filter((s) => {
      const hay = haystack(s);
      return words.every((w) => hay.includes(w));
    });
  }, [stores, term]);

  // The option list including "All stores", so keyboard movement and clicking
  // agree on what index means.
  const options = useMemo(
    () => (allLabel ? [null, ...matches] : matches),
    [allLabel, matches]
  );

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!boxRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setTerm("");
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  function choose(store: PickableStore | null) {
    onChange(store?.id ?? "");
    setOpen(false);
    setTerm("");
  }

  const label = chosen
    ? `${chosen.name}${chosen.city ? ` — ${chosen.city}` : ""}`
    : allLabel ?? "";

  return (
    <div ref={boxRef} className={cn("relative", className)}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => {
          setOpen((o) => !o);
          // Focused on the next frame: the input does not exist until the panel
          // has rendered.
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-3 text-sm",
          "focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        )}
      >
        <span
          className={cn(
            "min-w-0 truncate text-left",
            label ? "text-foreground" : "text-muted-foreground"
          )}
        >
          {label || placeholder}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border border-border bg-popover shadow-lg">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={term}
              onChange={(e) => {
                setTerm(e.target.value);
                // Reset here rather than in an effect on `term`: the highlight
                // has to move with the list, and an effect doing it is a second
                // render for something the keystroke already knows.
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setOpen(false);
                  setTerm("");
                  return;
                }
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((i) => Math.min(i + 1, options.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((i) => Math.max(i - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (options.length > 0) choose(options[active] ?? null);
                }
              }}
              placeholder="Name, town or code"
              aria-label="Search stores"
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            {term !== "" && (
              <button
                type="button"
                aria-label="Clear the search"
                onClick={() => {
                  setTerm("");
                  setActive(0);
                  inputRef.current?.focus();
                }}
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <ul className="max-h-72 overflow-y-auto py-1">
            {options.length === 0 ? (
              <li className="px-3 py-3 text-sm text-muted-foreground">
                No store matches &ldquo;{term.trim()}&rdquo;.
              </li>
            ) : (
              options.map((store, i) => {
                const selected = (store?.id ?? "") === value;
                return (
                  <li key={store?.id ?? "__all"}>
                    <button
                      type="button"
                      onMouseEnter={() => setActive(i)}
                      onClick={() => choose(store)}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm",
                        i === active ? "bg-accent/60" : "hover:bg-accent/40"
                      )}
                    >
                      <Check
                        className={cn(
                          "h-4 w-4 shrink-0",
                          selected ? "text-foreground" : "invisible"
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate text-foreground">
                        {store ? store.name : allLabel}
                      </span>
                      {store?.city && (
                        <span className="shrink-0 truncate text-xs text-muted-foreground">
                          {store.city}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })
            )}
          </ul>

          {matches.length < stores.length && (
            <p className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
              {matches.length} of {stores.length} stores
            </p>
          )}
        </div>
      )}
    </div>
  );
}
