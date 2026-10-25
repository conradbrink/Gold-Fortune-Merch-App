"use client";

import { useEffect, useId, useRef, useState } from "react";
import { founding, site } from "@/lib/site";
import { track } from "@/components/analytics";
import { FoundingVideo } from "@/components/founding-video";
import {
  Chips,
  Labelled,
  MultiChips,
  input,
  offeredTypes,
  products,
  sendApplication,
  useFormFunnel,
  type Option,
} from "@/components/founding-form";

// The Founding 10 form on /founding, for the sales process the owner set on 25
// Oct 2026: Conrad calls each applicant within minutes, so the form asks for
// as little as it can and who decides (their role), and the thank-you screen
// says who will call and from which number. Required: their name (one box),
// the business, WhatsApp, how many reps and their role. Optional: what they
// distribute, their email, and the consent to be contacted (ticked to start). The main page
// keeps the form before it (components/founding-form.tsx); the app takes both.

// The countries we sell in, with how many digits a number has after the
// country code (and without South Africa's leading 0). The number is sent with
// its country code.
const countries: { label: string; code: string; digits: number; example: string }[] = [
  { label: "🇿🇦 +27", code: "+27", digits: 9, example: "082 123 4567" },
  { label: "🇧🇼 +267", code: "+267", digits: 8, example: "71 234 567" },
];

const sizes: Option[] = [
  ["1 to 2", "1-2"],
  ["3 to 5", "3-5"],
  ["6 to 10", "6-10"],
  ["11 to 15", "11-15"],
  ["16 to 30", "16-30"],
  ["More than 30", "31+"],
];

const roles: Option[] = [
  ["Owner or MD", "owner"],
  ["Sales manager", "sales_manager"],
  ["Other", "other"],
];

type Field = "name" | "businessName" | "whatsapp" | "teamSize" | "role" | "distributes" | "email";

// The funnel's section for each box (FORM_FIELDS in the app's lib/acquisition.ts).
const boxKey: Record<string, string> = {
  name: "name",
  businessName: "business_name",
  whatsapp: "whatsapp",
  email: "email",
  contactOk: "consent",
};
const issueKey: Record<Field, string> = {
  name: "name",
  businessName: "business_name",
  whatsapp: "whatsapp",
  teamSize: "team_size",
  role: "role",
  distributes: "distributes",
  email: "email",
};
type Issue = { field: Field; message: string };
type State =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "error"; message: string; issues: Issue[] }
  | { kind: "done"; waitlist: boolean; already: boolean; firstName: string };

// The country picker sits beside the number box at its own width (the boxes' own
// style is full width, which squeezed the number box to nothing).
const countryPicker = `${input.replace("w-full", "w-auto").replace("px-4", "")} shrink-0 pl-3 pr-8`;

/**
 * The number as typed, with the chosen country code unless they typed one: with
 * a + or 00, or the code's own digits without the + ("27 82 123 4567" is
 * +27821234567, not +2727821234567, which the app would take and nobody could
 * reach).
 */
function fullNumber(code: string, digits: number, raw: string): string {
  const t = raw.trim();
  const d = t.replace(/\D/g, "");
  if (t.startsWith("+") || d.startsWith("00")) return t;
  const cc = code.replace("+", "");
  if (d.startsWith(cc) && d.length === cc.length + digits) return `+${d}`;
  return `${code}${d.replace(/^0+/, "")}`;
}

