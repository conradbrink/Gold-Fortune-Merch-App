/**
 * Every row of a query, a page at a time.
 *
 * The API returns at most 1,000 rows per request, so a month of a busy team's
 * finished jobs would be cut short without a word. Pages are asked for in
 * order until one comes back short; the query must order by a unique key so
 * no row is skipped or repeated between pages.
 */
export const PAGE_SIZE = 1000;

/**
 * Whether a page of [rows] rows, asked for [size], was the last. Empty, or
 * shorter than the page before it, it was. A short *first* page is taken as the
 * whole list unless its length is a round hundred: a server answering fewer
 * rows than asked (the API's max rows set below [size]) cuts at a round
 * number, which a whole list rarely is — so only those cost a request more.
 */
export function isLastPage(rows: number, previous: number | null, size = PAGE_SIZE): boolean {
  if (rows === 0) return true;
  if (previous !== null) return rows < previous;
  return rows < size && rows % 100 !== 0;
}

/** One page of a query, as `allPages` asks for it. */
export type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** A query that can be narrowed past a key and ordered by it, as `allByKey` needs. */
export type KeyedQuery<T> = {
  gt(column: string, value: string): KeyedQuery<T>;
  order(column: string, options?: { ascending?: boolean }): { limit(count: number): Page<T> };
};

/**
 * Every row of a query, paged by a unique key (`id` unless told otherwise)
 * rather than by position.
 *
 * By position, a row added or removed while the pages are read shifts the rest:
 * one row comes back twice, or not at all. Past the last key it cannot. The
 * last page is found by `isLastPage`, or by a page that does not move past the
 * last key (a server ignoring the filter must not keep this going). The query
 * must select [key].
 *
 * Rows come back in key order; sort them for display (`byName`).
 */
export async function allByKey<T>(
  query: () => KeyedQuery<T>,
  key = "id",
  size = PAGE_SIZE
): Promise<T[]> {
  const out: T[] = [];
  let after: string | null = null;
  let previous: number | null = null;
  for (;;) {
    let q = query();
    if (after !== null) q = q.gt(key, after);
    const { data, error } = await q.order(key, { ascending: true }).limit(size);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (isLastPage(rows.length, previous, size)) return out;
    const value = (rows[rows.length - 1] as Record<string, unknown>)[key];
    if (value === undefined || value === null) {
      throw new Error(`The list could not be read past ${out.length} rows: it has no "${key}" to page by.`);
    }
    const last = String(value);
    if (last === after) return out;
    previous = rows.length;
    after = last;
  }
}

// One collator for every comparison: localeCompare with options sets one up
// each time, and a list of a thousand is ten thousand comparisons.
const names = new Intl.Collator("en", { sensitivity: "base" });

/** A–Z by name, ignoring case, then by id so equal names keep their order. */
export function byName<T extends { id: string; name: string }>(a: T, b: T): number {
  return names.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export async function allPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  size = PAGE_SIZE
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < size) return out;
  }
}
