"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { founding, site } from "@/lib/site";
import { trackLead } from "@/components/meta-pixel";
import { track } from "@/components/analytics";
import { firstVisit } from "@/lib/first-visit";

// The Founding 10 application on /founding. It is posted to the app
// (`founding.apiUrl`), which saves it, emails the owner and lists it under
// /platform/founding. All required: the applicant's first and last name (sent
// as one `name`), the business's name, how many staff, WhatsApp and email. On
// 11 Oct 2026 the owner cut it from eleven answers, after no ad visitor
// finished the long form.

type Option = [label: string, value: string];

const sizes: Option[] = [
  ["1 to 4", "1-4"],
  ["5 to 10", "5-10"],
  ["11 to 25", "11-25"],
  ["26 to 50", "26-50"],
  ["50+", "50+"],
];

type Field = "name" | "businessName" | "teamSize" | "whatsapp" | "email";

// Where visitors stop (the owner's ask, 11 Oct 2026, after 3 started and none
// sent): each box sends `signup_field` the first time it takes focus and
// `signup_filled` the first time it is left with an answer; a press of Send
// sends `signup_submitted`, and anything that stops it sends `signup_error`.
// The section is the box's key below; the Control Centre's funnel page reads
// them in this order (FORM_FIELDS in the app's lib/acquisition.ts).
const boxKey: Record<string, string> = {
  firstName: "first_name",
  lastName: "last_name",
  businessName: "business_name",
  whatsapp: "whatsapp",
  email: "email",
};
const issueKey: Record<Field, string> = {
  name: "first_name",
  businessName: "business_name",
  teamSize: "team_size",
  whatsapp: "whatsapp",
  email: "email",
};
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
  const [teamSize, setTeamSize] = useState("");
  const [missing, setMissing] = useState<Partial<Record<Field, string>>>({});

  const pickSize = (v: string) => {
    started();
    once("signup_field", "team_size");
    once("signup_filled", "team_size");
    setTeamSize(v);
    setMissing((m) => ({ ...m, teamSize: undefined }));
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

  // Each box's first focus and first answer, once per page load.
  const sentRef = useRef(new Set<string>());
  function once(event: "signup_field" | "signup_filled", key: string) {
    const k = `${event}:${key}`;
    if (sentRef.current.has(k)) return;
    sentRef.current.add(k);
    track(event, { section: key });
  }
  const keyOf = (t: EventTarget) => (t instanceof HTMLInputElement ? boxKey[t.name] : undefined);
  function focused(e: React.FocusEvent<HTMLFormElement>) {
    started();
    const key = keyOf(e.target);
    if (key) once("signup_field", key);
  }
  function left(e: React.FocusEvent<HTMLFormElement>) {
    const key = keyOf(e.target);
    if (key && e.target instanceof HTMLInputElement && e.target.value.trim()) once("signup_filled", key);
  }
  // The browser's own check (an empty or badly written box) stops Send before
  // `submit` runs; this is the only sign of it.
  function invalid(e: React.FormEvent<HTMLFormElement>) {
    const key = keyOf(e.target);
    if (key) track("signup_error", { section: key });
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state.kind === "sending") return;
    const form = new FormData(e.currentTarget);
    const text = (k: string) => String(form.get(k) ?? "");

    track("signup_submitted");
    const gaps: Partial<Record<Field, string>> = {};
    if (!teamSize) gaps.teamSize = "Choose how many staff you have.";
    setMissing(gaps);
    if (Object.keys(gaps).length > 0) {
      track("signup_error", { section: "team_size" });
      return;
    }

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
          name: `${text("firstName").trim()} ${text("lastName").trim()}`.trim(),
          businessName: text("businessName"),
          teamSize,
          whatsapp: text("whatsapp"),
          email: text("email"),
          website: text("website"),
          source: src,
          attribution: firstVisit(),
        }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; waitlist?: boolean; error?: string; issues?: Issue[] } | null;
      if (res.ok && body?.ok) {
        trackLead();
        track("signup_completed", { waitlist: body.waitlist === true });
        setState({ kind: "done", waitlist: body.waitlist === true });
        return;
      }
      const turnedBack = body?.issues?.length ? body.issues.map((i) => issueKey[i.field]).filter(Boolean) : [];
      for (const key of new Set(turnedBack)) track("signup_error", { section: key });
      if (turnedBack.length === 0) track("signup_error", { section: `server-${res.status}` });
      setState({
        kind: "error",
        message: body?.issues?.length ? "Please check the details marked below." : (body?.error ?? "That did not go through. Please try again."),
        issues: body?.issues ?? [],
      });
    } catch {
      track("signup_error", { section: "network" });
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
    <form onSubmit={submit} onFocusCapture={focused} onBlurCapture={left} onInvalidCapture={invalid} className="grid gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Labelled label="First name" htmlFor={`${id}-first`} error={problem("name")}>
          <input id={`${id}-first`} name="firstName" required maxLength={40} autoComplete="given-name" className={input} />
        </Labelled>
        <Labelled label="Last name" htmlFor={`${id}-last`}>
          <input id={`${id}-last`} name="lastName" required maxLength={39} autoComplete="family-name" className={input} />
        </Labelled>
      </div>
      <Labelled label="Business name" htmlFor={`${id}-biz`} error={problem("businessName")}>
        <input id={`${id}-biz`} name="businessName" required maxLength={120} autoComplete="organization" className={input} />
      </Labelled>
      <Chips label="How many staff do you have?" options={sizes} value={teamSize} onChange={pickSize} error={problem("teamSize")} />
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
