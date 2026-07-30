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

export function GlobalSearch() {
  const router = useRouter();
  const supabase = createClient();

  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const run = useCallback(
    async (raw: string) => {
      const q = sanitise(raw);
      if (q.length < 2) {
        setHits([]);
        setBusy(false);
        return;
      }
      setBusy(true);
      const like = `%${q}%`;
      try {
        const [stores, reps, products, forms, files] = await Promise.all([
          supabase
            .from("stores")
            .select("id, name, city")
            .eq("active", true)
            .or(`name.ilike.${like},city.ilike.${like}`)
            .limit(5),
          supabase
            .from("profiles")
            .select("id, full_name, email")
            .or(`full_name.ilike.${like},email.ilike.${like}`)
            .limit(5),
          supabase
            .from("products")
            .select("id, name, brand, sku_code")
            .or(`name.ilike.${like},brand.ilike.${like},sku_code.ilike.${like}`)
            .limit(5),
          supabase
            .from("form_templates")
            .select("id, name")
            .ilike("name", like)
            .limit(5),
          supabase.from("files").select("id, name").ilike("name", like).limit(5),
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
            detail: null,
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

        setHits(found);
        setActive(0);
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Debounced: five queries per keystroke would be five per keystroke.
  useEffect(() => {
    if (term.trim() === "") {
      setHits([]);
      return;
    }
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
    router.push(hit.href);
  }

  return (
    <div
      ref={boxRef}
      className="relative hidden min-w-0 flex-1 sm:block sm:max-w-md"
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
          ) : hits.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">
              Nothing matches &ldquo;{term.trim()}&rdquo;.
            </p>
          ) : (
            <ul>
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
