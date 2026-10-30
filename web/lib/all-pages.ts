/**
 * Every row of a query, a page at a time.
 *
 * The API returns at most 1,000 rows per request, so a month of a busy team's
 * finished jobs would be cut short without a word. Pages are asked for in
 * order until one comes back short; the query must order by a unique key so
 * no row is skipped or repeated between pages.
 */
export const PAGE_SIZE = 1000;

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
 * one row comes back twice, or not at all. Past the last key it cannot. And the
 * last page is not taken to be the first one shorter than [size]: if the API's
 * max rows were ever set below it, every page would be short. A page is the
 * last when it is empty, shorter than the page before, or does not move past
 * the last key — so a short first page costs one more request to be sure.
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
    if (rows.length === 0) return out;
    const last = String((rows[rows.length - 1] as Record<string, unknown>)[key]);
    if ((previous !== null && rows.length < previous) || last === after) return out;
    previous = rows.length;
    after = last;
  }
}

/** A–Z by name, ignoring case, then by id so equal names keep their order. */
export function byName<T extends { id: string; name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
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
