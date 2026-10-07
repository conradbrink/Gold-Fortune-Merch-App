"use client";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { previewIndustries, signupAction, type IndustryPreview } from "@/app/signup/actions";
import { PASSWORD_MIN, signupIssues, signupProblems, type SignupInput } from "@/lib/signup";

type Template = { code: string; name: string; description: string };

const STEPS = ["You", "Your company", "Your work"] as const;
const STEP_FIELDS: (keyof SignupInput)[][] = [
  ["fullName", "email", "password"],
  ["companyName", "countryCode", "currencyCode", "timezone"],
  ["templates"],
];

/**
 * What only the browser knows: every country and currency it can name, the
 * person's own country (from the browser's language) and timezone. Read
 * through useSyncExternalStore, so the server render and the first client
 * render agree (empty) and the lists fill in once hydrated. Nothing here is a
 * list in our code.
 */
type BrowserLists = {
  countries: { code: string; name: string }[];
  currencies: { code: string; name: string }[];
  country: string;
  zone: string;
  zones: string[];
};
const NO_LISTS: BrowserLists = { countries: [], currencies: [], country: "", zone: "", zones: [] };

/**
 * A code the browser names but ISO 3166-1 does not give to a country: the
 * user-assigned ranges (AA, QM–QZ, XA–XZ, ZZ — the browser names XA "Pseudo-
 * Accents" and ZZ "Unknown Region") and the exceptionally reserved codes (EU,
 * UN, Ceuta, Canary Islands…). Kosovo's XK is user-assigned but in general use,
 * so it stays. This is the standard's own rule, not a list of countries.
 */
