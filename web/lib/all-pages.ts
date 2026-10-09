/**
 * Every row of a query, a page at a time.
 *
 * The API returns at most 1,000 rows per request, so a month of a busy team's
 * finished jobs would be cut short without a word. Pages are asked for in
 * order until one comes back short; the query must order by a unique key so
 * no row is skipped or repeated between pages.
 */
export const PAGE_SIZE = 1000;

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
