/**
 * Sage Business Cloud Accounting, South Africa (the "Sage One" API, 2.0.0):
 * only the calls the accounting sync makes.
 *
 * Every call carries Tickd's API key (SAGE_API_KEY) as the `apikey` query
 * parameter, the company as `companyid`, and the company's sign-in: for now a
 * Sage login and password (HTTP Basic), which is what Sage gives developers
 * on the sandbox; Sage ID (OAuth) follows when Sage issues client
 * credentials. The base address is SAGE_API_URL: the sandbox
 * (resellers.accounting.sageone.co.za) or the real one.
 *
 * Sage's limits shape the errors below: 100 calls a minute per company (more
 * blocks it for an hour, HTTP 429), and 20 failed sign-ins in an hour lock
 * the login for a day. So a refused sign-in or a 429 stops all sending for
 * that company at once; the sync never probes again on its own.
 *
 * Lists come 100 at a time in { TotalResults, ReturnedResults, Results }.
 * Filtering on text does not work (Sage's docs), so customers are matched by
 * name and items by code here, page by page.
 *
 * Pure apart from `sageRequest` and the calls built on it.
 */

export const SAGE_LIVE_URL = "https://accounting.sageone.co.za/api/2.0.0";
const PAGE = 100;

export type SageConfig = { baseUrl: string; apiKey: string };

/** From the server's environment; null until the API key is set. */
export function sageConfig(env: Record<string, string | undefined> = process.env): SageConfig | null {
  const apiKey = env.SAGE_API_KEY?.trim().replace(/^\{|\}$/g, "");
  if (!apiKey || !/^[0-9A-Fa-f-]{20,60}$/.test(apiKey)) return null;
  let baseUrl = env.SAGE_API_URL?.trim() || SAGE_LIVE_URL;
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" || !/(^|\.)accounting\.sageone\.co\.za$/.test(url.hostname)) return null;
  } catch {
    return null;
  }
  baseUrl = baseUrl.replace(/\/+$/, "");
  return { baseUrl, apiKey };
}

/** How a company signs in to Sage. */
export type SageSignIn = { kind: "password"; username: string; password: string };

export type SageAuth = { config: SageConfig; signIn: SageSignIn };

// ------------------------------------------------------------------ errors

/**
 * What went wrong, as the sync must treat it:
 *  - sign_in: Sage refused the login (401). Stop until the office connects again.
 *  - limit:   too many calls (429). Stop the company for an hour.
 *  - expired: the Sage subscription lapsed (402). Stop until it is renewed.
 *  - refused: Sage rejected the data (400, 404, 405, 409). Trying again will
 *             not help; the office has to fix something.
 *  - busy:    anything else (5xx, a network failure, a timeout). Try later.
 */
export type SageErrorKind = "sign_in" | "limit" | "expired" | "refused" | "busy";

export class SageError extends Error {
  readonly kind: SageErrorKind;
  readonly status: number | null;

  constructor(kind: SageErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = "SageError";
    this.kind = kind;
    this.status = status;
  }
}

export function errorKind(status: number): SageErrorKind {
  if (status === 401) return "sign_in";
  if (status === 429) return "limit";
  if (status === 402) return "expired";
  if (status === 400 || status === 404 || status === 405 || status === 409 || status === 415) return "refused";
  return "busy";
}

/**
 * Sage's own words from an error body, which is not documented: a string, a
 * {Message}, a list of messages or of {Message}, or ASP.NET's ModelState.
 */
export function errorText(body: unknown): string | null {
  const parts: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === "string" && v.trim()) parts.push(v.trim());
    else if (Array.isArray(v)) v.forEach(add);
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.Message === "string") add(o.Message);
      if (typeof o.ExceptionMessage === "string") add(o.ExceptionMessage);
      if (o.ModelState && typeof o.ModelState === "object") Object.values(o.ModelState).forEach(add);
      if (Array.isArray(o.Results)) add(o.Results);
    }
  };
  add(body);
  const text = [...new Set(parts)].join(" ").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 400) : null;
}

/** The sentence the office sees for an error kind, with Sage's own words when there are some. */
export function officeMessage(err: SageError): string {
  switch (err.kind) {
    case "sign_in":
      return "Sage refused the sign-in. Connect Sage again.";
    case "limit":
      return "Sage asked Tickd to slow down. Sending starts again in an hour.";
    case "expired":
      return "Your Sage subscription has expired. Sending starts again once it is renewed and Sage is connected again.";
    case "refused":
      return `Sage did not accept it: ${err.message}`;
    default:
      return "Sage could not be reached. Tickd will try again.";
  }
}

// ----------------------------------------------------------------- request

type FetchLike = typeof fetch;

export type SageCall = {
  method: "GET" | "POST" | "DELETE";
  path: string;
  companyId?: number | null;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
};

