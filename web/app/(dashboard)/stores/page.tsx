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
import { googleMapsUrl } from "@/lib/maps";
import type { Tables } from "@/lib/supabase/types";

type StoreRow = Tables<"stores">;
type StoreGroup = Tables<"store_groups">;

const emptyForm = {
  name: "",
  store_group_id: "",
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

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [newGroupName, setNewGroupName] = useState("");
  const [saving, setSaving] = useState(false);

  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupForm, setGroupForm] = useState("");

  async function loadData() {
    setLoading(true);

    const { data: groupRows } = await supabase
      .from("store_groups")
      .select("*")
      .order("name");
    setGroups(groupRows ?? []);

    const { data: storeRows } = await supabase
      .from("stores")
      .select("*")
      .order("name");
    setStores(storeRows ?? []);

    // Which stores have an owner. A store nobody is responsible for is the
    // gap worth prompting on — it will never appear on anyone's route.
    // Reuses the representatives fetcher: store_assignments is missing from the
    // stale generated types, so querying it off the typed client won't compile.
    const assignmentRows = await fetchAssignments(supabase);
    setAssignments(assignmentRows);

    // Aggregated in Postgres. `visits` is the fastest-growing table here, so
    // the list must not download it to compute a maximum per row.
    const visitRes = await callRpc(supabase, "store_last_visit", {});
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

    // Names for the "Responsible" column. profiles is already readable org-wide,
    // so this is one extra query rather than a join through the stale types.
    const { data: repRows } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("role", "rep");
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

  function assignGroup(store: StoreRow, groupId: string) {
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
    setGroupDialogOpen(false);
    setGroupForm("");
    loadData();
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

  const filtered = stores
    .filter((s) =>
      groupFilter === "all" ? true : (s.store_group_id ?? "none") === groupFilter
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
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => setGroupDialogOpen(true)}
        >
          <Building2 className="h-4 w-4" />
          New group
        </Button>
      </div>

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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New store group</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="group-name">Group name</Label>
            <Input
              id="group-name"
              placeholder="e.g. Choppies Retail Group"
              value={groupForm}
              onChange={(e) => setGroupForm(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              onClick={handleCreateGroup}
              disabled={saving || !groupForm.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? "Saving…" : "Create group"}
            </Button>
          </DialogFooter>
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
                <TableHead>Store</TableHead>
                {/* lg, not sm: the sidebar takes ~225px, so a "640px viewport"
                    is a ~415px table. Breakpoints here have to be read against
                    the container the table actually gets. */}
                <TableHead className="hidden lg:table-cell">Group</TableHead>
                <TableHead className="hidden md:table-cell">Last visited</TableHead>
                <TableHead className="hidden xl:table-cell">Status</TableHead>
                <TableHead>Responsible</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((store) => (
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

                        <div
                          className="truncate text-xs text-muted-foreground"
                          title={
                            [store.address, store.city, store.state, store.zip]
                              .filter(Boolean)
                              .join(", ") || undefined
                          }
                        >
                          {[store.address, store.city, store.state, store.zip]
                            .filter(Boolean)
                            .join(", ") || (
                            <span className="text-amber-700 dark:text-amber-400">
                              No town — not schedulable
                            </span>
                          )}
                        </div>
                        {/* Mirrors whatever the breakpoints have hidden, so a
                            narrow window loses layout, never information. */}
                        <div className="truncate text-xs text-muted-foreground lg:hidden">
                          {groupName(store.store_group_id)} ·{" "}
                          {store.active ? "Active" : "Inactive"}
                          <span className="md:hidden">
                            {" · "}
                            {formatLastVisit(lastVisits[store.id])}
                          </span>
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-sm lg:table-cell">
                    {store.store_group_id ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
                        <Building2 className="h-3 w-3" />
                        {groupName(store.store_group_id)}
                      </span>
                    ) : (
                      // Same affordance as "Assign rep": say what is missing
                      // and fix it in place, rather than reporting a state.
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <button
                              type="button"
                              disabled={busyStore === store.id}
                              className="inline-flex items-center rounded-full border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-500/20 disabled:opacity-50 dark:text-amber-400"
                            >
                              Assign group
                            </button>
                          }
                        />
                        <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
                          {groups.length === 0 && (
                            <DropdownMenuItem disabled>
                              No groups yet
                            </DropdownMenuItem>
                          )}
                          {groups.map((g) => (
                            <DropdownMenuItem
                              key={g.id}
                              onClick={() => assignGroup(store, g.id)}
                            >
                              {g.name}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
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
                    colSpan={6}
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
    </div>
  );
}
