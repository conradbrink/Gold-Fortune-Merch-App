"use client";

import { useState } from "react";
import { KeyRound, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WelcomeCard } from "@/components/team/welcome-card";
import { changeRepEmail, generatePassword, setRepPassword } from "@/lib/representatives";
import { displayLogin, isPhoneLogin, normalisePhone, phoneLogin } from "@/lib/phone-login";
import { useCompanyConfig, useTerms } from "@/lib/use-company-config";

/**
 * How someone in the field signs in, and the two fixes an owner needs: a new
 * password (shown once, with the WhatsApp message to send again) and a new
 * number for a phone login, or a phone login for someone who used email.
 * Field and warehouse staff only, as `/api/reps/[id]` allows.
 */
export function SignInPanel({
  person,
  onChanged,
}: {
  person: { id: string; full_name: string | null; email: string | null; phone: string | null };
  onChanged: () => void;
}) {
  const t = useTerms();
  const config = useCompanyConfig();
  const [mode, setMode] = useState<"number" | null>(null);
  const [number, setNumber] = useState("");
  const [password, setPassword] = useState<string | null>(null);
  const [login, setLogin] = useState(person.email ?? "");
  const [phone, setPhone] = useState(person.phone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function newPassword() {
    setBusy(true);
    setError(null);
    const pw = generatePassword();
    try {
      await setRepPassword(person.id, pw, t);
      setPassword(pw);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function changeNumber() {
    setError(null);
    const e164 = normalisePhone(number, config?.settings.country_code || null);
    if (!e164) return setError("That is not a mobile number. Type it as you would dial it, or with its country code (+…).");
    setBusy(true);
    try {
      await changeRepEmail(person.id, phoneLogin(e164), t, e164);
      setLogin(phoneLogin(e164));
      setPhone(e164);
      setMode(null);
      setNumber("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">
        Signs in with <span className="font-medium text-foreground">{displayLogin(login)}</span>
        {isPhoneLogin(login) ? " (their phone number)." : "."}
      </p>
      {password ? (
        <WelcomeCard fullName={person.full_name ?? ""} login={login} phone={phone} password={password} />
      ) : mode === "number" ? (
        <div className="flex flex-wrap gap-2">
          <Input
            type="tel"
            inputMode="tel"
            aria-label="New mobile number"
            placeholder="Mobile number"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            className="max-w-56"
          />
          {/* The company's country reads a number typed as it is dialled, so wait for it. */}
          <Button onClick={changeNumber} disabled={busy || !config}>
            {busy ? "Saving…" : "Save"}
          </Button>
          <Button variant="ghost" onClick={() => setMode(null)} disabled={busy}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={newPassword} disabled={busy}>
            <KeyRound className="mr-1.5 size-4" aria-hidden /> {busy ? "Setting…" : "New password"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setMode("number")} disabled={busy}>
            <Phone className="mr-1.5 size-4" aria-hidden />
            {isPhoneLogin(login) ? "Change number" : "Sign in with a phone number instead"}
          </Button>
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
