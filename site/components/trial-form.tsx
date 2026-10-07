"use client";

import { useState } from "react";
import { contactHref, site, trialMessage, type Billing } from "@/lib/site";

const sizes = ["1 to 5", "6 to 10", "11 to 20", "More than 20"];
const plans: [Billing, string][] = [
  ["yearly", "Yearly (2 months free)"],
  ["monthly", "Monthly"],
];

// No backend: the form opens WhatsApp (or email until the WhatsApp line
// exists) with the details filled in, so the owner sends it themselves.
export function TrialForm() {
  const [values, setValues] = useState({ name: "", business: "", phone: "", size: sizes[0] });
  const [plan, setPlan] = useState<Billing>("yearly");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);

  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setValues((v) => ({ ...v, [k]: e.target.value }));
    setErrors((er) => ({ ...er, [k]: "" }));
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!values.name.trim()) next.name = "Enter your name";
    if (!values.business.trim()) next.business = "Enter your business name";
    if (values.phone.replace(/\D/g, "").length < 9) next.phone = "Enter a WhatsApp number we can reach you on";
    setErrors(next);
    if (Object.keys(next).length) return;

    const message = [
      trialMessage,
      `Name: ${values.name.trim()}`,
      `Business: ${values.business.trim()}`,
      `WhatsApp: ${values.phone.trim()}`,
      `Team size: ${values.size}`,
      `Plan: ${plans.find(([b]) => b === plan)?.[1]}`,
    ].join("\n");
    setSent(true);
    window.location.href = contactHref(message, `${site.name} trial: ${values.business.trim()}`);
  }

  const field = "w-full rounded-lg bg-sand px-3 py-2.5 text-ink ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-amber-500";
  const label = "grid gap-1.5 text-sm font-medium text-teal-100";
  const err = (k: string) =>
    errors[k] ? <span className="text-sm font-medium text-amber-400">{errors[k]}</span> : null;

  return (
    <form noValidate onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <label className={label}>
        Name
        <input className={field} autoComplete="name" value={values.name} onChange={set("name")} aria-invalid={!!errors.name} />
        {err("name")}
      </label>
      <label className={label}>
        Business
        <input className={field} autoComplete="organization" value={values.business} onChange={set("business")} aria-invalid={!!errors.business} />
        {err("business")}
      </label>
      <label className={label}>
        WhatsApp number
        <input className={field} type="tel" autoComplete="tel" value={values.phone} onChange={set("phone")} aria-invalid={!!errors.phone} />
        {err("phone")}
      </label>
      <label className={label}>
        Team size
        <select className={field} value={values.size} onChange={set("size")}>
          {sizes.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <fieldset className="grid gap-1.5 sm:col-span-2">
        <legend className="mb-1.5 text-sm font-medium text-teal-100">Plan</legend>
        <div role="radiogroup" className="flex rounded-full bg-white/10 p-1 sm:inline-flex sm:justify-self-start">
          {plans.map(([b, label]) => (
            <button
              key={b}
              type="button"
              role="radio"
              aria-checked={plan === b}
              onClick={() => setPlan(b)}
              className={`min-h-11 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition sm:flex-none sm:px-5 ${
                b === "yearly" ? "flex-1" : "flex-none"
              } ${
                plan === b ? "bg-amber-500 text-teal-950" : "text-teal-100 hover:bg-white/10"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      <button
        type="submit"
        className="w-full rounded-full bg-amber-500 px-6 py-4 text-lg font-semibold text-teal-950 transition hover:bg-amber-400 sm:col-span-2 sm:w-auto sm:justify-self-start sm:py-3.5 sm:text-base"
      >
        Start free
      </button>
      <p className="text-sm text-teal-100 sm:col-span-2">
        Free for {site.trialDays} days. We&apos;ll WhatsApp you to set up.
      </p>
      {sent && (
        <p role="status" className="font-display text-xl font-bold text-amber-400 sm:col-span-2">
          You&apos;re {site.name} in. We&apos;ll WhatsApp you soon.
        </p>
      )}
    </form>
  );
}
