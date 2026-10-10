"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { founding, site } from "@/lib/site";
import { trackLead } from "@/components/meta-pixel";
import { track } from "@/components/analytics";
import { firstVisit } from "@/lib/first-visit";

// The Founding 10 application on /founding. It is posted to the app
// (`founding.apiUrl`), which saves it, emails the owner and lists it under
// /platform/founding. Eleven answers, all required, in the owner's order
// (~/Downloads/founding-10-site-prompt.md). The trade codes are the app's
// `industry_templates`, the same list as the main sign-up form.

type Option = [label: string, value: string];

const trades: Option[] = [
  ["Cleaning", "cleaning"],
  ["CCTV and installation", "installation"],
  ["Security and patrols", "security"],
  ["Maintenance", "maintenance"],
  ["Plumbing", "plumbing"],
  ["Garden", "garden"],
  ["Pest control", "pest_control"],
  ["Pools", "pool"],
  ["Sales and distribution", "distribution"],
  ["Delivery", "delivery"],
  ["Something else", "generic"],
];
const sizes: Option[] = [
  ["1 to 4", "1-4"],
  ["5 to 10", "5-10"],
  ["11 to 25", "11-25"],
  ["26 to 50", "26-50"],
  ["50+", "50+"],
];
const ways: Option[] = [
  ["WhatsApp", "whatsapp"],
  ["Paper", "paper"],
  ["Another app", "app"],
  ["Mostly memory", "memory"],
];
const yesNo: Option[] = [
  ["Yes", "yes"],
  ["No", "no"],
];

type Field =
  | "name"
  | "businessName"
  | "whatsapp"
  | "email"
  | "trade"
  | "teamSize"
  | "town"
  | "howRun"
  | "biggestCost"
  | "wholeTeam"
  | "videoReview"
  | "marketingOk";
type Issue = { field: Field; message: string };
type State =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "error"; message: string; issues: Issue[] }
  | { kind: "done"; waitlist: boolean };

const input =
  "min-h-12 w-full rounded-xl border-0 bg-white px-4 py-3 text-base text-ink ring-1 ring-white/30 placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-amber-500";

const errorText = "text-sm font-medium text-amber-300";

function Chips({
  label,
  options,
  value,
  onChange,
  error,
}: {
  label: string;
  options: Option[];
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium text-teal-100">{label}</legend>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
        {options.map(([text, code]) => (
          <button
            key={code}
            type="button"
            role="radio"
            aria-checked={value === code}
            onClick={() => onChange(code)}
            className={`min-h-11 rounded-full px-4 py-2 text-sm font-semibold ring-1 transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97] ${
              value === code ? "bg-amber-500 text-teal-950 ring-amber-500" : "text-teal-100 ring-white/25 hover:bg-white/10"
            }`}
          >
            {text}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className={errorText}>
          {error}
        </p>
      )}
    </fieldset>
  );
}

function Labelled({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-teal-100">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-sm text-teal-100/80">{hint}</p>}
      {error && (
        <p role="alert" className={errorText}>
          {error}
        </p>
      )}
    </div>
  );
}

