import type { SupabaseClient } from "@supabase/supabase-js";
import type { Tables } from "@/lib/supabase/types";

/**
 * Importing a price card into the product list.
 *
 * Modelled on `lib/import/stores.ts` — same `detectColumns` shape, same
 * never-throwing `buildDrafts` contract where every row yields a reviewable
 * draft and anything doubtful arrives with `include: false` and a stated
 * reason. It departs from that file in one fundamental way: **stores import is
 * insert-only, and this is not.**
 *
 * A price card is a document that gets reissued. The second import of the same
 * file must update the eighteen lines already there rather than create eighteen
 * more, which is what the three partial unique indexes in
 * `20260729104245_create_products_and_projects.sql` exist for.
 */

export type ProductRow = Tables<"products">;

export type ColumnMap = {
  name: string | null;
  brand: string | null;
  category: string | null;
  unit_barcode: string | null;
  shrink_barcode: string | null;
  units_per_shrink: string | null;
  shrink_price_excl_vat: string | null;
  shrink_price_incl_vat: string | null;
  sku_code: string | null;
};

/** What the import will do with a row, decided at preview time. */
export type DraftAction = "create" | "update" | "conflict" | "no_key";

export type FieldChange = {
  field: string;
  label: string;
  /** Null renders as an em dash — "was empty" reads differently from a change. */
  from: string | null;
  to: string;
};

export type ProductDraft = {
  /** 1-based source row, for talking to the manager about their spreadsheet. */
  row: number;
  action: DraftAction;
  include: boolean;
  issues: string[];

  name: string | null;
  brand: string | null;
  category: string | null;
  unit_barcode: string | null;
  shrink_barcode: string | null;
  units_per_shrink: number | null;
  shrink_price_excl_vat: number | null;
  shrink_price_incl_vat: number | null;
  sku_code: string | null;

  /** The existing product this row resolved to, when it resolved to one. */
  matchedId: string | null;
  matchedName: string | null;
  /** Which key matched, so a wrong match is catchable by eye. */
  matchedOn: string | null;
  /** Only the fields this row would actually change. Empty means no-op. */
  changes: FieldChange[];
};

export type ImportResult = {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
};

const HEADER_HINTS: Record<keyof ColumnMap, string[]> = {
  // "detail" first: it is the price card's own column heading, and exact-match
  // beats partial so a sheet with both "Detail" and "Description" picks right.
  name: ["detail", "description", "product", "name", "item"],
  brand: ["brand", "make", "supplier"],
  category: ["category", "type", "range", "segment"],
  // Deliberately specific. A bare column called "Barcode" is left unmapped —
  // see `hasAmbiguousBarcode` below.
  unit_barcode: ["unit barcode", "unit ean", "single barcode", "item barcode"],
  shrink_barcode: [
    "shrink barcode",
    "srink barcode",
    "outer barcode",
    "case barcode",
    "carton barcode",
  ],
  units_per_shrink: ["shrink size", "units per", "pack size", "case size", "units"],
  // Never hint on "rsp" or "retail": those are shelf prices, and these columns
  // are the trade price of a shrink. Mixing them would report a P1,818 vape.
  shrink_price_excl_vat: [
    "shrink (vat excl.)",
    "srink (vat excl.)",
    "vat excl",
    "excl vat",
    "excluding vat",
    "ex vat",
  ],
  shrink_price_incl_vat: [
    "shrink vat incl.)",
    "shrink vat incl",
    "vat incl",
    "incl vat",
    "including vat",
    "inc vat",
  ],
  sku_code: ["sku", "code", "item code", "product code", "stock code"],
};

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  brand: "Brand",
  category: "Category",
  unit_barcode: "Unit barcode",
  shrink_barcode: "Shrink barcode",
  units_per_shrink: "Units per shrink",
  shrink_price_excl_vat: "Price excl. VAT",
  shrink_price_incl_vat: "Price incl. VAT",
  sku_code: "SKU code",
};

