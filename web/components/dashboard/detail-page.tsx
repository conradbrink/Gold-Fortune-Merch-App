"use client";

import Link from "next/link";
import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TableHead } from "@/components/ui/table";

/**
 * The pieces every dashboard card's own page is built from (owner, 13 Oct
 * 2026: "if the dashboard says store health when I go into the page it should
 * be the same kind of dashboard and simplified as well where we can see these
 * insights").
 *
 * Each page reads top to bottom the same way: the card itself, opened up, with
 * its figures as tiles to choose from; then two insight panels whose lines
 * narrow the list when tapped; then the list. One set of pieces, so Store
 * health, the orders pipeline, sales and the field team look and behave alike.
 */

/** Back to the dashboard, the card's name, one sentence, and an action (Export). */
export function DetailHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <Link href="/" className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Dashboard
        </Link>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

export type Tone = "good" | "bad" | "warn";

const TONE_TEXT: Record<Tone, string> = {
  good: "text-emerald-700 dark:text-emerald-400",
  bad: "text-red-700 dark:text-red-400",
  warn: "text-amber-700 dark:text-amber-400",
};

/** One of the card's figures, as a tile that picks what the list below shows. */
export type Tile = {
  id: string;
  label: string;
  value: ReactNode;
  /** A line under the figure: its value in money, how old the oldest is. */
  sub?: string;
  tone?: Tone;
};

/**
 * The card's figures as tiles. Pressing one chooses what the panels and the
 * list show; pressing the chosen one again clears the choice, on a page whose
 * list has a view for no tile at all (`allowNone`).
 */
