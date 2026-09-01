"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
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

type CommonProps = {
  stores: PickableStore[];
  placeholder?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
};

type SingleProps = CommonProps & {
  multiple?: false;
  /** The chosen store id, or `""` for none / all. */
  value: string;
  onChange: (id: string) => void;
  /**
   * When set, a first option meaning "no filter" — "All stores". Absent on a
   * picker that must produce a store, like adding a stop.
   */
  allLabel?: string;
};

type MultiProps = CommonProps & {
  multiple: true;
  /** The chosen store ids, in the order they were picked. */
  value: string[];
  onChange: (ids: string[]) => void;
  /**
   * Meaningless when several can be chosen — "all stores" is expressed by
   * picking them, and an option that silently means "no filter" alongside real
   * selections reads as a store called "All stores".
   */
  allLabel?: never;
};

/**
 * Single by default. `multiple` turns each option into a toggle and keeps the
 * panel open, because choosing five shops one at a time through a panel that
 * shuts after each is the thing this mode exists to stop.
 */
export function StorePicker(props: SingleProps | MultiProps) {
  const {
    stores,
    placeholder = "Search stores…",
    id,
    className,
    disabled = false,
  } = props;
  const multiple = props.multiple === true;
  const allLabel = multiple ? undefined : props.allLabel;

  /**
   * One shape for both modes, so everything below stops caring which it is.
   *
   * Memoised on the prop rather than derived inline: the single-select branch
   * builds a fresh array on every render, which would rebuild the Set below
   * every render too.
   */
  const selectedIds = useMemo(
    () =>
      props.multiple === true
        ? props.value
        : props.value
          ? [props.value]
          : [],
    [props.multiple, props.value]
  );
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  /**
   * Whether an input method is mid-composition.
   *
   * Typing a name in a language that needs an IME ends each candidate with
   * Enter, and that Enter would otherwise pick whatever the list is currently
   * highlighting — before the word being typed had even been entered. The
   * ref rather than state because it is read inside a keydown and changing it
   * must not re-render. Safari clears `isComposing` before the confirming
   * Enter arrives, so the flag is held until the next keystroke rather than
   * cleared on `compositionend`.
   */
  const composing = useRef(false);
  // Stable across renders and unique per instance, so two pickers on one page
  // do not point their `aria-controls` at each other.
  const listId = useId();
  const optionId = (i: number) => `${listId}-option-${i}`;

  const chosen = stores.find((s) => selected.has(s.id)) ?? null;

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
    function leave() {
      setOpen(false);
      setTerm("");
    }
    function onPointerDown(event: MouseEvent) {
      if (!boxRef.current?.contains(event.target as Node)) leave();
    }
    // Tabbing out has to close it too. A panel left open behind a keyboard user
    // covers whatever they moved on to, and they have no pointer to dismiss it
    // with. `relatedTarget` is where focus went — null when it left the
    // document entirely, which is not a reason to close.
    function onFocusOut(event: FocusEvent) {
      const next = event.relatedTarget as Node | null;
      if (next && !boxRef.current?.contains(next)) leave();
    }
    document.addEventListener("mousedown", onPointerDown);
    const box = boxRef.current;
    box?.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      box?.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  // The list scrolls at 18rem and arrow keys walk past that in a few presses.
  // Without this the highlight moves somewhere the user cannot see, which on a
  // 230-item list is the same as it not moving at all.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function choose(store: PickableStore | null) {
    if (props.multiple === true) {
      // No "all" row in this mode, so a null option cannot arrive.
      if (!store) return;
      const next = selected.has(store.id)
        ? props.value.filter((sid) => sid !== store.id)
        : [...props.value, store.id];
      props.onChange(next);
      // Panel and search term both survive: picking three shops in one town
      // means typing the town once, not once per shop. Focus goes back to the
      // input because the click moved it to the option button.
      inputRef.current?.focus();
      return;
    }
    props.onChange(store?.id ?? "");
    setOpen(false);
    setTerm("");
  }

  /**
   * What the closed control says. Names the store while there is one to name —
   * a bare count is uninformative at one — and counts past that, where the
   * names do not fit and the number is the useful part.
   */
  const label = multiple
    ? selectedIds.length === 0
      ? ""
      : selectedIds.length === 1 && chosen
        ? `${chosen.name}${chosen.city ? ` — ${chosen.city}` : ""}`
        : `${selectedIds.length} stores selected`
    : chosen
      ? `${chosen.name}${chosen.city ? ` — ${chosen.city}` : ""}`
      : allLabel ?? "";

  return (
    <div ref={boxRef} className={cn("relative", className)}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-haspopup="listbox"
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
              onCompositionStart={() => {
                composing.current = true;
              }}
              onCompositionEnd={() => {
                // Cleared on the next tick rather than now. WebKit fires the
                // confirming Enter *after* `compositionend` with `isComposing`
                // already false, so clearing immediately would let that Enter
                // choose a store — and clearing only on the next keystroke
                // stranded the flag when the candidate was confirmed with the
                // mouse, swallowing the Enter after it.
                setTimeout(() => {
                  composing.current = false;
                }, 0);
              }}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  (e.nativeEvent.isComposing || composing.current)
                ) {
                  return;
                }
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
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={
                options.length > 0 ? optionId(active) : undefined
              }
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

          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Stores"
            aria-multiselectable={multiple || undefined}
            className="max-h-72 overflow-y-auto py-1"
          >
            {options.length === 0 ? (
              <li className="px-3 py-3 text-sm text-muted-foreground">
                No store matches &ldquo;{term.trim()}&rdquo;.
              </li>
            ) : (
              options.map((store, i) => {
                const isChosen = store
                  ? selected.has(store.id)
                  : selectedIds.length === 0;
                return (
                  <li key={store?.id ?? "__all"} role="none">
                    <button
                      type="button"
                      role="option"
                      id={optionId(i)}
                      data-index={i}
                      aria-selected={isChosen}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => choose(store)}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm",
                        i === active ? "bg-accent/60" : "hover:bg-accent/40"
                      )}
                    >
                      {/* A tick that only ever appears is fine for one choice.
                          For several, an empty box is what says "this one is
                          not picked, and could be" — without it a list of
                          unticked rows looks like nothing is selectable. */}
                      {multiple ? (
                        <span
                          className={cn(
                            "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                            isChosen
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-muted-foreground/40"
                          )}
                        >
                          {isChosen && <Check className="h-3 w-3" />}
                        </span>
                      ) : (
                        <Check
                          className={cn(
                            "h-4 w-4 shrink-0",
                            isChosen ? "text-foreground" : "invisible"
                          )}
                        />
                      )}
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

          {(matches.length < stores.length || selectedIds.length > 0) && (
            <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
              <span>
                {matches.length < stores.length
                  ? `${matches.length} of ${stores.length} stores`
                  : `${stores.length} stores`}
              </span>
              {multiple && selectedIds.length > 0 && (
                <span className="flex items-center gap-2">
                  <span className="font-medium text-foreground">
                    {selectedIds.length} selected
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (props.multiple === true) props.onChange([]);
                      inputRef.current?.focus();
                    }}
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    Clear
                  </button>
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
