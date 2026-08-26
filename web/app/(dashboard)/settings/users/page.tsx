"use client";

import { useCallback, useMemo, useState } from "react";
import { Check, Copy, Eye, EyeOff, Info, RefreshCw, Smartphone, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/hr/field";
import { createClient } from "@/lib/supabase/client";
import { useHrLoad } from "@/lib/hr/use-load";
import { generatePassword } from "@/lib/representatives";
import {
  applyJobRole,
  createUser,
  fetchAccessDirectory,
  groupByArea,
  setPermission,
  type AccessDirectory,
} from "@/lib/access";

/**
 * Users and permissions.
 *
 * A job role is a starting point, not a cage: choosing one ticks its boxes and
 * you then tick or untick individually. That is the QuickBooks arrangement, and
 * it is the reason there is no "CFO" role in the database's role column — the
 * CFO who needs the warehouse and HR but not sales is a set of permissions, not
 * a fifth role waiting to be invented.
 *
 * Mobile access is shown but not tickable, and that is not an oversight. The
 * Android app decides who it lets in by reading `profiles.role` — anybody who
 * is not a `rep` gets the "this is for reps" notice — so it is the job role's
 * base role that grants it, and turning it into a permission needs a Flutter
 * release rather than a migration. Showing it derived is the honest halfway
 * house: an administrator can see who has it and change it by changing the job
 * role, and nothing pretends to be a switch that is not wired up.
 *
 * 🔴 The honesty this screen owes its user: not every tick box is enforced by
 * the database yet. HR, the warehouse and the working day are; the rest still
 * follow the person's underlying role, so unticking one of those changes what
 * they see in the menu and not what they could read through the API. Each
 * permission says which it is, because a security screen that overstates itself
 * is worse than one that admits a gap.
 */
export default function UsersPage() {
  const supabase = createClient();
  const [directory, setDirectory] = useState<AccessDirectory | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await fetchAccessDirectory(supabase);
      setDirectory(data);
      setSelectedId((current) =>
        current && data.users.some((u) => u.id === current)
          ? current
          : (data.users[0]?.id ?? null)
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useHrLoad(load);

  const selected = useMemo(
    () => directory?.users.find((u) => u.id === selectedId) ?? null,
    [directory, selectedId]
  );
  const areas = useMemo(
    () => groupByArea(directory?.permissions ?? []),
    [directory]
  );
  const isAdminUser = selected?.permissions.includes("admin") ?? false;

  async function change(fn: () => Promise<void>, key: string) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (!directory) {
    return error ? (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">Users and permissions</h1>
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <p className="font-medium">Could not load users</p>
          <p className="mt-1">{error}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={load}>
            Retry
          </Button>
        </div>
      </div>
    ) : (
      <div className="h-64 animate-pulse rounded-lg bg-muted/50" />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Users and permissions
          </h1>
          <p className="text-sm text-muted-foreground">
            {directory.users.length} people · a job role ticks the boxes, then
            change any of them
          </p>
        </div>
        <Button className="gap-1.5" onClick={() => setCreating(true)}>
          <UserPlus className="h-4 w-4" /> Add a person
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <Card>
          <CardContent className="p-2">
            <ul className="space-y-0.5">
              {directory.users.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(u.id)}
                    className={
                      "w-full rounded-md px-3 py-2 text-left transition-colors " +
                      (u.id === selectedId ? "bg-muted" : "hover:bg-muted/50")
                    }
                  >
                    <span className="block text-sm font-medium text-foreground">
                      {u.full_name ?? "Unnamed"}
                      {!u.is_active && (
                        <Badge variant="outline" className="ml-2 font-normal">
                          Inactive
                        </Badge>
                      )}
                    </span>
                    <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                      {directory.jobRoles.find((r) => r.id === u.job_role_id)?.name ??
                        "No job role"}
                      {u.role === "rep" && (
                        <Smartphone className="h-3 w-3 shrink-0" aria-label="Uses the mobile app" />
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {selected && (
          <div className="space-y-4">
            <Card>
              <CardContent className="space-y-3 p-5">
                <div>
                  <h2 className="text-sm font-semibold">{selected.full_name}</h2>
                  <p className="text-xs text-muted-foreground">{selected.email}</p>
                </div>
                <Field
                  label="Job role"
                  hint="Choosing one replaces this person's permissions with the template's. Change individual boxes afterwards."
                >
                  <NativeSelect
                    value={selected.job_role_id ?? ""}
                    disabled={busy !== null}
                    onChange={(e) =>
                      change(
                        () => applyJobRole(supabase, selected.id, e.target.value),
                        "role"
                      )
                    }
                  >
                    <option value="" disabled>
                      Choose…
                    </option>
                    {directory.jobRoles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <p className="flex gap-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                  <Smartphone className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {selected.role === "rep" ? (
                    <span>
                      <span className="font-medium text-foreground">
                        Signs in to the Android app.
                      </span>{" "}
                      Check-ins, forms, photos and their round. Granted by the
                      job role, not by a tick box — the app decides by reading
                      the underlying role, so changing this means moving them to
                      or off a field-rep job role.
                    </span>
                  ) : (
                    <span>
                      Does not use the Android app — it shows them the
                      &ldquo;this is for reps&rdquo; notice. Only a job role
                      whose underlying role is <em>rep</em> opens it, and this
                      one&rsquo;s is <em>{selected.role}</em>.
                    </span>
                  )}
                </p>
                {isAdminUser && (
                  <p className="flex gap-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {/* Stated where somebody is about to wonder why the boxes
                        are all ticked and greyed. */}
                    This person is a full administrator, so every permission
                    applies whether it is ticked or not. Administrator can only
                    be granted or removed in the Supabase dashboard, and the last
                    one cannot be removed at all.
                  </p>
                )}
              </CardContent>
            </Card>

            {areas.map((area) => (
              <Card key={area.area}>
                <CardContent className="space-y-3 p-5">
                  <h3 className="text-sm font-semibold">{area.area}</h3>
                  <ul className="space-y-3">
                    {area.permissions.map((p) => {
                      const held = selected.permissions.includes(p.code);
                      const locked = p.code === "admin" || isAdminUser;
                      return (
                        <li key={p.code} className="flex gap-3">
                          <Checkbox
                            className="mt-0.5"
                            checked={held || isAdminUser}
                            disabled={locked || busy !== null}
                            onCheckedChange={(checked) =>
                              change(
                                () =>
                                  setPermission(
                                    supabase,
                                    selected.id,
                                    p.code,
                                    Boolean(checked)
                                  ),
                                p.code
                              )
                            }
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-foreground">
                              {p.label}
                              {!p.data_enforced && (
                                <Badge
                                  variant="outline"
                                  className="ml-2 font-normal"
                                  title="This permission decides what appears in the menu. The data behind it still follows the person's underlying role until that module is converted."
                                >
                                  Menu only
                                </Badge>
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {p.description}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <CreateUserDialog
        open={creating}
        onOpenChange={setCreating}
        jobRoles={directory.jobRoles.filter((r) => r.name !== "Administrator")}
        onCreated={load}
      />
    </div>
  );
}

/**
 * Create a login on a job role.
 *
 * No email is sent. Reps here often have no work email and Supabase rejects the
 * organisation's own domain outright, so whoever creates the account sets a
 * starting password and hands it over — the same arrangement the rep dialog has
 * always used. The password is shown once and never stored client-side.
 *
 * The Administrator template is filtered out by the caller, and the API refuses
 * it too: creating another full administrator is somebody handing out their own
 * level of access, which belongs in the Supabase dashboard where it is
 * deliberate and attributable.
 */
function CreateUserDialog({
  open,
  onOpenChange,
  jobRoles,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobRoles: { id: string; name: string; description: string | null; base_role: string }[];
  onCreated: () => void;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [jobRoleId, setJobRoleId] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(
    null
  );
  const [copied, setCopied] = useState(false);

  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setFullName("");
      setEmail("");
      setPassword("");
      setJobRoleId(jobRoles[0]?.id ?? "");
      setReveal(false);
      setError(null);
      setCreated(null);
      setCopied(false);
    }
  }

  const chosen = jobRoles.find((r) => r.id === jobRoleId) ?? null;

  async function submit() {
    if (!fullName.trim() || !email.trim()) {
      setError("A name and an email address are required.");
      return;
    }
    if (!jobRoleId) {
      setError("Choose a job role.");
      return;
    }
    if (password.length < 8) {
      setError("The password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createUser({
        email: email.trim(),
        fullName: fullName.trim(),
        password,
        jobRoleId,
      });
      setCreated({ email: email.trim(), password });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{created ? "Account created" : "Add a person"}</DialogTitle>
          <DialogDescription>
            {created
              ? "Hand these over now. The password is shown once and cannot be looked up afterwards."
              : "They can sign in immediately. Their permissions come from the job role and you can change any of them afterwards."}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/50 p-3 font-mono text-sm">
              <span>{created.email}</span>
              <span>·</span>
              <span>{reveal ? created.password : "••••••••••••"}</span>
              <Button size="sm" variant="ghost" onClick={() => setReveal((v) => !v)}>
                {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  await navigator.clipboard.writeText(created.password);
                  setCopied(true);
                }}
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Ask them to change it the first time they sign in.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name">
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field
              label="Job role"
              className="sm:col-span-2"
              hint={
                chosen
                  ? `${chosen.description ?? ""}${
                      chosen.base_role === "rep"
                        ? " They will also be able to sign in to the Android app."
                        : " They will not be able to sign in to the Android app."
                    }`.trim()
                  : undefined
              }
            >
              <NativeSelect
                value={jobRoleId}
                onChange={(e) => setJobRoleId(e.target.value)}
              >
                {jobRoles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Starting password" className="sm:col-span-2">
              <div className="flex gap-2">
                <Input
                  type={reveal ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <Button
                  variant="outline"
                  onClick={() => {
                    setPassword(generatePassword());
                    setReveal(true);
                  }}
                  title="Generate a password"
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
                <Button variant="outline" onClick={() => setReveal((v) => !v)}>
                  {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </Field>
          </div>
        )}

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {created ? "Done" : "Cancel"}
          </Button>
          {!created && (
            <Button onClick={submit} disabled={busy}>
              {busy ? "Creating…" : "Create account"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
