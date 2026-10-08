"use client";

import { useEffect, useState } from "react";
import { Smartphone, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Field } from "@/components/hr/field";
import { StepCard } from "@/components/setup/step-card";
import { WelcomeCard } from "@/components/team/welcome-card";
import { createClient } from "@/lib/supabase/client";
import { createUser } from "@/lib/access";
import { generatePassword } from "@/lib/representatives";
import { displayLogin } from "@/lib/phone-login";
import { useTerms } from "@/lib/use-company-config";
import { lower } from "@/lib/terms";
import type { StepProps } from "./types";

type Role = { id: string; code: string | null; name: string; description: string | null; base_role: string };
type Person = { id: string; full_name: string | null; email: string | null };
type Made = { fullName: string; login: string; phone: string | null; password: string };

/** The code of the main field role in every company (roles research: one of the two fixed anchors). */
const FIELD_ROLE = "sales_rep";

/**
 * Logins for the team, one person at a time: a name and a mobile number,
 * the field role already picked, a password made for them, and the code that
 * installs the app, scanned from the owner's screen. No email needed.
 */
export function TeamStep({ setup, text, icon, onBack, onNext, reload }: StepProps) {
  const t = useTerms();
  const [roles, setRoles] = useState<Role[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "", roleId: "" });
  const [withEmail, setWithEmail] = useState(false);
  const [made, setMade] = useState<Made | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadPeople() {
    const { data } = await createClient()
      .from("profiles")
      .select("id, full_name, email")
      .eq("is_active", true)
      .order("created_at");
    setPeople((data ?? []) as Person[]);
  }

  useEffect(() => {
    void (async () => {
      const supabase = createClient();
      const [user, list] = await Promise.all([
        supabase.auth.getUser(),
        supabase
          .from("job_roles")
          .select("id, code, name, description, base_role")
          .eq("active", true)
          .order("sort_order")
          .order("name"),
      ]);
      setMe(user.data.user?.id ?? null);
      // Never the administrator: a second one is added by us, deliberately.
      const offered = ((list.data ?? []) as Role[]).filter((r) => r.code !== "administrator");
      setRoles(offered);
      setForm((f) => ({ ...f, roleId: offered.find((r) => r.code === FIELD_ROLE)?.id ?? offered[0]?.id ?? "" }));
      await loadPeople();
    })();
    // Once, on opening the step.
  }, []);

  async function add() {
    setError(null);
    if (!form.name.trim()) return setError("Type their name.");
    if (!form.phone.trim() && !form.email.trim()) return setError("Type their mobile number.");
    if (!form.roleId) return setError("Choose what they do.");
    setBusy(true);
    const password = generatePassword();
    try {
      const created = await createUser({
        fullName: form.name.trim(),
        phone: form.phone.trim(),
        email: withEmail ? form.email.trim() : "",
        password,
        jobRoleId: form.roleId,
      });
      setMade({ fullName: form.name.trim(), login: created.login, phone: created.phone, password });
      setForm((f) => ({ ...f, name: "", phone: "", email: "" }));
      await Promise.all([loadPeople(), reload()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const chosen = roles.find((r) => r.id === form.roleId);
  const others = people.filter((p) => p.id !== me);

  return (
    <StepCard
      icon={icon}
      title={text.title}
      subtitle={text.subtitle}
      time={text.time}
      onBack={onBack}
      onContinue={onNext}
      busy={busy}
      error={error}
    >
      <div className="space-y-5">
        {setup.places && (
          <p className="text-sm text-muted-foreground">
            {setup.places.used} of {setup.places.limit} places used
            {setup.places.used >= setup.places.limit ? ". Every place is taken." : "."}
          </p>
        )}

        {others.length > 0 && (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {others.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span className="font-medium text-foreground">{p.full_name ?? "Unnamed"}</span>
                <span className="truncate text-muted-foreground">{displayLogin(p.email)}</span>
              </li>
            ))}
          </ul>
        )}

        {made ? (
          <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
            <p className="text-sm font-medium text-foreground">
              {made.fullName} can sign in now. Show them this, or copy it to send. The password is shown only once.
            </p>
            <WelcomeCard fullName={made.fullName} login={made.login} phone={made.phone} password={made.password} />
            <Button variant="outline" onClick={() => setMade(null)}>
              <UserPlus className="mr-1.5 size-4" aria-hidden /> Add another
            </Button>
          </div>
        ) : (
          <div className="space-y-4 rounded-xl border border-border p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="setup-person-name">
                <Input id="setup-person-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="Mobile number" htmlFor="setup-person-phone" hint="They sign in with it. No email needed.">
                <Input
                  id="setup-person-phone"
                  type="tel"
                  inputMode="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </Field>
              {withEmail && (
                <Field label="Email (they sign in with this instead)" htmlFor="setup-person-email" className="sm:col-span-2">
                  <Input
                    id="setup-person-email"
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </Field>
              )}
              <Field
                label="What they do"
                htmlFor="setup-person-role"
                className="sm:col-span-2"
                hint={
                  chosen
                    ? chosen.base_role === "rep"
                      ? "Uses the phone app."
                      : "Works in the office, on the web. Not on the phone app."
                    : undefined
                }
              >
                <NativeSelect id="setup-person-role" value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={add} disabled={busy}>
                <Smartphone className="mr-1.5 size-4" aria-hidden /> {busy ? "Making the login…" : "Make their login"}
              </Button>
              {!withEmail && (
                <button type="button" onClick={() => setWithEmail(true)} className="text-sm text-primary hover:underline">
                  They have an email address
                </button>
              )}
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Add the rest of your {lower(t.staff.many)} now or later in Settings → Users. Need a second administrator, such
          as a partner? Ask us and we add it for you.
        </p>
      </div>
    </StepCard>
  );
}
