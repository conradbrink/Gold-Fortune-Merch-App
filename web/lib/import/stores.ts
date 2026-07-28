import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveTown, type TownSource } from "@/lib/import/towns";
import type { VisitFrequency } from "@/lib/schedule";

/**
 * Turning an accounting export into an estate of stores.
 *
 * The source is a QuickBooks customer list, so it is shaped for invoicing
 * rather than for field work. Three transformations do most of the work:
 *
 * - **`Parent:Child`** becomes store group + store. Four parents cover 173 of
 *   215 rows, which is the chain structure a merchandising manager thinks in.
 * - **`T/A` ("trading as") carries the real name.** 101 Choppies rows share the
 *   legal entity "Choppies Distribution Centre (Pty) Ltd-1108"; what
 *   distinguishes them is what follows the T/A — "Choppies Value Store -
 *   Molapowabojang". Without this the estate is 101 stores with the same name.
 * - **The town is derived, not copied** — see `lib/import/towns.ts`.
 *
 * Nothing is written until the manager has seen the preview. Every judgement
 * this file makes is surfaced there with its reason, because a wrong store
 * name or town is not obvious once it is in the database and reps are being
 * routed by it.
 */

export type ColumnMap = {
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  country: string | null;
  /**
   * Optional. A business that already knows who covers each store can say so
   * in the sheet and skip assigning 200 stores by hand. Matched against rep
   * name or email; anything unmatched is flagged rather than guessed at.
   */
  rep: string | null;
};

export type StoreDraft = {
  /** 1-based row in the source sheet, so the preview can point at the file. */
  row: number;
  name: string;
  rawName: string;
  groupName: string | null;
  address: string | null;
  city: string | null;
  townSource: TownSource;
  /** The City column resolved to a different town — usually a postal address. */
  conflict: boolean;
  columnTown: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  /** Raw text from the sheet; resolved to a rep at write time. */
  repName: string | null;
  include: boolean;
  /** Why this row needs a human glance. Empty means it is clean. */
  issues: string[];
};

export type ImportResult = {
  storesCreated: number;
  groupsCreated: number;
  skipped: number;
  assignmentsCreated: number;
  /** Rep names in the sheet that matched nobody — reported, never invented. */
  unmatchedReps: string[];
};

const HEADER_HINTS: Record<keyof ColumnMap, string[]> = {
  name: ["name", "customer", "store", "shop", "outlet"],
  address: ["street address", "address", "street"],
  city: ["city", "town", "area", "village"],
  state: ["state", "province", "district"],
  zip: ["zip", "postal", "post code", "postcode"],
  phone: ["phone", "tel", "mobile", "contact"],
  country: ["country"],
  rep: ["rep", "merchandiser", "sales rep", "agent", "assigned to"],
};

/**
 * Best guess at which column is which.
 *
 * Only a starting point — the dialog lets every one of these be overridden,
 * because a header called "Name" is not always the store's name.
 */
