"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { createCompanyAction, previewTemplates } from "@/app/platform/actions";
import {
  addCompanyProblems,
  editableSetting,
  generatePassword,
  settingFromText,
  settingToText,
  toggleModule,
  type AddCompanyInput,
  type ModuleDependency,
  type TemplateDefaults,
  type TemplateTerm,
} from "@/lib/add-company";
import type { IndustryTemplate, SettingDefinition, TermLabel } from "@/lib/platform";

type CatalogueModule = { code: string; name: string; built: boolean; planType: string };

const STEPS = ["Details", "Industries", "Modules", "Defaults", "Owner", "Create"] as const;

/**
 * What only the browser knows: its timezone lists and the operator's own zone
 * (a starting point, not a fixed default). Read through useSyncExternalStore,
 * so the server render and the first client render agree (both empty) and the
 * lists appear once hydrated.
 */
type BrowserLists = { timezones: string[]; currencies: string[]; zone: string };
const NO_LISTS: BrowserLists = { timezones: [], currencies: [], zone: "" };
let browserLists: BrowserLists | null = null;
function readBrowserLists(): BrowserLists {
  if (!browserLists) {
    const supported = typeof Intl.supportedValuesOf === "function";
    browserLists = {
      timezones: supported ? Intl.supportedValuesOf("timeZone") : [],
      currencies: supported ? Intl.supportedValuesOf("currency") : [],
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
    };
  }
  return browserLists;
}
const neverChanges = () => () => {};

/**
 * The operator's "Add company", in steps on one page: details → industries →
 * modules → defaults → owner → create.
 *
 * The defaults come from `template_defaults()` through `previewTemplates`, the
 * same function `create_company` builds from, so what is reviewed here is what
 * the company gets. Changing the industries fetches a fresh proposal and
 * replaces the modules, words, settings, checklists and forms chosen so far.
 *
 * Nothing is written until "Create company": then `createCompanyAction` makes
 * the owner's login and calls `create_company`, deleting the login again if the
 * company is refused. The starting password is shown once more on success, to
 * copy; it is not stored anywhere else.
 *
 * The two actions come in as props (the page passes the server actions), so
 * the form holds no route of its own and can be rendered against fixed data.
 */
