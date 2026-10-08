import { lower, type Terms } from "@/lib/terms";
import { isMoneyWorkflow, type MoneySwitches, type MoneyWorkflow } from "@/lib/money-workflow";

/**
 * The set-up wizard a new company walks through after sign-up (Stage 7
 * Part 2): eight steps, each skippable, ending on the company's first quote or
 * contract. Where it is and whether it shows are the database's
 * (`my_setup()`, `save_setup_step()`); the steps and their words are here.
 */

export const SETUP_STEPS = ["welcome", "company", "documents", "workflow", "prices", "sites", "team", "done"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export function isSetupStep(v: unknown): v is SetupStep {
  return typeof v === "string" && (SETUP_STEPS as readonly string[]).includes(v);
}

export type SetupCounts = {
  sites: number;
  people: number;
  checklists: number;
  items: number;
  pricedItems: number;
  products: number;
  quotes: number;
  contracts: number;
  checkins: number;
};

export type Setup = {
  /** Still to do: a company that is not exempt and has not finished it. */
  show: boolean;
  step: SetupStep | null;
  finishedAt: string | null;
  industries: { code: string; name: string }[];
  /** How the main trade usually gets paid (its template's route). */
  tradeWorkflow: MoneyWorkflow | null;
  counts: SetupCounts;
  /** User places on the trial or plan; null for a company that has none. */
  places: { used: number; limit: number } | null;
  countryCode: string | null;
  /** The country's usual VAT rate, offered when the company charges VAT. */
  vatRateDefault: number | null;
};

function obj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) && x >= 0 ? x : 0;
}

/** `my_setup()`, checked field by field. */
export function parseSetup(raw: unknown): Setup {
  const r = obj(raw);
  const c = obj(r.counts);
  const p = obj(r.places);
  const vat = r.vat_rate_default === null || r.vat_rate_default === undefined ? NaN : Number(r.vat_rate_default);
  return {
    show: r.show === true,
    step: isSetupStep(r.step) ? r.step : null,
    finishedAt: typeof r.finished_at === "string" ? r.finished_at : null,
    industries: (Array.isArray(r.industries) ? r.industries : [])
      .map((i) => ({ code: String(obj(i).code ?? ""), name: String(obj(i).name ?? "") }))
      .filter((i) => i.code && i.name),
    tradeWorkflow: isMoneyWorkflow(r.trade_workflow) ? r.trade_workflow : null,
    counts: {
      sites: n(c.sites),
      people: n(c.people),
      checklists: n(c.checklists),
      items: n(c.items),
      pricedItems: n(c.priced_items),
      products: n(c.products),
      quotes: n(c.quotes),
      contracts: n(c.contracts),
      checkins: n(c.checkins),
    },
    places: r.places && typeof p.limit === "number" ? { used: n(p.used), limit: n(p.limit) } : null,
    countryCode: typeof r.country_code === "string" && /^[A-Z]{2}$/.test(r.country_code) ? r.country_code : null,
    vatRateDefault: Number.isFinite(vat) && vat >= 0 && vat < 100 ? vat : null,
  };
}

/** Where the wizard opens: the step the address asks for, else where it was left, else the start. */
export function openingStep(asked: string | null, saved: SetupStep | null): SetupStep {
  if (isSetupStep(asked)) return asked;
  return saved ?? "welcome";
}

export function stepIndex(step: SetupStep): number {
  return SETUP_STEPS.indexOf(step);
}

export function nextStep(step: SetupStep): SetupStep {
  return SETUP_STEPS[Math.min(SETUP_STEPS.length - 1, stepIndex(step) + 1)];
}

export function previousStep(step: SetupStep): SetupStep {
  return SETUP_STEPS[Math.max(0, stepIndex(step) - 1)];
}

export type StepText = { label: string; title: string; subtitle: string; time: string };

