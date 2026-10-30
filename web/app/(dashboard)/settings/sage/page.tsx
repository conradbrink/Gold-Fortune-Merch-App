"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { createClient } from "@/lib/supabase/client";
import { useCompanyConfig, useTerms } from "@/lib/use-company-config";
import type { SageCompanyChoice } from "@/lib/accounting/connect";
import { SettingsPage, SettingsSection, SettingsSurface } from "@/components/settings/settings-section";

type Connection = {
  company_name: string;
  sign_in_name: string | null;
  bank_account_name: string | null;
  sync_from: string;
  last_sent_at: string | null;
  last_error: string | null;
  paused_until: string | null;
};

type Problem = {
  id: string;
  kind: string;
  label: string;
  last_error: string | null;
};

type Counts = { sent: number; waiting: number; failed: number };

const KIND: Record<string, string> = {
  invoice: "Invoice",
  credit_note: "Credit note",
  payment: "Payment",
  payment_removed: "Payment removed",
  invoice_voided: "Voided invoice",
};

/** "30 Oct, 14:05" in the company's time zone. */
function when(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString("en-ZA", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  });
}

/** A date column as "30 Oct 2026", the same day for everyone. */
function day(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

async function post(body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch("/api/accounting/sage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data };
}

/**
 * Settings > Sage: the company's invoices, credit notes and payments go into
 * its Sage Business Cloud Accounting by themselves (lib/accounting/sync.ts).
 *
 * Shown only to companies with the Accounting sync add-on (lib/modules.ts).
 * Connecting is a Sage login, then where things go: the company (chosen for
 * them when the login has one), the bank account payments go into (Sage's
 * default chosen for them) and the day to send from (today unless they pick
 * earlier). Connected, the page says what reached Sage and lists only what
 * needs them, each with the fix in a sentence and one button.
 */
export default function SageSettingsPage() {
  const config = useCompanyConfig();
  const orgId = config?.orgId ?? null;
  const timeZone = config?.timezone ?? "Africa/Johannesburg";

  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [counts, setCounts] = useState<Counts>({
    sent: 0,
    waiting: 0,
    failed: 0,
  });
  const [problems, setProblems] = useState<Problem[]>([]);
  const [reconnecting, setReconnecting] = useState(false);
  // Bumped to read everything again after a change.
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const count = (statuses: string[]) =>
        supabase
          .from("accounting_queue")
          .select("id", { count: "exact", head: true })
          .eq("org_id", orgId)
          .in("status", statuses);
      const [conn, sent, waiting, failed, list] = await Promise.all([
        supabase
          .from("accounting_connections")
          .select("company_name, sign_in_name, bank_account_name, sync_from, last_sent_at, last_error, paused_until")
          .eq("org_id", orgId)
          .maybeSingle(),
        count(["sent"]),
        count(["queued", "sending"]),
        count(["failed"]),
        supabase
          .from("accounting_queue")
          .select("id, kind, label, last_error")
          .eq("org_id", orgId)
          .eq("status", "failed")
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
      if (cancelled) return;
      const err = conn.error ?? list.error;
      if (err) {
        setLoadError(`The Sage connection could not be loaded (${err.message}).`);
        return;
      }
      setConnection((conn.data as Connection | null) ?? null);
      setCounts({
        sent: sent.count ?? 0,
        waiting: waiting.count ?? 0,
        failed: failed.count ?? 0,
      });
      setProblems((list.data as Problem[] | null) ?? []);
      setLoadError(null);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, version]);

  if (loadError) {
    return (
      <SettingsPage title="Sage">
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {loadError}
        </p>
      </SettingsPage>
    );
  }

  if (!loaded) {
    return (
      <SettingsPage title="Sage">
        <div
          className="h-72 animate-pulse rounded-xl border border-border bg-muted/30"
          aria-label="Loading the Sage connection"
        />
      </SettingsPage>
    );
  }

  if (!connection || reconnecting) {
    return (
      <SettingsPage title="Sage">
        <ConnectForm
          email={connection?.sign_in_name ?? ""}
          onCancel={connection ? () => setReconnecting(false) : null}
          onConnected={() => {
            setReconnecting(false);
            reload();
          }}
        />
      </SettingsPage>
    );
  }

  // 'infinity' (Postgres) when Sage refused the sign-in: stopped until they connect again.
  const forGood = connection.paused_until === "infinity";
  const paused = forGood || (connection.paused_until !== null && new Date(connection.paused_until) > new Date());

  return (
    <SettingsPage title="Sage">
      <SettingsSurface>
        {paused && (
          <div
            role="status"
            className="flex flex-wrap items-center gap-3 bg-amber-50 px-5 py-4 text-sm text-amber-950 sm:px-6 dark:bg-amber-950/30 dark:text-amber-100"
          >
            <p className="mr-auto text-pretty">
              {connection.last_error ?? "Sending to Sage has stopped."}
              {!forGood &&
                connection.paused_until &&
                ` Sending starts again at ${when(connection.paused_until, timeZone)}.`}
            </p>
            {forGood && (
              <Button size="sm" onClick={() => setReconnecting(true)}>
                Connect again
              </Button>
            )}
          </div>
        )}
        <SettingsSection
          id="sage-connection"
          title="Connection"
          description="Your invoices, credit notes and payments go into Sage by themselves, a few minutes after they are made."
        >
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Fact term="Company" value={connection.company_name} />
            <Fact term="Signed in as" value={connection.sign_in_name ?? "Sage ID"} />
            <Fact term="Payments go into" value={connection.bank_account_name ?? "Not chosen"} />
            <Fact term="Sending from" value={day(connection.sync_from)} />
            <Fact
              term="Last sent"
              value={connection.last_sent_at ? when(connection.last_sent_at, timeZone) : "Nothing yet"}
            />
          </dl>
        </SettingsSection>
        <SettingsSection id="sage-sent" title="Sent to Sage">
          <dl className="grid grid-cols-3 gap-4">
            <Count term="In Sage" value={counts.sent} />
            <Count term="Waiting" value={counts.waiting} />
            <Count term="Needs you" value={counts.failed} />
          </dl>
        </SettingsSection>
        <SettingsSection
          id="sage-problems"
          title="Needs you"
          description="Sage turned these down, or they need doing in Sage too."
        >
          {problems.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing needs you. Anything Sage turns down shows here, with what to do about it.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {problems.map((p) => (
                <ProblemRow key={p.id} problem={p} onDone={reload} />
              ))}
            </ul>
          )}
        </SettingsSection>
        <SettingsSection
          id="sage-disconnect"
          title="Disconnect"
          description="Nothing more goes to Sage until you connect again. What is already in Sage stays there."
        >
          <DisconnectButton onDone={reload} />
        </SettingsSection>
      </SettingsSurface>
    </SettingsPage>
  );
}

function Fact({ term, value }: { term: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}

function Count({ term, value }: { term: string; value: number }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-sm text-muted-foreground">{term}</dt>
      <dd className="text-2xl font-semibold tabular-nums text-foreground">{value.toLocaleString("en-ZA")}</dd>
    </div>
  );
}

function ProblemRow({ problem, onDone }: { problem: Problem; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const voided = problem.kind === "invoice_voided";

  async function answer() {
    setBusy(true);
    setError(null);
    const { error: e } = await createClient().rpc("accounting_retry", {
      p_id: problem.id,
    });
    setBusy(false);
    if (e) return setError(e.message);
    onDone();
  }

  return (
    <li className="flex flex-wrap items-start gap-3 px-4 py-3">
      <div className="mr-auto min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-foreground">
          {KIND[problem.kind] ?? "Document"} {problem.label}
        </p>
        <p className="text-sm text-pretty text-muted-foreground">{problem.last_error ?? "Sage did not take it."}</p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void answer()}>
        {busy ? "Saving…" : voided ? "Done" : "Try again"}
      </Button>
    </li>
  );
}

function DisconnectButton({ onDone }: { onDone: () => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function disconnect() {
    setBusy(true);
    setError(null);
    const { ok, data } = await post({ step: "disconnect" });
    setBusy(false);
    if (!ok) return setError(String(data.error ?? "Not disconnected."));
    setAsking(false);
    onDone();
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {asking ? (
        <>
          <Button variant="destructive" disabled={busy} onClick={() => void disconnect()}>
            {busy ? "Disconnecting…" : "Yes, disconnect"}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => setAsking(false)}>
            Keep it
          </Button>
        </>
      ) : (
        <Button variant="outline" onClick={() => setAsking(true)}>
          Disconnect
        </Button>
      )}
      <p aria-live="polite" className="text-sm text-destructive">
        {error ?? ""}
      </p>
    </div>
  );
}

function ConnectForm({
  email,
  onCancel,
  onConnected,
}: {
  email: string;
  onCancel: (() => void) | null;
  onConnected: () => void;
}) {
  const [username, setUsername] = useState(email);
  const [password, setPassword] = useState("");
  const [companies, setCompanies] = useState<SageCompanyChoice[] | null>(null);
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [bankAccountId, setBankAccountId] = useState<number | null>(null);
  const [syncFrom, setSyncFrom] = useState("");
  const [today, setToday] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useTerms();

  const company = companies?.find((c) => c.id === companyId) ?? null;

  function chooseCompany(next: SageCompanyChoice | null) {
    setCompanyId(next?.id ?? null);
    setBankAccountId(next?.bankAccounts.find((b) => b.isDefault)?.id ?? next?.bankAccounts[0]?.id ?? null);
  }

  async function check() {
    setBusy(true);
    setError(null);
    const { ok, data } = await post({ step: "check", username, password });
    setBusy(false);
    if (!ok) return setError(String(data.error ?? "Sage could not be checked."));
    const list = (data.companies as SageCompanyChoice[]) ?? [];
    setCompanies(list);
    setToday(String(data.today ?? ""));
    setSyncFrom(String(data.today ?? ""));
    chooseCompany(list[0] ?? null);
  }

  async function connect() {
    setBusy(true);
    setError(null);
    const { ok, data } = await post({
      step: "connect",
      username,
      password,
      companyId,
      bankAccountId,
      syncFrom,
    });
    setBusy(false);
    if (!ok) return setError(String(data.error ?? "Sage was not connected."));
    setPassword("");
    onConnected();
  }

  return (
    <SettingsSurface>
      <SettingsSection
        id="sage-login"
        title="Sage login"
        description="Your invoices, credit notes and payments go into Sage by themselves, a few minutes after they are made."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="sage-email">Sage email</Label>
            <Input
              id="sage-email"
              type="email"
              autoComplete="off"
              value={username}
              disabled={busy || companies !== null}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sage-password">Sage password</Label>
            <Input
              id="sage-password"
              type="password"
              autoComplete="new-password"
              value={password}
              disabled={busy || companies !== null}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <p id="sage-login-hint" className="text-sm text-pretty text-muted-foreground sm:col-span-2">
            Best is a separate Sage user made for Tickd, so you can switch it off in Sage at any time. Tickd keeps the
            password locked away and only uses it to send your documents.
          </p>
        </div>
      </SettingsSection>

      {companies && (
        <SettingsSection
          id="sage-where"
          title="Where it goes"
          description={`${t.client.many} are matched to Sage by name, and products by product code. Anything Sage does not have yet is added.`}
        >
          <div className="grid gap-5 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="sage-company">Company</Label>
              {companies.length === 1 ? (
                <p id="sage-company" className="py-2 text-sm font-medium text-foreground">
                  {companies[0].name}
                </p>
              ) : (
                <NativeSelect
                  id="sage-company"
                  value={companyId ?? ""}
                  disabled={busy}
                  onChange={(e) => chooseCompany(companies.find((c) => c.id === Number(e.target.value)) ?? null)}
                >
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sage-bank">Payments go into</Label>
              <NativeSelect
                id="sage-bank"
                value={bankAccountId ?? ""}
                disabled={busy || !company || company.bankAccounts.length === 0}
                onChange={(e) => setBankAccountId(Number(e.target.value) || null)}
              >
                {(company?.bankAccounts ?? []).length === 0 && <option value="">None</option>}
                {(company?.bankAccounts ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </NativeSelect>
              {company && company.bankAccounts.length === 0 && (
                <p role="alert" className="text-xs text-pretty text-destructive">
                  This Sage company has no bank account yet. Add one in Sage under Banking, then press Back and Next.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sage-from">Send from</Label>
              <Input
                id="sage-from"
                type="date"
                value={syncFrom}
                max={today || undefined}
                disabled={busy}
                aria-describedby="sage-from-hint"
                onChange={(e) => setSyncFrom(e.target.value)}
              />
              <p id="sage-from-hint" className="text-xs text-muted-foreground">
                Invoices from this day on go to Sage.
              </p>
            </div>
          </div>
        </SettingsSection>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3 px-5 py-3 sm:px-6">
        <p aria-live="polite" className={`mr-auto text-sm ${error ? "text-destructive" : "text-muted-foreground"}`}>
          {error ?? ""}
        </p>
        {companies && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              setCompanies(null);
              setError(null);
            }}
          >
            Back
          </Button>
        )}
        {onCancel && !companies && (
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        )}
        {companies ? (
          <Button disabled={busy || !companyId || !bankAccountId || !syncFrom} onClick={() => void connect()}>
            {busy ? "Connecting…" : "Connect"}
          </Button>
        ) : (
          <Button disabled={busy || !username.trim() || !password} onClick={() => void check()}>
            {busy ? "Checking…" : "Next"}
          </Button>
        )}
      </div>
    </SettingsSurface>
  );
}
