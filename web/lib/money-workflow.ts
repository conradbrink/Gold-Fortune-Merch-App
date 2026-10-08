import { lower, type Terms } from "@/lib/terms";
import { moduleEnabled, type ModuleSet } from "@/lib/modules";

/**
 * How a company gets paid: the route its trade usually takes from first
 * contact to payment, and the four switches that decide which documents and
 * buttons its office sees.
 *
 * The route is a company setting (`money_workflow`), seeded from its industry
 * template; the switches are settings too (`money_quotes`, `money_deposits`,
 * `money_invoice_from_jobs`, `money_invoice_direct`) and the database refuses
 * what they switch off. Picking a route on the settings page sets the switches
 * to its usual values; each can still be changed on its own.
 */

export const MONEY_WORKFLOWS = [
  "quote_job_invoice",
  "quote_deposit_final",
  "contract_extras",
  "contract_jobs",
  "jobs_monthly",
  "order_invoice",
  "flexible",
] as const;

export type MoneyWorkflow = (typeof MONEY_WORKFLOWS)[number];

export type MoneySwitches = {
  /** Quotes can be written. */
  quotes: boolean;
  /** An accepted quote can be invoiced as a deposit, then the balance. */
  deposits: boolean;
  /** Completed work can be invoiced. */
  jobs: boolean;
  /** An invoice can be typed in directly. */
  direct: boolean;
  /** Fixed-fee contracts per site, invoiced automatically each period. */
  contracts: boolean;
};

export function isMoneyWorkflow(v: unknown): v is MoneyWorkflow {
  return typeof v === "string" && (MONEY_WORKFLOWS as readonly string[]).includes(v);
}

/** Each route's name, what it means, and the switches it usually goes with. */
export function workflowPreset(
  w: MoneyWorkflow,
  t: Terms
): { label: string; description: string; switches: MoneySwitches } {
  const job = lower(t.job.one);
  const jobs = lower(t.job.many);
  const client = lower(t.client.one);
  switch (w) {
    case "quote_job_invoice":
      return {
        label: `Quote, do the ${job}, invoice`,
        description: `A quote first; once it is accepted and the ${job} is done, invoice it.`,
        switches: { quotes: true, deposits: false, jobs: true, direct: true, contracts: false },
      };
    case "quote_deposit_final":
      return {
        label: "Quote, deposit, final invoice",
        description: `A quote first; on acceptance a deposit invoice, and the balance when the ${job} is finished.`,
        switches: { quotes: true, deposits: true, jobs: true, direct: true, contracts: false },
      };
    case "contract_extras":
      return {
        label: "Contracts, plus quoted extras",
        description: `A fixed fee per ${client}, invoiced automatically each month or quarter; once-off extras quoted.`,
        switches: { quotes: true, deposits: false, jobs: true, direct: true, contracts: true },
      };
    case "contract_jobs":
      return {
        label: "Contracts and once-off jobs",
        description: `Contracts invoiced automatically, and once-off ${jobs} invoiced as they are done.`,
        switches: { quotes: true, deposits: false, jobs: true, direct: true, contracts: true },
      };
    case "jobs_monthly":
      return {
        label: `The month's ${jobs}, one invoice`,
        description: `At month end, one invoice per ${client} for the ${jobs} done.`,
        switches: { quotes: true, deposits: false, jobs: true, direct: true, contracts: false },
      };
    case "order_invoice":
      return {
        label: "Order, deliver, invoice",
        description: "Orders are taken, delivered, and invoiced from the order.",
        switches: { quotes: true, deposits: false, jobs: false, direct: false, contracts: false },
      };
    case "flexible":
      return {
        label: "Flexible",
        description: "Every way of quoting and invoicing is available.",
        switches: { quotes: true, deposits: true, jobs: true, direct: true, contracts: true },
      };
  }
}

export type InvoiceSource = "order" | "quote" | "jobs" | "direct";

/**
 * The ways this company can start an invoice, in the order the "New invoice"
 * page offers them. An order invoice is started from the order itself, so it is
 * listed only to explain where it comes from.
 */
export function invoiceSources(sw: MoneySwitches, modules: ModuleSet): InvoiceSource[] {
  const out: InvoiceSource[] = [];
  if (sw.jobs) out.push("jobs");
  if (sw.quotes) out.push("quote");
  if (sw.direct) out.push("direct");
  if (moduleEnabled(modules, "distribution")) out.push("order");
  return out;
}

/** Whether the price list matters to this company: it quotes or invoices services. */
export function usesPriceList(sw: MoneySwitches, modules: ModuleSet): boolean {
  return sw.jobs || sw.direct || sw.contracts || (sw.quotes && !moduleEnabled(modules, "distribution"));
}

/** The switches as the company's settings hold them. */
export function switchesOf(settings: {
  money_quotes: boolean;
  money_deposits: boolean;
  money_invoice_from_jobs: boolean;
  money_invoice_direct: boolean;
  money_contracts: boolean;
}): MoneySwitches {
  return {
    quotes: settings.money_quotes,
    deposits: settings.money_deposits,
    jobs: settings.money_invoice_from_jobs,
    direct: settings.money_invoice_direct,
    contracts: settings.money_contracts,
  };
}

/** The five switches as the settings page and the set-up wizard offer them. */
export function switchToggles(t: Terms): { key: keyof MoneySwitches; label: string; hint: string }[] {
  return [
    { key: "quotes", label: "Quotes", hint: "Send quotes before the work." },
    { key: "deposits", label: "Deposits", hint: "Invoice part of an accepted quote up front, and the balance at the end." },
    {
      key: "jobs",
      label: `Invoice completed ${lower(t.job.many)}`,
      hint: `Pick a ${lower(t.site.one)} and a period, and invoice the finished ${lower(t.job.many)}.`,
    },
    { key: "direct", label: "Direct invoices", hint: "Type an invoice in without a quote or a job." },
    {
      key: "contracts",
      label: "Contracts",
      hint: `A fixed fee per ${lower(t.site.one)}, invoiced automatically each month or quarter.`,
    },
  ];
}
