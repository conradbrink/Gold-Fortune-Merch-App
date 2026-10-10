"use client";

import { useId, useState, type ReactNode } from "react";
import { founding, site } from "@/lib/site";

// The Founding 10 application. It replaces the old "start the free trial"
// button: the form is posted to the app (`founding.apiUrl`), which saves it
// and emails the owner, and the owner answers on WhatsApp. Five short fields
// and one optional one, because each extra field costs applications. The trade
// codes are the app's `industry_templates`, so what is chosen here is what the
// business is set up with.

const trades: [string, string][] = [
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

const sizes: [string, string][] = [
  ["1 to 2", "1-2"],
  ["3 to 5", "3-5"],
  ["6 to 15", "6-15"],
  ["16 or more", "16+"],
];

type Field = "name" | "whatsapp" | "businessName" | "trade" | "teamSize" | "headache";
type Issue = { field: Field; message: string };
type State =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "error"; message: string; issues: Issue[] }
  | { kind: "done"; name: string; waitlist: boolean };

const input =
  "min-h-12 w-full rounded-xl border-0 bg-white px-4 py-3 text-base text-ink ring-1 ring-white/30 placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-amber-500";

function Chips({
  label,
  options,
  value,
  onChange,
  error,
}: {
  label: string;
  options: [string, string][];
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
        <p role="alert" className="text-sm font-medium text-amber-300">
          {error}
        </p>
      )}
    </fieldset>
  );
}

function Labelled({ label, htmlFor, hint, error, children }: { label: string; htmlFor: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-teal-100">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-sm text-teal-100/80">{hint}</p>}
      {error && (
        <p role="alert" className="text-sm font-medium text-amber-300">
          {error}
        </p>
      )}
    </div>
  );
}

export function ApplyForm() {
  const id = useId();
  const [state, setState] = useState<State>({ kind: "idle" });
  const [trade, setTrade] = useState("");
  const [teamSize, setTeamSize] = useState("");
  const [tradeMissing, setTradeMissing] = useState(false);
  const [sizeMissing, setSizeMissing] = useState(false);

  const issues = state.kind === "error" ? state.issues : [];
  const problem = (f: Field) => issues.find((i) => i.field === f)?.message;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state.kind === "sending") return;
    const form = new FormData(e.currentTarget);
    const text = (k: string) => String(form.get(k) ?? "");
    setTradeMissing(!trade);
    setSizeMissing(!teamSize);
    if (!trade || !teamSize) return;

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
          whatsapp: text("whatsapp"),
          businessName: text("businessName"),
          trade,
          teamSize,
          headache: text("headache"),
          website: text("website"),
          source: src,
        }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; waitlist?: boolean; error?: string; issues?: Issue[] } | null;
      if (res.ok && body?.ok) {
        setState({ kind: "done", name: text("name").trim(), waitlist: body.waitlist === true });
        return;
      }
      setState({
        kind: "error",
        message: body?.issues?.length ? "Please check the details below." : (body?.error ?? "That did not go through. Please try again."),
        issues: body?.issues ?? [],
      });
    } catch {
      setState({ kind: "error", message: "We could not reach the server. Please check your signal and try again.", issues: [] });
    }
  }

  if (state.kind === "done") {
    return (
      <div role="status" className="grid gap-3 rounded-2xl bg-white/10 p-5 ring-1 ring-white/20 sm:p-6">
        <p className="font-display text-2xl font-bold text-amber-500">Thank you, {state.name}.</p>
        {state.waitlist ? (
          <p className="leading-relaxed text-teal-100 sm:text-lg">
            All the Founding spots are taken, so you are on the waiting list. We message you on WhatsApp as soon as a spot opens.
          </p>
        ) : (
          <p className="leading-relaxed text-teal-100 sm:text-lg">
            We will message you on WhatsApp within {founding.replyWithin}. If you are a fit, your spot is yours, and we set up your team so you are running in {founding.runningIn}.
          </p>
        )}
      </div>
    );
  }

  const sending = state.kind === "sending";
  return (
    <form onSubmit={submit} className="grid gap-5" noValidate={false}>
      <div className="grid gap-5 sm:grid-cols-2">
        <Labelled label="Your first name" htmlFor={`${id}-name`} error={problem("name")}>
          <input id={`${id}-name`} name="name" required maxLength={80} autoComplete="given-name" className={input} />
        </Labelled>
        <Labelled
          label="Your WhatsApp number"
          htmlFor={`${id}-wa`}
          hint="We reply here. We never share it."
          error={problem("whatsapp")}
        >
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
      </div>
      <Labelled label="Your business's name" htmlFor={`${id}-biz`} error={problem("businessName")}>
        <input id={`${id}-biz`} name="businessName" required maxLength={120} autoComplete="organization" className={input} />
      </Labelled>
      <Chips
        label="What does your team do?"
        options={trades}
        value={trade}
        onChange={(v) => {
          setTrade(v);
          setTradeMissing(false);
        }}
        error={tradeMissing ? "Choose what your team does." : problem("trade")}
      />
      <Chips
        label="How many people work on site?"
        options={sizes}
        value={teamSize}
        onChange={(v) => {
          setTeamSize(v);
          setSizeMissing(false);
        }}
        error={sizeMissing ? "Choose how many people work on site." : problem("teamSize")}
      />
      <Labelled label="What is your biggest headache right now? (optional)" htmlFor={`${id}-ache`} error={problem("headache")}>
        <textarea
          id={`${id}-ache`}
          name="headache"
          rows={3}
          maxLength={1000}
          placeholder="For example: my staff say they were at the client, and I can't prove it."
          className={`${input} resize-y`}
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

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
        <button
          type="submit"
          disabled={sending}
          className="w-full rounded-full bg-amber-500 px-6 py-4 text-center text-lg font-semibold text-teal-950 transition-[background-color,transform] duration-150 ease-out hover:bg-amber-400 active:scale-[0.97] disabled:opacity-70 sm:w-auto sm:py-3.5 sm:text-base"
        >
          {sending ? "Sending..." : "Apply for a Founding spot"}
        </button>
        <p className="text-sm text-teal-100">No card. No contract. We reply on WhatsApp within {founding.replyWithin}.</p>
      </div>
    </form>
  );
}
