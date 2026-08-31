"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Map,
  List,
  Upload,
  Plus,
  Store,
  MoreHorizontal,
  ExternalLink,
  Pencil,
  Trash2,
  Archive,
  AlertTriangle,
  Check,
  Building2,
  MapPin,
  CalendarClock,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ImportStoresButton } from "@/components/stores/import-dialog";
import { toLocalDate } from "@/lib/date-range";
import { ExportMenu } from "@/components/export-menu";
import type { ExportSheet } from "@/lib/export";
import {
  findSharedPoints,
  geocodeState,
  type GeocodeState,
  type SharedPointStore,
} from "@/lib/geocode";
import {
  GEOCODE_STATE_ORDER,
  GEOCODE_STATE_STYLES,
  GeocodePill,
} from "@/components/stores/geocode-pill";
import {
  StoreLocationDialog,
  type GeocodeCapture,
} from "@/components/stores/store-location-dialog";
// `components/dashboard/filter-bar.tsx` is deliberately NOT used here: its
// "Add filter", "Clear" and "Apply" buttons have no onClick at all. It read as
// decorative chrome next to the real filter row below, and with 200+ stores a
// manager reasonably expects it to do something.
import { PlacesMap } from "@/components/dashboard/places-map";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";
import {
  assignStore,
  fetchAssignments,
  fetchOrgId,
  unassignStore,
  type Assignment,
} from "@/lib/representatives";
import { callRpc } from "@/lib/rpc";
import {
  FREQUENCIES,
  setStoreFrequency,
  type VisitFrequency,
} from "@/lib/schedule";
import { googleMapsUrl } from "@/lib/maps";
import type { Tables } from "@/lib/supabase/types";

type StoreRow = Tables<"stores">;
type StoreGroup = Tables<"store_groups">;

const emptyForm = {
  name: "",
  store_group_id: "",
  visit_frequency: "weekly",
  address: "",
  city: "",
  state: "",
  zip: "",
};

/** What a hard delete would cascade away — from `store_delete_impact`. */
type StoreDeleteImpact = {
  store_name: string | null;
  visits: number;
  submissions: number;
  photos: number;
  routes: number;
  assignments: number;
  reps: number;
};

