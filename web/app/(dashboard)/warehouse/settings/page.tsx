"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Pencil, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ErrorBanner, EmptyRow } from "@/components/warehouse/stat-tile";
import { useCurrentRole } from "@/lib/use-current-role";
import { fetchOrgId } from "@/lib/representatives";
import {
  fetchSuppliersAll,
  fetchDriversAll,
  fetchVehiclesAll,
  fetchLocationsAll,
  fetchReorderLevels,
  fetchWarehouseStaff,
  inviteWarehouseUser,
  setStaffActive,
  saveSupplier,
  saveDriver,
  saveVehicle,
  saveLocation,
  saveReorderLevels,
  setActive,
  type Supplier,
  type Driver,
  type Vehicle,
  type LocationRow,
  type ReorderRow,
  type StaffMember,
} from "@/lib/warehouse-settings";

type Editing =
  | null
  | { kind: "supplier"; row: Partial<Supplier> }
  | { kind: "driver"; row: Partial<Driver> }
  | { kind: "vehicle"; row: Partial<Vehicle> }
  | { kind: "location"; row: Partial<LocationRow> };

/**
 * The reference data the warehouse runs on.
 *
 * It lives under /warehouse rather than /settings on purpose. A clerk needs to
 * add the driver who started this morning, or the supplier whose lorry is at
 * the door, without waiting for a manager — and RLS already permits exactly
 * that. Locations and reorder levels are a different kind of decision and stay
 * with managers, which the tabs reflect and the database enforces.
 *
 * Nothing here is deleted. A retired supplier still appears on every receipt
 * they ever delivered, so `active = false` is the retirement.
 */