export function FoundingForm() {
  const id = useId();
  const [state, setState] = useState<State>({ kind: "idle" });
  const [choice, setChoice] = useState<Record<"trade" | "teamSize" | "howRun" | "wholeTeam" | "videoReview", string>>({
    trade: "",
    teamSize: "",
    howRun: "",
    wholeTeam: "",
    videoReview: "",
  });
  const [agreed, setAgreed] = useState(false);
  const [missing, setMissing] = useState<Partial<Record<Field, string>>>({});

  const pick = (k: keyof typeof choice) => (v: string) => {
    setChoice((c) => ({ ...c, [k]: v }));
    setMissing((m) => ({ ...m, [k]: undefined }));
  };
  const issues = state.kind === "error" ? state.issues : [];
  const problem = (f: Field) => missing[f] ?? issues.find((i) => i.field === f)?.message;

  // The funnel's "started applying" step: the first time anything in the form
  // takes focus, once per page load.
  const startedRef = useRef(false);
  function started() {
    if (startedRef.current) return;
    startedRef.current = true;
    track("signup_started");
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state.kind === "sending") return;
    const form = new FormData(e.currentTarget);
    const text = (k: string) => String(form.get(k) ?? "");

    const gaps: Partial<Record<Field, string>> = {};
    if (!choice.trade) gaps.trade = "Choose what your team does.";
    if (!choice.teamSize) gaps.teamSize = "Choose how many people work in the field.";
    if (!choice.howRun) gaps.howRun = "Choose how you run jobs today.";
    if (!choice.wholeTeam) gaps.wholeTeam = "Please answer yes or no.";
    if (!choice.videoReview) gaps.videoReview = "Please answer yes or no.";
    if (!agreed) gaps.marketingOk = "Please tick the box to agree.";
    setMissing(gaps);
    if (Object.keys(gaps).length > 0) return;

    setState({ kind: "sending" });
    let src = "";
    try {
      src = new URLSearchParams(window.location.search).get("src") ?? "";
    } catch {
      /* the address is not readable: no source */
    }
    try {
      const res = await fetch(founding.apiUrl, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          name: text("name"),
          businessName: text("businessName"),
          whatsapp: text("whatsapp"),
          email: text("email"),
          trade: choice.trade,
          teamSize: choice.teamSize,
          town: text("town"),
          howRun: choice.howRun,
          biggestCost: text("biggestCost"),
          wholeTeam: choice.wholeTeam,
          videoReview: choice.videoReview,
          marketingOk: agreed,
          website: text("website"),
          source: src,
          attribution: firstVisit(),
        }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; waitlist?: boolean; error?: string; issues?: Issue[] } | null;
      if (res.ok && body?.ok) {
        trackLead();
        track("signup_completed", { waitlist: body.waitlist === true, trade: choice.trade });
        setState({ kind: "done", waitlist: body.waitlist === true });
        return;
      }
      setState({
        kind: "error",
        message: body?.issues?.length ? "Please check the details marked below." : (body?.error ?? "That did not go through. Please try again."),
        issues: body?.issues ?? [],
      });
    } catch {
      setState({ kind: "error", message: "We could not reach the server. Please check your signal and try again.", issues: [] });
    }
  }

  if (state.kind === "done") {
    return (
      <div role="status" className="grid gap-3 rounded-2xl bg-white/10 p-5 ring-1 ring-white/20 sm:p-6">
        <p className="font-display text-2xl font-bold text-amber-500">You&apos;re in the running.</p>
        <p className="leading-relaxed text-teal-100 sm:text-lg">
          {state.waitlist
            ? "All the spots are taken, so you are on the waiting list. If one opens, we will WhatsApp you."
            : `We'll WhatsApp you by ${founding.tellsBy}.`}
        </p>
      </div>
    );
  }

  const sending = state.kind === "sending";
  return (
    <form onSubmit={submit} onFocusCapture={started} className="grid gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Labelled label="Your name" htmlFor={`${id}-name`} error={problem("name")}>
          <input id={`${id}-name`} name="name" required maxLength={80} autoComplete="name" className={input} />
        </Labelled>
        <Labelled label="Business name" htmlFor={`${id}-biz`} error={problem("businessName")}>
          <input id={`${id}-biz`} name="businessName" required maxLength={120} autoComplete="organization" className={input} />
        </Labelled>
      </div>
      <Labelled label="WhatsApp number" htmlFor={`${id}-wa`} hint="We reply here. We never share it." error={problem("whatsapp")}>
        <input
          id={`${id}-wa`}
          name="whatsapp"
          type="tel"
          inputMode="tel"
          required
          maxLength={25}
          autoComplete="tel"
          placeholder="082 123 4567"
          className={input}
        />
      </Labelled>
      <Labelled label="Email" htmlFor={`${id}-email`} hint="We confirm your application here. We never share it." error={problem("email")}>
        <input
          id={`${id}-email`}
          name="email"
          type="email"
          inputMode="email"
          required
          maxLength={254}
          autoComplete="email"
          placeholder="you@yourbusiness.co.za"
          className={input}
        />
      </Labelled>
      <Chips label="What does your team do?" options={trades} value={choice.trade} onChange={pick("trade")} error={problem("trade")} />
      <Chips
        label="How many people work in the field?"
        options={sizes}
        value={choice.teamSize}
        onChange={pick("teamSize")}
        error={problem("teamSize")}
      />
      <Labelled label="Which town or city?" htmlFor={`${id}-town`} error={problem("town")}>
        <input id={`${id}-town`} name="town" required maxLength={80} autoComplete="address-level2" className={input} />
      </Labelled>
      <Chips label="How do you run jobs today?" options={ways} value={choice.howRun} onChange={pick("howRun")} error={problem("howRun")} />
      <Labelled label="What costs you the most right now?" htmlFor={`${id}-cost`} error={problem("biggestCost")}>
        <textarea
          id={`${id}-cost`}
          name="biggestCost"
          rows={3}
          required
          maxLength={1000}
          placeholder="For example: my staff say they were at the client, and I can't prove it."
          className={`${input} resize-y`}
        />
      </Labelled>
      <Chips
        label={`Will your whole team use ${site.name} every workday for ${founding.days} days?`}
        options={yesNo}
        value={choice.wholeTeam}
        onChange={pick("wholeTeam")}
        error={problem("wholeTeam")}
      />
      <Chips
        label="Are you happy to do a 60-second phone video and a Google review at the end?"
        options={yesNo}
        value={choice.videoReview}
        onChange={pick("videoReview")}
        error={problem("videoReview")}
      />

      <div className="grid gap-1.5">
        <label className="flex items-start gap-3 text-sm leading-snug text-teal-100">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => {
              setAgreed(e.target.checked);
              setMissing((m) => ({ ...m, marketingOk: undefined }));
            }}
            className="mt-0.5 size-5 shrink-0 accent-amber-500"
          />
          <span>I agree that {site.name} may use my business name, logo, video and results in its marketing.</span>
        </label>
        {problem("marketingOk") && (
          <p role="alert" className={errorText}>
            {problem("marketingOk")}
          </p>
        )}
      </div>

      {/* A trap for scripts: people never see or fill this in. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Leave this empty
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      {state.kind === "error" && (
        <p role="alert" className="rounded-xl bg-white/10 px-4 py-3 text-sm font-medium text-amber-300 ring-1 ring-amber-500/40">
          {state.message}{" "}
          <a href={`mailto:${site.email}`} className="underline underline-offset-4">
            Or email {site.email}.
          </a>
        </p>
      )}

      <button
        type="submit"
        disabled={sending}
        className="w-full rounded-full bg-amber-500 px-6 py-4 text-center text-lg font-semibold text-teal-950 transition-[background-color,transform] duration-150 ease-out hover:bg-amber-400 active:scale-[0.97] disabled:opacity-70 sm:w-auto sm:py-3.5 sm:text-base"
      >
        {sending ? "Sending..." : "Send my application"}
      </button>
    </form>
  );
}
