import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  companyClosure,
  companyInternalSettings,
  companyRecentEmails,
  companyRecord,
  companyTerms,
  companyTrialEnd,
  getCompany,
  type InternalSetting,
} from "@/lib/platform";
import { extendTrial, setCompanyModule, setCompanyRecord, setCompanySetting, setCompanyTerms } from "@/app/platform/actions";
import { customerAlsoSets, groupSettings, patternChoices, settingText } from "@/lib/control-centre";
import { ALERT_RULES, ruleLabels } from "@/lib/alerts";
import { DEFAULT_TERMS } from "@/lib/terms";
import { termShown } from "@/lib/settings-tabs";
import { toModuleSet } from "@/lib/modules";
import { ClosePanel } from "./close-panel";
import { trialState } from "@/lib/onboarding";

/**
 * Platform operator: one company's set-up. Its modules, switchable; the
 * settings Tickd sets up for it (so the company's own Settings stay short:
 * Business, Team & Work, Notifications, Plan); the details on its tax
 * invoices; the words Tickd uses for it; and its last emails.
 *
 * Gated like `/platform`: a session is required by the proxy, and
 * `is_platform_admin()` is asked here before anything is read; everyone else
 * gets a 404. The switches post to `setCompanyModule`, which checks again —
 * this page hiding them is not what protects them. At the foot, closing the
 * company (or reopening a closed one), through `setCompanyClosed`.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Platform · Company" };

const dateTime = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

export default async function PlatformCompanyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: isOperator, error } = await supabase.rpc("is_platform_admin");
  if (error) throw error;
  if (!isOperator) notFound();

  const { id } = await params;
  // Not a company id at all: a 404, not a database cast error and a 500.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const [company, trialEndsAt, internal, closure, record, terms, emails] = await Promise.all([
    getCompany(id),
    companyTrialEnd(id),
    companyInternalSettings(id),
    companyClosure(id),
    companyRecord(id),
    companyTerms(id),
    companyRecentEmails(id),
  ]);
  if (!company || !record) notFound();
  const trial = trialState(trialEndsAt);
  const modules = toModuleSet(Object.fromEntries(company.modules.map((m) => [m.code, m.enabled])));

  const query = await searchParams;
  const refusal = typeof query.error === "string" ? query.error : null;
  // The setting just saved (or refused): its group opens again.
  const touched = typeof query.setting === "string" ? query.setting : null;

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-8">
      <header className="space-y-1">
        <Link href="/platform/companies" className="text-sm text-muted-foreground hover:underline">
          ← Companies
        </Link>
        <h1 className="text-2xl font-bold text-foreground">{company.name}</h1>
        {company.industries.length > 0 && (
          <p className="text-sm text-foreground">
            {company.industries
              .map((i) => (i.version === null ? i.name : `${i.name} (v${i.version})`))
              .join(" + ")}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          Modules switched here take effect on the company&apos;s next page load,
          and on phones at their next refresh. Every change is logged.
        </p>
      </header>

      {closure && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Closed {dateTime.format(new Date(closure.closedAt))} UTC
          {closure.reason ? ` · ${closure.reason}` : ""}. Its people can&apos;t sign in and nothing is sent for it.
          Reopen it at the foot of this page.
        </p>
      )}

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
        <p className="text-sm text-foreground">
          {trial.kind === "none"
            ? "Not on a free pilot (free by arrangement, or paying)."
            : trial.kind === "ended"
              ? `Free pilot ended ${dateTime.format(new Date(trialEndsAt!))} UTC.`
              : `Free pilot ends ${dateTime.format(new Date(trialEndsAt!))} UTC (${trial.daysLeft} ${trial.daysLeft === 1 ? "day" : "days"} left).`}
        </p>
        <form action={extendTrial} className="flex items-center gap-2">
          <input type="hidden" name="orgId" value={company.id} />
          <label className="text-sm text-muted-foreground" htmlFor="extend-days">
            {trial.kind === "none" ? "Start a trial of" : "Extend by"}
          </label>
          <input
            id="extend-days"
            name="days"
            type="number"
            min={1}
            max={365}
            required
            className="h-8 w-20 rounded-md border border-border bg-transparent px-2 text-sm"
          />
          <span className="text-sm text-muted-foreground">days</span>
          <button
            type="submit"
            className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-secondary"
          >
            Save
          </button>
        </form>
      </section>

      {refusal && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Not changed: {refusal}
        </p>
      )}

      <ul className="divide-y divide-border rounded-lg border border-border bg-card">
        {company.modules.map((m) => (
          <li key={m.code} className="flex items-start justify-between gap-4 p-4">
            <div className="space-y-1">
              <p className="font-medium text-foreground">
                {m.name}{" "}
                <span className="text-xs font-normal text-muted-foreground">({m.planType})</span>
              </p>
              <p className="text-sm text-muted-foreground">{m.description}</p>
              {m.requires.length > 0 && (
                <p className="text-xs text-muted-foreground">Needs: {m.requires.join(", ")}</p>
              )}
            </div>
            <div className="shrink-0">
              {m.planType === "core" ? (
                <span className="text-sm text-muted-foreground">Always on</span>
              ) : !m.isBuilt ? (
                <span className="text-sm text-muted-foreground">Not built yet</span>
              ) : (
                <form action={setCompanyModule}>
                  <input type="hidden" name="orgId" value={company.id} />
                  <input type="hidden" name="module" value={m.code} />
                  <input type="hidden" name="enabled" value={m.enabled ? "false" : "true"} />
                  <button
                    type="submit"
                    className={
                      m.enabled
                        ? "inline-flex h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-secondary"
                        : "inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm text-primary-foreground hover:bg-primary/90"
                    }
                  >
                    {m.enabled ? "On · switch off" : "Off · switch on"}
                  </button>
                </form>
              )}
            </div>
          </li>
        ))}
      </ul>

      {/* What Tickd sets up for this company. The company never sees these
          (its Settings show only what an owner decides) and the database
          refuses its writes to the internal ones; each action checks the
          operator again and logs the change. */}
      <section id="settings" className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-foreground">Settings Tickd sets up</h2>
          <p className="text-sm text-muted-foreground">
            Seeded from the trade when the company was made. Leave the defaults unless there is a reason. A few
            the company can also change in a simpler form, as each one says.
          </p>
        </div>
        {groupSettings(internal).map((g) => (
          <details
            key={g.id}
            open={g.settings.some((x) => x.key === touched)}
            className="group rounded-lg border border-border bg-card"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 text-sm font-medium text-foreground">
              {g.title}
              <span className="text-xs font-normal text-muted-foreground">
                {g.settings.filter((x) => x.value !== null).length} of {g.settings.length} set for this company
              </span>
            </summary>
            <ul className="divide-y divide-border border-t border-border">
              {g.settings.map((x) => (
                <SettingRow key={x.key} orgId={company.id} setting={x} />
              ))}
            </ul>
          </details>
        ))}
      </section>

      <section id="record" className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-foreground">Invoices, tax and the schedule</h2>
          <p className="text-sm text-muted-foreground">
            Printed on their quotes and invoices; an invoice already issued keeps what it was issued with. The company
            fills these in once, in its set-up wizard.
          </p>
        </div>
        <form action={setCompanyRecord} className="space-y-4 rounded-lg border border-border bg-card p-4">
          <input type="hidden" name="orgId" value={company.id} />
          <div className="grid gap-4 sm:grid-cols-3">
            <RecordInput name="registration_number" label="Registration number" value={record.registration_number} />
            <RecordInput name="tax_number" label="Taxpayer number (TIN)" value={record.tax_number} />
            <RecordInput name="vat_number" label="VAT number" value={record.vat_number} />
            <RecordInput name="vat_rate" label="VAT rate (%)" value={record.vat_rate} inputMode="decimal" />
            <RecordSelect
              name="prices_include_vat"
              label="Prices include VAT"
              value={record.prices_include_vat ? "true" : "false"}
              options={[["false", "No"], ["true", "Yes"]]}
            />
            <RecordInput name="invoice_terms_days" label="Invoices due after (days)" value={record.invoice_terms_days} inputMode="numeric" />
            <RecordInput name="invoice_prefix" label="Invoice prefix" value={record.invoice_prefix} />
            <RecordInput name="quote_prefix" label="Quote prefix" value={record.quote_prefix} />
            <RecordInput name="quote_validity_days" label="Quotes valid for (days)" value={record.quote_validity_days} inputMode="numeric" />
            <RecordSelect
              name="default_visit_frequency"
              label="Default visit frequency"
              value={String(record.default_visit_frequency ?? "weekly")}
              options={[["weekly", "Weekly"], ["biweekly", "Every two weeks"], ["monthly", "Monthly"]]}
            />
            <RecordInput name="industry" label="Industry (free text)" value={record.industry} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <RecordText name="bank_details" label="Bank details" value={record.bank_details} />
            <RecordText name="invoice_footer" label="Invoice footer" value={record.invoice_footer} />
          </div>
          <button
            type="submit"
            className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-secondary"
          >
            Save
          </button>
        </form>
      </section>

      <section id="words" className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-foreground">Words</h2>
          <p className="text-sm text-muted-foreground">
            What Tickd calls things for this company. Blank, or the catalogue&apos;s own words, means the default.
          </p>
        </div>
        <form action={setCompanyTerms} className="space-y-3 rounded-lg border border-border bg-card p-4">
          <input type="hidden" name="orgId" value={company.id} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1.5 pr-3 font-medium">Word</th>
                  <th className="py-1.5 pr-3 font-medium">One</th>
                  <th className="py-1.5 pr-3 font-medium">Many</th>
                  <th className="py-1.5 font-medium">a / an</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {terms.filter((w) => termShown(w.key, modules)).map((w) => (
                  <tr key={w.key}>
                    <td className="py-1.5 pr-3 text-foreground" title={w.description}>
                      {w.singular}
                    </td>
                    <td className="py-1.5 pr-3">
                      <input
                        name={`${w.key}.one`}
                        aria-label={`${w.singular}, one`}
                        defaultValue={w.own?.singular ?? ""}
                        placeholder={w.singular}
                        className="h-8 w-full rounded-md border border-border bg-transparent px-2"
                      />
                    </td>
                    <td className="py-1.5 pr-3">
                      <input
                        name={`${w.key}.many`}
                        aria-label={`${w.singular}, many`}
                        defaultValue={w.own?.plural ?? ""}
                        placeholder={w.plural}
                        className="h-8 w-full rounded-md border border-border bg-transparent px-2"
                      />
                    </td>
                    <td className="py-1.5">
                      <select
                        name={`${w.key}.article`}
                        aria-label={`${w.singular}, article`}
                        defaultValue={(w.own ?? w).article ?? ""}
                        className="h-8 rounded-md border border-border bg-transparent px-2"
                      >
                        <option value="a">a</option>
                        <option value="an">an</option>
                        <option value="">auto</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="submit"
            className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-secondary"
          >
            Save words
          </button>
        </form>
      </section>

      <section id="emails" className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Recent emails (UTC)</h2>
        {emails.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing sent yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card text-sm">
            {emails.map((m) => (
              <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-4 py-2">
                <span className="min-w-0 truncate">
                  <span className="font-medium text-foreground">{m.template}</span>
                  <span className="text-muted-foreground"> to {m.toAddress}</span>
                </span>
                <span className="flex items-baseline gap-2">
                  <span className={m.status === "failed" ? "text-destructive" : "text-muted-foreground"} title={m.lastError ?? undefined}>
                    {m.status}
                    {m.lastError ? ` · ${m.lastError}` : ""}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {dateTime.format(new Date(m.sentAt ?? m.createdAt))}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ClosePanel orgId={company.id} name={company.name} closed={closure !== null} />

      {company.recentChanges.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">Recent changes (UTC)</h2>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {company.recentChanges.map((c, i) => (
              <li key={i}>
                {dateTime.format(new Date(c.createdAt))} · {c.action} ·{" "}
                {JSON.stringify(c.detail)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function SettingRow({ orgId, setting: s }: { orgId: string; setting: InternalSetting }) {
  const current = s.value ?? s.defaultValue;
  const shown = settingText(current);
  const choices = s.valueType === "text" ? patternChoices(s.pattern) : null;
  const rules = s.key === "alerts_on" ? ruleLabels(DEFAULT_TERMS) : null;
  const field = "h-8 rounded-md border border-border bg-transparent px-2 text-sm";
  return (
    <li className="flex flex-wrap items-start justify-between gap-4 p-4">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium text-foreground">
          {s.label}{" "}
          <span className="text-xs font-normal text-muted-foreground">
            ({s.value === null ? "default" : `set for this company; default ${settingText(s.defaultValue)}`}
            {customerAlsoSets(s.key) ? `; they can change it too, in ${customerAlsoSets(s.key)}` : ""})
          </span>
        </p>
        <p className="text-sm text-muted-foreground">{s.description}</p>
        {rules && (
          <ul className="text-xs text-muted-foreground">
            {ALERT_RULES.map((r) => (
              <li key={r}>
                <code>{r}</code>: {rules[r].label}
              </li>
            ))}
          </ul>
        )}
      </div>
      <form action={setCompanySetting} className="flex items-center gap-2">
        <input type="hidden" name="orgId" value={orgId} />
        <input type="hidden" name="key" value={s.key} />
        {s.valueType === "boolean" ? (
          <select name="value" aria-label={s.label} defaultValue={String(current === true)} className={`${field} w-28`}>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        ) : choices ? (
          <select name="value" aria-label={s.label} defaultValue={shown} className={`${field} w-40`}>
            {(choices.includes(shown) ? choices : [shown, ...choices]).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        ) : (
          <input
            name="value"
            aria-label={s.label}
            defaultValue={shown}
            required={s.valueType !== "text"}
            type={s.valueType === "integer" ? "number" : s.valueType === "time" ? "time" : "text"}
            min={s.valueType === "integer" && s.min !== null ? s.min : undefined}
            max={s.valueType === "integer" && s.max !== null ? s.max : undefined}
            className={`${field} ${s.valueType === "text" ? "w-64" : "w-28"}`}
          />
        )}
        <button type="submit" className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-secondary">
          Save
        </button>
      </form>
    </li>
  );
}

const recordField = "h-8 w-full rounded-md border border-border bg-transparent px-2 text-sm";

function RecordInput({
  name,
  label,
  value,
  inputMode,
}: {
  name: string;
  label: string;
  value: string | number | boolean | null;
  inputMode?: "numeric" | "decimal";
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="block text-muted-foreground">{label}</span>
      <input name={name} defaultValue={value === null ? "" : String(value)} inputMode={inputMode} className={recordField} />
    </label>
  );
}

function RecordSelect({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value: string;
  options: [string, string][];
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="block text-muted-foreground">{label}</span>
      <select name={name} defaultValue={value} className={recordField}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function RecordText({ name, label, value }: { name: string; label: string; value: string | number | boolean | null }) {
  return (
    <label className="space-y-1 text-sm">
      <span className="block text-muted-foreground">{label}</span>
      <textarea
        name={name}
        rows={4}
        defaultValue={value === null ? "" : String(value)}
        className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm"
      />
    </label>
  );
}
