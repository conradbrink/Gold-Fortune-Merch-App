"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/hr/field";
import { WelcomeCard } from "@/components/team/welcome-card";
import { createClient } from "@/lib/supabase/client";
import { createUser } from "@/lib/access";
import { generatePassword } from "@/lib/representatives";
import { displayLogin } from "@/lib/phone-login";
import { parseSetup } from "@/lib/setup";
import { useTerms } from "@/lib/use-company-config";
import { lower } from "@/lib/terms";

/** The code of the main field role in every company (as in the wizard's team step). */
const FIELD_ROLE = "sales_rep";

type Mine = { login: string; startedWorkday: boolean };
type Made = { fullName: string; login: string; phone: string | null; password: string };

/**
 * The owner tries the phone app themselves (Stage 7 Part 2c). Today's app lets
 * only field staff in, so Tickd makes the owner a second login on their own
 * mobile number, on the field role, that does not use one of the company's
 * places. Then: install, start a workday, see it on the map.
 */
export function TryItPanel({ onChange }: { onChange?: () => void }) {
  const t = useTerms();
  const [loading, setLoading] = useState(true);
  const [mine, setMine] = useState<Mine | null>(null);
  const [made, setMade] = useState<Made | null>(null);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data, error: setupError } = await supabase.rpc("my_setup");
    const id = setupError ? null : parseSetup(data).ownerTestId;
    if (!id) {
      setMine(null);
      setLoading(false);
      return;
    }
    const [profile, status] = await Promise.all([
      supabase.from("profiles").select("email, is_active").eq("id", id).maybeSingle(),
      supabase.rpc("my_team_status"),
    ]);
    const p = profile.data as { email: string | null; is_active: boolean } | null;
    // A removed test login is as good as none: the owner may make another.
    setMine(
      p && p.is_active
        ? {
            login: p.email ?? "",
            startedWorkday: (status.data ?? []).some((r) => r.profile_id === id && r.started_workday),
          }
        : null
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function make() {
    setError(null);
    if (!phone.trim()) return setError("Type your mobile number.");
    setBusy(true);
    try {
      const supabase = createClient();
      const [{ data: role }, { data: me }] = await Promise.all([
        supabase.from("job_roles").select("id").eq("code", FIELD_ROLE).eq("active", true).maybeSingle(),
        supabase.auth.getUser(),
      ]);
      const roleId = (role as { id: string } | null)?.id;
      if (!roleId) throw new Error(`Your company has no ${lower(t.staff.one)} role to try the app with.`);
      const fullName = (me.user?.user_metadata?.full_name as string | undefined)?.trim() || "Me";
      const password = generatePassword();
      const created = await createUser({ fullName, phone: phone.trim(), password, jobRoleId: roleId, ownerTest: true });
      setMade({ fullName, login: created.login, phone: created.phone, password });
      await load();
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const steps = (
    <ol className="space-y-2 text-sm text-foreground">
      <li className="flex gap-2.5">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">1</span>
        Install the app on your phone and sign in with your test login.
      </li>
      <li className="flex gap-2.5">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">2</span>
        Tap &ldquo;Start {lower(t.workday.one)}&rdquo;. Check in at one of your {lower(t.site.many)} and take a photo, if you like.
      </li>
      <li className="flex gap-2.5">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">3</span>
        Come back here and see your {lower(t.workday.one)} on the map.
      </li>
    </ol>
  );

  if (made) {
    return (
      <div className="space-y-4">
        <p className="text-sm font-medium text-foreground">
          Your test login is ready. Send it to your phone; the password is shown only once.
        </p>
        <WelcomeCard fullName={made.fullName} login={made.login} phone={made.phone} password={made.password} />
        <p className="text-xs text-muted-foreground">This is the same message your {lower(t.staff.many)} get.</p>
        {steps}
      </div>
    );
  }

  if (mine) {
    return mine.startedWorkday ? (
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          <CheckCircle2 className="size-4 text-primary" aria-hidden /> You started a {lower(t.workday.one)} on your phone.
        </p>
        <Button nativeButton={false} render={<Link href="/tracking" />}>
          See it on your map <ArrowRight className="ml-1.5 size-4" aria-hidden />
        </Button>
      </div>
    ) : (
      <div className="space-y-4">
        <p className="text-sm text-foreground">
          Your test login is <span className="font-medium">{displayLogin(mine.login)}</span>.
        </p>
        {steps}
        <p className="text-xs text-muted-foreground">
          Lost the password? Set a new one in{" "}
          <Link href="/settings/users" className="underline">
            Settings → Users
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        See exactly what your {lower(t.staff.many)} will see. Tickd makes you a second login on your own mobile number, just
        for trying. It doesn&rsquo;t use one of your places.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="Your mobile number" htmlFor="try-it-phone" className="sm:flex-1">
          <Input
            id="try-it-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void make();
            }}
          />
        </Field>
        <Button onClick={make} disabled={busy}>
          <Smartphone className="mr-1.5 size-4" aria-hidden /> {busy ? "Making your login…" : "Make my test login"}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
