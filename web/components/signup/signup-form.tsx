"use client";

import { useMemo, useRef, useState } from "react";
import { useRegionLists } from "@/lib/region-lists";
import { Check, Eye, EyeOff, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { previewIndustries, signupAction, type IndustryPreview } from "@/app/signup/actions";
import { PASSWORD_MIN, signupIssues, type SignupInput } from "@/lib/signup";

type Template = { code: string; name: string; description: string };

const STEPS = ["You", "Your company", "Your work"] as const;
/** The element each field's problem sends focus to. */
const FIELD_ID: Record<keyof SignupInput, string> = {
  fullName: "full-name",
  email: "email",
  password: "password",
  companyName: "company",
  countryCode: "country",
  currencyCode: "currency",
  timezone: "timezone",
  templates: "template-0",
};
const STEP_FIELDS: (keyof SignupInput)[][] = [
  ["fullName", "email", "password"],
  ["companyName", "countryCode", "currencyCode", "timezone"],
  ["templates"],
];


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
  const browser = useRegionLists();
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
  // Problems shown under their own field; `error` is for the server's answer.
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof SignupInput, string>>>({});
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
    setFieldErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  }

  /** The problems that belong to one step, so "Continue" can stop on them. */
  function stepIssues(i: number) {
    return signupIssues(input).filter((p) => STEP_FIELDS[i].includes(p.field));
  }

  /** Show each problem under its field and move focus to the first one. */
  function showIssues(issues: { field: keyof SignupInput; message: string }[]): boolean {
    if (issues.length === 0) return false;
    const byField: Partial<Record<keyof SignupInput, string>> = {};
    for (const p of issues) byField[p.field] ??= p.message;
    setFieldErrors(byField);
    // After the render, so a step that just reappeared has its field.
    // The trades fall back to their fieldset when there is no first box
    // (an empty template list), so focus never goes nowhere.
    const target = FIELD_ID[issues[0].field];
    requestAnimationFrame(() =>
      (document.getElementById(target) ?? (target === FIELD_ID.templates ? document.getElementById("templates") : null))?.focus()
    );
    return true;
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
    setFieldErrors((e) => (e.templates ? { ...e, templates: undefined } : e));
    void loadPreview(next);
  }

  async function next() {
    if (showIssues(stepIssues(step))) return;
    setError(null);
    setFieldErrors({});
    if (step === 1 && templatesChosen.length > 0) void loadPreview(templatesChosen);
    setStep((s) => s + 1);
  }

  function back() {
    setError(null);
    setFieldErrors({});
    setStep((s) => s - 1);
  }

  async function submit() {
    // Anything left over from an earlier step goes back to that step.
    const issues = signupIssues(input);
    if (issues.length > 0) {
      const first = STEP_FIELDS.findIndex((fields) => fields.includes(issues[0].field));
      if (first !== step) setStep(first);
      showIssues(issues.filter((p) => STEP_FIELDS[first].includes(p.field)));
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
    router.push(res.signedIn ? "/onboarding" : "/login");
    router.refresh();
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        // Enter moves on a step, and finishes on the last one.
        e.preventDefault();
        if (step < STEPS.length - 1) void next();
        else void submit();
      }}
      className="space-y-7"
    >
      <header className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight text-balance text-foreground sm:text-3xl">
          Start your {trialDays}-day free trial
        </h1>
        <p className="text-pretty text-muted-foreground">
          No card needed. Your account is set up for your kind of work as soon as you finish.
        </p>
      </header>

      <ol className="grid grid-cols-3 gap-2" aria-label="Sign-up steps">
        {STEPS.map((label, i) => {
          const done = i < step;
          const current = i === step;
          return (
            <li key={label} aria-current={current ? "step" : undefined} className="grid gap-2">
              <span
                className={`h-1.5 rounded-full transition-colors duration-200 ${done || current ? "bg-[#f5a524]" : "bg-border"}`}
                aria-hidden="true"
              />
              <span
                className={`flex items-center gap-1.5 text-xs font-medium sm:text-sm ${
                  current ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {done ? (
                  <Check className="size-3.5 shrink-0 text-[#0f3d3e] dark:text-[#f5a524]" strokeWidth={3} aria-hidden="true" />
                ) : (
                  <span className="tabular-nums">{i + 1}.</span>
                )}
                {label}
                {done && <span className="sr-only">(done)</span>}
              </span>
            </li>
          );
        })}
      </ol>

      {step === 0 && (
        <div className="grid grid-cols-1 gap-5">
          <Field id="full-name" label="Your name" value={form.fullName} onChange={(v) => set("fullName", v)} autoComplete="name" error={fieldErrors.fullName} />
          <Field id="email" label="Work email" type="email" value={form.email} onChange={(v) => set("email", v)} autoComplete="email" error={fieldErrors.email} />
          <PasswordField
            value={form.password}
            onChange={(v) => set("password", v)}
            hint={`At least ${PASSWORD_MIN} characters.`}
            error={fieldErrors.password}
          />
        </div>
      )}

      {step === 1 && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field
              id="company"
              label="Company name"
              value={form.companyName}
              onChange={(v) => set("companyName", v)}
              autoComplete="organization"
              error={fieldErrors.companyName}
            />
          </div>
          <SelectField id="country" label="Country" value={input.countryCode} onChange={(v) => set("countryCode", v)} error={fieldErrors.countryCode}>
            {browser.countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </SelectField>
          <SelectField id="currency" label="Currency" value={form.currencyCode} onChange={(v) => set("currencyCode", v)} error={fieldErrors.currencyCode}>
            {browser.currencies.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} ({c.code})
              </option>
            ))}
          </SelectField>
          <div className="sm:col-span-2">
            <SelectField id="timezone" label="Timezone" value={input.timezone} onChange={(v) => set("timezone", v)} error={fieldErrors.timezone}>
              {browser.zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </SelectField>
          </div>
        </div>
      )}

      {step === 2 && (
        <fieldset
          id="templates"
          tabIndex={-1}
          className="space-y-4 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-describedby={fieldErrors.templates ? "templates-error" : undefined}
        >
          <legend className="text-pretty text-muted-foreground">
            Pick the work your team does. Pick more than one if you do several; the first one sets your words.
          </legend>
          <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {templates.map((t, i) => {
              const index = templatesChosen.indexOf(t.code);
              const on = index >= 0;
              return (
                <li key={t.code}>
                  <label
                    className={`flex h-full cursor-pointer items-start gap-3 rounded-xl p-3.5 ring-1 transition-[box-shadow,background-color] duration-150 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${
                      on ? "bg-[#f5a524]/10 ring-2 ring-[#f5a524]" : "ring-border hover:bg-secondary/60"
                    }`}
                  >
                    <input
                      id={i === 0 ? "template-0" : undefined}
                      type="checkbox"
                      className="sr-only"
                      checked={on}
                      onChange={() => toggle(t.code)}
                    />
                    <span
                      className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-md ring-1 ${
                        on ? "bg-[#f5a524] text-[#0f3d3e] ring-[#f5a524]" : "ring-border"
                      }`}
                      aria-hidden="true"
                    >
                      {on && <Check className="size-3.5" strokeWidth={3.5} />}
                    </span>
                    <span>
                      <span className="block font-medium text-foreground">
                        {t.name}
                        {index === 0 && templatesChosen.length > 1 && (
                          <span className="ml-1.5 rounded-full bg-[#0f3d3e] px-1.5 py-0.5 text-[11px] font-semibold text-[#f7f7f2] dark:bg-[#f5a524] dark:text-[#0f3d3e]">
                            Main
                          </span>
                        )}
                      </span>
                      <span className="block text-sm text-muted-foreground">{t.description}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {fieldErrors.templates && (
            <p id="templates-error" className="text-sm text-destructive">
              {fieldErrors.templates}
            </p>
          )}
          {preview && previewFor === templatesChosen.join(",") && (
            <div className="rounded-xl bg-secondary/70 p-4 text-sm" aria-live="polite">
              <p className="font-medium text-foreground">
                Ready for you: {templatesChosen.map((c) => templateName.get(c) ?? c).join(" + ")}
              </p>
              <p className="mt-1 text-pretty text-muted-foreground">
                Your app will talk about {preview.words.staffMany.toLowerCase()}, {preview.words.siteMany.toLowerCase()} and{" "}
                {preview.words.jobMany.toLowerCase()}
                {preview.checklists.length + preview.forms.length > 0
                  ? `, with ${preview.checklists.length + preview.forms.length} ready-made checklists and forms: ${[...preview.checklists, ...preview.forms].join(", ")}.`
                  : "."}
              </p>
            </div>
          )}
        </fieldset>
      )}

      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        {step > 0 ? (
          <Button type="button" variant="outline" className="h-11 px-5 text-sm" onClick={back} disabled={busy}>
            Back
          </Button>
        ) : (
          <span className="hidden sm:block" />
        )}
        <Button
          type="submit"
          disabled={busy}
          className="h-11 w-full gap-2 bg-[#f5a524] px-6 text-[15px] font-semibold text-[#0f3d3e] hover:bg-[#f8b84e] active:scale-[0.98] sm:w-auto"
        >
          {busy && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
          {step < STEPS.length - 1 ? "Continue" : busy ? "Setting up your account…" : "Start my free trial"}
        </Button>
      </div>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-foreground underline underline-offset-4 hover:text-foreground/80">
          Sign in
        </Link>
      </p>
    </form>
  );
}

const ERROR_SLOT = "text-sm text-destructive";

function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
  hint,
  autoComplete,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  hint?: string;
  autoComplete?: string;
  error?: string;
}) {
  const described = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={described}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 px-3 text-base md:text-[15px]"
      />
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className={ERROR_SLOT}>
          {error}
        </p>
      )}
    </div>
  );
}

function PasswordField({
  value,
  onChange,
  hint,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  hint: string;
  error?: string;
}) {
  const [shown, setShown] = useState(false);
  const described = error ? "password-error" : "password-hint";
  return (
    <div className="space-y-1.5">
      <Label htmlFor="password">Choose a password</Label>
      <div className="relative">
        <Input
          id="password"
          type={shown ? "text" : "password"}
          value={value}
          autoComplete="new-password"
          aria-invalid={error ? true : undefined}
          aria-describedby={described}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 px-3 pr-12 text-base md:text-[15px]"
        />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? "Hide password" : "Show password"}
          aria-pressed={shown}
          className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-lg text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {shown ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
        </button>
      </div>
      {error ? (
        <p id="password-error" className={ERROR_SLOT}>
          {error}
        </p>
      ) : (
        <p id="password-hint" className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

function SelectField({
  id,
  label,
  value,
  onChange,
  error,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect
        id={id}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => onChange(e.target.value)}
        className="h-11"
      >
        <option value="">Choose…</option>
        {children}
      </NativeSelect>
      {error && (
        <p id={`${id}-error`} className={ERROR_SLOT}>
          {error}
        </p>
      )}
    </div>
  );
}