function notACountry(code: string): boolean {
  if (code === "XK") return false;
  if (code === "AA" || code === "ZZ" || code[0] === "X") return true;
  if (code[0] === "Q" && code[1] >= "M") return true;
  return ["AC", "CP", "DG", "EA", "EU", "EZ", "IC", "TA", "UN"].includes(code);
}
let browserLists: BrowserLists | null = null;
function readBrowserLists(): BrowserLists {
  if (browserLists) return browserLists;
  const regionNames = new Intl.DisplayNames(undefined, { type: "region" });
  const currencyNames = new Intl.DisplayNames(undefined, { type: "currency" });
  const countries: { code: string; name: string }[] = [];
  const A = "A".charCodeAt(0);
  for (let i = 0; i < 26; i++) {
    for (let j = 0; j < 26; j++) {
      const code = String.fromCharCode(A + i, A + j);
      if (notACountry(code)) continue;
      try {
        const name = regionNames.of(code);
        // An unassigned code comes back as itself. A retired code (DD, SU,
        // UK…) canonicalises to its successor, so keeping only codes that are
        // their own canonical form lists each country once.
        if (name && name !== code && new Intl.Locale(`und-${code}`).region === code) countries.push({ code, name });
      } catch {
        // Not a region code this browser knows.
      }
    }
  }
  countries.sort((a, b) => a.name.localeCompare(b.name));
  const supported = typeof Intl.supportedValuesOf === "function";
  const currencies = (supported ? Intl.supportedValuesOf("currency") : [])
    .map((code) => ({ code, name: currencyNames.of(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name));
  let country = "";
  try {
    country = new Intl.Locale(navigator.language).maximize().region ?? "";
  } catch {
    country = "";
  }
  browserLists = {
    countries,
    currencies,
    country: countries.some((c) => c.code === country) ? country : "",
    zone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
    zones: supported ? Intl.supportedValuesOf("timeZone") : [],
  };
  return browserLists;
}
const neverChanges = () => () => {};

export function SignupForm({
  templates,
  trialDays,
  initialIndustry,
}: {
  templates: Template[];
  trialDays: number;
  initialIndustry: string | null;
}) {
  const router = useRouter();
  const browser = useSyncExternalStore(neverChanges, readBrowserLists, () => NO_LISTS);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    password: "",
    companyName: "",
    countryCode: "",
    currencyCode: "",
    timezone: "",
  });
  // Until the person picks one, their own country and timezone.
  const [picked, setPicked] = useState({ country: false, timezone: false });
  const [templatesChosen, setTemplatesChosen] = useState<string[]>(initialIndustry ? [initialIndustry] : []);
  const [preview, setPreview] = useState<IndustryPreview | null>(null);
  const [previewFor, setPreviewFor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);

  const input: SignupInput = {
    ...form,
    countryCode: picked.country ? form.countryCode : form.countryCode || browser.country,
    timezone: picked.timezone ? form.timezone : form.timezone || browser.zone,
    templates: templatesChosen,
  };
  const templateName = useMemo(() => new Map(templates.map((t) => [t.code, t.name])), [templates]);

  function set<K extends keyof typeof form>(key: K, value: string) {
    if (key === "countryCode") setPicked((p) => ({ ...p, country: true }));
    if (key === "timezone") setPicked((p) => ({ ...p, timezone: true }));
    setForm((f) => ({ ...f, [key]: value }));
  }

  /** The problems that belong to one step, so "Next" can stop on them. */
  function stepProblems(i: number): string[] {
    return signupIssues(input)
      .filter((p) => STEP_FIELDS[i].includes(p.field))
      .map((p) => p.message);
  }

  async function loadPreview(codes: string[]) {
    const key = codes.join(",");
    if (!key || key === previewFor) return;
    const res = await previewIndustries(codes);
    if (res.ok) {
      setPreview(res.preview);
      setPreviewFor(key);
    }
  }

  function toggle(code: string) {
    const next = templatesChosen.includes(code)
      ? templatesChosen.filter((c) => c !== code)
      : [...templatesChosen, code].slice(0, 3);
    setTemplatesChosen(next);
    void loadPreview(next);
  }

  async function next() {
    const problems = stepProblems(step);
    if (problems.length > 0) {
      setError(problems.join(" "));
      return;
    }
    setError(null);
    if (step === 1 && templatesChosen.length > 0) void loadPreview(templatesChosen);
    setStep((s) => s + 1);
  }

  async function submit() {
    const problems = signupProblems(input);
    if (problems.length > 0) {
      setError(problems.join(" "));
      return;
    }
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    const res = await signupAction(input);
    if (!res.ok) {
      submitting.current = false;
      setBusy(false);
      setError(res.error);
      return;
    }
    router.push(res.signedIn ? "/" : "/login");
    router.refresh();
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm">
      <header className="space-y-1">
        <h1 className="text-xl font-bold text-foreground">Start your {trialDays}-day free trial</h1>
        <p className="text-sm text-muted-foreground">
          No card needed. Your account is set up for your kind of work as soon as you finish.
        </p>
      </header>

      <ol className="flex gap-2 text-xs">
        {STEPS.map((label, i) => (
          <li
            key={label}
            className={
              i === step
                ? "rounded-md bg-primary px-2.5 py-1 text-primary-foreground"
                : "rounded-md border border-border px-2.5 py-1 text-muted-foreground"
            }
          >
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="grid grid-cols-1 gap-4">
          <Field id="full-name" label="Your name" value={form.fullName} onChange={(v) => set("fullName", v)} autoComplete="name" />
          <Field id="email" label="Work email" type="email" value={form.email} onChange={(v) => set("email", v)} autoComplete="email" />
          <Field
            id="password"
            label="Choose a password"
            type="password"
            value={form.password}
            onChange={(v) => set("password", v)}
            autoComplete="new-password"
            hint={`At least ${PASSWORD_MIN} characters.`}
          />
        </div>
      )}

      {step === 1 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field id="company" label="Company name" value={form.companyName} onChange={(v) => set("companyName", v)} autoComplete="organization" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="country">Country</Label>
            <NativeSelect id="country" value={input.countryCode} onChange={(e) => set("countryCode", e.target.value)}>
              <option value="">Choose…</option>
              {browser.countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="currency">Currency</Label>
            <NativeSelect id="currency" value={form.currencyCode} onChange={(e) => set("currencyCode", e.target.value)}>
              <option value="">Choose…</option>
              {browser.currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.code})
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="timezone">Timezone</Label>
            <NativeSelect id="timezone" value={input.timezone} onChange={(e) => set("timezone", e.target.value)}>
              <option value="">Choose…</option>
              {browser.zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Pick the work your team does. Pick more than one if you do several; the first one sets your words.
          </p>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {templates.map((t) => {
              const index = templatesChosen.indexOf(t.code);
              return (
                <li key={t.code}>
                  <label
                    className={
                      index >= 0
                        ? "flex h-full cursor-pointer items-start gap-2 rounded-lg border-2 border-primary p-3"
                        : "flex h-full cursor-pointer items-start gap-2 rounded-lg border border-border p-3"
                    }
                  >
                    <input type="checkbox" className="mt-0.5 size-4" checked={index >= 0} onChange={() => toggle(t.code)} />
                    <span>
                      <span className="block text-sm font-medium text-foreground">
                        {t.name}
                        {index === 0 && templatesChosen.length > 1 && (
                          <span className="ml-1 text-xs font-normal text-primary">(main)</span>
                        )}
                      </span>
                      <span className="block text-xs text-muted-foreground">{t.description}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {preview && previewFor === templatesChosen.join(",") && (
            <div className="rounded-md bg-secondary/60 p-3 text-sm">
              <p className="font-medium text-foreground">
                Ready for you: {templatesChosen.map((c) => templateName.get(c) ?? c).join(" + ")}
              </p>
              <p className="text-muted-foreground">
                Your app will talk about {preview.words.staffMany.toLowerCase()}, {preview.words.siteMany.toLowerCase()} and{" "}
                {preview.words.jobMany.toLowerCase()}
                {preview.checklists.length + preview.forms.length > 0
                  ? `, with ${preview.checklists.length + preview.forms.length} ready-made checklists and forms: ${[...preview.checklists, ...preview.forms].join(", ")}.`
                  : "."}
              </p>
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        {step > 0 ? (
          <Button variant="outline" onClick={() => setStep((s) => s - 1)} disabled={busy}>
            Back
          </Button>
        ) : (
          <Link href="/login" className="text-sm text-muted-foreground hover:underline">
            Already have an account? Sign in
          </Link>
        )}
        {step < STEPS.length - 1 ? (
          <Button onClick={next}>Next</Button>
        ) : (
          <Button onClick={submit} disabled={busy}>
            {busy ? "Setting up your account…" : "Start my free trial"}
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
  type = "text",
  hint,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  hint?: string;
  autoComplete?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={value} autoComplete={autoComplete} onChange={(e) => onChange(e.target.value)} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
