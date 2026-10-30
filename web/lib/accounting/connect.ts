/**
 * What the Sage tab sends to /api/accounting/sage, read and checked. Pure, so
 * the route and its tests share it.
 *
 *   check       a Sage login: which companies it opens, and each one's bank
 *               accounts (nothing is stored);
 *   connect     the same login, the company and bank account chosen, and the
 *               day to send documents from: stored, and what is due queued;
 *   disconnect  forgets the login. What is waiting stays queued, and goes if
 *               Sage is connected again.
 */

export type CheckInput = { step: "check"; username: string; password: string };
export type ConnectInput = {
  step: "connect";
  username: string;
  password: string;
  companyId: number;
  bankAccountId: number;
  syncFrom: string;
};
export type SageInput = CheckInput | ConnectInput | { step: "disconnect" };

export type SageCompanyChoice = {
  id: number;
  name: string;
  bankAccounts: { id: number; name: string; isDefault: boolean }[];
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A yyyy-mm-dd day between a year before `today` and `today`. */
export function sendFromDay(value: unknown, today: string): string | null {
  if (typeof value !== "string" || !DAY.test(value) || !DAY.test(today)) return null;
  const day = new Date(`${value}T00:00:00Z`);
  const now = new Date(`${today}T00:00:00Z`);
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== value) return null;
  const earliest = new Date(now);
  earliest.setUTCFullYear(now.getUTCFullYear() - 1);
  return day > now || day < earliest ? null : value;
}

/** Today in a time zone, as yyyy-mm-dd. */
export function dayIn(timeZone: string, at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

const id = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);

export function readSageInput(body: unknown, today: string): SageInput | { error: string } {
  if (!body || typeof body !== "object") return { error: "Nothing was sent." };
  const b = body as Record<string, unknown>;
  if (b.step === "disconnect") return { step: "disconnect" };
  if (b.step !== "check" && b.step !== "connect") return { error: "Unknown step." };

  const username = typeof b.username === "string" ? b.username.trim() : "";
  const password = typeof b.password === "string" ? b.password : "";
  if (!username || username.length > 254) return { error: "Enter the email you sign in to Sage with." };
  if (!password || password.length > 200) return { error: "Enter the Sage password." };
  if (b.step === "check") return { step: "check", username, password };

  const companyId = id(b.companyId);
  const bankAccountId = id(b.bankAccountId);
  if (!companyId) return { error: "Choose the Sage company." };
  if (!bankAccountId) return { error: "Choose the bank account payments go into." };
  const syncFrom = sendFromDay(b.syncFrom, today);
  if (!syncFrom) return { error: "Choose a day from the last year, not after today." };
  return { step: "connect", username, password, companyId, bankAccountId, syncFrom };
}