export function TilePicker({
  tiles,
  active,
  onChoose,
  label,
  allowNone = false,
  loading = false,
}: {
  tiles: Tile[];
  active: string | null;
  onChoose: (id: string | null) => void;
  /** What the tiles choose between, for a screen reader. */
  label: string;
  allowNone?: boolean;
  loading?: boolean;
}) {
  const cols =
    tiles.length >= 5 ? "lg:grid-cols-5" : tiles.length === 4 ? "lg:grid-cols-4" : tiles.length === 3 ? "sm:grid-cols-3" : "";
  return (
    <div role="group" aria-label={label} className={`grid grid-cols-2 gap-2 ${cols}`}>
      {tiles.map((tile, i) => {
        const on = tile.id === active;
        return (
          <button
            key={tile.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChoose(on && allowNone ? null : tile.id)}
            className={`flex min-h-11 flex-col items-start gap-1 rounded-xl p-3 text-left transition-[background-color,box-shadow,transform] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.98] motion-reduce:transition-none ${
              on ? "bg-primary/5 ring-2 ring-primary" : "bg-card ring-1 ring-foreground/10 hover:bg-muted/40"
            } ${tiles.length % 2 === 1 && i === tiles.length - 1 ? "col-span-2 sm:col-span-1" : ""}`}
          >
            <span className="text-xs font-medium text-muted-foreground">{tile.label}</span>
            <span
              className={`text-[28px] font-semibold leading-none tracking-tight tabular-nums ${tile.tone ? TONE_TEXT[tile.tone] : "text-foreground"}`}
            >
              {loading ? " " : tile.value}
            </span>
            {tile.sub && !loading && <span className="text-xs text-muted-foreground">{tile.sub}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** The card at the top of the page: a white card with the tiles and anything else the card shows. */
export function TopCard({ children }: { children: ReactNode }) {
  return <Card className="flex flex-col gap-4 p-5">{children}</Card>;
}

/** A coloured part of a split bar, sized by `flex`. */
export type Segment = { flex: number; className: string };

/** One line of an insight panel: a name, a bar, a figure. */
export type InsightLine = {
  id: string;
  label: string;
  /** The figure on the right: usually how many of the chosen group. */
  value: ReactNode;
  /** A split bar (segments) or a single fill from 0 to 1. */
  bar: Segment[] | number;
  /** Nothing of the chosen group here: shown, but not a filter. */
  disabled?: boolean;
  /** Set apart: "Unassigned", "No town recorded". */
  aside?: "warn" | "muted";
};

const INSIGHT_ROW =
  "-mx-1.5 grid w-[calc(100%+0.75rem)] grid-cols-[minmax(6rem,9rem)_1fr_auto] items-center gap-3 rounded-md px-1.5 py-2 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default";

/**
 * "By rep", "By town", "Waiting": a short ranked list whose lines narrow the
 * page's list when tapped, and widen it again when tapped a second time.
 */
export function InsightPanel({
  title,
  caption,
  lines,
  active,
  onToggle,
  footnote,
  empty,
  limit = 6,
}: {
  title: string;
  /** What the figures count, on the right of the title: the chosen group. */
  caption?: string;
  lines: InsightLine[];
  active: string;
  onToggle: (id: string) => void;
  footnote?: string;
  empty: string;
  limit?: number;
}) {
  const shown = lines.slice(0, limit);
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {caption && <span className="text-right text-xs text-muted-foreground">{caption}</span>}
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col">
          {shown.map((l) => {
            const on = active === l.id;
            return (
              <li key={l.id} className="border-b last:border-b-0">
                <button
                  type="button"
                  aria-pressed={on}
                  disabled={l.disabled}
                  onClick={() => onToggle(l.id)}
                  className={`${INSIGHT_ROW} ${on ? "bg-primary/10" : "enabled:hover:bg-muted/60"}`}
                >
                  <span
                    className={`truncate ${
                      l.aside === "warn" ? "italic text-amber-700 dark:text-amber-400" : l.aside === "muted" ? "italic text-muted-foreground" : ""
                    }`}
                  >
                    {l.label}
                  </span>
                  {typeof l.bar === "number" ? (
                    <span className="h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <span className="block h-full rounded-full bg-primary/60" style={{ width: `${Math.min(Math.max(l.bar, 0), 1) * 100}%` }} />
                    </span>
                  ) : (
                    <span className="flex h-2.5 gap-px overflow-hidden rounded-full bg-muted" aria-hidden>
                      {l.bar.map((s, i) => (
                        <span key={i} className={s.className} style={{ flex: s.flex }} />
                      ))}
                    </span>
                  )}
                  <span className={`min-w-[2.5rem] text-right font-semibold tabular-nums ${l.disabled ? "text-muted-foreground" : ""}`}>
                    {l.value}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {lines.length > limit && (
        <p className="text-xs text-muted-foreground">
          And {lines.length - limit} more. Search the list below to find one.
        </p>
      )}
      {footnote && <p className="text-xs text-muted-foreground">{footnote}</p>}
    </Card>
  );
}

/** A filter that is on, said in words, with the way to take it off. */
export function FilterChip({ children, onClear }: { children: ReactNode; onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      className="rounded-full border border-primary/40 px-3 py-1 text-xs text-primary hover:bg-primary/5"
    >
      {children}
    </button>
  );
}

/** Which column a list is ordered by, and which way. */
export type SortState<K extends string> = { key: K; dir: "asc" | "desc" };

/** A heading that orders the list; the arrow says which way. */
export function SortHead<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: {
  label: string;
  sortKey: K;
  sort: SortState<K>;
  onSort: (key: K) => void;
  className?: string;
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={className} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      >
        {label}
        <Icon className={`h-3.5 w-3.5 ${active ? "opacity-100" : "opacity-40"}`} aria-hidden />
      </button>
    </TableHead>
  );
}

/** The search over the list, with the filters that are on beside it. */
export function ListTools({
  search,
  onSearch,
  placeholder,
  children,
}: {
  search: string;
  onSearch: (v: string) => void;
  placeholder: string;
  /** The filter chips that are on. */
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-64">
        <Search className="absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={search} onChange={(e) => onSearch(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="pl-8" />
      </div>
      {children}
    </div>
  );
}

/** One of the card's smaller figures, opening its own list. */
export type Figure = { label: string; value: ReactNode; href?: string; tone?: Tone; title?: string };

/**
 * The rest of the card's figures, under the tiles: the ones that are not this
 * page's list, each opening the list it has elsewhere.
 */
/** Tailwind cannot see a computed class name, so the column counts are spelled out. */
const STRIP_COLS: Record<number, string> = {
  1: "",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-4",
  5: "sm:grid-cols-3 lg:grid-cols-5",
  6: "sm:grid-cols-3 lg:grid-cols-6",
};

export function FigureStrip({ figures }: { figures: Figure[] }) {
  return (
    <div className={`grid grid-cols-2 gap-3 border-t pt-4 ${STRIP_COLS[figures.length] ?? "sm:grid-cols-3 lg:grid-cols-6"}`}>
      {figures.map((f) => {
        const body = (
          <>
            <span className="text-xs text-muted-foreground">{f.label}</span>
            <span className={`text-lg font-semibold tabular-nums ${f.tone ? TONE_TEXT[f.tone] : ""}`}>{f.value}</span>
          </>
        );
        return f.href ? (
          <Link
            key={f.label}
            href={f.href}
            title={f.title}
            className="-m-1.5 flex flex-col gap-0.5 rounded-lg p-1.5 transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
          >
            {body}
          </Link>
        ) : (
          <div key={f.label} className="flex flex-col gap-0.5">
            {body}
          </div>
        );
      })}
    </div>
  );
}