export function AddCompanyWizard({
  templates,
  modules: catalogue,
  dependencies,
  settings: settingDefs,
  terms: termLabels,
  preview,
  create: createCompany,
}: {
  templates: IndustryTemplate[];
  modules: CatalogueModule[];
  dependencies: ModuleDependency[];
  settings: SettingDefinition[];
  terms: TermLabel[];
  preview: typeof previewTemplates;
  create: typeof createCompanyAction;
}) {
  const [step, setStep] = useState(0);

  const browser = useSyncExternalStore(neverChanges, readBrowserLists, () => NO_LISTS);
  const [timezoneEdited, setTimezoneEdited] = useState(false);
  const [details, setCompany] = useState<AddCompanyInput["company"]>({
    name: "",
    legalName: "",
    countryCode: "",
    timezone: "",
    currencyCode: "",
    vatNumber: "",
    address: "",
    phone: "",
    supportEmail: "",
  });
  const [chosen, setChosen] = useState<string[]>([]);

  // The proposal, and which industries it was made for.
  const [defaults, setDefaults] = useState<TemplateDefaults | null>(null);
  const [defaultsFor, setDefaultsFor] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [modules, setModules] = useState<string[]>([]);
  const [terms, setTerms] = useState<Record<string, TemplateTerm>>({});
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [checklists, setChecklists] = useState<string[]>([]);
  const [forms, setForms] = useState<string[]>([]);

  const [owner, setOwner] = useState({ fullName: "", email: "", password: "" });
  const [copied, setCopied] = useState(false);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ orgId: string; email: string; password: string } | null>(null);

  // Until the operator types one, the timezone is their own.
  const company = timezoneEdited ? details : { ...details, timezone: browser.zone };

  const editableSettings = useMemo(() => settingDefs.filter((d) => editableSetting(d.key)), [settingDefs]);
  const templateName = useMemo(() => new Map(templates.map((t) => [t.code, t.name])), [templates]);
  const moduleName = useMemo(() => new Map(catalogue.map((m) => [m.code, m.name])), [catalogue]);

  const input: AddCompanyInput = {
    company,
    templates: chosen,
    modules,
    terms,
    settings: Object.fromEntries(
      editableSettings
        .filter((d) => d.key in settings)
        .map((d) => [d.key, settingFromText(d.valueType, settings[d.key])])
    ),
    checklists,
    forms,
    owner,
  };
  const problems = addCompanyProblems(input, dependencies);

  function edit<K extends keyof AddCompanyInput["company"]>(key: K, value: string) {
    if (key === "timezone") setTimezoneEdited(true);
    setCompany((c) => ({ ...c, [key]: value }));
  }

  function toggleIndustry(code: string) {
    setChosen((cur) => (cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code]));
  }

  function makePrimary(code: string) {
    setChosen((cur) => [code, ...cur.filter((c) => c !== code)]);
  }

  /** Fetch the proposal for the chosen industries, unless it is already the one on screen. */
  async function loadDefaults(): Promise<boolean> {
    const key = chosen.join(",");
    if (defaults && defaultsFor === key) return true;
    setLoading(true);
    setPreviewError(null);
    const res = await preview(chosen);
    setLoading(false);
    if (!res.ok) {
      setPreviewError(res.error);
      return false;
    }
    const d = res.defaults;
    setDefaults(d);
    setDefaultsFor(key);
    setModules(d.modules.filter((m) => m.built).map((m) => m.code));
    setTerms(d.terms);
    setSettings(Object.fromEntries(Object.entries(d.settings).map(([k, v]) => [k, settingToText(v)])));
    setChecklists(d.checklists.map((c) => c.code));
    setForms(d.forms.map((f) => f.code));
    return true;
  }

  async function next() {
    if (step === 1 && !(await loadDefaults())) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  async function create() {
    setCreating(true);
    setCreateError(null);
    const res = await createCompany(input);
    setCreating(false);
    if (!res.ok) {
      setCreateError(res.error);
      return;
    }
    setCreated({ orgId: res.orgId, email: owner.email.trim().toLowerCase(), password: owner.password });
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (created) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{company.name.trim()} is ready</CardTitle>
          <CardDescription>
            Give the owner these details. The password is shown only here; they can change it
            after signing in.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Email</dt>
            <dd className="font-mono">{created.email}</dd>
            <dt className="text-muted-foreground">Password</dt>
            <dd className="font-mono">{created.password}</dd>
          </dl>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              onClick={() => copy(`Email: ${created.email}\nPassword: ${created.password}`)}
            >
              {copied ? "Copied" : "Copy both"}
            </Button>
            <Button nativeButton={false} render={<Link href={`/platform/companies/${created.orgId}`} />}>Open the company</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap gap-2 text-sm">
        {STEPS.map((label, i) => (
          <li key={label}>
            <button
              type="button"
              // Back to any step already passed; forward only with "Next", which loads the proposal.
              disabled={i > step}
              onClick={() => setStep(i)}
              className={
                i === step
                  ? "rounded-md bg-primary px-3 py-1 text-primary-foreground"
                  : "rounded-md border border-border px-3 py-1 text-muted-foreground enabled:hover:bg-secondary disabled:opacity-50"
              }
            >
              {i + 1}. {label}
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Company details</CardTitle>
            <CardDescription>
              The country limits address lookups and the currency is used for every amount, so
              both are required.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="name" label="Company name" value={company.name} onChange={(v) => edit("name", v)} />
            <Field id="legal" label="Legal name" value={company.legalName} onChange={(v) => edit("legalName", v)} optional />
            <Field
              id="country"
              label="Country (two letters)"
              value={company.countryCode}
              onChange={(v) => edit("countryCode", v.toUpperCase())}
              maxLength={2}
              hint="ISO code, such as ZA or BW."
            />
            <Field
              id="currency"
              label="Currency (three letters)"
              value={company.currencyCode}
              onChange={(v) => edit("currencyCode", v.toUpperCase())}
              maxLength={3}
              list="currency-codes"
              hint="ISO code, such as ZAR or BWP."
            />
            <Field
              id="timezone"
              label="Timezone"
              value={company.timezone}
              onChange={(v) => edit("timezone", v)}
              list="timezones"
            />
            <Field id="vat" label="VAT number" value={company.vatNumber} onChange={(v) => edit("vatNumber", v)} optional />
            <Field id="phone" label="Phone" value={company.phone} onChange={(v) => edit("phone", v)} optional />
            <Field
              id="email"
              label="Company email"
              type="email"
              value={company.supportEmail}
              onChange={(v) => edit("supportEmail", v)}
              optional
            />
            <div className="sm:col-span-2">
              <Field id="address" label="Address" value={company.address} onChange={(v) => edit("address", v)} optional />
            </div>
            <datalist id="timezones">
              {browser.timezones.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <datalist id="currency-codes">
              {browser.currencies.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </CardContent>
        </Card>
      )}

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Industries</CardTitle>
            <CardDescription>
              Pick one or more. The primary industry decides the words and settings; the others
              add their modules, checklists and forms.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {templates.map((t) => {
                const index = chosen.indexOf(t.code);
                return (
                  <li
                    key={t.code}
                    className={
                      index >= 0
                        ? "rounded-lg border-2 border-primary p-3"
                        : "rounded-lg border border-border p-3"
                    }
                  >
                    <label className="flex cursor-pointer items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4"
                        checked={index >= 0}
                        onChange={() => toggleIndustry(t.code)}
                      />
                      <span className="space-y-0.5">
                        <span className="block font-medium text-foreground">{t.name}</span>
                        <span className="block text-xs text-muted-foreground">{t.description}</span>
                      </span>
                    </label>
                    {index === 0 && <p className="mt-2 text-xs font-medium text-primary">Primary</p>}
                    {index > 0 && (
                      <button
                        type="button"
                        onClick={() => makePrimary(t.code)}
                        className="mt-2 text-xs text-muted-foreground underline"
                      >
                        Make primary
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {defaults && defaultsFor && defaultsFor !== chosen.join(",") && (
              <p className="text-sm text-muted-foreground">
                The industries changed: the next step starts again from their defaults.
              </p>
            )}
            {previewError && <p className="text-sm text-destructive">{previewError}</p>}
          </CardContent>
        </Card>
      )}

      {step === 2 && defaults && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Modules</CardTitle>
            <CardDescription>
              Ticked from the industries. Ticking a module ticks what it needs; unticking one
              unticks what needs it. Modules not built yet are switched on once they are.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {catalogue.map((m) => {
                const named = defaults.modules.some((d) => d.code === m.code);
                const needs = dependencies.filter((d) => d.module === m.code).map((d) => moduleName.get(d.requires) ?? d.requires);
                return (
                  <li key={m.code} className="flex items-start justify-between gap-4 p-3">
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4"
                        disabled={!m.built}
                        checked={modules.includes(m.code)}
                        onChange={(e) => setModules((cur) => toggleModule(cur, m.code, e.target.checked, dependencies))}
                      />
                      <span>
                        <span className="block text-sm font-medium text-foreground">
                          {m.name}{" "}
                          <span className="text-xs font-normal text-muted-foreground">({m.planType})</span>
                        </span>
                        {needs.length > 0 && (
                          <span className="block text-xs text-muted-foreground">Needs: {needs.join(", ")}</span>
                        )}
                      </span>
                    </label>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {!m.built ? (named ? "Coming soon · in the template" : "Coming soon") : named ? "In the template" : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {step === 3 && defaults && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Words</CardTitle>
              <CardDescription>
                What this company calls things, on every screen, report and PDF. The owner can
                change them later under Settings.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="border-b border-border text-left text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Term</th>
                      <th className="px-3 py-2 font-medium">Singular</th>
                      <th className="px-3 py-2 font-medium">Plural</th>
                    </tr>
                  </thead>
                  <tbody>
                    {termLabels.map((t) => {
                      const term = terms[t.key];
                      if (!term) return null;
                      return (
                        <tr key={t.key} className="border-b border-border align-top last:border-0">
                          <td className="px-3 py-2">
                            <div className="font-medium text-foreground">{t.label}</div>
                            <p className="text-xs text-muted-foreground">{t.description}</p>
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              aria-label={`${t.label}, singular`}
                              value={term.one}
                              maxLength={40}
                              onChange={(e) => setTerms((cur) => ({ ...cur, [t.key]: { ...term, one: e.target.value } }))}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              aria-label={`${t.label}, plural`}
                              value={term.many}
                              maxLength={40}
                              onChange={(e) => setTerms((cur) => ({ ...cur, [t.key]: { ...term, many: e.target.value } }))}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Field settings</CardTitle>
              <CardDescription>
                Checked by the database when the company is created; a value out of range stops
                the creation with the setting&apos;s own message.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              {editableSettings.map((d) => {
                const id = `setting-${d.key}`;
                const value = settings[d.key] ?? "";
                const set = (v: string) => setSettings((cur) => ({ ...cur, [d.key]: v }));
                if (d.valueType === "boolean") {
                  return (
                    <div key={d.key} className="space-y-1.5">
                      <label htmlFor={id} className="flex items-center gap-2 text-sm font-medium">
                        <input
                          id={id}
                          type="checkbox"
                          className="size-4"
                          checked={value === "true"}
                          onChange={(e) => set(e.target.checked ? "true" : "false")}
                        />
                        {d.label}
                      </label>
                      <p className="text-xs text-muted-foreground">{d.description}</p>
                    </div>
                  );
                }
                return (
                  <div key={d.key} className="space-y-1.5">
                    <Label htmlFor={id}>{d.label}</Label>
                    <Input
                      id={id}
                      type={d.valueType === "integer" ? "number" : d.valueType === "time" ? "time" : "text"}
                      min={d.min ?? undefined}
                      max={d.max ?? undefined}
                      step={d.valueType === "integer" ? 1 : undefined}
                      value={value}
                      onChange={(e) => set(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      {d.description}
                      {d.min !== null && d.max !== null ? ` Between ${d.min} and ${d.max}.` : ""}
                    </p>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Checklists and forms</CardTitle>
              <CardDescription>
                Each one ticked becomes a form the company can use straight away and edit later.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {defaults.checklists.length === 0 && defaults.forms.length === 0 && (
                <p className="text-sm text-muted-foreground">These industries come with none.</p>
              )}
              {defaults.checklists.map((c) => (
                <PickRow
                  key={`c-${c.code}`}
                  name={c.name}
                  source={templateName.get(c.template) ?? c.template}
                  checked={checklists.includes(c.code)}
                  onChange={(on) =>
                    setChecklists((cur) => (on ? [...cur, c.code] : cur.filter((x) => x !== c.code)))
                  }
                  lines={c.items.map((i) => `${i.text}${i.photo_required ? " (photo)" : ""}${i.required ? "" : " (optional)"}`)}
                />
              ))}
              {defaults.forms.map((f) => (
                <PickRow
                  key={`f-${f.code}`}
                  name={f.name}
                  source={templateName.get(f.template) ?? f.template}
                  checked={forms.includes(f.code)}
                  onChange={(on) => setForms((cur) => (on ? [...cur, f.code] : cur.filter((x) => x !== f.code)))}
                  lines={f.fields.map((x) => `${x.label} (${x.field_type}${x.required ? "" : ", optional"})`)}
                />
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Owner</CardTitle>
            <CardDescription>
              The company&apos;s first login, as its Administrator. Set a starting password and
              give it to them; they can change it after signing in.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="owner-name" label="Full name" value={owner.fullName} onChange={(v) => setOwner((o) => ({ ...o, fullName: v }))} />
            <Field
              id="owner-email"
              label="Email"
              type="email"
              value={owner.email}
              onChange={(v) => setOwner((o) => ({ ...o, email: v }))}
            />
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="owner-password">Starting password</Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="owner-password"
                  className="max-w-xs font-mono"
                  value={owner.password}
                  autoComplete="new-password"
                  onChange={(e) => setOwner((o) => ({ ...o, password: e.target.value }))}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOwner((o) => ({ ...o, password: generatePassword(crypto.getRandomValues(new Uint8Array(16))) }))}
                >
                  Generate
                </Button>
                <Button type="button" variant="outline" disabled={!owner.password} onClick={() => copy(owner.password)}>
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">At least 8 characters.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 5 && defaults && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create</CardTitle>
            <CardDescription>
              One step: the login is made, then the company in a single transaction. If the
              company is refused, the login is removed again.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Company</dt>
              <dd>{company.name.trim() || "—"}</dd>
              <dt className="text-muted-foreground">Country · currency · timezone</dt>
              <dd>
                {company.countryCode || "—"} · {company.currencyCode || "—"} · {company.timezone || "—"}
              </dd>
              <dt className="text-muted-foreground">Industries</dt>
              <dd>{chosen.map((c) => templateName.get(c) ?? c).join(", ")}</dd>
              <dt className="text-muted-foreground">Modules</dt>
              <dd>{modules.map((m) => moduleName.get(m) ?? m).join(", ") || "Core only"}</dd>
              <dt className="text-muted-foreground">Checklists and forms</dt>
              <dd>{checklists.length + forms.length}</dd>
              <dt className="text-muted-foreground">Owner</dt>
              <dd>
                {owner.fullName.trim() || "—"} · {owner.email.trim() || "—"}
              </dd>
            </dl>
            {problems.length > 0 && (
              <ul className="list-disc space-y-1 rounded-md border border-destructive/40 bg-destructive/10 py-2 pr-3 pl-7 text-sm text-destructive">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            {createError && <p className="text-sm text-destructive">{createError}</p>}
            <Button onClick={create} disabled={creating || problems.length > 0}>
              {creating ? "Creating…" : "Create company"}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-between">
        <Button variant="outline" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
          Back
        </Button>
        {step < STEPS.length - 1 && (
          <Button onClick={next} disabled={loading || (step === 1 && chosen.length === 0)}>
            {loading ? "Loading defaults…" : "Next"}
          </Button>
        )}
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  optional,
  hint,
  type = "text",
  maxLength,
  list,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  optional?: boolean;
  hint?: string;
  type?: string;
  maxLength?: number;
  list?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {optional && <span className="font-normal text-muted-foreground"> (optional)</span>}
      </Label>
      <Input id={id} type={type} value={value} maxLength={maxLength} list={list} onChange={(e) => onChange(e.target.value)} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function PickRow({
  name,
  source,
  checked,
  onChange,
  lines,
}: {
  name: string;
  source: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  lines: string[];
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="font-medium text-foreground">{name}</span>
        <span className="text-xs text-muted-foreground">· {source}</span>
      </label>
      <details className="mt-1 pl-6">
        <summary className="cursor-pointer text-xs text-muted-foreground">{lines.length} items</summary>
        <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
          {lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
