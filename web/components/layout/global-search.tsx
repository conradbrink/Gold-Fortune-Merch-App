"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Global search across the five things a manager looks for by name.
 *
 * The header promised this for a long time without being wired to anything —
 * it was a styled div around a span, so it could not even be focused.
 *
 * Only `form_templates` has a page of its own to land on. The other four are
 * list pages with their own filter box, so a hit navigates there carrying `?q=`
 * and the page seeds its filter from it. That is read with `window.location`
 * rather than `useSearchParams`, which in this version of Next forces every
 * consumer into a Suspense boundary; these pages are already client components,
 * so there is nothing to gain from it.
 */

type Hit = {
  kind: "Outlet" | "Rep" | "Line" | "Form" | "File";
  id: string;
  label: string;
  detail: string | null;
  href: string;
};

/**
 * PostgREST parses `or=(…)` itself, so a comma, bracket or wildcard typed into
 * the box would change the filter's meaning rather than being searched for.
 */
function sanitise(term: string): string {
  return term.replace(/[,()%*\\]/g, " ").trim();
}

/**
 * A query that resolves whether it succeeded or not.
 *
 * PostgREST reports a refusal as `.error` on a resolved promise, but a transport
 * failure rejects — and one rejection in a `Promise.all` loses every sibling
 * result. Turning the rejection into the same `{ data, error }` shape keeps the
 * results that did arrive and leaves one way to report the ones that did not.
 */
async function settled<T extends { data: unknown; error: unknown }>(
  query: PromiseLike<T>
): Promise<T | { data: null; error: { message: string } }> {
  try {
    return await query;
  } catch (e) {
    return {
      data: null,
      error: { message: e instanceof Error ? e.message : String(e) },
    };
  }
}

/**
 * @param revealed Shows the box below the `sm` breakpoint, where it is hidden by
 *   default because the header has no room for it. The top bar's mobile search
 *   button drives this — before it did, that button was inert.
 */
