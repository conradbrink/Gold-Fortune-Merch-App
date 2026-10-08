/**
 * Billing for the company's own pages and the operator's (Stage 6): the shapes
 * the `billing_*` functions return, read field by field, and how amounts and
 * states are written. Pure, so the pages and tests share it. Every amount is
 * worked out in the database (`billing_lines`); nothing here prices anything.
 */

export type Period = "monthly" | "yearly";
export type AccountStatus = "trial" | "active" | "past_due" | "read_only" | "cancelled" | "exempt";
export type Plan = { seats: number; addons: Record<string, number> };
export type Line = {
  code: string;
  label: string;
  quantity: number;
  unitCents: number;
  amountCents: number;
  once: boolean;
  prorated: boolean;
};
export type Quote = {
  lines: Line[];
  totalCents: number;
  custom: boolean;
  seatsUsed: number | null;
  vatCents: number;
  vatRegistered: boolean;
};
export type ChangePreview = {
  lines: Line[];
  totalCents: number;
  nextTotalCents: number;
  more: boolean;
  less: boolean;
  periodEnd: string | null;
  seatsUsed: number | null;
};
export type Account = {
  status: AccountStatus;
  writable: boolean;
  trialEndsAt: string | null;
  periodEnd: string | null;
  graceEndsAt: string | null;
  readOnlySince: string | null;
  cancelAtPeriodEnd: boolean;
  canManage: boolean;
};

function obj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : fallback;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

const STATUSES: AccountStatus[] = ["trial", "active", "past_due", "read_only", "cancelled", "exempt"];
export function parseStatus(v: unknown): AccountStatus {
  return STATUSES.includes(v as AccountStatus) ? (v as AccountStatus) : "exempt";
}

export function parseLines(v: unknown): Line[] {
  return (Array.isArray(v) ? v : []).map((l) => {
    const o = obj(l);
    return {
      code: typeof o.code === "string" ? o.code : "",
      label: typeof o.label === "string" ? o.label : "",
      quantity: num(o.quantity, 1),
      unitCents: num(o.unit_cents),
      amountCents: num(o.amount_cents),
      once: o.once === true,
      prorated: o.prorated === true,
    };
  });
}

export function parseQuote(raw: unknown): Quote {
  const r = obj(raw);
  const vat = obj(r.vat);
  return {
    lines: parseLines(r.lines),
    totalCents: num(r.total_cents),
    custom: r.custom === true,
    seatsUsed: r.seats_used === undefined ? null : num(r.seats_used),
    vatCents: num(vat.vat_cents),
    vatRegistered: vat.registered === true,
  };
}

export function parseChangePreview(raw: unknown): ChangePreview {
  const r = obj(raw);
  return {
    lines: parseLines(r.lines),
    totalCents: num(r.total_cents),
    nextTotalCents: num(r.next_total_cents),
    more: r.more === true,
    less: r.less === true,
    periodEnd: str(r.period_end),
    seatsUsed: r.seats_used === undefined ? null : num(r.seats_used),
  };
}

export function parseAccount(raw: unknown): Account {
  const r = obj(raw);
  return {
    status: parseStatus(r.status),
    writable: r.writable !== false,
    trialEndsAt: str(r.trial_ends_at),
    periodEnd: str(r.period_end),
    graceEndsAt: str(r.grace_ends_at),
    readOnlySince: str(r.read_only_since),
    cancelAtPeriodEnd: r.cancel_at_period_end === true,
    canManage: r.can_manage === true,
  };
}

export function parsePlan(raw: unknown): Plan | null {
  const r = obj(raw);
  const seats = num(r.seats, 0);
  if (seats < 1) return null;
  const addons: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(r.addons))) {
    const q = num(v, 0);
    if (q > 0) addons[k] = q;
  }
  return { seats, addons };
}

/** Rand, as the sales site writes it: "R1,499", with cents only when there are some ("R1,163.47"). */
export function formatRand(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  const rest = abs % 100;
  return `${negative ? "-" : ""}R${whole}${rest ? `.${String(rest).padStart(2, "0")}` : ""}`;
}

/** Always with cents, for invoices: "R1,499.00". */
export function formatRandExact(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  return `${negative ? "-" : ""}R${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : dateFormat.format(d);
}

export function periodWord(period: Period | string | null | undefined): string {
  return period === "yearly" ? "year" : "month";
}

export const STATUS_LABEL: Record<AccountStatus, string> = {
  trial: "Free trial",
  active: "Paid",
  past_due: "Payment failed",
  read_only: "Read-only",
  cancelled: "Plan ended",
  exempt: "Managed by us",
};

/** The banner every user sees when the company cannot save (read-only), or is about to. */
export function accountNotice(a: Account, now: Date = new Date()): { tone: "red" | "amber"; text: string } | null {
  if (a.status === "read_only") {
    return a.trialEndsAt && !a.periodEnd
      ? { tone: "red", text: "Your free trial has ended, so your account is read-only. Choose a plan to keep working." }
      : { tone: "red", text: "Your account is read-only until the plan is paid." };
  }
  if (a.status === "cancelled") return { tone: "red", text: "Your plan has ended, so your account is read-only. Choose a plan to keep working." };
  if (a.status === "past_due") {
    const by = formatDate(a.graceEndsAt);
    return { tone: "red", text: `Your last payment did not go through. Update your card${by ? ` before ${by}` : ""} to keep working.` };
  }
  if (a.status === "active" && a.cancelAtPeriodEnd && a.periodEnd && new Date(a.periodEnd) > now) {
    return { tone: "amber", text: `Your plan ends on ${formatDate(a.periodEnd)}.` };
  }
  return null;
}

/**
 * A refusal from the database, in words for the screen. The read-only gate and
 * the user limit carry a hint; anything else is shown as the database wrote it.
 */
export function billingErrorMessage(error: { message?: string; hint?: string | null; code?: string } | null): string | null {
  if (!error) return null;
  if (error.hint === "read_only") return "Your account is read-only until the plan is paid. Open Billing to choose a plan.";
  if (error.hint === "user_limit") return `${error.message ?? "All user places on your plan are taken."} Add users on the Billing page.`;
  if (error.hint === "quote") return error.message ?? "This is priced on request. Talk to us.";
  return error.message ?? "Something went wrong.";
}

/** The plan as the page edits it: seats at least 1, add-on quantities 0 to 100, whole numbers. */
export function normalisePlan(seats: number, addons: Record<string, number>): Plan {
  const clean: Record<string, number> = {};
  for (const [k, v] of Object.entries(addons)) {
    const q = Math.max(0, Math.min(100, Math.floor(Number(v) || 0)));
    if (/^[a-z][a-z_]*$/.test(k) && q > 0) clean[k] = q;
  }
  return { seats: Math.max(1, Math.min(1000, Math.floor(Number(seats) || 1))), addons: clean };
}