/** Relative for recent visits, absolute once "12 weeks ago" stops being useful. */
function formatLastVisit(iso: string | null | undefined): string {
  if (!iso) return "Never visited";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** The call cycle as a manager reads it — "Weekly", "Every 2 weeks". */
function cycleLabel(frequency: string): string {
  return FREQUENCIES.find((f) => f.value === frequency)?.label ?? frequency;
}

/** Frequencies shortest-cycle first, so ordering by this column reads as
    "how much attention does this store get" rather than as alphabetical
    accident — "biweekly" before "monthly" before "weekly" is meaningless. */
const FREQUENCY_ORDER: string[] = FREQUENCIES.map((f) => f.value);

type SortKey =
  | "name"
  | "town"
  | "location"
  | "group"
  | "cycle"
  | "lastVisit"
  | "status"
  | "responsible";

type SortState = { key: SortKey; dir: "asc" | "desc" };

/** One source of truth for the column names: the header renders these, and the
    export repeats the active one so a sorted file says how it was sorted. */
const SORT_LABELS: Record<SortKey, string> = {
  name: "Store",
  // "Town", not "City", to match the filter above the table and the export
  // column, both of which have always called it that.
  town: "Town",
  location: "Location",
  group: "Group",
  cycle: "Call cycle",
  lastVisit: "Last visited",
  status: "Status",
  responsible: "Responsible",
};

/**
 * A column header that orders the list.
 *
 * Every column here is sortable, including the ones a breakpoint has hidden —
 * a header that cannot be clicked because the window is narrow is worse than
 * one that is simply absent, and the hidden columns are mirrored under the
 * store name anyway.
 */
function SortHeader({
  sortKey,
  sort,
  onSort,
  className,
}: {
  sortKey: SortKey;
  sort: SortState;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead
      className={className}
      aria-sort={
        active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 font-medium hover:bg-muted"
      >
        {SORT_LABELS[sortKey]}
        <Icon
          className={`h-3.5 w-3.5 ${active ? "opacity-100" : "opacity-40"}`}
          aria-hidden
        />
      </button>
    </TableHead>
  );
}

export default function StoresPage() {
  const supabase = createClient();
  const [view, setView] = useState<"list" | "map">("list");
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [groups, setGroups] = useState<StoreGroup[]>([]);
  /**
   * The raw assignment rows, not a derived summary.
   *
   * Keeping the ids means a rep can be unassigned from this page, and it lets
   * assignment edits be applied to local state instead of triggering a reload —
   * a full refetch swapped the table for a spinner and threw away the scroll
   * position, which is unusable at 217 stores.
   */
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  // With 200+ stores across 45 towns, "which town" is the filter a manager
  // actually reaches for — more than group, and far more than free text.
  const [cityFilter, setCityFilter] = useState("all");
  const [lastVisits, setLastVisits] = useState<Record<string, string>>({});
  /** Reps available to assign inline from this page. */
  const [reps, setReps] = useState<{ id: string; name: string }[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [busyStore, setBusyStore] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  /** Non-null once a delete has been requested — holds what it would destroy. */
  const [deleteTarget, setDeleteTarget] = useState<StoreRow | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<StoreDeleteImpact | null>(null);
  const [deleting, setDeleting] = useState(false);
  /** The rep and visit behind each field-captured location, keyed by store. */
  const [captures, setCaptures] = useState<Record<string, GeocodeCapture>>({});
  /** Filter on where a location came from — "shared" cuts across the sources. */
  const [provFilter, setProvFilter] = useState<GeocodeState | "all" | "shared">(
    "all"
  );
  /** Non-null while the location-provenance dialog is open. */
  const [locationTarget, setLocationTarget] = useState<StoreRow | null>(null);
  /** Which column the table is ordered by. Name ascending, matching the order
      the rows are fetched in, so the page opens looking as it always has. */
  const [sort, setSort] = useState<SortState>({ key: "name", dir: "asc" });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [newGroupName, setNewGroupName] = useState("");
  const [saving, setSaving] = useState(false);

  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  const [groupBusy, setGroupBusy] = useState<string | null>(null);
  /** Second click confirms — deleting un-groups every store in it. */
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState<string | null>(
    null
  );
  const [groupForm, setGroupForm] = useState("");

  async function loadData() {
    setLoading(true);

    // Four independent reads, so they go together rather than in a queue.
    // Sequentially these were four round trips before the table could paint,
    // and on a Botswana connection that is the difference between the page
    // feeling instant and feeling broken. None of them depends on another —
    // only the capture lookup below does, because it needs to know whether any
    // store has a capture at all.
    const [groupRes, storeRes, assignmentRows, visitRes, repRes] =
      await Promise.all([
        supabase.from("store_groups").select("*").order("name"),
        supabase.from("stores").select("*").order("name"),
        // Reuses the representatives fetcher: store_assignments is missing from
        // the generated types, so querying it off the typed client won't compile.
        fetchAssignments(supabase),
        // Aggregated in Postgres. `visits` is the fastest-growing table here, so
        // the list must not download it to compute a maximum per row.
        callRpc(supabase, "store_last_visit", {}),
        // Names for the "Responsible" column.
        supabase.from("profiles").select("id, full_name").eq("role", "rep"),
      ]);

    const groupRows = groupRes.data;
    const storeRows = storeRes.data;
    const repRows = repRes.data;

    setGroups(groupRows ?? []);
    setStores(storeRows ?? []);
    setAssignments(assignmentRows);

    const seen: Record<string, string> = {};
    if (!visitRes.error) {
      for (const r of (visitRes.data ?? []) as {
        store_id: string;
        last_visit_at: string | null;
      }[]) {
        if (r.last_visit_at) seen[r.store_id] = r.last_visit_at;
      }
    }
    setLastVisits(seen);

    // Who captured a location in the field, resolved through the visit it was
    // taken during. Skipped entirely when no store has one — which is every
    // store until reps start doing it — rather than asking Postgres for an
    // empty set on every page load.
    const byStore: Record<string, GeocodeCapture> = {};
    if ((storeRows ?? []).some((s) => s.geocode_visit_id !== null)) {
      const { data: captureRows } = await supabase.rpc("store_geocode_capture");
      for (const r of captureRows ?? []) {
        byStore[r.store_id] = {
          visitId: r.visit_id,
          // The RPC left-joins profiles and the generated types cannot express
          // that, so these two are narrowed here rather than trusted.
          repName: (r.rep_name as string | null) ?? null,
          checkinAt: (r.visit_checkin_at as string | null) ?? null,
        };
      }
    }
    setCaptures(byStore);

    // Plain objects, not Map: this file imports lucide's `Map` icon, which
    // shadows the global constructor.
    const nameById: Record<string, string> = {};
    for (const r of (repRows ?? []) as { id: string; full_name: string | null }[]) {
      nameById[r.id] = r.full_name ?? "Unnamed rep";
    }
    setReps(
      Object.entries(nameById)
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name))
    );
    setLoading(false);
  }

  useEffect(() => {
    loadData();
    fetchOrgId(supabase).then(setOrgId).catch(() => setOrgId(null));
    // Seeded from `?q=` so the header search lands here already filtered.
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) setSearch(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Runs a per-row mutation without reloading the page.
   *
   * The optimistic state goes in first so the row updates instantly, and is
   * rolled back if the write fails. Nothing calls `loadData()` here — that
   * would raise the loading flag, replace the table with a spinner and drop
   * the manager back at the top of a 217-row list.
   */
  async function runOnRow(
    storeId: string,
    optimistic: () => void,
    rollback: () => void,
    write: () => Promise<void>
  ) {
    setBusyStore(storeId);
    setRowError(null);
    optimistic();
    try {
      await write();
    } catch (e) {
      rollback();
      setRowError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyStore(null);
    }
  }

  /** Assign a rep in place — a trip to /representatives per store is untenable
      across 217 of them. */
  function assignRep(store: StoreRow, repId: string) {
    if (!orgId) {
      setRowError("Could not determine your organisation.");
      return;
    }
    const before = assignments;
    // A temporary id until the insert returns; only used as a React key and
    // for rollback, never sent anywhere.
    const optimisticRow: Assignment = {
      id: `pending-${store.id}-${repId}`,
      store_id: store.id,
      rep_id: repId,
      is_primary: false,
    };
    runOnRow(
      store.id,
      () => setAssignments((prev) => [...prev, optimisticRow]),
      () => setAssignments(before),
      async () => {
        await assignStore(supabase, orgId, store.id, repId);
        // Re-read just the assignments so the placeholder id becomes the real
        // one — one small query, and the table never unmounts.
        setAssignments(await fetchAssignments(supabase));
      }
    );
  }

  function unassignRep(store: StoreRow, assignmentId: string) {
    const before = assignments;
    runOnRow(
      store.id,
      () => setAssignments((prev) => prev.filter((a) => a.id !== assignmentId)),
      () => setAssignments(before),
      () => unassignStore(supabase, assignmentId)
    );
  }

  /** Moves a store between groups, or out of one entirely with `null`. */
  function setStoreGroup(store: StoreRow, groupId: string | null) {
    if (store.store_group_id === groupId) return;
    const before = stores;
    runOnRow(
      store.id,
      () =>
        setStores((prev) =>
          prev.map((s) =>
            s.id === store.id ? { ...s, store_group_id: groupId } : s
          )
        ),
      () => setStores(before),
      async () => {
        const { error } = await supabase
          .from("stores")
          .update({ store_group_id: groupId })
          .eq("id", store.id);
        if (error) throw new Error(error.message);
      }
    );
  }

  /**
   * Changes how often a store is visited.
   *
   * Frequency is a property of the *store*, so this changes the cycle for every
   * rep who covers it — the same write `setStoreFrequency` makes from the
   * planner, offered from the one page that has the whole estate in front of
   * you. The planner works a rep at a time, which means a store nobody covers
   * yet has nowhere to be given a cycle at all.
   *
   * The **weekday** stays in the planner. It lives on the assignment because it
   * only means something inside one rep's week, and this page has no rep to set
   * it against.
   *
   * The **week of the cycle** used to be the same argument, and is not any
   * more. Since #44 `setStoreFrequency` reconciles it store-wide — clamping a
   * monthly store's 3rd or 4th week down to 1 on the way to bi-weekly, and
   * nulling it on the way to weekly — because the legal range for that column
   * depends on `visit_frequency` on a different table, so every caller that
   * moves a store down a frequency has to bring the week with it. Once
   * `20260831120000` is applied, `stores_reconcile_week_of_cycle` does the same
   * thing again in the database; the two agree, and both clamp rather than
   * reject.
   *
   * Raising a store *above* weekly from here still cannot strand it: a null
   * week stays null, and `generate_routes` coalesces null to 1.
   */
  function setStoreCycle(store: StoreRow, frequency: VisitFrequency) {
    if (store.visit_frequency === frequency) return;
    // The previous *value*, not a snapshot of the whole list.
    //
    // `busyStore` holds one id, so only the row being written is disabled and a
    // second row can be edited while this write is still in flight — and that
    // row's `finally` clears the flag for both. Restoring a whole-array
    // snapshot on failure would then take the other row's SUCCESSFUL change
    // with it, and the table order and the export would stay wrong until a
    // reload. Rolling back one field of one store cannot do that.
    const previous = store.visit_frequency;
    runOnRow(
      store.id,
      () =>
        setStores((prev) =>
          prev.map((s) =>
            s.id === store.id ? { ...s, visit_frequency: frequency } : s
          )
        ),
      () =>
        setStores((prev) =>
          prev.map((s) =>
            s.id === store.id ? { ...s, visit_frequency: previous } : s
          )
        ),
      () => setStoreFrequency(supabase, store.id, frequency)
    );
  }

  /** Fetches the cost before the confirm step — never deletes on its own. */
  async function requestDelete(store: StoreRow) {
    setDeleteTarget(store);
    setDeleteImpact(null);
    setRowError(null);
    const res = await callRpc(supabase, "store_delete_impact", {
      p_store_id: store.id,
    });
    if (res.error) {
      setRowError(res.error.message);
      setDeleteTarget(null);
      return;
    }
    setDeleteImpact(((res.data ?? []) as StoreDeleteImpact[])[0] ?? null);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setRowError(null);
    try {
      const { error } = await supabase
        .from("stores")
        .delete()
        .eq("id", deleteTarget.id);
      if (error) throw new Error(error.message);
      setDeleteTarget(null);
      setDeleteImpact(null);
      await loadData();
    } catch (e) {
      setRowError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  async function currentOrgId() {
    const { data: userData } = await supabase.auth.getUser();
    const { data: profileRow } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", userData.user!.id)
      .single();
    return profileRow!.org_id;
  }

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setNewGroupName("");
    setDialogOpen(true);
  }

  function openEdit(store: StoreRow) {
    setEditingId(store.id);
    setForm({
      name: store.name ?? "",
      store_group_id: store.store_group_id ?? "",
      visit_frequency: store.visit_frequency ?? "weekly",
      address: store.address ?? "",
      city: store.city ?? "",
      state: store.state ?? "",
      zip: store.zip ?? "",
    });
    setNewGroupName("");
    setDialogOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    const orgId = await currentOrgId();

    // Allow creating a brand-new group inline from the store dialog.
    let groupId: string | null = form.store_group_id || null;
    if (form.store_group_id === "__new__") {
      groupId = null;
      if (newGroupName.trim()) {
        const { data: created } = await supabase
          .from("store_groups")
          .insert({ org_id: orgId, name: newGroupName.trim() })
          .select("id")
          .single();
        groupId = created?.id ?? null;
      }
    }

    const payload = {
      name: form.name,
      store_group_id: groupId,
      visit_frequency: form.visit_frequency,
      address: form.address,
      city: form.city,
      state: form.state,
      zip: form.zip,
    };

    if (editingId) {
      await supabase.from("stores").update(payload).eq("id", editingId);
    } else {
      await supabase.from("stores").insert({ ...payload, org_id: orgId });
    }

    setSaving(false);
    setDialogOpen(false);
    setEditingId(null);
    setForm(emptyForm);
    setNewGroupName("");
    loadData();
  }

  async function handleCreateGroup() {
    if (!groupForm.trim()) return;
    setSaving(true);
    const orgId = await currentOrgId();
    await supabase
      .from("store_groups")
      .insert({ org_id: orgId, name: groupForm.trim() });
    setSaving(false);
    setGroupForm("");
    loadData();
  }

  async function renameGroup(id: string, name: string) {
    if (!name.trim()) return;
    setGroupBusy(id);
    setRowError(null);
    try {
      const { data, error } = await supabase
        .from("store_groups")
        .update({ name: name.trim() })
        .eq("id", id)
        .select("id");
      if (error) throw new Error(error.message);
      if ((data?.length ?? 0) === 0) {
        throw new Error("That group could not be renamed — reload and retry.");
      }
      setEditingGroupId(null);
      await loadData();
    } catch (e) {
      setRowError(e instanceof Error ? e.message : String(e));
    } finally {
      setGroupBusy(null);
    }
  }

  /**
   * Deleting a group does not delete its stores.
   *
   * `stores.store_group_id` is `on delete set null`, so they survive and become
   * ungrouped — which is why this is safe to offer inline, and why the count of
   * what is about to be un-grouped is shown before the second click. Losing a
   * chain grouping quietly would be hard to notice and tedious to rebuild.
   */
  async function deleteGroup(id: string) {
    setGroupBusy(id);
    setRowError(null);
    try {
      const { error } = await supabase
        .from("store_groups")
        .delete()
        .eq("id", id);
      if (error) throw new Error(error.message);
      setConfirmDeleteGroup(null);
      await loadData();
    } catch (e) {
      setRowError(e instanceof Error ? e.message : String(e));
    } finally {
      setGroupBusy(null);
    }
  }

  async function toggleActive(store: StoreRow) {
    await supabase
      .from("stores")
      .update({ active: !store.active })
      .eq("id", store.id);
    loadData();
  }

  const groupName = (id: string | null) =>
    groups.find((g) => g.id === id)?.name ?? "Ungrouped";

  /** Assignments for one store, with rep names attached, for the row menu. */
  const assignedByStore = useMemo(() => {
    const nameById: Record<string, string> = {};
    for (const r of reps) nameById[r.id] = r.name;
    // Plain object, not Map: this file imports lucide's `Map` icon, which
    // shadows the global constructor.
    const byStore: Record<string, { id: string; repId: string; name: string }[]> = {};
    for (const a of assignments) {
      (byStore[a.store_id] ??= []).push({
        id: a.id,
        repId: a.rep_id,
        name: nameById[a.rep_id] ?? "Unknown rep",
      });
    }
    for (const list of Object.values(byStore)) {
      list.sort((x, y) => x.name.localeCompare(y.name));
    }
    return byStore;
  }, [assignments, reps]);

  /** Towns present in the estate, for the filter. 45 of them after the import. */
  const cities = useMemo(() => {
    const seen: Record<string, true> = {};
    for (const s of stores) if (s.city) seen[s.city] = true;
    return Object.keys(seen).sort((a, b) => a.localeCompare(b));
  }, [stores]);

  const missingCity = stores.filter((s) => !s.city).length;

  /** Active stores whose position is still a guess — nobody has stood in them.
      Not a to-do list: reps settle these by visiting, and this is here so a
      manager can see the estate correcting itself over the first call cycle. */
  const unverified = useMemo(
    () =>
      stores.filter(
        (s) =>
          s.active &&
          s.location_confirmed_at === null &&
          s.geocode_source !== "rep"
      ).length,
    [stores]
  );

  /** Several stores on one coordinate — see `findSharedPoints` for why that
      is a quieter and more misleading failure than having none. */
  const sharedPoints = useMemo(
    () => findSharedPoints(stores.filter((s) => s.active)),
    [stores]
  );

  /** One derivation of location trust, shared by the pill, the filter and the
      dialog, so the three can never disagree about a store. Plain objects, not
      Map — lucide's `Map` icon shadows the constructor in this file. */
  const stateById = useMemo(() => {
    const byId: Record<string, GeocodeState> = {};
    for (const s of stores) byId[s.id] = geocodeState(s);
    return byId;
  }, [stores]);

  const stateCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of stores) {
      const k = stateById[s.id];
      counts[k] = (counts[k] ?? 0) + 1;
    }
    return counts;
  }, [stores, stateById]);

  /** Store ids sitting on a coordinate another store also claims. */
  const sharedIds = useMemo(() => {
    const ids: Record<string, true> = {};
    for (const p of sharedPoints) for (const s of p.stores) ids[s.id] = true;
    return ids;
  }, [sharedPoints]);

  /** The other stores on this store's point, and whether they all matched the
      same listing — which is what separates a collapse from a coincidence. */
  function sharedWith(store: StoreRow): {
    others: SharedPointStore[];
    sameResult: boolean;
  } {
    const point = sharedPoints.find((p) =>
      p.stores.some((s) => s.id === store.id)
    );
    if (!point) return { others: [], sameResult: false };
    return {
      others: point.stores.filter((s) => s.id !== store.id),
      sameResult: point.sameResult,
    };
  }

  const filtered = stores
    .filter((s) =>
      groupFilter === "all" ? true : (s.store_group_id ?? "none") === groupFilter
    )
    .filter((s) =>
      provFilter === "all"
        ? true
        : provFilter === "shared"
          ? sharedIds[s.id] === true
          : stateById[s.id] === provFilter
    )
    .filter((s) =>
      cityFilter === "all"
        ? true
        : cityFilter === "none"
          ? !s.city
          : s.city === cityFilter
    )
    .filter((s) =>
      `${s.name} ${s.address ?? ""} ${s.city ?? ""} ${groupName(s.store_group_id)}`
        .toLowerCase()
        .includes(search.toLowerCase())
    );

  function toggleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : // A fresh column starts ascending. Carrying the previous column's
          // direction over made the first click on a header look like it had
          // sorted the wrong way round.
          { key, dir: "asc" }
    );
  }

  /**
   * The rows as they are shown — filtered, then ordered.
   *
   * Not memoised, deliberately: `filtered` is rebuilt every render, so a
   * `useMemo` keyed on it would recompute every render anyway while implying
   * it does not. Ordering 230 rows costs nothing.
   */
  const visible = (() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    /** What one row compares on. Numbers stay numbers rather than being
        stringified: Location and Call cycle order by rank rather than by
        alphabet, and a date compared as text is only accidentally right. */
    const rank = (s: StoreRow): string | number => {
      switch (sort.key) {
        case "town":
          // No town sorts first ascending, same argument as `lastVisit` and
          // `responsible` below: a store without one can never be scheduled,
          // so "which ones are missing it" is the question this column gets
          // sorted for.
          return (s.city ?? "").toLowerCase();
        case "location":
          // Trustworthiness, best first — the order the filter already uses.
          return GEOCODE_STATE_ORDER.indexOf(stateById[s.id]);
        case "group":
          return groupName(s.store_group_id).toLowerCase();
        case "cycle":
          return FREQUENCY_ORDER.indexOf(s.visit_frequency);
        case "lastVisit":
          // A store nobody has ever visited is the oldest thing on the list,
          // not a blank to be swept to the end: ascending should lead with the
          // stores that need going to, which is the reason to sort by this at
          // all.
          return lastVisits[s.id] ? new Date(lastVisits[s.id]).getTime() : 0;
        case "status":
          return s.active ? 0 : 1;
        case "responsible":
          // Same argument: unassigned sorts first ascending, because "who has
          // nobody" is the question this column gets sorted for.
          return (assignedByStore[s.id] ?? [])
            .map((a) => a.name)
            .join(", ")
            .toLowerCase();
        default:
          return s.name.toLowerCase();
      }
    };
    return [...filtered].sort((a, b) => {
      const x = rank(a);
      const y = rank(b);
      const cmp =
        typeof x === "number" && typeof y === "number"
          ? x - y
          : String(x).localeCompare(String(y));
      // Name breaks every tie, so two stores on the same cycle never swap
      // places between renders.
      return cmp !== 0 ? cmp * dir : a.name.localeCompare(b.name);
    });
  })();

  /** The visible list, as a spreadsheet. Same rows, same order, same filters. */
  function buildStoreSheet(): ExportSheet {
    const applied = [
      groupFilter !== "all" ? `Group: ${groupName(groupFilter === "none" ? null : groupFilter)}` : null,
      cityFilter !== "all"
        ? `Town: ${cityFilter === "none" ? "not recorded" : cityFilter}`
        : null,
      provFilter !== "all" ? `Location quality: ${provFilter}` : null,
      search.trim() ? `Search: ${search.trim()}` : null,
    ].filter((line): line is string => line !== null);

    return {
      title: "Stores",
      orgName: "Gold Fortune Merchandising",
      context: [
        `${filtered.length} of ${stores.length} stores`,
        ...(applied.length > 0 ? applied : ["No filters applied"]),
        `Sorted by ${SORT_LABELS[sort.key]}, ${
          sort.dir === "asc" ? "ascending" : "descending"
        }`,
      ],
      filename: "gf-stores",
      columns: [
        { header: "Store", key: "name" },
        { header: "Group", key: "group" },
        { header: "Address", key: "address" },
        { header: "Town", key: "city" },
        { header: "Region", key: "state" },
        { header: "Code", key: "code" },
        { header: "Call cycle", key: "frequency" },
        { header: "Responsible", key: "reps" },
        { header: "Last visited", key: "lastVisit" },
        { header: "Active", key: "active" },
      ],
      rows: visible.map((store) => ({
        name: store.name,
        group: groupName(store.store_group_id),
        address: store.address ?? "",
        city: store.city ?? "",
        state: store.state ?? "",
        code: store.place_code ?? "",
        frequency: cycleLabel(store.visit_frequency),
        reps: (assignedByStore[store.id] ?? []).map((a) => a.name).join(", "),
        // The date only. A store visited three weeks ago and one visited never
        // are different answers, and a blank cell says neither.
        lastVisit: toLocalDate(lastVisits[store.id]) || "never",
        active: store.active ? "Yes" : "No",
      })),
    };
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Stores
          </h1>
          <p className="text-sm text-muted-foreground">
            Every store you service, organised by retail group.
          </p>
        </div>
      </div>

      {/* The one banner on this page, and the only thing standing between a
          fresh import and reps working it.

          The missing-location and shared-point banners that used to sit here
          are gone: the review queue already surfaces both, as its top two
          reasons, with the store in front of you and a map to fix it on. Three
          banners saying overlapping things about the same problem taught a
          manager to scroll past all of them. */}
      {unverified > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
          <p className="flex items-start gap-2 text-sm text-foreground">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span>
              <span className="font-semibold">{unverified}</span> store
              {unverified === 1 ? "" : "s"} still on a guessed position. Each one
              is settled the first time a rep checks in there and sets it from
              inside the shop — nothing to do here unless one is flagged.
            </span>
          </p>
          {/* `nativeButton={false}` because the render target is an anchor, not
              a <button>. Without it Base UI logs an accessibility error — as
              forms/page.tsx:187 still does. */}
          <Button
            size="sm"
            nativeButton={false}
            render={<Link href="/stores/review">Exceptions</Link>}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="w-full min-w-0 sm:w-auto sm:flex-1">
          <Input
            placeholder="Search stores by name, group or address"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-56">
          <NativeSelect
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            aria-label="Filter by store group"
          >
            <option value="all">All groups</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
            <option value="none">Ungrouped</option>
          </NativeSelect>
        </div>
        <div className="w-full sm:w-44">
          <NativeSelect
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
            aria-label="Filter by town"
          >
            <option value="all">All towns</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            {/* A store with no town will never be schedulable, so it needs to
                be findable rather than buried among 200 that are fine. */}
            {missingCity > 0 && (
              <option value="none">No town ({missingCity})</option>
            )}
          </NativeSelect>
        </div>
        <div className="w-full sm:w-48">
          <NativeSelect
            value={provFilter}
            onChange={(e) =>
              setProvFilter(e.target.value as GeocodeState | "all" | "shared")
            }
            aria-label="Filter by where the location came from"
          >
            <option value="all">All sources</option>
            {GEOCODE_STATE_ORDER.filter(
              // A state nobody is in is noise in the list — but the selected
              // one always stays, or the control blanks itself after a reload
              // that empties it.
              (st) => (stateCounts[st] ?? 0) > 0 || provFilter === st
            ).map((st) => (
              <option key={st} value={st}>
                {GEOCODE_STATE_STYLES[st].label} ({stateCounts[st] ?? 0})
              </option>
            ))}
            {sharedPoints.length > 0 && (
              <option value="shared">
                Shares a point ({Object.keys(sharedIds).length})
              </option>
            )}
          </NativeSelect>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => setView(view === "list" ? "map" : "list")}
        >
          {view === "list" ? (
            <>
              <Map className="h-4 w-4" />
              Show map
            </>
          ) : (
            <>
              <List className="h-4 w-4" />
              Show list
            </>
          )}
        </Button>
        <ImportStoresButton onImported={loadData} />
        {/* Exports what is on screen, filters and all — the estate is 230
            outlets and "all of them" is rarely the list somebody wants to hand
            over. The file says which filters produced it, so a colleague
            receiving it can tell a Gaborone-only list from the whole book. */}
        <ExportMenu build={buildStoreSheet} disabled={loading} label="Export" />
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => setGroupDialogOpen(true)}
        >
          <Building2 className="h-4 w-4" />
          Groups
        </Button>
        <Button
          size="sm"
          className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={openCreate}
        >
          <Plus className="h-4 w-4" />
          New store
        </Button>
      </div>

      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Store groups</DialogTitle>
          </DialogHeader>

          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="group-name">Add a group</Label>
              <Input
                id="group-name"
                placeholder="e.g. Choppies Retail Group"
                value={groupForm}
                onChange={(e) => setGroupForm(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateGroup()}
              />
            </div>
            <Button
              onClick={handleCreateGroup}
              disabled={saving || !groupForm.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? "Saving…" : "Add"}
            </Button>
          </div>

          {groups.length > 0 && (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {groups.map((g) => {
                const count = stores.filter(
                  (s) => s.store_group_id === g.id
                ).length;
                const busy = groupBusy === g.id;

                if (editingGroupId === g.id) {
                  return (
                    <li key={g.id} className="flex items-center gap-2 p-2">
                      <Input
                        value={editingGroupName}
                        autoFocus
                        onChange={(e) => setEditingGroupName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter")
                            renameGroup(g.id, editingGroupName);
                          if (e.key === "Escape") setEditingGroupId(null);
                        }}
                      />
                      <Button
                        size="sm"
                        disabled={busy || !editingGroupName.trim()}
                        onClick={() => renameGroup(g.id, editingGroupName)}
                      >
                        {busy ? "Saving…" : "Save"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingGroupId(null)}
                      >
                        Cancel
                      </Button>
                    </li>
                  );
                }

                if (confirmDeleteGroup === g.id) {
                  return (
                    <li
                      key={g.id}
                      className="flex flex-wrap items-center justify-between gap-2 p-2"
                    >
                      <p className="text-sm text-foreground">
                        Delete <span className="font-medium">{g.name}</span>?
                        {count > 0 ? (
                          <span className="text-muted-foreground">
                            {" "}
                            {count} store{count === 1 ? "" : "s"} will become
                            ungrouped — none are deleted.
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            {" "}
                            It has no stores.
                          </span>
                        )}
                      </p>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={busy}
                          onClick={() => deleteGroup(g.id)}
                        >
                          {busy ? "Deleting…" : "Delete"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirmDeleteGroup(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </li>
                  );
                }

                return (
                  <li
                    key={g.id}
                    className="flex items-center justify-between gap-2 px-3 py-2"
                  >
                    <span className="min-w-0 truncate text-sm text-foreground">
                      {g.name}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {count} store{count === 1 ? "" : "s"}
                      </span>
                    </span>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        aria-label={`Rename ${g.name}`}
                        onClick={() => {
                          setEditingGroupId(g.id);
                          setEditingGroupName(g.name);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive"
                        aria-label={`Delete ${g.name}`}
                        onClick={() => setConfirmDeleteGroup(g.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit store" : "New store"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="store-group">Store group</Label>
              <NativeSelect
                id="store-group"
                value={form.store_group_id}
                onChange={(e) =>
                  setForm({ ...form, store_group_id: e.target.value })
                }
              >
                <option value="">Ungrouped</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
                <option value="__new__">+ Create new group…</option>
              </NativeSelect>
            </div>
            {form.store_group_id === "__new__" && (
              <div className="space-y-1.5">
                <Label htmlFor="new-group-name">New group name</Label>
                <Input
                  id="new-group-name"
                  placeholder="e.g. Choppies Retail Group"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                />
              </div>
            )}
            {/* The Call cycle column is `hidden lg:table-cell`, so below
                1024px the badge in the row is not rendered and the cycle
                cannot be set from the table at all. Group has always had this
                dialog as its narrow-width way in; without this the cycle was
                the one inline control on the page with no other route to it.
                Reading it is still possible at any width — the mirror line
                under the store name carries it. */}
            <div className="space-y-1.5">
              <Label htmlFor="store-frequency">Call cycle</Label>
              <NativeSelect
                id="store-frequency"
                value={form.visit_frequency}
                onChange={(e) =>
                  setForm({ ...form, visit_frequency: e.target.value })
                }
              >
                {FREQUENCIES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </NativeSelect>
              {/* Frequency is a property of the store, so this is not scoped
                  to whoever is looking at it. Said here because the dialog,
                  unlike the planner, gives no hint that a rep is involved. */}
              <p className="text-xs text-muted-foreground">
                Applies to every rep who covers this store.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="store-name">Store name</Label>
              <Input
                id="store-name"
                placeholder="e.g. Choppies Gaborone Main"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="store-address">Address</Label>
              <Input
                id="store-address"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="store-city">City</Label>
                <Input
                  id="store-city"
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="store-state">State</Label>
                <Input
                  id="store-state"
                  value={form.state}
                  onChange={(e) => setForm({ ...form, state: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="store-zip">Zip</Label>
                <Input
                  id="store-zip"
                  value={form.zip}
                  onChange={(e) => setForm({ ...form, zip: e.target.value })}
                />
              </div>
            </div>
            {form.name && (
              <a
                href={googleMapsUrl(form)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Preview on Google Maps
              </a>
            )}
          </div>
          <DialogFooter>
            <Button
              onClick={handleSave}
              disabled={saving || !form.name}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? "Saving…" : editingId ? "Save changes" : "Create store"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(o) => {
          if (!o) {
            setDeleteTarget(null);
            setDeleteImpact(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete {deleteImpact?.store_name ?? deleteTarget?.name ?? "store"}?
            </DialogTitle>
          </DialogHeader>

          {!deleteImpact ? (
            <p className="text-sm text-muted-foreground">
              Checking what this would remove…
            </p>
          ) : (
            <div className="space-y-2">
              <p className="flex items-start gap-1.5 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                This cannot be undone.
              </p>
              {deleteImpact.visits + deleteImpact.routes + deleteImpact.assignments ===
              0 ? (
                <p className="text-sm text-foreground">
                  Nothing else depends on this store — no visits, routes or rep
                  assignments. Safe to remove.
                </p>
              ) : (
                <p className="text-sm text-foreground">
                  This also deletes {deleteImpact.visits} visit
                  {deleteImpact.visits === 1 ? "" : "s"},{" "}
                  {deleteImpact.submissions} audit
                  {deleteImpact.submissions === 1 ? "" : "s"},{" "}
                  {deleteImpact.photos} photo
                  {deleteImpact.photos === 1 ? "" : "s"} and{" "}
                  {deleteImpact.routes} scheduled route
                  {deleteImpact.routes === 1 ? "" : "s"}
                  {deleteImpact.reps > 0 &&
                    `, and removes it from ${deleteImpact.reps} rep${deleteImpact.reps === 1 ? "'s" : "s'"} patch`}
                  . Reports covering those dates will change.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Deactivate instead if the store has simply closed — it keeps the
                history and only stops new visits being scheduled.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="destructive"
              disabled={deleting || !deleteImpact}
              onClick={confirmDelete}
            >
              {deleting ? "Deleting…" : "Yes, delete permanently"}
            </Button>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {rowError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {rowError}
        </p>
      )}

      {loading ? (
        <div className="rounded-lg border border-border bg-card py-16 text-center text-sm text-muted-foreground">
          Loading stores…
        </div>
      ) : view === "map" ? (
        <PlacesMap places={filtered} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <SortHeader sortKey="name" sort={sort} onSort={toggleSort} />
                {/* Deliberately NOT breakpoint-hidden, unlike every other
                    column added here. The town is the fact this estate is
                    organised around — 45 of them, and the filter beside the
                    search box is the one a manager reaches for first — and
                    hiding it below `md` would mean the narrow windows this page
                    is actually used in never show it. It is also the cheapest
                    column on the row: one short word. */}
                <SortHeader sortKey="town" sort={sort} onSort={toggleSort} />
                {/* Beside the name on purpose: the name links to the point on
                    Google Maps, this says how much that point can be trusted. */}
                <SortHeader
                  sortKey="location"
                  sort={sort}
                  onSort={toggleSort}
                  className="hidden md:table-cell"
                />
                {/* lg, not sm: the sidebar takes ~225px, so a "640px viewport"
                    is a ~415px table. Breakpoints here have to be read against
                    the container the table actually gets. */}
                <SortHeader
                  sortKey="group"
                  sort={sort}
                  onSort={toggleSort}
                  className="hidden lg:table-cell"
                />
                {/* Next to Group because the two are set together: which chain
                    a store belongs to and how often it is worked are the two
                    facts a manager is editing when they open this page to plan
                    rather than to look something up. */}
                <SortHeader
                  sortKey="cycle"
                  sort={sort}
                  onSort={toggleSort}
                  className="hidden lg:table-cell"
                />
                <SortHeader
                  sortKey="lastVisit"
                  sort={sort}
                  onSort={toggleSort}
                  className="hidden md:table-cell"
                />
                <SortHeader
                  sortKey="status"
                  sort={sort}
                  onSort={toggleSort}
                  className="hidden xl:table-cell"
                />
                <SortHeader
                  sortKey="responsible"
                  sort={sort}
                  onSort={toggleSort}
                />
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((store) => (
                <TableRow key={store.id}>
                  {/* Bounded, not just min-width. An unbounded address pushed
                      Group, Responsible and the actions menu outside the
                      horizontal scroll viewport entirely — invisible rather
                      than merely cramped, which reads as a missing feature. */}
                  <TableCell className="min-w-[200px] max-w-[320px]">
                    <div className="flex items-start gap-2.5">
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                        <Store className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <a
                          href={googleMapsUrl(store)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
                        >
                          {store.name}
                          <ExternalLink className="h-3 w-3 shrink-0 opacity-70" />
                        </a>

                        {/* The street, without the town — the town has its own
                            column now, and printing it twice on the same row
                            was the wider half of what made this cell noisy.

                            The mirror line that used to sit under this one is
                            GONE. It restated Group, Call cycle, Status, Last
                            visited and Location for whatever the breakpoints
                            had hidden, on the principle that a narrow window
                            should lose layout and not information. In practice
                            it truncated — "… · Never visited · No locati…" —
                            so it was losing information anyway, while making
                            every row three lines tall. Removed on the owner's
                            instruction after seeing it in production.

                            ⚠️ The consequence is real and intended: below `md`
                            the Location and Last visited columns are hidden and
                            no longer restated anywhere, and below `lg` the same
                            goes for Group and Call cycle. Group, cycle and
                            location all remain reachable per row through the
                            actions menu; Last visited does not. */}
                        <div
                          className="truncate text-xs text-muted-foreground"
                          title={
                            [store.address, store.state, store.zip]
                              .filter(Boolean)
                              .join(", ") || undefined
                          }
                        >
                          {[store.address, store.state, store.zip]
                            .filter(Boolean)
                            .join(", ")}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {store.city ? (
                      <span className="text-foreground">{store.city}</span>
                    ) : (
                      // Carries the warning the store cell used to: a store
                      // with no town is invisible to the town filter and can
                      // never be scheduled, which is worth saying in the column
                      // that is supposed to answer "where".
                      <span
                        className="text-amber-700 dark:text-amber-400"
                        title="Not schedulable until this store has a town."
                      >
                        No town
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <GeocodePill
                      state={stateById[store.id]}
                      accuracyM={store.geocode_accuracy_m}
                      shared={sharedIds[store.id] === true}
                      confirmed={store.location_confirmed_at !== null}
                      onClick={() => setLocationTarget(store)}
                    />
                  </TableCell>
                  <TableCell className="hidden text-sm lg:table-cell">
                    {/* The group badge is the control, same as the rep name.
                        Unlike reps this REPLACES rather than toggles — a store
                        has a single store_group_id — so the current group is
                        ticked and "Ungrouped" is an explicit way back out. */}
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <button
                            type="button"
                            disabled={busyStore === store.id}
                            className={
                              store.store_group_id
                                ? "inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground hover:bg-secondary/70 disabled:opacity-50"
                                : "inline-flex items-center rounded-full border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-500/20 disabled:opacity-50 dark:text-amber-400"
                            }
                          >
                            {store.store_group_id ? (
                              <>
                                <Building2 className="h-3 w-3" />
                                {groupName(store.store_group_id)}
                              </>
                            ) : (
                              "Assign group"
                            )}
                          </button>
                        }
                      />
                      <DropdownMenuContent
                        align="start"
                        className="max-h-72 overflow-y-auto"
                      >
                        {groups.length === 0 && (
                          <DropdownMenuItem disabled>No groups yet</DropdownMenuItem>
                        )}
                        {groups.map((g) => (
                          <DropdownMenuItem
                            key={g.id}
                            className="gap-2"
                            onClick={() => setStoreGroup(store, g.id)}
                          >
                            <Check
                              className={`h-3.5 w-3.5 ${
                                store.store_group_id === g.id
                                  ? "opacity-100"
                                  : "opacity-0"
                              }`}
                            />
                            {g.name}
                          </DropdownMenuItem>
                        ))}
                        {store.store_group_id && (
                          <DropdownMenuItem
                            className="gap-2 text-muted-foreground"
                            onClick={() => setStoreGroup(store, null)}
                          >
                            <Check className="h-3.5 w-3.5 opacity-0" />
                            Ungrouped
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {/* The badge is the control, same as Group and the rep
                        names — and like Group this REPLACES rather than
                        toggles, so the current cycle is ticked. Every store has
                        one (the column is `not null default 'weekly'`), so
                        there is no unset state to prompt for. */}
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <button
                            type="button"
                            disabled={busyStore === store.id}
                            className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground hover:bg-secondary/70 disabled:opacity-50"
                          >
                            <CalendarClock className="h-3 w-3" />
                            {cycleLabel(store.visit_frequency)}
                          </button>
                        }
                      />
                      <DropdownMenuContent align="start">
                        {FREQUENCIES.map((f) => (
                          <DropdownMenuItem
                            key={f.value}
                            className="gap-2"
                            onClick={() => setStoreCycle(store, f.value)}
                          >
                            <Check
                              className={`h-3.5 w-3.5 ${
                                store.visit_frequency === f.value
                                  ? "opacity-100"
                                  : "opacity-0"
                              }`}
                            />
                            {f.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap text-sm md:table-cell">
                    {lastVisits[store.id] ? (
                      <span className="text-foreground">
                        {formatLastVisit(lastVisits[store.id])}
                      </span>
                    ) : (
                      // "Never" is a fact worth showing plainly — after the
                      // import this is most of the estate, and it is exactly
                      // the list a manager needs to work through.
                      <span className="text-muted-foreground">Never</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-sm xl:table-cell">
                    <span
                      className={
                        store.active ? "text-emerald-700" : "text-muted-foreground"
                      }
                    >
                      {store.active ? "Active" : "Inactive"}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">
                    {/* One menu whether or not anyone is assigned: the names
                        are the control, so reassigning is a tap on the name
                        rather than a trip to another page. A store can have
                        more than one rep, so this toggles rather than
                        replaces — ticked names are assigned. */}
                    {store.active ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <button
                              type="button"
                              disabled={busyStore === store.id || !orgId}
                              className={
                                assignedByStore[store.id]?.length
                                  ? "rounded px-1 py-0.5 text-left text-foreground hover:bg-muted disabled:opacity-50"
                                  : "inline-flex items-center rounded-full border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-500/20 disabled:opacity-50 dark:text-amber-400"
                              }
                            >
                              {assignedByStore[store.id]?.length
                                ? assignedByStore[store.id].map((a) => a.name).join(", ")
                                : "Assign rep"}
                            </button>
                          }
                        />
                        <DropdownMenuContent
                          align="start"
                          className="max-h-72 overflow-y-auto"
                        >
                          {/* Assignment is deliberately *not* gated on the
                              location being confirmed, though it was briefly.
                              Reps are the ones who establish where a shop is,
                              by visiting it — so requiring a confirmed location
                              before anyone can be sent there is a deadlock:
                              nobody can visit the store that needs visiting. */}
                          {reps.length === 0 && (
                            <DropdownMenuItem disabled>No reps yet</DropdownMenuItem>
                          )}
                          {reps.map((r) => {
                            const mine = assignedByStore[store.id]?.find(
                              (a) => a.repId === r.id
                            );
                            return (
                              <DropdownMenuItem
                                key={r.id}
                                className="gap-2"
                                onClick={() =>
                                  mine
                                    ? unassignRep(store, mine.id)
                                    : assignRep(store, r.id)
                                }
                              >
                                <Check
                                  className={`h-3.5 w-3.5 ${mine ? "opacity-100" : "opacity-0"}`}
                                />
                                {r.name}
                              </DropdownMenuItem>
                            );
                          })}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      // A deactivated store is not expected to have an owner,
                      // so prompting on one would be noise.
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end">
                        {/* The pill is the usual way in, but the Location
                            column is hidden below md — this keeps the detail
                            reachable on a phone. */}
                        <DropdownMenuItem
                          onClick={() => setLocationTarget(store)}
                          className="gap-2"
                        >
                          <MapPin className="h-4 w-4" />
                          Location details
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => openEdit(store)}
                          className="gap-2"
                        >
                          <Pencil className="h-4 w-4" />
                          Edit store
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            window.open(googleMapsUrl(store), "_blank")
                          }
                          className="gap-2"
                        >
                          <ExternalLink className="h-4 w-4" />
                          Open in Google Maps
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => toggleActive(store)}
                          className="gap-2"
                        >
                          <Archive className="h-4 w-4" />
                          {store.active ? "Deactivate" : "Reactivate"}
                        </DropdownMenuItem>
                        {/* Distinct from Deactivate, and styled to say so —
                            this one takes the store's whole visit history with
                            it. The impact is fetched before anything is asked. */}
                        <DropdownMenuItem
                          onClick={() => requestDelete(store)}
                          className="gap-2 text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete permanently
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    No stores found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {filtered.length} of {stores.length} stores across {groups.length} groups.
      </p>

      <StoreLocationDialog
        store={locationTarget}
        capture={locationTarget ? (captures[locationTarget.id] ?? null) : null}
        sharedWith={locationTarget ? sharedWith(locationTarget).others : []}
        sameResult={
          locationTarget ? sharedWith(locationTarget).sameResult : false
        }
        onClose={() => setLocationTarget(null)}
      />
    </div>
  );
}
