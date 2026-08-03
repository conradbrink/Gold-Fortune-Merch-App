/**
 * A PostgREST `date` rendered in the reader's own timezone.
 *
 * `new Date("2026-08-14")` is parsed by ECMAScript as **UTC midnight**, so
 * `toLocaleDateString()` renders 13 August anywhere behind UTC. An expiry date
 * shown a day early is the kind of wrong that looks right: nobody questions it,
 * and FEFO decisions get made on it.
 *
 * Appending a time forces local-time parsing instead. Date-only columns —
 * `expiry_date`, `required_by`, `expected_delivery_on` — carry no timezone and
 * mean the same calendar day to everyone, which is exactly what this preserves.
 */
export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return "—";
  // Guard against a full timestamp arriving here: those already carry a zone
  // and must not have one bolted on.
  const local = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}