export function detectColumns(headers: string[]): ColumnMap {
  const map: ColumnMap = {
    name: null, brand: null, category: null,
    unit_barcode: null, shrink_barcode: null, units_per_shrink: null,
    shrink_price_excl_vat: null, shrink_price_incl_vat: null, sku_code: null,
  };
  const taken = new Set<string>();

  for (const field of Object.keys(HEADER_HINTS) as (keyof ColumnMap)[]) {
    for (const hint of HEADER_HINTS[field]) {
      // Exact before partial, same reason as the stores importer: a specific
      // header must not be stolen by a looser hint for another field.
      const exact = headers.find(
        (h) => !taken.has(h) && h.trim().toLowerCase() === hint
      );
      const partial = headers.find(
        (h) => !taken.has(h) && h.trim().toLowerCase().includes(hint)
      );
      const hit = exact ?? partial;
      if (hit) {
        map[field] = hit;
        taken.add(hit);
        break;
      }
    }
  }
  return map;
}

/**
 * True when the sheet has a barcode column we refuse to guess at.
 *
 * Which barcode a column holds decides whether a rep's shelf scan ever matches
 * anything: the unit barcode is on the item a shopper picks up, the shrink
 * barcode is on the outer the store receives. No heuristic can tell them apart
 * from the word "Barcode", so the dialog asks rather than inventing.
 */
export function hasAmbiguousBarcode(headers: string[], map: ColumnMap): boolean {
  if (map.unit_barcode || map.shrink_barcode) return false;
  return headers.some((h) => h.trim().toLowerCase().includes("barcode"));
}

function value(row: Record<string, string>, column: string | null): string | null {
  if (!column) return null;
  const v = (row[column] ?? "").trim();
  return v === "" ? null : v;
}

/** First integer in the cell: "10 UNITS" is 10, and so is "10". */
function toUnits(raw: string | null): number | null {
  if (!raw) return null;
  const m = raw.match(/\d+/);
  return m ? Number(m[0]) : null;
}