export function detectColumns(headers: string[]): ColumnMap {
  const map: ColumnMap = {
    name: null, address: null, city: null,
    state: null, zip: null, phone: null, country: null, rep: null,
  };
  const taken = new Set<string>();

  for (const field of Object.keys(HEADER_HINTS) as (keyof ColumnMap)[]) {
    for (const hint of HEADER_HINTS[field]) {
      // Exact match first so "Street Address" beats "Address" for `address`
      // and does not get stolen by a looser hint.
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

/** Splits QuickBooks "Parent:Child" into chain and branch. */
export function splitGroup(rawName: string): { group: string | null; branch: string } {
  const i = rawName.indexOf(":");
  if (i === -1) return { group: null, branch: rawName.trim() };
  return {
    group: rawName.slice(0, i).trim() || null,
    branch: rawName.slice(i + 1).trim(),
  };
}

/** `T/A`, `T\A`, `t/a` — the real file uses at least three spellings. */
const TRADING_AS = /\bT\s*[/\\]\s*A\b/i;

/**
 * Gentle case repair for rows typed in caps lock.
 *
 * Words of three letters or fewer keep their case, so "CHOPPIES SUPERSTORE
 * BBS" becomes "Choppies Superstore BBS" rather than "Bbs". Applied only when
 * the whole string is uppercase — mixed-case names are left exactly alone.
 */
function fixCaps(text: string): string {
  if (text !== text.toUpperCase()) return text;
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/** The name a rep would recognise on a shelf, not the legal entity. */
export function cleanStoreName(rawName: string): string {
  const { branch } = splitGroup(rawName);
  const parts = branch.split(TRADING_AS);
  // Everything after "T/A" is the trading name; without it the branch stands.
  const trading = parts.length > 1 ? parts.slice(1).join(" ") : branch;
  return fixCaps(trading.replace(/\s+/g, " ").trim()) || rawName.trim();
}

/** Ledger accounts and chain headers that are not places a rep can visit. */
const NOT_A_STORE = /^(petty cash|instant sales delivery|opening balance|sundry)/i;

function value(row: Record<string, string>, column: string | null): string | null {
  if (!column) return null;
  const v = (row[column] ?? "").trim();
  return v === "" ? null : v;
}

/**
 * Builds one reviewable draft per source row.
 *
 * Rows are never silently dropped. Anything suspicious arrives with
 * `include: false` and a stated reason, so the decision is the manager's and
 * they can see what they are deciding about.
 */
export function buildDrafts(
  rows: Record<string, string>[],
  map: ColumnMap
): StoreDraft[] {
  // A bare parent row ("Choppies Group" with no colon) is a chain header that
  // QuickBooks emits alongside its children — not a store.
  const groupNames = new Set(
    rows
      .map((r) => splitGroup(value(r, map.name) ?? "").group)
      .filter((g): g is string => Boolean(g))
      .map((g) => g.toLowerCase())
  );

  return rows.map((row, i) => {
    const rawName = value(row, map.name) ?? "";
    const { group } = splitGroup(rawName);
    const name = cleanStoreName(rawName);
    const address = value(row, map.address);
    const cityColumn = value(row, map.city);
    const country = value(row, map.country);

    const town = deriveTown(rawName, address, cityColumn);
    const issues: string[] = [];
    let include = true;

    if (!rawName) {
      issues.push("No name");
      include = false;
    } else if (groupNames.has(rawName.trim().toLowerCase())) {
      issues.push("Chain header, not a store");
      include = false;
    } else if (NOT_A_STORE.test(rawName.trim())) {
      issues.push("Looks like a ledger account");
      include = false;
    }

    // Botswana estate — a South African row is almost certainly not a call.
    if (country && !/botswana/i.test(country)) {
      issues.push(`Country is ${country}`);
      include = false;
    }

    if (!town.town) {
      // Imported anyway, per the decision to keep them: a store with no town
      // is simply unschedulable until someone fills it in.
      issues.push("No town — will not be schedulable until set");
    }
    if (town.conflict) {
      issues.push(`City column says ${town.columnTown}`);
    }

    return {
      row: i + 1,
      name,
      rawName,
      groupName: group,
      address,
      city: town.town,
      townSource: town.source,
      conflict: town.conflict,
      columnTown: town.columnTown,
      state: value(row, map.state),
      zip: value(row, map.zip),
      phone: value(row, map.phone),
      repName: value(row, map.rep),
      include,
      issues,
    };
  });
}

/**
 * Writes the accepted drafts.
 *
 * Groups are get-or-create by name, matched case-insensitively against what is
 * already there — importing the same chain twice must not produce "Choppies
 * Group" alongside "CHOPPIES GROUP".
 *
 * `lat`/`lng` are deliberately left null. The source has no coordinates, and a
 * town centroid would be worse than nothing: every Gaborone store would share
 * one point, so real check-ins would compute as kilometres off site and the
 * geofence would reject people standing in the shop. A null distance already
 * renders as "Unknown" on the Activities page; a wrong one renders as fact.
 */
export async function importStores(
  supabase: SupabaseClient,
  orgId: string,
  drafts: StoreDraft[],
  /**
   * From org settings. Set explicitly rather than left to the column default,
   * which is `weekly` — importing 200 stores as weekly would silently create a
   * call cycle several times over capacity.
   */
  defaultFrequency: VisitFrequency,
  onProgress?: (done: number, total: number) => void
): Promise<ImportResult> {
  const accepted = drafts.filter((d) => d.include && d.name);
  const skipped = drafts.length - accepted.length;

  const { data: existingGroups, error: groupReadError } = await supabase
    .from("store_groups")
    .select("id, name");
  if (groupReadError) throw new Error(groupReadError.message);

  const groupIdByName: Record<string, string> = {};
  for (const g of (existingGroups ?? []) as { id: string; name: string }[]) {
    groupIdByName[g.name.trim().toLowerCase()] = g.id;
  }

  const wanted = [
    ...new Set(
      accepted
        .map((d) => d.groupName)
        .filter((g): g is string => Boolean(g))
        .filter((g) => !groupIdByName[g.trim().toLowerCase()])
    ),
  ];

  let groupsCreated = 0;
  if (wanted.length > 0) {
    const { data: created, error } = await supabase
      .from("store_groups")
      .insert(wanted.map((name) => ({ org_id: orgId, name })))
      .select("id, name");
    if (error) throw new Error(error.message);
    for (const g of (created ?? []) as { id: string; name: string }[]) {
      groupIdByName[g.name.trim().toLowerCase()] = g.id;
    }
    groupsCreated = created?.length ?? 0;
  }

  // Resolve rep names once, if the sheet has that column at all.
  const repIdByKey: Record<string, string> = {};
  if (accepted.some((d) => d.repName)) {
    const { data: repRows } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("role", "rep");
    for (const r of (repRows ?? []) as {
      id: string;
      full_name: string | null;
      email: string | null;
    }[]) {
      if (r.full_name) repIdByKey[r.full_name.trim().toLowerCase()] = r.id;
      if (r.email) repIdByKey[r.email.trim().toLowerCase()] = r.id;
    }
  }
  const unmatchedReps = new Set<string>();

  // Batched rather than one request per row: 200 sequential inserts from the
  // browser is a minute of waiting and 200 chances to fail half way.
  const BATCH = 50;
  let storesCreated = 0;
  let assignmentsCreated = 0;
  for (let i = 0; i < accepted.length; i += BATCH) {
    const slice = accepted.slice(i, i + BATCH);
    const batch = slice.map((d) => ({
      org_id: orgId,
      name: d.name,
      address: d.address,
      city: d.city,
      state: d.state,
      zip: d.zip,
      store_group_id: d.groupName
        ? groupIdByName[d.groupName.trim().toLowerCase()] ?? null
        : null,
      visit_frequency: defaultFrequency,
      active: true,
    }));
    const { data, error } = await supabase.from("stores").insert(batch).select("id");
    if (error) {
      throw new Error(
        `${error.message} — ${storesCreated} store${storesCreated === 1 ? "" : "s"} were already created before this failed.`
      );
    }
    storesCreated += data?.length ?? 0;

    // Assignments ride along with the batch, matched positionally: the insert
    // returns ids in the order they were sent.
    const created = (data ?? []) as { id: string }[];
    const links = slice
      .map((d, n) => ({ draft: d, storeId: created[n]?.id }))
      .filter((x) => x.draft.repName && x.storeId)
      .map((x) => {
        const repId = repIdByKey[x.draft.repName!.trim().toLowerCase()];
        if (!repId) {
          unmatchedReps.add(x.draft.repName!);
          return null;
        }
        return {
          org_id: orgId,
          store_id: x.storeId!,
          rep_id: repId,
          is_primary: false,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (links.length > 0) {
      const { data: made, error: linkError } = await supabase
        .from("store_assignments")
        .insert(links)
        .select("id");
      // A failed assignment must not lose the stores that already landed —
      // report it rather than throwing the whole import away.
      if (!linkError) assignmentsCreated += made?.length ?? 0;
    }

    onProgress?.(Math.min(i + BATCH, accepted.length), accepted.length);
  }

  return {
    storesCreated,
    groupsCreated,
    skipped,
    assignmentsCreated,
    unmatchedReps: [...unmatchedReps].sort(),
  };
}