export function GlobalSearch({ revealed = false }: { revealed?: boolean }) {
  const router = useRouter();
  const supabase = createClient();

  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const runSeq = useRef(0);

  const run = useCallback(
    async (raw: string) => {
      // Which run this is. The debounce stops a query per keystroke, but not two
      // in flight: type, wait 200ms, type again while the first is still out,
      // and whichever *returns* last wins. That is not necessarily the one whose
      // term is in the box.
      //
      // Claimed before the length check, so that deleting back down to one
      // character also retires a search still on the wire.
      const runId = ++runSeq.current;
      const isStale = () => runId !== runSeq.current;

      const q = sanitise(raw);
      if (q.length < 2) {
        setHits([]);
        setError(null);
        setBusy(false);
        return;
      }

      setBusy(true);
      const like = `%${q}%`;
      try {
        // Each source is settled on its own. `Promise.all` rejected the whole
        // batch on one transport failure, and the catch below then cleared the
        // hits — throwing away four sets of results that had arrived, and
        // bypassing the partial-error row built for exactly this case. A refusal
        // (`.error`) and a rejection now arrive in the same shape, so one code
        // path reports both.
        const [stores, reps, products, forms, files] = await Promise.all([
          settled(
            supabase
              .from("stores")
              .select("id, name, city")
              .eq("active", true)
              .or(`name.ilike.${like},city.ilike.${like}`)
              .limit(5)
          ),
          settled(
            supabase
              .from("profiles")
              .select("id, full_name, email")
              // Reps only: a hit here navigates to /representatives?q=…, and the
              // directory lists reps, so a manager match led to an empty page.
              .eq("role", "rep")
              .or(`full_name.ilike.${like},email.ilike.${like}`)
              .limit(5)
          ),
          settled(
            supabase
              .from("products")
              .select("id, name, brand, sku_code")
              .or(`name.ilike.${like},brand.ilike.${like},sku_code.ilike.${like}`)
              .limit(5)
          ),
          settled(
            supabase
              .from("form_templates")
              .select("id, name, active")
              .ilike("name", like)
              .limit(5)
          ),
          settled(
            supabase.from("files").select("id, name").ilike("name", like).limit(5)
          ),
        ]);

        const found: Hit[] = [
          ...(stores.data ?? []).map((s) => ({
            kind: "Outlet" as const,
            id: s.id,
            label: s.name,
            detail: s.city,
            href: `/stores?q=${encodeURIComponent(s.name)}`,
          })),
          ...(reps.data ?? []).map((r) => ({
            kind: "Rep" as const,
            id: r.id,
            label: r.full_name ?? r.email ?? "Unnamed",
            detail: r.email,
            href: `/representatives?q=${encodeURIComponent(r.full_name ?? r.email ?? "")}`,
          })),
          ...(products.data ?? []).map((p) => ({
            kind: "Line" as const,
            id: p.id,
            label: p.name,
            detail: p.brand ?? p.sku_code,
            href: `/products?q=${encodeURIComponent(p.name)}`,
          })),
          ...(forms.data ?? []).map((f) => ({
            kind: "Form" as const,
            id: f.id,
            label: f.name,
            // Archived forms stay searchable — the Forms list shows them with the
            // same badge, and hiding them would make an archived form impossible
            // to find in order to restore it. But a hit that does not say so
            // implies reps are still filling it in.
            detail: f.active ? null : "Archived",
            // The only one of the five with a page of its own.
            href: `/forms/${f.id}`,
          })),
          ...(files.data ?? []).map((f) => ({
            kind: "File" as const,
            id: f.id,
            label: f.name,
            detail: null,
            href: `/files?q=${encodeURIComponent(f.name)}`,
          })),
        ];

        if (isStale()) return;

        // A refused query used to arrive as `?? []` and read exactly like "no
        // matches" — the one answer a search must not invent. Say the search
        // failed instead, and still show whatever did come back.
        const failed = [stores, reps, products, forms, files].find((r) => r.error);
        setError(failed?.error?.message ?? null);
        setHits(found);
        setActive(0);
      } catch (e) {
        // `settled` never rejects, so reaching here means something outside the
        // queries went wrong. Still reported rather than swallowed: nothing
        // awaits `run`, so without this the box would say "Nothing matches" —
        // a claim about the data made without any.
        if (isStale()) return;
        setError(e instanceof Error ? e.message : String(e));
        setHits([]);
      } finally {
        // Only the newest run owns the spinner; an older one finishing must not
        // clear it while the current search is still out.
        if (!isStale()) setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Debounced: five queries per keystroke would be five per keystroke.
  //
  // The empty-term case goes through `run` as well rather than clearing state
  // here. `run("")` short-circuits on the length check — and, importantly, still
  // claims a run id first, which retires any search already on the wire. Doing
  // it in the effect body cleared the results without retiring anything, so a
  // reply for the term the user had just deleted could repopulate the list.
  useEffect(() => {
    const timer = setTimeout(() => run(term), 200);
    return () => clearTimeout(timer);
  }, [term, run]);

  // A dropdown that outlives a click elsewhere covers the page it is over.
  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  function go(hit: Hit) {
    setOpen(false);
    setTerm("");
    setHits([]);
    setError(null);
    router.push(hit.href);
  }

  return (
    <div
      ref={boxRef}
      className={cn(
        "relative min-w-0 flex-1 sm:block sm:max-w-md",
        revealed ? "block" : "hidden"
      )}
    >
      <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/50 px-3 py-2 text-sm">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              return;
            }
            if (hits.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => (i + 1) % hits.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => (i - 1 + hits.length) % hits.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              go(hits[active]);
            }
          }}
          placeholder="Find places, reps, forms, files and products"
          aria-label="Search"
          className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
        />
        {term !== "" && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setTerm("");
              setHits([]);
              setError(null);
            }}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {open && term.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
          {busy && hits.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">Searching…</p>
          ) : error && hits.length === 0 ? (
            <p className="px-3 py-3 text-sm text-destructive">
              The search could not be completed: {error}
            </p>
          ) : hits.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">
              Nothing matches &ldquo;{term.trim()}&rdquo;.
            </p>
          ) : (
            <ul>
              {/* Some sources answered, at least one did not — say so above the
                  results rather than let a partial list pass for the whole. */}
              {error && (
                <li className="border-b border-border px-3 py-2 text-xs text-destructive">
                  Some results are missing: {error}
                </li>
              )}
              {hits.map((hit, i) => (
                <li key={`${hit.kind}-${hit.id}`}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(hit)}
                    className={cn(
                      "flex w-full items-center gap-3 px-3 py-2 text-left text-sm",
                      i === active ? "bg-accent/60" : "hover:bg-accent/40"
                    )}
                  >
                    <span className="w-14 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
                      {hit.kind}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-foreground">
                      {hit.label}
                    </span>
                    {hit.detail && (
                      <span className="shrink-0 truncate text-xs text-muted-foreground">
                        {hit.detail}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