export function FoundingCallForm() {
  const id = useId();
  const { started, once, focused, left, invalid } = useFormFunnel(boxKey);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [country, setCountry] = useState(countries[0].code);
  const [teamSize, setTeamSize] = useState("");
  const [role, setRole] = useState("");
  const [distributes, setDistributes] = useState<string[]>([]);
  const [trade] = useState(offeredTypes.length === 1 ? offeredTypes[0][1] : "");
  const [missing, setMissing] = useState<Partial<Record<Field, string>>>({});

  // The thank-you is much shorter than the form, so after Send the page moves
  // up under the visitor and the message lands above the screen. Bring it back.
  const doneRef = useRef<HTMLDivElement>(null);
  const done = state.kind === "done";
  useEffect(() => {
    if (!done) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    doneRef.current?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }, [done]);

  const pick = (key: "team_size" | "role", field: Field, set: (v: string) => void) => (v: string) => {
    started();
    once("signup_field", key);
    once("signup_filled", key);
    set(v);
    setMissing((m) => ({ ...m, [field]: undefined }));
  };
  const toggleProduct = (v: string) => {
    started();
    once("signup_field", "distributes");
    once("signup_filled", "distributes");
    setDistributes((cur) => (cur.includes(v) ? cur.filter((c) => c !== v) : products.filter((p) => p === v || cur.includes(p))));
  };
  const issues = state.kind === "error" ? state.issues : [];
  const problem = (f: Field) => missing[f] ?? issues.find((i) => i.field === f)?.message;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state.kind === "sending") return;
    const form = new FormData(e.currentTarget);
    const text = (k: string) => String(form.get(k) ?? "");

    track("signup_submitted");
    const gaps: Partial<Record<Field, string>> = {};
    if (!teamSize) gaps.teamSize = "Choose how many reps you have.";
    if (!role) gaps.role = "Choose your role.";
    setMissing(gaps);
    if (Object.keys(gaps).length > 0) {
      for (const f of Object.keys(gaps) as Field[]) track("signup_error", { section: issueKey[f] });
      return;
    }

    setState({ kind: "sending" });
    const name = text("name").trim();
    const picked = countries.find((c) => c.code === country) ?? countries[0];
    const result = await sendApplication(
      {
        name,
        businessName: text("businessName"),
        whatsapp: fullNumber(picked.code, picked.digits, text("whatsapp")),
        teamSize,
        role,
        distributes: distributes.join(", "),
        email: text("email"),
        contactOk: form.get("contactOk") === "on",
        trade,
        website: text("website"),
      },
      issueKey,
    );
    setState(result.kind === "done" ? { ...result, firstName: name.split(/\s+/)[0] ?? "" } : result);
  }

  if (state.kind === "done") {
    const thanks = state.firstName ? `Thanks, ${state.firstName}.` : "Thanks.";
    return (
      <div ref={doneRef} role="status" className="grid scroll-mt-28 gap-4 rounded-2xl bg-white/10 p-5 ring-1 ring-white/20 sm:p-6">
        {state.already ? (
          <>
            <p className="font-display text-2xl font-bold text-amber-500">You&apos;ve already applied.</p>
            <p className="leading-relaxed text-teal-100 sm:text-lg">
              We already have your application, so there&apos;s no need to send it again. To change your details, email{" "}
              {site.email}.
            </p>
          </>
        ) : state.waitlist ? (
          <>
            <p className="font-display text-2xl font-bold text-amber-500">{thanks} You&apos;re on the waiting list.</p>
            <p className="leading-relaxed text-teal-100 sm:text-lg">
              All the spots are taken, so you are on the waiting list. If one opens, {founding.caller} will call you from{" "}
              <strong className="whitespace-nowrap text-sand">{founding.callerNumber}</strong>.
            </p>
          </>
        ) : (
          <>
            <p className="font-display text-2xl font-bold leading-snug text-amber-500">
              {thanks} {founding.caller} will call you in the next few minutes.
            </p>
            <p className="leading-relaxed text-teal-100 sm:text-lg">
              He&apos;ll call or WhatsApp you from <strong className="whitespace-nowrap text-sand">{founding.callerNumber}</strong>.
              Save the number so you know it&apos;s him.
            </p>
          </>
        )}
        <div className="grid gap-3">
          <p className="font-semibold text-sand">While you wait, watch how it works (3 minutes).</p>
          <FoundingVideo />
        </div>
      </div>
    );
  }

  const sending = state.kind === "sending";
  const example = countries.find((c) => c.code === country)?.example ?? "";
  return (
    <form onSubmit={submit} onFocusCapture={focused} onBlurCapture={left} onInvalidCapture={invalid} className="grid gap-5">
      <Labelled label="Your name" htmlFor={`${id}-name`} error={problem("name")}>
        <input id={`${id}-name`} name="name" required maxLength={80} autoComplete="name" className={input} />
      </Labelled>
      <Labelled label="Business name" htmlFor={`${id}-biz`} error={problem("businessName")}>
        <input id={`${id}-biz`} name="businessName" required maxLength={120} autoComplete="organization" className={input} />
      </Labelled>
      <Labelled label="WhatsApp number" htmlFor={`${id}-wa`} hint="We never share your number." error={problem("whatsapp")}>
        <div className="flex gap-2">
          <select
            aria-label="Country code"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className={countryPicker}
          >
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
          <input
            id={`${id}-wa`}
            name="whatsapp"
            type="tel"
            inputMode="tel"
            required
            maxLength={25}
            autoComplete="tel-national"
            placeholder={example}
            className={`${input} min-w-0 flex-1`}
          />
        </div>
      </Labelled>
      <Chips
        label="How many reps do you have?"
        options={sizes}
        value={teamSize}
        onChange={pick("team_size", "teamSize", setTeamSize)}
        error={problem("teamSize")}
      />
      <Chips label="Your role" options={roles} value={role} onChange={pick("role", "role", setRole)} error={problem("role")} />
      <MultiChips
        label="What do you distribute?"
        options={products}
        value={distributes}
        onToggle={toggleProduct}
        error={problem("distributes")}
      />
      <Labelled label="Email address" htmlFor={`${id}-email`} hint="Optional. For your confirmation." error={problem("email")}>
        <input
          id={`${id}-email`}
          name="email"
          type="email"
          inputMode="email"
          maxLength={254}
          autoComplete="email"
          placeholder="you@yourbusiness.co.za"
          className={input}
        />
      </Labelled>
      <div className="grid gap-1.5">
        <label className="flex items-start gap-3 text-sm leading-snug text-teal-100">
          {/* Ticked to start with; they can untick it and still apply (owner,
              25 Oct 2026). The app records the answer either way. */}
          <input
            name="contactOk"
            type="checkbox"
            defaultChecked
            // Already ticked, so "answered" here means they touched it.
            onChange={() => once("signup_filled", "consent")}
            className="mt-0.5 size-5 shrink-0 accent-amber-500"
          />
          <span>
            {site.name} may contact me on WhatsApp, phone and email about my pilot.{" "}
            <a href="/privacy" target="_blank" className="font-semibold text-sand underline underline-offset-2">
              Privacy policy
            </a>
          </span>
        </label>
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
        {sending ? "Sending..." : "Apply now"}
      </button>
    </form>
  );
}
