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
import { FilterBar } from "@/components/dashboard/filter-bar";
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
import { fetchAssignments } from "@/lib/representatives";
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

export default function StoresPage() {
  const supabase = createClient();
  const [view, setView] = useState<"list" | "map">("list");
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [groups, setGroups] = useState<StoreGroup[]>([]);
  const [assignedStoreIds, setAssignedStoreIds] = useState<Set<string>>(new Set());
  const [repsByStore, setRepsByStore] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");

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
    setAssignedStoreIds(new Set(assignmentRows.map((a) => a.store_id)));

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
    const byStore: Record<string, string[]> = {};
    for (const a of assignmentRows) {
      const n = nameById[a.rep_id];
      if (!n) continue;
      (byStore[a.store_id] ??= []).push(n);
    }
    setRepsByStore(
      Object.fromEntries(
        Object.entries(byStore).map(([k, v]) => [k, v.sort().join(", ")])
      )
    );

    setLoading(false);
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const filtered = stores
    .filter((s) =>
      groupFilter === "all" ? true : (s.store_group_id ?? "none") === groupFilter
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

      <FilterBar />

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
        <Button variant="outline" size="sm" className="hidden gap-1.5 lg:inline-flex">
          <Upload className="h-4 w-4" />
          Import
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
                <TableHead className="hidden sm:table-cell">Group</TableHead>
                <TableHead className="hidden md:table-cell">Status</TableHead>
                <TableHead>Responsible</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((store) => (
                <TableRow key={store.id}>
                  <TableCell className="min-w-[220px]">
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

                        <div className="text-xs text-muted-foreground">
                          {[store.address, store.city, store.state, store.zip]
                            .filter(Boolean)
                            .join(", ")}
                        </div>
                        <div className="text-xs text-muted-foreground sm:hidden">
                          {groupName(store.store_group_id)} ·{" "}
                          {store.active ? "Active" : "Inactive"}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-sm sm:table-cell">
                    {store.store_group_id ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
                        <Building2 className="h-3 w-3" />
                        {groupName(store.store_group_id)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Ungrouped</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-sm md:table-cell">
                    <span
                      className={
                        store.active ? "text-emerald-700" : "text-muted-foreground"
                      }
                    >
                      {store.active ? "Active" : "Inactive"}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">
                    {repsByStore[store.id] ? (
                      <span className="text-foreground">{repsByStore[store.id]}</span>
                    ) : store.active ? (
                      // Only active stores are expected to have an owner —
                      // prompting on a deactivated one would be noise.
                      <Link
                        href="/representatives"
                        className="inline-flex items-center rounded-full border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-500/20 dark:text-amber-400"
                      >
                        Assign rep
                      </Link>
                    ) : (
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
                          <Trash2 className="h-4 w-4" />
                          {store.active ? "Deactivate" : "Reactivate"}
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