export default function WarehouseSettingsPage() {
  const supabase = createClient();
  const role = useCurrentRole();
  const isManager = role === "manager";

  const [orgId, setOrgId] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [reorder, setReorder] = useState<ReorderRow[]>([]);
  const [levels, setLevels] = useState<Record<string, ReorderRow>>({});
  const [staff, setStaff] = useState<StaffMember[]>([]);

  // The invite form. Kept out of `editing` because it is not editing anything —
  // it creates an auth user through a route handler, and the password is a
  // credential that should not sit in shared dialog state.
  const [inviting, setInviting] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePassword, setInvitePassword] = useState("");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  // Fixed when the data loads rather than read during render. `Date.now()` in
  // the render path is impure — the value would shift on every re-render, and
  // a licence could change colour because something unrelated updated.
  const [licenceCutoff, setLicenceCutoff] = useState<number | null>(null);

  const reload = useCallback(async () => {
    const [org, s, d, v, l, r, st] = await Promise.all([
      fetchOrgId(supabase),
      fetchSuppliersAll(supabase),
      fetchDriversAll(supabase),
      fetchVehiclesAll(supabase),
      fetchLocationsAll(supabase),
      fetchReorderLevels(supabase),
      fetchWarehouseStaff(supabase),
    ]);
    setOrgId(org);
    setSuppliers(s);
    setDrivers(d);
    setVehicles(v);
    setLocations(l);
    setReorder(r);
    setLevels(Object.fromEntries(r.map((x) => [x.product_id, x])));
    setStaff(st);
    setLicenceCutoff(Date.now() + 30 * 24 * 60 * 60 * 1000);
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await reload();
        if (!cancelled) setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  async function run(fn: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      await reload();
      setNotice(success);
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function field(kind: string, key: string): string {
    if (!editing || editing.kind !== kind) return "";
    return ((editing.row as Record<string, unknown>)[key] as string) ?? "";
  }

  function setField(key: string, value: string) {
    setEditing((prev) =>
      prev ? ({ ...prev, row: { ...prev.row, [key]: value } } as Editing) : prev
    );
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/warehouse" className="text-sm text-muted-foreground hover:underline">
          ← Warehouse
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Warehouse settings</h1>
        <p className="text-sm text-muted-foreground">
          Who we buy from, who delivers, and where stock lives.
        </p>
      </div>

      <ErrorBanner message={error} />
      {notice && (
        <p className="rounded-lg border border-border bg-muted/40 p-2.5 text-sm">{notice}</p>
      )}

      <Tabs defaultValue="suppliers">
        <TabsList>
          <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
          <TabsTrigger value="drivers">Drivers</TabsTrigger>
          <TabsTrigger value="vehicles">Vehicles</TabsTrigger>
          {isManager && <TabsTrigger value="locations">Locations</TabsTrigger>}
          {isManager && <TabsTrigger value="reorder">Reorder levels</TabsTrigger>}
          {isManager && <TabsTrigger value="staff">Warehouse staff</TabsTrigger>}
        </TabsList>

        {/* ------------------------------------------------------ suppliers */}
        <TabsContent value="suppliers" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setEditing({ kind: "supplier", row: {} })}>
              <Plus className="mr-1.5 h-4 w-4" /> Add a supplier
            </Button>
          </div>
          <div className="rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppliers.length === 0 ? (
                  <EmptyRow colSpan={5}>
                    No suppliers yet. Add one before keying a delivery.
                  </EmptyRow>
                ) : (
                  suppliers.map((s) => (
                    <TableRow key={s.id} className={s.active ? undefined : "opacity-60"}>
                      <TableCell className="font-medium">
                        {s.name}
                        {!s.active && (
                          <Badge variant="outline" className="ml-2">
                            retired
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {s.contact_name ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{s.phone ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {s.account_ref ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditing({ kind: "supplier", row: s })}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            run(
                              () => setActive(supabase, "suppliers", s.id, !s.active),
                              s.active ? "Supplier retired." : "Supplier brought back."
                            )
                          }
                          disabled={busy}
                        >
                          {s.active ? "Retire" : "Restore"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* -------------------------------------------------------- drivers */}
        <TabsContent value="drivers" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setEditing({ kind: "driver", row: {} })}>
              <Plus className="mr-1.5 h-4 w-4" /> Add a driver
            </Button>
          </div>
          <div className="rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Licence</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {drivers.length === 0 ? (
                  <EmptyRow colSpan={5}>
                    No drivers yet. A driver is named on a dispatch — they do not need a
                    login.
                  </EmptyRow>
                ) : (
                  drivers.map((d) => {
                    const expiring =
                      d.licence_expires_on != null &&
                      licenceCutoff != null &&
                      new Date(d.licence_expires_on).getTime() < licenceCutoff;
                    return (
                      <TableRow key={d.id} className={d.active ? undefined : "opacity-60"}>
                        <TableCell className="font-medium">
                          {d.full_name}
                          {!d.active && (
                            <Badge variant="outline" className="ml-2">
                              retired
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {d.phone ?? "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {d.licence_number ?? "—"}
                        </TableCell>
                        <TableCell>
                          {d.licence_expires_on ? (
                            <span className={expiring ? "text-amber-600" : "text-muted-foreground"}>
                              {new Date(d.licence_expires_on).toLocaleDateString()}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditing({ kind: "driver", row: d })}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              run(
                                () => setActive(supabase, "drivers", d.id, !d.active),
                                d.active ? "Driver retired." : "Driver brought back."
                              )
                            }
                            disabled={busy}
                          >
                            {d.active ? "Retire" : "Restore"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ------------------------------------------------------- vehicles */}
        <TabsContent value="vehicles" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setEditing({ kind: "vehicle", row: {} })}>
              <Plus className="mr-1.5 h-4 w-4" /> Add a vehicle
            </Button>
          </div>
          <div className="rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Registration</TableHead>
                  <TableHead>Make and model</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {vehicles.length === 0 ? (
                  <EmptyRow colSpan={4}>
                    No vehicles yet. A vehicle gets its own stock location the first time
                    it carries an order.
                  </EmptyRow>
                ) : (
                  vehicles.map((v) => (
                    <TableRow key={v.id} className={v.active ? undefined : "opacity-60"}>
                      <TableCell className="font-medium">
                        {v.registration}
                        {!v.active && (
                          <Badge variant="outline" className="ml-2">
                            retired
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {v.make_model ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {v.description ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditing({ kind: "vehicle", row: v })}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            run(
                              () => setActive(supabase, "vehicles", v.id, !v.active),
                              v.active ? "Vehicle retired." : "Vehicle brought back."
                            )
                          }
                          disabled={busy}
                        >
                          {v.active ? "Retire" : "Restore"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ------------------------------------------------------ locations */}
        {isManager && (
          <TabsContent value="locations" className="mt-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Vehicle and rep locations are created automatically the first time stock
                goes to one. Only warehouses are added here.
              </p>
              <Button size="sm" onClick={() => setEditing({ kind: "location", row: {} })}>
                <Plus className="mr-1.5 h-4 w-4" /> Add a warehouse
              </Button>
            </div>
            <div className="rounded-lg border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {locations.map((l) => (
                    <TableRow key={l.id} className={l.active ? undefined : "opacity-60"}>
                      <TableCell className="font-medium">
                        {l.name}
                        {l.is_default && (
                          <Badge variant="secondary" className="ml-2">
                            default
                          </Badge>
                        )}
                        {!l.active && (
                          <Badge variant="outline" className="ml-2">
                            retired
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{l.code ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{l.type}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {l.address ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {l.type === "warehouse" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditing({ kind: "location", row: l })}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {!l.is_default && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              run(
                                () => setActive(supabase, "stock_locations", l.id, !l.active),
                                l.active ? "Location retired." : "Location brought back."
                              )
                            }
                            disabled={busy}
                          >
                            {l.active ? "Retire" : "Restore"}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        )}

        {/* -------------------------------------------------------- reorder */}
        {isManager && (
          <TabsContent value="reorder" className="mt-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              The minimum is the level below which a shortage is worth an alert. The
              reorder point sits at or above it — the idea is to buy before the floor is
              breached, not once it already has been.
            </p>
            <div className="rounded-lg border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="w-28 text-right">Minimum</TableHead>
                    <TableHead className="w-28 text-right">Reorder at</TableHead>
                    <TableHead className="w-28 text-right">Order qty</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reorder.length === 0 ? (
                    <EmptyRow colSpan={5}>
                      No stock-tracked products yet. Load the catalogue first.
                    </EmptyRow>
                  ) : (
                    reorder.map((p) => {
                      const l = levels[p.product_id] ?? p;
                      const changed =
                        l.min_stock_level !== p.min_stock_level ||
                        l.reorder_point !== p.reorder_point ||
                        l.reorder_qty !== p.reorder_qty;
                      return (
                        <TableRow key={p.product_id}>
                          <TableCell>
                            <div className="font-medium">{p.product_name}</div>
                            {p.brand && (
                              <div className="text-xs text-muted-foreground">{p.brand}</div>
                            )}
                          </TableCell>
                          {(["min_stock_level", "reorder_point", "reorder_qty"] as const).map(
                            (key) => (
                              <TableCell key={key}>
                                <Input
                                  type="number"
                                  min={0}
                                  value={l[key] ?? ""}
                                  onChange={(e) =>
                                    setLevels((prev) => ({
                                      ...prev,
                                      [p.product_id]: {
                                        ...(prev[p.product_id] ?? p),
                                        [key]:
                                          e.target.value === ""
                                            ? null
                                            : Number(e.target.value),
                                      },
                                    }))
                                  }
                                  className="text-right"
                                  aria-label={`${key.replace(/_/g, " ")} for ${p.product_name}`}
                                />
                              </TableCell>
                            )
                          )}
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant={changed ? "default" : "ghost"}
                              disabled={busy || !changed}
                              onClick={() =>
                                run(
                                  () =>
                                    saveReorderLevels(supabase, p.product_id, {
                                      min_stock_level: l.min_stock_level,
                                      reorder_point: l.reorder_point,
                                      reorder_qty: l.reorder_qty,
                                    }),
                                  `Levels saved for ${p.product_name}.`
                                )
                              }
                            >
                              Save
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        )}
        {/* ---------------------------------------------------------- staff */}
        {isManager && (
          <TabsContent value="staff" className="mt-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="max-w-xl text-sm text-muted-foreground">
                A warehouse login reaches the warehouse, orders and inventory screens
                and nothing else — no visits, no GPS, no leads, no settings. Accounts
                are created with a starting password and handed over directly; there is
                no invitation email.
              </p>
              <Button
                size="sm"
                onClick={() => {
                  setInviteName("");
                  setInviteEmail("");
                  setInvitePassword("");
                  setInviting(true);
                }}
              >
                <Plus className="mr-1.5 h-4 w-4" /> Add warehouse staff
              </Button>
            </div>
            <div className="rounded-lg border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Sign-in email</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Added</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {staff.length === 0 ? (
                    <EmptyRow colSpan={5}>
                      Nobody has a warehouse login yet.
                    </EmptyRow>
                  ) : (
                    staff.map((m) => (
                      <TableRow key={m.id} className={m.is_active ? undefined : "opacity-60"}>
                        <TableCell className="font-medium">
                          {m.full_name}
                          {!m.is_active && (
                            <Badge variant="outline" className="ml-2">
                              suspended
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {m.email ?? "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {m.phone ?? "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(m.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              run(
                                () => setStaffActive(m.id, !m.is_active),
                                m.is_active
                                  ? "Suspended. They can no longer sign in."
                                  : "Restored. They can sign in again."
                              )
                            }
                          >
                            {m.is_active ? "Suspend" : "Restore"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        )}
      </Tabs>

      {/* --------------------------------------------------------- dialogs */}

      <Dialog open={inviting} onOpenChange={(v) => !v && setInviting(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add warehouse staff</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Full name" value={inviteName} onChange={setInviteName} />
            <Field label="Sign-in email" value={inviteEmail} onChange={setInviteEmail} />
            <div>
              <Label htmlFor="starting-password">Starting password</Label>
              <Input
                id="starting-password"
                // Not a password field: the manager is about to read this out or
                // write it down, and hiding it from the person choosing it helps
                // nobody. It is typed once and never shown again.
                value={invitePassword}
                onChange={(e) => setInvitePassword(e.target.value)}
                placeholder="At least 8 characters"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Hand this over directly. It is not emailed and cannot be read back
                afterwards — a forgotten one has to be reset.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviting(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              disabled={
                busy ||
                !inviteName.trim() ||
                !inviteEmail.trim() ||
                invitePassword.length < 8
              }
              onClick={() =>
                run(async () => {
                  await inviteWarehouseUser({
                    email: inviteEmail,
                    fullName: inviteName,
                    password: invitePassword,
                  });
                  setInviting(false);
                  // Cleared as soon as it has been used. There is no reason for a
                  // credential to stay in component state after the request.
                  setInvitePassword("");
                }, `${inviteName.trim()} can now sign in.`)
              }
            >
              {busy ? "Creating…" : "Create the account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing?.row && "id" in editing.row && editing.row.id ? "Edit" : "Add"}{" "}
              {editing?.kind === "location" ? "warehouse" : editing?.kind}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {editing?.kind === "supplier" && (
              <>
                <Field label="Name" value={field("supplier", "name")} onChange={(v) => setField("name", v)} />
                <Field label="Contact" value={field("supplier", "contact_name")} onChange={(v) => setField("contact_name", v)} />
                <Field label="Phone" value={field("supplier", "phone")} onChange={(v) => setField("phone", v)} />
                <Field label="Email" value={field("supplier", "email")} onChange={(v) => setField("email", v)} />
                <Field label="Account reference" value={field("supplier", "account_ref")} onChange={(v) => setField("account_ref", v)} />
              </>
            )}
            {editing?.kind === "driver" && (
              <>
                <Field label="Full name" value={field("driver", "full_name")} onChange={(v) => setField("full_name", v)} />
                <Field label="Phone" value={field("driver", "phone")} onChange={(v) => setField("phone", v)} />
                <Field label="Licence number" value={field("driver", "licence_number")} onChange={(v) => setField("licence_number", v)} />
                <Field label="Licence expires" type="date" value={field("driver", "licence_expires_on")} onChange={(v) => setField("licence_expires_on", v)} />
              </>
            )}
            {editing?.kind === "vehicle" && (
              <>
                <Field label="Registration" value={field("vehicle", "registration")} onChange={(v) => setField("registration", v)} />
                <Field label="Make and model" value={field("vehicle", "make_model")} onChange={(v) => setField("make_model", v)} />
                <Field label="Description" value={field("vehicle", "description")} onChange={(v) => setField("description", v)} />
              </>
            )}
            {editing?.kind === "location" && (
              <>
                <Field label="Name" value={field("location", "name")} onChange={(v) => setField("name", v)} />
                <Field label="Code" value={field("location", "code")} onChange={(v) => setField("code", v)} />
                <Field label="Address" value={field("location", "address")} onChange={(v) => setField("address", v)} />
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                if (!editing) return;
                // Returning silently here left the dialog open with the Save
                // button apparently doing nothing at all, which reads as a
                // broken button rather than a state the user can act on.
                if (!orgId) {
                  setError("Could not work out your organisation. Reload and try again.");
                  return;
                }
                const row = editing.row as Record<string, string | undefined>;
                run(() => {
                  switch (editing.kind) {
                    case "supplier":
                      if (!row.name?.trim()) throw new Error("A supplier needs a name.");
                      return saveSupplier(supabase, orgId, row as never);
                    case "driver":
                      if (!row.full_name?.trim()) throw new Error("A driver needs a name.");
                      return saveDriver(supabase, orgId, row as never);
                    case "vehicle":
                      if (!row.registration?.trim())
                        throw new Error("A vehicle needs a registration.");
                      return saveVehicle(supabase, orgId, row as never);
                    case "location":
                      if (!row.name?.trim()) throw new Error("A warehouse needs a name.");
                      return saveLocation(supabase, orgId, {
                        id: row.id,
                        name: row.name,
                        code: row.code ?? null,
                        address: row.address ?? null,
                      });
                  }
                }, "Saved.");
              }}
            >
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  const id = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