export function requestUrl(config: SageConfig, call: SageCall): string {
  const url = new URL(`${config.baseUrl}/${call.path.replace(/^\/+/, "")}`);
  for (const [k, v] of Object.entries(call.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  url.searchParams.set("apikey", config.apiKey);
  if (call.companyId) url.searchParams.set("companyid", String(call.companyId));
  return url.toString();
}

export function authorization(signIn: SageSignIn): string {
  return `Basic ${Buffer.from(`${signIn.username}:${signIn.password}`, "utf8").toString("base64")}`;
}

/**
 * One call. Counts itself in `counter.calls`, so the sync can keep each
 * company inside Sage's daily allowance.
 */
export async function sageRequest<T>(
  auth: SageAuth,
  call: SageCall,
  opts: { fetchImpl?: FetchLike; counter?: { calls: number }; timeoutMs?: number } = {},
): Promise<T> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  if (opts.counter) opts.counter.calls += 1;
  let res: Response;
  try {
    res = await fetchImpl(requestUrl(auth.config, call), {
      method: call.method,
      headers: {
        Authorization: authorization(auth.signIn),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: call.body === undefined ? undefined : JSON.stringify(call.body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
      cache: "no-store",
    });
  } catch {
    throw new SageError("busy", "Sage could not be reached.");
  }
  const text = await res.text().catch(() => "");
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text.slice(0, 400);
    }
  }
  if (!res.ok) {
    const kind = errorKind(res.status);
    const said = errorText(body);
    throw new SageError(kind, said ?? `Sage answered ${res.status}.`, res.status);
  }
  return body as T;
}

// --------------------------------------------------------------- the shapes

export type SagePage<T> = { TotalResults: number; ReturnedResults: number; Results: T[] };

export type SageCompany = { ID: number; Name: string; Active?: boolean; TaxSystem?: number; CurrencySymbol?: string };
export type SageTaxType = { ID: number; Name: string; Percentage: number; IsDefault?: boolean; Active?: boolean; IsManualTax?: boolean };
export type SageBankAccount = { ID: number; Name: string; Active?: boolean; Default?: boolean };
export type SageCustomer = { ID: number; Name: string; Active?: boolean };
export type SageItem = { ID: number; Code: string; Description?: string; Active?: boolean };
export type SageDocument = { ID: number; DocumentNumber?: string; ExternalReference?: string; Total?: number };
export type SageAllocation = { ID: number };

/**
 * Every page of a list, up to `maxPages` (100 rows a page). `pace` runs
 * before each call (the sync keeps a company's calls apart). A short page is
 * the last; TotalResults, when Sage sends it, ends it sooner.
 */
export async function sageAll<T>(
  auth: SageAuth,
  path: string,
  companyId: number | null,
  opts: Parameters<typeof sageRequest>[2] & {
    maxPages?: number;
    query?: SageCall["query"];
    pace?: () => Promise<void>;
  } = {},
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < (opts.maxPages ?? 50); page++) {
    await opts.pace?.();
    const got = await sageRequest<SagePage<T>>(
      auth,
      {
        method: "GET",
        path,
        companyId,
        query: { ...opts.query, $orderby: "ID", $top: PAGE, $skip: page * PAGE },
      },
      opts,
    );
    const results = Array.isArray(got?.Results) ? got.Results : [];
    rows.push(...results);
    const total = typeof got?.TotalResults === "number" ? got.TotalResults : Infinity;
    if (results.length < PAGE || rows.length >= total) break;
  }
  return rows;
}

// ----------------------------------------------------------- choosing things

/** Names compared the way people mean them: case, spaces and punctuation aside. */
export function nameKey(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\(pty\)|\bpty\b|\bltd\b|\(ltd\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The Sage customer that is this Tickd customer, by name: exactly one active
 * match. Two Sage customers with the name is a question only the office can
 * answer, so it is reported, not guessed.
 */
export function matchCustomer(name: string, customers: SageCustomer[]): SageCustomer | "several" | null {
  const key = nameKey(name);
  if (!key) return null;
  const hits = customers.filter((c) => c.Active !== false && nameKey(c.Name ?? "") === key);
  if (hits.length > 1) return "several";
  return hits[0] ?? null;
}

export function matchItem(code: string, items: SageItem[]): SageItem | null {
  const key = code.trim().toLowerCase();
  if (!key) return null;
  const hits = items.filter((i) => (i.Code ?? "").trim().toLowerCase() === key);
  return hits.find((i) => i.Active !== false) ?? hits[0] ?? null;
}

/**
 * A tax type's rate in percent. Sage's API gives it as a fraction (0.15 for
 * 15%: the sandbox's 12% type came back as 0.12, 30 Oct 2026), though its
 * docs call it a percentage; a value above 1 is read as percent already.
 */
export function taxPercent(t: SageTaxType): number {
  const p = Number(t.Percentage);
  return p > 0 && p <= 1 ? Math.round(p * 100_000) / 1000 : p;
}

/**
 * The tax type for a VAT rate: the active, non-manual one at that percentage,
 * Sage's default first; for 0%, "zero rated" before "exempt".
 */
export function pickTaxType(rate: number, types: SageTaxType[]): SageTaxType | null {
  const at = types.filter((t) => t.Active !== false && !t.IsManualTax && Math.abs(taxPercent(t) - rate) < 0.001);
  if (at.length === 0) return null;
  const score = (t: SageTaxType) =>
    (t.IsDefault ? 4 : 0) + (rate === 0 && /zero/i.test(t.Name) ? 2 : 0) - (rate === 0 && /exempt/i.test(t.Name) ? 1 : 0);
  return [...at].sort((a, b) => score(b) - score(a) || a.ID - b.ID)[0];
}

/** Why a VAT rate cannot be sent, naming the rates Sage has; null when it can. */
export function taxTypeProblem(rate: number, types: SageTaxType[]): string | null {
  if (pickTaxType(rate, types) || rate === 0) return null;
  const rates = [...new Set(types.filter((t) => t.Active !== false && !t.IsManualTax).map(taxPercent))]
    .sort((a, b) => b - a)
    .map((r) => `${r}%`);
  return (
    `Sage has no active VAT type at ${rate}%, the rate on Tickd's invoices` +
    (rates.length ? ` (Sage has ${rates.join(", ")})` : "") +
    ". Check that the Sage company is set up for the same country."
  );
}

/** The bank account payments go to: Sage's default, else the first active one. */
export function pickBankAccount(accounts: SageBankAccount[]): SageBankAccount | null {
  const active = accounts.filter((a) => a.Active !== false);
  return active.find((a) => a.Default) ?? active[0] ?? null;
}