/** Each step's words, in the company's own terms. */
export function stepText(step: SetupStep, t: Terms, opts: { products: boolean; trade: string }): StepText {
  switch (step) {
    case "welcome":
      return {
        label: "Welcome",
        title: "Your company is ready",
        subtitle: opts.trade ? `Set up for ${lower(opts.trade)}. Here is what is already in place.` : "Here is what is already in place.",
        time: "",
      };
    case "company":
      return {
        label: "Company",
        title: "Your company",
        subtitle: "Your logo and details print on every quote and invoice.",
        time: "about 1 min",
      };
    case "documents":
      return {
        label: "Invoices",
        title: "Invoices and quotes",
        subtitle: "Tax and payment details for your documents. We filled in what we could.",
        time: "about 1 min",
      };
    case "workflow":
      return {
        label: "Get paid",
        title: "How you get paid",
        subtitle: "We picked what most companies like yours do. Change it if you work differently.",
        time: "20 sec",
      };
    case "prices":
      return opts.products
        ? { label: "Products", title: "Your products", subtitle: "What you sell, so orders can be taken.", time: "about 2 min" }
        : { label: "Prices", title: "Your prices", subtitle: "Price what you sell most. Skip any you don't.", time: "about 2 min" };
    case "sites":
      return {
        label: t.site.many,
        title: `Your ${lower(t.site.many)}`,
        subtitle: "Start with one. Add the rest now or later.",
        time: "about 2 min",
      };
    case "team":
      return {
        label: "Team",
        title: "Your team",
        subtitle: `Give each ${lower(t.staff.one)} a login. We write the WhatsApp message for you.`,
        time: "about 1 min each",
      };
    case "done":
      return { label: "Done", title: "You're ready", subtitle: "", time: "" };
  }
}

export type FirstDocument = { kind: "contract" | "quote" | "invoice"; label: string; href: string };

/**
 * The document the last step opens, so the first thing made is the one this
 * company actually sends: a contract where contracts are how it gets paid, a
 * quote where it quotes, otherwise an invoice. The first place comes along.
 */
export function firstDocument(workflow: MoneyWorkflow, sw: MoneySwitches, siteId: string | null): FirstDocument {
  const site = siteId ? `?site=${encodeURIComponent(siteId)}` : "";
  if (sw.contracts && (workflow === "contract_extras" || workflow === "contract_jobs")) {
    return { kind: "contract", label: "Create your first contract", href: `/contracts/new${site}` };
  }
  if (sw.quotes) return { kind: "quote", label: "Create your first quote", href: `/quotes/new${site}` };
  return { kind: "invoice", label: "Create your first invoice", href: "/invoices/new" };
}

/** Bank details as the four lines an invoice prints, from the four boxes. */
export function bankDetailsText(b: { bank: string; accountName: string; accountNumber: string; branchCode: string }): string {
  return [
    b.bank.trim() && `Bank: ${b.bank.trim()}`,
    b.accountName.trim() && `Account name: ${b.accountName.trim()}`,
    b.accountNumber.trim() && `Account number: ${b.accountNumber.trim()}`,
    b.branchCode.trim() && `Branch code: ${b.branchCode.trim()}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** The four boxes from saved bank details: lines this wizard wrote are read back; anything else stays whole in "Bank". */
export function bankDetailsBoxes(text: string | null): { bank: string; accountName: string; accountNumber: string; branchCode: string } {
  const out = { bank: "", accountName: "", accountNumber: "", branchCode: "" };
  if (!text?.trim()) return out;
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const labelled = lines.every((l) => /^(Bank|Account name|Account number|Branch code): /.test(l));
  if (!labelled) return { ...out, bank: text.trim() };
  for (const l of lines) {
    const [label, ...rest] = l.split(": ");
    const value = rest.join(": ");
    if (label === "Bank") out.bank = value;
    else if (label === "Account name") out.accountName = value;
    else if (label === "Account number") out.accountNumber = value;
    else if (label === "Branch code") out.branchCode = value;
  }
  return out;
}
