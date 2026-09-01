"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { createClient } from "@/lib/supabase/client";
import {
  assignStore,
  changeRepEmail,
  deleteRep,
  fetchDeleteImpact,
  generatePassword,
  setRepActive,
  setRepPassword,
  unassignStore,
  updateRep,
  type Assignment,
  type DeleteImpact,
  type RepSummary,
  type StoreOption,
} from "@/lib/representatives";

/**
 * Assign stores to one rep, grouped by retail chain.
 *
 * Chains are the unit a merchandising manager thinks in ("give Nancy the Target
 * estate"), and a flat list stops working the moment a chain has more than a
 * handful of branches. Groups collapse by default; any group the rep already
 * covers starts expanded so their current patch is visible without hunting.
 *
 * A store may be covered by several reps.
 */
export function AssignStoresDialog({
  rep,
  stores,
  assignments,
  orgId,
  open,
  onOpenChange,
  onChanged,
}: {
  rep: RepSummary | null;
  stores: StoreOption[];
  assignments: Assignment[];
  orgId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /**
   * Every store with a write in flight, not just the most recent one.
   *
   * A single id cannot describe two at once: whichever write settled first
   * re-enabled *both* rows while one was still pending. Nothing here keeps an
   * optimistic copy — `onChanged()` re-reads — so this was never the data-loss
   * shape, only a control that came back too early.
   *
   * A set of ids rather than a count per id: the row's control is disabled by
   * `busyStores.has(s.id)`, so one store cannot start a second write while its
   * first is still going.
   */
  const [busyStores, setBusyStores] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [error, setError] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailSaved, setEmailSaved] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [phone, setPhone] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [savingDetails, setSavingDetails] = useState(false);
  const [savedDetails, setSavedDetails] = useState(false);
  const [impact, setImpact] = useState<DeleteImpact | null>(null);
  const [deleting, setDeleting] = useState(false);

  const supabase = createClient();

  /** This rep's assignments, by store. */
  const mineByStore = useMemo(() => {
    const m = new Map<string, Assignment>();
    for (const a of assignments) {
      if (rep && a.rep_id === rep.rep_id) m.set(a.store_id, a);
    }
    return m;
  }, [assignments, rep]);

  /** How many *other* reps cover each store, so reassigning isn't done blind. */
  const otherCover = useMemo(() => {
    const c = new Map<string, number>();
    for (const a of assignments) {
      if (!rep || a.rep_id !== rep.rep_id) {
        c.set(a.store_id, (c.get(a.store_id) ?? 0) + 1);
      }
    }
    return c;
  }, [assignments, rep]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matching = q
      ? stores.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            (s.city ?? "").toLowerCase().includes(q) ||
            (s.group_name ?? "").toLowerCase().includes(q)
        )
      : stores;

    const map = new Map<string, { name: string; stores: StoreOption[] }>();
    for (const s of matching) {
      // Stores with no group still need a home, or they vanish from the UI.
      const key = s.group_id ?? "__ungrouped__";
      const name = s.group_name ?? "Ungrouped";
      if (!map.has(key)) map.set(key, { name, stores: [] });
      map.get(key)!.stores.push(s);
    }
    return [...map.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [stores, query]);

  useEffect(() => {
    if (!open || !rep) return;
    // Reopening on a different rep must reload the form from that rep, not keep
    // the last one's.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFullName(rep.rep_name ?? "");
    setEmail(rep.email ?? "");
    setNewPassword("");
    setEmailSaved(false);
    setPasswordSaved(false);
    setPhone(rep.phone ?? "");
    setJobTitle(rep.job_title ?? "");
    setSavedDetails(false);
    setImpact(null);
  }, [open, rep]);

  // Open the groups this rep already covers; searching opens everything so
  // matches are never hidden behind a collapsed header.
  useEffect(() => {
    if (!open) return;
    if (query.trim()) {
      // Expanding on search is a deliberate one-way nudge — the user may
      // collapse a group again while the query stands.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExpanded(new Set(groups.map((g) => g.key)));
      return;
    }
    const covered = new Set<string>();
    for (const s of stores) {
      if (mineByStore.has(s.id)) covered.add(s.group_id ?? "__ungrouped__");
    }
    setExpanded(covered);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rep?.rep_id, query]);

  async function run(storeId: string, fn: () => Promise<void>) {
    setBusyStores((prev) => new Set(prev).add(storeId));
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      // Only this store's id — another may still be writing, and it clears its own.
      setBusyStores((prev) => {
        const next = new Set(prev);
        next.delete(storeId);
        return next;
      });
    }
  }

  function toggleGroup(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{rep?.rep_name ?? "Rep"}</DialogTitle>
          <DialogDescription>
            Tick a store to assign it to this rep. A store can be covered by
            more than one rep.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {!orgId && (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            Could not determine your organisation — assignments are disabled.
          </p>
        )}

        <div className="space-y-3 rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-foreground">Details</p>
            {rep && !rep.is_active && (
              <Badge variant="destructive">Deactivated</Badge>
            )}
          </div>
          {/* Editable here and nowhere else. The email is the sign-in
              credential and only the admin API can move it, and the role is
              server-controlled — but a misspelt name is an ordinary correction
              a manager should not need help with. */}
          <div className="space-y-1.5">
            <Label htmlFor="rep-name">Full name</Label>
            <Input
              id="rep-name"
              value={fullName}
              placeholder="Kagiso Motlhabane"
              onChange={(e) => {
                setFullName(e.target.value);
                setSavedDetails(false);
              }}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rep-phone">Phone</Label>
              <Input
                id="rep-phone"
                value={phone}
                placeholder="+267 71 000 000"
                onChange={(e) => {
                  setPhone(e.target.value);
                  setSavedDetails(false);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rep-title">Job title</Label>
              <Input
                id="rep-title"
                value={jobTitle}
                placeholder="Field merchandiser"
                onChange={(e) => {
                  setJobTitle(e.target.value);
                  setSavedDetails(false);
                }}
              />
            </div>
          </div>
          {/* Email and password are the sign-in credentials, so both go through
              /api/reps/[id] on the service role — auth.users is not writable
              from the browser, and a profiles-only email change would leave the
              rep signing in with an address the dashboard no longer shows. */}
          <div className="space-y-1.5">
            <Label htmlFor="rep-email">Email</Label>
            <div className="flex gap-2">
              <Input
                id="rep-email"
                type="email"
                value={email}
                placeholder="kagiso@example.com"
                onChange={(e) => {
                  setEmail(e.target.value);
                  setEmailSaved(false);
                }}
              />
              <Button
                variant="outline"
                disabled={
                  savingEmail ||
                  !rep ||
                  !email.trim() ||
                  email.trim().toLowerCase() === (rep?.email ?? "").toLowerCase()
                }
                onClick={async () => {
                  if (!rep) return;
                  setSavingEmail(true);
                  setError(null);
                  try {
                    await changeRepEmail(rep.rep_id, email.trim());
                    setEmailSaved(true);
                    onChanged();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setSavingEmail(false);
                  }
                }}
              >
                {savingEmail ? "Saving…" : emailSaved ? "Changed" : "Change"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              This is what they sign in with. Changing it takes effect
              immediately — tell them.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rep-new-password">Set a new password</Label>
            <div className="flex gap-2">
              <Input
                id="rep-new-password"
                type="text"
                value={newPassword}
                autoComplete="new-password"
                placeholder="At least 8 characters"
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  setPasswordSaved(false);
                }}
              />
              <Button
                variant="outline"
                size="icon"
                title="Generate a password"
                onClick={() => {
                  setNewPassword(generatePassword());
                  setPasswordSaved(false);
                }}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                disabled={savingPassword || !rep || newPassword.length < 8}
                onClick={async () => {
                  if (!rep) return;
                  setSavingPassword(true);
                  setError(null);
                  try {
                    await setRepPassword(rep.rep_id, newPassword);
                    setPasswordSaved(true);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setSavingPassword(false);
                  }
                }}
              >
                {savingPassword ? "Setting…" : passwordSaved ? "Changed" : "Set"}
              </Button>
            </div>
            {passwordSaved ? (
              // Shown here and nowhere else: it is stored hashed, so this is the
              // only moment it can be read.
              <p className="text-xs text-emerald-700 dark:text-emerald-400">
                Password changed. Give them{" "}
                <span className="font-mono text-foreground">{newPassword}</span>{" "}
                now — it cannot be looked up later.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Replaces their current password. There is no way to look up the
                old one.
              </p>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            {rep?.joined_at &&
              `Joined ${new Date(rep.joined_at).toLocaleDateString()}`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              // A blank name is not a correction, it is a rep who becomes
              // "Unnamed rep" everywhere they appear.
              disabled={savingDetails || !rep || !fullName.trim()}
              onClick={async () => {
                if (!rep) return;
                setSavingDetails(true);
                setError(null);
                try {
                  await updateRep(supabase, rep.rep_id, {
                    full_name: fullName.trim(),
                    phone: phone.trim() || null,
                    job_title: jobTitle.trim() || null,
                  });
                  setSavedDetails(true);
                  onChanged();
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setSavingDetails(false);
                }
              }}
            >
              {savingDetails ? "Saving…" : savedDetails ? "Saved" : "Save details"}
            </Button>
            {rep && (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  setError(null);
                  try {
                    await setRepActive(rep.rep_id, !rep.is_active);
                    onChanged();
                    onOpenChange(false);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  }
                }}
              >
                {rep.is_active ? "Deactivate rep" : "Reactivate rep"}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Deactivating keeps their visit history — it only stops new work being
            assigned.
          </p>

          {/* Deleting cascades through visits, audits, photos and workdays, so
              the cost is stated before the destructive button appears. */}
          {rep && !impact && (
            <div className="space-y-1.5 border-t border-border pt-3">
              <Button
                size="sm"
                variant="destructive"
                onClick={async () => {
                  setError(null);
                  try {
                    setImpact(await fetchDeleteImpact(supabase, rep.rep_id));
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  }
                }}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Delete permanently
              </Button>
              <p className="flex items-start gap-1.5 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                This erases the rep and all of their visits, audits and photos.
                It cannot be undone.
              </p>
            </div>
          )}

          {rep && impact && (
            <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3">
              <p className="text-sm font-medium text-destructive">
                Permanently delete {impact.rep_name ?? "this rep"}?
              </p>
              <p className="text-xs text-foreground">
                This also deletes {impact.visits} visit
                {impact.visits === 1 ? "" : "s"}, {impact.submissions} audit
                {impact.submissions === 1 ? "" : "s"}, {impact.photos} photo
                {impact.photos === 1 ? "" : "s"}, {impact.workdays} workday
                {impact.workdays === 1 ? "" : "s"} and {impact.routes} scheduled
                route{impact.routes === 1 ? "" : "s"}. Reports covering those
                dates will change. This cannot be undone.
              </p>
              <p className="text-xs text-muted-foreground">
                Deactivate instead if they have simply left — it keeps the
                history.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={deleting}
                  onClick={async () => {
                    setDeleting(true);
                    setError(null);
                    try {
                      await deleteRep(rep.rep_id);
                      onChanged();
                      onOpenChange(false);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    } finally {
                      setDeleting(false);
                    }
                  }}
                >
                  {deleting ? "Deleting…" : "Yes, delete everything"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setImpact(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>

        <Input
          placeholder="Search chains, stores or cities…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className="divide-y divide-border rounded-md border border-border">
          {groups.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No stores match &ldquo;{query}&rdquo;.
            </p>
          )}

          {groups.map((g) => {
            const isOpen = expanded.has(g.key);
            const assignedHere = g.stores.filter((s) =>
              mineByStore.has(s.id)
            ).length;

            return (
              <div key={g.key}>
                <button
                  type="button"
                  onClick={() => toggleGroup(g.key)}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/50"
                >
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="flex-1 text-sm font-medium text-foreground">
                    {g.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {g.stores.length} {g.stores.length === 1 ? "store" : "stores"}
                  </span>
                  {assignedHere > 0 && (
                    <Badge variant="secondary" className="shrink-0">
                      {assignedHere} assigned
                    </Badge>
                  )}
                </button>

                {isOpen && (
                  <ul className="border-t border-border bg-muted/20">
                    {g.stores.map((s) => {
                      const mine = mineByStore.get(s.id);
                      const others = otherCover.get(s.id) ?? 0;
                      const busy = busyStores.has(s.id);
                      // Shown, not blocked. A rep visiting is how an unverified
                      // location gets fixed, so refusing the assignment would
                      // prevent the only thing that resolves it — but it is
                      // still worth knowing the geofence here cannot be trusted
                      // yet, because the first visits will read as off-site.
                      const unverified = s.location_confirmed_at === null;
                      return (
                        <li
                          key={s.id}
                          className="flex items-center gap-3 px-3 py-2 pl-9"
                        >
                          <Checkbox
                            checked={Boolean(mine)}
                            disabled={busy || !orgId}
                            aria-label={`Assign ${s.name}`}
                            onCheckedChange={() =>
                              run(s.id, () =>
                                mine
                                  ? unassignStore(supabase, mine.id)
                                  : assignStore(supabase, orgId!, s.id, rep!.rep_id)
                              )
                            }
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm text-foreground">
                              {s.name}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {s.city ?? "—"}
                              {others > 0 && (
                                <span className="ml-1.5">
                                  · also covered by {others} other
                                  {others === 1 ? "" : "s"}
                                </span>
                              )}
                              {unverified && (
                                <span className="ml-1.5 text-amber-700 dark:text-amber-400">
                                  · location unverified
                                </span>
                              )}
                            </p>
                          </div>

                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