/** Strips currency symbols and thousands separators; null when unparseable. */
function toMoney(raw: string | null): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d.,-]/g, "").replace(/,/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Digits only. A barcode with a space or a stray quote is still that barcode. */
function toBarcode(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits === "" ? null : digits;
}

/**
 * SheetJS hands back a General-formatted long number in exponential form even
 * under `raw: false`, and a 13-digit barcode is long enough to trip it. Silently
 * accepting `6.00123E+12` would store a barcode that can never match a scan.
 */
function looksRounded(raw: string | null): boolean {
  return raw !== null && /e\+?\d+/i.test(raw);
}

function money(n: number | null): string | null {
  return n === null ? null : n.toFixed(2);
}

/**
 * Builds one reviewable draft per row, resolving each against the products
 * already in the org.
 *
 * Matching happens here, at preview time, and the resolved id is carried
 * through to the write. `stores.ts` resolves reps later, at write time, which is
 * safe there because nothing existing is overwritten — here the preview makes a
 * promise about specific existing rows and the write has to keep it.
 */
export function buildDrafts(
  rows: Record<string, string>[],
  map: ColumnMap,
  existing: ProductRow[]
): ProductDraft[] {
  const bySku: Record<string, ProductRow> = {};
  const byUnit: Record<string, ProductRow> = {};
  const byShrink: Record<string, ProductRow> = {};
  for (const p of existing) {
    if (p.sku_code) bySku[p.sku_code.trim().toLowerCase()] = p;
    if (p.unit_barcode) byUnit[p.unit_barcode.trim()] = p;
    if (p.shrink_barcode) byShrink[p.shrink_barcode.trim()] = p;
  }

  // Two rows in one sheet claiming the same barcode bites twice: as two updates
  // where the second silently wins, or as two creates where the second violates
  // a unique index and takes its whole batch down. `stores.ts` has no analogue.
  const seenUnit: Record<string, number> = {};
  const seenShrink: Record<string, number> = {};
  const seenSku: Record<string, number> = {};

  return rows.map((row, i) => {
    const rowNo = i + 2; // +1 for zero-index, +1 for the header row.
    const issues: string[] = [];

    const rawUnit = value(row, map.unit_barcode);
    const rawShrink = value(row, map.shrink_barcode);
    const name = value(row, map.name);
    const unit_barcode = toBarcode(rawUnit);
    const shrink_barcode = toBarcode(rawShrink);
    const sku_code = value(row, map.sku_code);
    const rawExcl = value(row, map.shrink_price_excl_vat);
    const rawIncl = value(row, map.shrink_price_incl_vat);

    const draft: ProductDraft = {
      row: rowNo,
      action: "create",
      include: true,
      issues,
      name,
      brand: value(row, map.brand),
      category: value(row, map.category),
      unit_barcode,
      shrink_barcode,
      units_per_shrink: toUnits(value(row, map.units_per_shrink)),
      shrink_price_excl_vat: toMoney(rawExcl),
      shrink_price_incl_vat: toMoney(rawIncl),
      sku_code,
      matchedId: null,
      matchedName: null,
      matchedOn: null,
      changes: [],
    };

    if (!name) {
      issues.push("No product name in this row.");
      draft.include = false;
    }
    for (const [raw, label] of [
      [rawUnit, "Unit barcode"],
      [rawShrink, "Shrink barcode"],
    ] as const) {
      if (looksRounded(raw)) {
        issues.push(
          `${label} looks like a rounded number — format that column as Text and re-export.`
        );
        draft.include = false;
      }
    }
    if (rawExcl && draft.shrink_price_excl_vat === null) {
      issues.push(`Could not read "${rawExcl}" as a price.`);
    }
    if (rawIncl && draft.shrink_price_incl_vat === null) {
      issues.push(`Could not read "${rawIncl}" as a price.`);
    }

    // In-sheet duplicates, reported against the earlier row so the manager can
    // find both.
    const dupes: [string | null, Record<string, number>, string][] = [
      [unit_barcode, seenUnit, "unit barcode"],
      [shrink_barcode, seenShrink, "shrink barcode"],
      [sku_code?.toLowerCase() ?? null, seenSku, "SKU code"],
    ];
    let duplicated = false;
    for (const [key, seen, label] of dupes) {
      if (!key) continue;
      if (seen[key] !== undefined) {
        issues.push(`Row ${seen[key]} in this sheet has the same ${label}.`);
        duplicated = true;
      } else {
        seen[key] = rowNo;
      }
    }
    if (duplicated) {
      draft.action = "conflict";
      draft.include = false;
      return draft;
    }

    // Match on the three enforced keys, never on name: products_org_name_idx is
    // deliberately not unique, and the premise of this table is that free text
    // cannot identify a line.
    const hits: { product: ProductRow; on: string }[] = [];
    if (sku_code && bySku[sku_code.trim().toLowerCase()]) {
      hits.push({ product: bySku[sku_code.trim().toLowerCase()], on: `SKU ${sku_code}` });
    }
    if (unit_barcode && byUnit[unit_barcode]) {
      hits.push({ product: byUnit[unit_barcode], on: `unit barcode ${unit_barcode}` });
    }
    if (shrink_barcode && byShrink[shrink_barcode]) {
      hits.push({ product: byShrink[shrink_barcode], on: `shrink barcode ${shrink_barcode}` });
    }

    const distinct = Array.from(new Set(hits.map((h) => h.product.id)));

    if (distinct.length > 1) {
      // No priority tie-break on purpose. Picking a winner would write the
      // sheet's other barcode onto it — either violating a unique index and
      // killing the batch, or succeeding and leaving two rows claiming the same
      // physical item. Only a person knows which side has the typo.
      const names = hits.map((h) => `"${h.product.name}" (${h.on})`).join(" and ");
      issues.push(`This row matches two different products: ${names}.`);
      draft.action = "conflict";
      draft.include = false;
      return draft;
    }

    if (distinct.length === 0) {
      if (!sku_code && !unit_barcode && !shrink_barcode) {
        // Nothing to match on now or ever, so every future import of this file
        // would create it again. All three unique indexes are partial, so the
        // database will not stop that.
        issues.push(
          "No barcode or SKU — re-importing this file would create a second copy."
        );
        draft.action = "no_key";
        draft.include = false;
      }
      return draft;
    }

    const match = hits[0];
    draft.action = "update";
    draft.matchedId = match.product.id;
    draft.matchedName = match.product.name;
    draft.matchedOn = match.on;
    draft.changes = diffAgainst(draft, match.product);

    if (
      draft.name &&
      draft.name.trim().toLowerCase() !== match.product.name.trim().toLowerCase()
    ) {
      // The loudest available signal that the match is wrong. Amber in the
      // list, not buried among the other changed fields.
      issues.push(`Sheet calls this "${draft.name}" but the matched product is "${match.product.name}".`);
    }
    return draft;
  });
}

/**
 * Fields this row would actually change.
 *
 * Only mapped, non-empty values count. A sheet that omits the brand column must
 * not null out every brand — which is what sending a whole row at an upsert
 * would do — so the write starts from the existing record and overlays.
 */
function diffAgainst(draft: ProductDraft, existing: ProductRow): FieldChange[] {
  const pairs: [string, string | null, string | null][] = [
    ["name", draft.name, existing.name],
    ["brand", draft.brand, existing.brand],
    ["category", draft.category, existing.category],
    ["unit_barcode", draft.unit_barcode, existing.unit_barcode],
    ["shrink_barcode", draft.shrink_barcode, existing.shrink_barcode],
    [
      "units_per_shrink",
      draft.units_per_shrink === null ? null : String(draft.units_per_shrink),
      existing.units_per_shrink === null ? null : String(existing.units_per_shrink),
    ],
    [
      "shrink_price_excl_vat",
      money(draft.shrink_price_excl_vat),
      existing.shrink_price_excl_vat === null
        ? null
        : Number(existing.shrink_price_excl_vat).toFixed(2),
    ],
    [
      "shrink_price_incl_vat",
      money(draft.shrink_price_incl_vat),
      existing.shrink_price_incl_vat === null
        ? null
        : Number(existing.shrink_price_incl_vat).toFixed(2),
    ],
    ["sku_code", draft.sku_code, existing.sku_code],
  ];

  const changes: FieldChange[] = [];
  for (const [field, next, current] of pairs) {
    if (next === null) continue; // blank cell: leave what is there.
    if (next === current) continue;
    changes.push({ field, label: FIELD_LABELS[field], from: current, to: next });
  }
  return changes;
}

/** Drafts that would change something. A no-op update is not worth a write. */
export function actionable(drafts: ProductDraft[]): ProductDraft[] {
  return drafts.filter(
    (d) => d.include && (d.action === "create" || d.changes.length > 0)
  );
}

const BATCH = 50;

/**
 * Writes the drafts.
 *
 * Sequential in batches, like `importStores`, and for the same reason: a
 * handful of concurrent writes silently failed during auto-spread, and a price
 * card is imported rarely enough that certainty beats throughput.
 *
 * Upserts on the **primary key**, not on a barcode. PostgREST cannot express
 * the predicate of a partial unique index, so `onConflict: "unit_barcode"`
 * would fail with "no unique or exclusion constraint matching the ON CONFLICT
 * specification". Matching already resolved an id, so the primary key is both
 * available and exact.
 *
 * `active` is never written. A line somebody deactivated by hand must not come
 * back to life because it is still printed on the price card.
 */
export async function importProducts(
  supabase: SupabaseClient,
  orgId: string,
  drafts: ProductDraft[],
  existing: ProductRow[],
  onProgress?: (done: number, total: number) => void
): Promise<ImportResult> {
  const byId: Record<string, ProductRow> = {};
  for (const p of existing) byId[p.id] = p;

  const todo = actionable(drafts);
  const result: ImportResult = {
    created: 0,
    updated: 0,
    unchanged: drafts.filter((d) => d.include && d.action === "update" && d.changes.length === 0).length,
    skipped: drafts.filter((d) => !d.include).length,
  };

  const rows = todo.map((d) => {
    if (d.action === "update" && d.matchedId) {
      const current = byId[d.matchedId];
      // Overlay onto the existing record so unmapped columns survive.
      return {
        ...current,
        ...Object.fromEntries(d.changes.map((c) => [c.field, coerce(c.field, c.to)])),
      };
    }
    return {
      org_id: orgId,
      name: d.name,
      brand: d.brand,
      category: d.category,
      unit_barcode: d.unit_barcode,
      shrink_barcode: d.shrink_barcode,
      units_per_shrink: d.units_per_shrink,
      shrink_price_excl_vat: d.shrink_price_excl_vat,
      shrink_price_incl_vat: d.shrink_price_incl_vat,
      sku_code: d.sku_code,
    };
  });

  let done = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from("products")
      .upsert(batch)
      .select("id");
    if (error) {
      throw new Error(
        `${error.message} — ${result.created + result.updated} of ${rows.length} rows were already written before this failed.`
      );
    }
    for (const d of todo.slice(i, i + BATCH)) {
      if (d.action === "update") result.updated += 1;
      else result.created += 1;
    }
    done = Math.min(i + BATCH, rows.length);
    onProgress?.(done, rows.length);
    void data;
  }

  return result;
}

/** Diffs carry display strings; the write needs the column's real type back. */
function coerce(field: string, text: string): string | number | null {
  if (field === "units_per_shrink") return Number(text);
  if (field === "shrink_price_excl_vat" || field === "shrink_price_incl_vat") {
    return Number(text);
  }
  return text;
}
