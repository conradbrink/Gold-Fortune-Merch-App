import type { ActionName } from "@/lib/assistant-actions";
import { ACTIONS } from "@/lib/assistant-actions";
import type { ActionDraft } from "@/lib/assistant-stream";
import { dashboardNow, type ToolEnv, type ToolResult } from "@/lib/assistant-data";
import { cardAvailable, findCard } from "@/lib/dashboard-cards";
import { resetLayout, saveLayout } from "@/lib/dashboard-layout";
import {
  answeredStoreIds,
  createPromotion,
  fetchPromotionDetail,
  promotionProblem,
  setPromotionActive,
  updatePromotion,
  type PromotionInput,
} from "@/lib/promotions";
import {
  FIELD_TYPES,
  addFormFields,
  createForm,
  formFieldProblem,
  newFormProblem,
  saveFieldOrder,
  updateForm,
  type NewFormField,
} from "@/lib/forms";
import { fieldTypeLabel } from "@/lib/metrics";
import { lower, type Terms } from "@/lib/terms";
import { writeRefusal } from "@/lib/write-refusal";

/**
 * What each AI Manager action does: draft the card, read the card back, make
 * the change.
 *
 * `draft` runs when the assistant calls the action. It only reads: it finds
 * the records the request names, checks the change as the page would, and
 * returns the card's lines with the `input` its button will send. `read` and
 * `apply` run when the person presses that button (`/api/assistant/act`):
 * `read` checks the input's shape as if typed by hand, since it comes back
 * from the browser, and `apply` checks it against the database again and then
 * writes with the same function the page uses, with the person's own session.
 * So a card can only ever do what the person could have done on the page.
 */

/** Something to say instead of a change: to the assistant while drafting, to the person when applying. */
export class ActionError extends Error {}

type Args = Record<string, unknown>;
type Line = { label: string; value: string };

type Drafted<I> = {
  title: string;
  lines: Line[];
  warnings?: string[];
  button: string;
  href: string;
  input: I;
};

/** What a change did: said to the person, kept in the record, and told to the assistant next time. */
export type Applied = { text: string; href: string; targetId: string | null };

type Action<I> = {
  draft: (args: Args, env: ToolEnv) => Promise<Drafted<I>>;
  read: (raw: unknown) => I;
  apply: (input: I, env: ToolEnv) => Promise<Applied>;
};

// ---------------------------------------------------------------- words

/** "Sun 1 Nov 2026", the way the app writes a day. */
function dayWords(day: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).formatToParts(new Date(`${day}T12:00:00Z`));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")} ${part("day")} ${part("month")} ${part("year")}`;
}

/** "A, B, C and 9 more". */
function listWords(names: string[], max = 5): string {
  if (names.length === 0) return "None";
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ---------------------------------------------------------------- reading input

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** More than any company has, and few enough to check in a handful of queries. */
const MAX_IDS = 5000;
const MAX_QUESTIONS = 40;

/** A card that comes back changed is not one the person was shown. */
const UNREADABLE = "That change could not be read. Ask the AI Manager for it again.";

function record(raw: unknown): Args {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new ActionError(UNREADABLE);
  return raw as Args;
}

function text(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length > max) throw new ActionError(UNREADABLE);
  return value;
}

function maybeText(value: unknown, max: number): string | null {
  return value === null ? null : text(value, max);
}

function flag(value: unknown): boolean {
  if (typeof value !== "boolean") throw new ActionError(UNREADABLE);
  return value;
}

function maybeFlag(value: unknown): boolean | null {
  return value === null || value === undefined ? null : flag(value);
}

function id(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new ActionError(UNREADABLE);
  return value.toLowerCase();
}

function ids(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_IDS) throw new ActionError(UNREADABLE);
  return [...new Set(value.map(id))];
}

function day(value: unknown): string {
  if (typeof value !== "string" || !DAY.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new ActionError(UNREADABLE);
  }
  return value;
}

function words(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 200) throw new ActionError(UNREADABLE);
  return value.map((v) => text(v, 200));
}

// ---------------------------------------------------------------- checking against the database

/** Every id is one the asker can see at their company, in batches a URL can carry. */
async function allVisible(env: ToolEnv, table: "stores" | "products", wanted: string[]): Promise<boolean> {
  let seen = 0;
  for (let i = 0; i < wanted.length; i += 100) {
    const { data, error } = await env.supabase.from(table).select("id").in("id", wanted.slice(i, i + 100));
    if (error) throw new Error(error.message);
    seen += (data ?? []).length;
  }
  return seen === wanted.length;
}

type SiteRow = { id: string; name: string; city: string | null; store_group_id: string | null; active: boolean };

async function companySites(env: ToolEnv): Promise<SiteRow[]> {
  const rows: SiteRow[] = [];
  for (let from = 0; from < MAX_IDS; from += 1000) {
    const { data, error } = await env.supabase
      .from("stores")
      .select("id, name, city, store_group_id, active")
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as SiteRow[]));
    if ((data ?? []).length < 1000) break;
  }
  return rows;
}

const same = (a: string | null | undefined, b: string) => (a ?? "").trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The sites a request names: every active one, or those in some groups and
 * towns, plus single ones by id. Names are matched exactly (case aside), and a
 * name that matches nothing is said back with the names that would, so the
 * assistant asks rather than guesses.
 */
async function chooseSites(choice: Args, env: ToolEnv): Promise<{ ids: string[]; names: Map<string, string> }> {
  const t = env.terms;
  const all = choice.all === true;
  const groups = Array.isArray(choice.groups) ? (choice.groups as unknown[]).filter((g): g is string => typeof g === "string" && g.trim() !== "") : [];
  const towns = Array.isArray(choice.towns) ? (choice.towns as unknown[]).filter((g): g is string => typeof g === "string" && g.trim() !== "") : [];
  const single = Array.isArray(choice.site_ids) ? (choice.site_ids as unknown[]) : [];
  for (const s of single) {
    if (typeof s !== "string" || !UUID.test(s)) throw new ActionError(`Each site id must come from find_sites.`);
  }

  const sites = await companySites(env);
  const names = new Map(sites.map((s) => [s.id, s.name]));
  const chosen = new Set<string>();

  if (all || groups.length > 0 || towns.length > 0) {
    let groupIds: Set<string> | null = null;
    if (groups.length > 0) {
      const { data, error } = await env.supabase.from("store_groups").select("id, name").order("name");
      if (error) throw new Error(error.message);
      const known = (data ?? []) as { id: string; name: string }[];
      groupIds = new Set();
      for (const g of groups) {
        const match = known.find((k) => same(k.name, g));
        if (!match) {
          throw new ActionError(
            `There's no ${lower(t.site_group.one)} called "${g}". The ${lower(t.site_group.many)} are: ${listWords(known.map((k) => k.name), 30)}.`
          );
        }
        groupIds.add(match.id);
      }
    }
    for (const town of towns) {
      if (!sites.some((s) => s.active && same(s.city, town))) {
        throw new ActionError(`No active ${lower(t.site.many)} are in a town called "${town}". Check the spelling with find_sites.`);
      }
    }
    for (const s of sites) {
      if (!s.active) continue;
      if (groupIds && !(s.store_group_id && groupIds.has(s.store_group_id))) continue;
      if (towns.length > 0 && !towns.some((town) => same(s.city, town))) continue;
      chosen.add(s.id);
    }
    if (chosen.size === 0) {
      throw new ActionError(`No active ${lower(t.site.many)} match those ${lower(t.site_group.many)} and towns together.`);
    }
  }
  for (const s of single) {
    const sid = (s as string).toLowerCase();
    if (!names.has(sid)) throw new ActionError(`One of the site ids isn't at this company. Use find_sites.`);
    chosen.add(sid);
  }
  return { ids: [...chosen], names };
}

/** The products a request names: by id, or every active product of some brands. */
async function chooseProducts(choice: Args, env: ToolEnv): Promise<{ ids: string[]; names: Map<string, string> }> {
  const brands = Array.isArray(choice.brands) ? (choice.brands as unknown[]).filter((b): b is string => typeof b === "string" && b.trim() !== "") : [];
  const single = Array.isArray(choice.product_ids) ? (choice.product_ids as unknown[]) : [];
  for (const p of single) {
    if (typeof p !== "string" || !UUID.test(p)) throw new ActionError("Each product id must come from find_products.");
  }
  const { data, error } = await env.supabase.from("products").select("id, name, brand, active").order("name").limit(MAX_IDS);
  if (error) throw new Error(error.message);
  const products = (data ?? []) as { id: string; name: string; brand: string | null; active: boolean }[];
  const names = new Map(products.map((p) => [p.id, p.name]));
  const chosen = new Set<string>();
  for (const b of brands) {
    const matches = products.filter((p) => p.active && same(p.brand, b));
    if (matches.length === 0) {
      const known = [...new Set(products.filter((p) => p.active && p.brand).map((p) => p.brand as string))];
      throw new ActionError(`No active products are of a brand called "${b}". The brands are: ${listWords(known, 30)}.`);
    }
    for (const p of matches) chosen.add(p.id);
  }
  for (const p of single) {
    const pid = (p as string).toLowerCase();
    if (!names.has(pid)) throw new ActionError("One of the product ids isn't at this company. Use find_products.");
    chosen.add(pid);
  }
  return { ids: [...chosen], names };
}

function sitesLine(t: Terms, chosen: string[], names: Map<string, string>): string {
  const list = chosen.map((s) => names.get(s) ?? "").filter(Boolean).sort((a, b) => a.localeCompare(b));
  return `${count(chosen.length, lower(t.site.one), lower(t.site.many))}: ${listWords(list)}`;
}

function productsLine(chosen: string[], names: Map<string, string>): string {
  const list = chosen.map((p) => names.get(p) ?? "").filter(Boolean).sort((a, b) => a.localeCompare(b));
  return chosen.length <= 5 ? listWords(list) : `${chosen.length} products: ${listWords(list)}`;
}

// ---------------------------------------------------------------- dashboard

type DashboardInput = { add: string[]; remove: string[]; first: string[]; seen: string[] };

function cardIds(env: ToolEnv, value: unknown, what: string): string[] {
  const list = Array.isArray(value) ? (value as unknown[]) : [];
  const out: string[] = [];
  for (const v of list) {
    const card = typeof v === "string" ? findCard(v) : undefined;
    if (!card || !cardAvailable(card, env.modules, env.permissions)) {
      throw new ActionError(`"${String(v)}" isn't a card this person can ${what}. Use the ids from dashboard_cards.`);
    }
    if (!out.includes(card.id)) out.push(card.id);
  }
  return out;
}

/** The layout after the change. Cards the person can't see stay where they are, as the Customise panel leaves them. */
function arranged(layout: string[], change: Omit<DashboardInput, "seen">): string[] {
  let next = layout.filter((c) => !change.remove.includes(c));
  for (const c of change.add) if (!next.includes(c)) next.push(c);
  const top = change.first.filter((c) => next.includes(c));
  next = [...top, ...next.filter((c) => !top.includes(c))];
  return next;
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

function cardNames(env: ToolEnv, list: string[]): string[] {
  return list
    .map((c) => findCard(c))
    .filter((c) => c !== undefined && cardAvailable(c, env.modules, env.permissions))
    .map((c) => c!.title(env.terms));
}

const changeDashboard: Action<DashboardInput> = {
  async draft(args, env) {
    const change = {
      add: cardIds(env, args.add, "add"),
      remove: cardIds(env, args.remove, "take off"),
      first: cardIds(env, args.first, "move"),
    };
    const { layout } = await dashboardNow(env);
    const next = arranged(layout, change);
    if (sameList(next, layout)) throw new ActionError("That is already how their dashboard is.");
    const added = change.add.filter((c) => !layout.includes(c));
    const removed = change.remove.filter((c) => layout.includes(c));
    const lines: Line[] = [];
    if (added.length) lines.push({ label: "Adds", value: cardNames(env, added).join(", ") });
    if (removed.length) lines.push({ label: "Takes off", value: cardNames(env, removed).join(", ") });
    lines.push({ label: "In this order", value: cardNames(env, next).map((n, i) => `${i + 1}. ${n}`).join("\n") });
    return {
      title: "Your dashboard",
      lines,
      warnings: [],
      button: "Change my dashboard",
      href: "/",
      input: { ...change, seen: layout },
    };
  },
  read(raw) {
    const r = record(raw);
    const list = (v: unknown) => words(v);
    return { add: list(r.add), remove: list(r.remove), first: list(r.first), seen: list(r.seen) };
  },
  async apply(input, env) {
    const change = {
      add: cardIds(env, input.add, "add"),
      remove: cardIds(env, input.remove, "take off"),
      first: cardIds(env, input.first, "move"),
    };
    const { layout } = await dashboardNow(env);
    if (!sameList(layout, input.seen)) {
      throw new ActionError("Your dashboard changed since this was drafted. Ask the AI Manager again.");
    }
    const next = arranged(layout, change);
    await saveLayout(env.supabase, env.orgId, next);
    const shown = cardNames(env, next);
    return { text: `Your dashboard now shows ${count(shown.length, "card", "cards")}: ${shown.join(", ")}.`, href: "/", targetId: null };
  },
};

const resetDashboard: Action<Record<string, never>> = {
  async draft(_args, env) {
    const { saved } = await dashboardNow(env);
    if (saved === null) throw new ActionError("Their dashboard already shows the company's standard cards.");
    return {
      title: "Your dashboard",
      lines: [{ label: "Back to", value: cardNames(env, env.dashboardDefault).join(", ") }],
      warnings: ["The cards you arranged yourself go back to the company's standard set."],
      button: "Reset my dashboard",
      href: "/",
      input: {},
    };
  },
  read(raw) {
    record(raw);
    return {};
  },
  async apply(_input, env) {
    await resetLayout(env.supabase);
    return { text: "Your dashboard is back to the company's standard cards.", href: "/", targetId: null };
  },
};

// ---------------------------------------------------------------- promotions

type PromotionDraftInput = PromotionInput;

async function checkPromotion(input: PromotionInput, env: ToolEnv): Promise<void> {
  const problem = promotionProblem(input);
  if (problem) throw new ActionError(problem);
  if (!(await allVisible(env, "products", input.productIds))) {
    throw new ActionError("A product on this promotion isn't at your company any more. Ask the AI Manager again.");
  }
  if (!(await allVisible(env, "stores", input.storeIds))) {
    throw new ActionError(`A ${lower(env.terms.site.one)} on this promotion isn't at your company any more. Ask the AI Manager again.`);
  }
}

function readPromotion(r: Args): PromotionInput {
  return {
    name: text(r.name, 200),
    brief: maybeText(r.brief, 1000),
    starts_on: day(r.starts_on),
    ends_on: day(r.ends_on),
    productIds: ids(r.productIds),
    storeIds: ids(r.storeIds),
  };
}

const createPromotionAction: Action<PromotionDraftInput> = {
  async draft(args, env) {
    const t = env.terms;
    const products = await chooseProducts(record(args.products ?? {}), env);
    const sites = await chooseSites(record(args.sites ?? {}), env);
    if (products.ids.length === 0) throw new ActionError("A promotion needs at least one product. Find them with find_products.");
    if (sites.ids.length === 0) throw new ActionError(`A promotion needs at least one ${lower(t.site.one)}.`);
    const input: PromotionInput = {
      name: typeof args.name === "string" ? args.name.trim() : "",
      brief: typeof args.brief === "string" && args.brief.trim() ? args.brief.trim() : null,
      starts_on: typeof args.starts_on === "string" ? args.starts_on : "",
      ends_on: typeof args.ends_on === "string" ? args.ends_on : "",
      productIds: products.ids,
      storeIds: sites.ids,
    };
    const problem = promotionProblem(input);
    if (problem) throw new ActionError(problem);
    const warnings: string[] = [];
    if (input.starts_on < env.today) warnings.push("It starts before today.");
    return {
      title: "New promotion",
      lines: [
        { label: "Name", value: input.name },
        ...(input.brief ? [{ label: `What ${lower(t.staff.many)} look for`, value: input.brief }] : []),
        { label: "Dates", value: `${dayWords(input.starts_on)} to ${dayWords(input.ends_on)}` },
        { label: "Products", value: productsLine(products.ids, products.names) },
        { label: t.site.many, value: sitesLine(t, sites.ids, sites.names) },
      ],
      warnings,
      button: "Create the promotion",
      href: "/promotions",
      input,
    };
  },
  read(raw) {
    return readPromotion(record(raw));
  },
  async apply(input, env) {
    await checkPromotion(input, env);
    const created = await createPromotion(env.supabase, env.orgId, { ...input, name: input.name.trim() });
    return {
      text: `"${input.name.trim()}" is set up: ${count(input.productIds.length, "product", "products")} at ${count(
        input.storeIds.length,
        lower(env.terms.site.one),
        lower(env.terms.site.many)
      )}, ${dayWords(input.starts_on)} to ${dayWords(input.ends_on)}.`,
      href: "/promotions",
      targetId: created,
    };
  },
};

type PromotionChangeInput = PromotionInput & { promotion_id: string; seen: string; active: boolean };

function changed(current: string[], change: string, picked: string[]): string[] {
  if (change === "add") return [...new Set([...current, ...picked])];
  if (change === "remove") return current.filter((x) => !picked.includes(x));
  if (change === "replace") return picked;
  return current;
}

const changePromotion: Action<PromotionChangeInput> = {
  async draft(args, env) {
    const t = env.terms;
    const pid = typeof args.promotion_id === "string" && UUID.test(args.promotion_id) ? args.promotion_id : null;
    const detail = pid ? await fetchPromotionDetail(env.supabase, pid) : null;
    if (!detail) throw new ActionError("There's no promotion with that id. Look it up with promotions first.");

    const productChoice = record(args.products ?? { change: "keep" });
    const siteChoice = record(args.sites ?? { change: "keep" });
    const pChange = typeof productChoice.change === "string" ? productChoice.change : "keep";
    const sChange = typeof siteChoice.change === "string" ? siteChoice.change : "keep";
    const products = pChange === "keep" ? null : await chooseProducts(productChoice, env);
    const sites = sChange === "keep" ? null : await chooseSites(siteChoice, env);

    const productIds = products ? changed(detail.product_ids, pChange, products.ids) : detail.product_ids;
    const storeIds = sites ? changed(detail.store_ids, sChange, sites.ids) : detail.store_ids;
    const next: PromotionChangeInput = {
      promotion_id: detail.id,
      seen: detail.updated_at,
      name: typeof args.name === "string" && args.name.trim() ? args.name.trim() : detail.name,
      brief: typeof args.brief === "string" && args.brief.trim() ? args.brief.trim() : detail.brief,
      starts_on: typeof args.starts_on === "string" ? args.starts_on : detail.starts_on,
      ends_on: typeof args.ends_on === "string" ? args.ends_on : detail.ends_on,
      active: typeof args.active === "boolean" ? args.active : detail.active,
      productIds,
      storeIds,
    };
    const problem = promotionProblem(next);
    if (problem) throw new ActionError(problem);
    if (productIds.length === 0) throw new ActionError("That would leave the promotion with no products.");
    if (storeIds.length === 0) throw new ActionError(`That would leave the promotion with no ${lower(t.site.many)}.`);

    const lines: Line[] = [{ label: "Promotion", value: detail.name }];
    if (next.name !== detail.name) lines.push({ label: "New name", value: next.name });
    if (next.brief !== detail.brief) lines.push({ label: `What ${lower(t.staff.many)} look for`, value: next.brief ?? "" });
    if (next.starts_on !== detail.starts_on || next.ends_on !== detail.ends_on) {
      lines.push({ label: "Dates", value: `${dayWords(next.starts_on)} to ${dayWords(next.ends_on)}` });
    }
    const names = new Map([...(products?.names ?? []), ...(sites?.names ?? [])]);
    const diff = (before: string[], after: string[], one: string, many: string) => {
      const plus = after.filter((x) => !before.includes(x));
      const minus = before.filter((x) => !after.includes(x));
      const parts: string[] = [];
      if (plus.length) parts.push(`adds ${listWords(plus.map((x) => names.get(x) ?? "").filter(Boolean), 3)}`);
      if (minus.length) parts.push(`takes off ${count(minus.length, one, many)}`);
      return parts.length ? `${parts.join(", ")}. ${count(after.length, one, many)} in all.` : null;
    };
    const pLine = diff(detail.product_ids, productIds, "product", "products");
    if (pLine) lines.push({ label: "Products", value: pLine });
    const sLine = diff(detail.store_ids, storeIds, lower(t.site.one), lower(t.site.many));
    if (sLine) lines.push({ label: t.site.many, value: sLine });
    if (next.active !== detail.active) {
      lines.push({ label: "Switched", value: next.active ? "On: it shows on the phones again" : "Off: it leaves every phone" });
    }
    if (lines.length === 1) throw new ActionError("That is already how the promotion is.");

    const warnings: string[] = [];
    const removed = detail.store_ids.filter((x) => !storeIds.includes(x));
    if (removed.length) {
      const answered = await answeredStoreIds(env.supabase, detail.id);
      const lost = removed.filter((x) => answered.has(x)).length;
      if (lost) {
        warnings.push(
          `${count(lost, lower(t.site.one), lower(t.site.many))} you're taking off already ${lost === 1 ? "has" : "have"} answers. Their answers drop out of the promotion's figures.`
        );
      }
    }
    return { title: "Change a promotion", lines, warnings, button: "Make the change", href: "/promotions", input: next };
  },
  read(raw) {
    const r = record(raw);
    return { ...readPromotion(r), promotion_id: id(r.promotion_id), seen: text(r.seen, 64), active: flag(r.active) };
  },
  async apply(input, env) {
    const detail = await fetchPromotionDetail(env.supabase, input.promotion_id);
    if (!detail) throw new ActionError("That promotion isn't there any more.");
    await checkPromotion(input, env);
    // The header write carries the version the person was shown, so a
    // promotion somebody changed in the meantime is refused, not overwritten.
    await updatePromotion(env.supabase, input.promotion_id, { ...input, name: input.name.trim() }, input.seen);
    if (input.active !== detail.active) await setPromotionActive(env.supabase, input.promotion_id, input.active);
    return {
      text: `"${input.name.trim()}" is changed${input.active === detail.active ? "" : input.active ? " and switched on" : " and switched off"}.`,
      href: "/promotions",
      targetId: input.promotion_id,
    };
  },
};

// ---------------------------------------------------------------- forms

function questionsFrom(value: unknown): NewFormField[] {
  if (!Array.isArray(value)) return [];
  return value.map((q) => {
    const r = (q ?? {}) as Args;
    const type = typeof r.type === "string" ? r.type : "text";
    const choices = Array.isArray(r.choices) ? (r.choices as unknown[]).filter((c): c is string => typeof c === "string") : [];
    return {
      label: typeof r.label === "string" ? r.label.trim() : "",
      field_type: type,
      required: r.required === true,
      options: type === "multiple_choice" ? choices.map((c) => c.trim()).filter(Boolean) : null,
      metric_key: null,
    };
  });
}

function readQuestions(value: unknown): NewFormField[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_QUESTIONS) throw new ActionError(UNREADABLE);
  return value.map((q) => {
    const r = record(q);
    const type = text(r.field_type, 40);
    if (!FIELD_TYPES.includes(type as (typeof FIELD_TYPES)[number])) throw new ActionError(UNREADABLE);
    const options = r.options === null ? null : words(r.options);
    // Never a metric from the AI Manager: which question feeds which report
    // is set on the form builder by a person who knows what it measures.
    return { label: text(r.label, 400), field_type: type, required: flag(r.required), options, metric_key: null };
  });
}

function questionLines(fields: NewFormField[]): string {
  return fields
    .map((f, i) => {
      const extra = [fieldTypeLabel(f.field_type), f.required ? "must answer" : null].filter(Boolean).join(", ");
      const choices = f.options?.length ? `: ${f.options.join(" / ")}` : "";
      return `${i + 1}. ${f.label} (${extra})${choices}`;
    })
    .join("\n");
}

function checkQuestions(fields: NewFormField[]): void {
  if (fields.length === 0) throw new ActionError("Add at least one question.");
  if (fields.length > MAX_QUESTIONS) throw new ActionError(`Keep it to ${MAX_QUESTIONS} questions at a time.`);
  for (const f of fields) {
    const problem = formFieldProblem(f);
    if (problem) throw new ActionError(problem);
  }
}

type FormRow = { id: string; name: string; required: boolean; active: boolean; updated_at: string };

async function formRow(env: ToolEnv, formId: unknown): Promise<FormRow> {
  if (typeof formId !== "string" || !UUID.test(formId)) throw new ActionError("Use a form id from forms.");
  const { data, error } = await env.supabase
    .from("form_templates")
    .select("id, name, required, active, updated_at")
    .eq("id", formId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ActionError("There's no form with that id. Look it up with forms first.");
  return data as FormRow;
}

function compulsoryWords(t: Terms, compulsory: boolean): string {
  return compulsory
    ? `Yes: ${lower(t.staff.many)} can't check out of a ${lower(t.site.one)} until it is sent`
    : `No: ${lower(t.staff.many)} fill it in when it is relevant`;
}

type NewFormInput = { name: string; description: string | null; required: boolean; fields: NewFormField[] };

const createFormAction: Action<NewFormInput> = {
  async draft(args, env) {
    const fields = questionsFrom(args.questions);
    const input: NewFormInput = {
      name: typeof args.name === "string" ? args.name.trim() : "",
      description: typeof args.description === "string" && args.description.trim() ? args.description.trim() : null,
      required: args.compulsory === true,
      fields,
    };
    checkQuestions(fields);
    const problem = newFormProblem(input);
    if (problem) throw new ActionError(problem);
    return {
      title: "New form",
      lines: [
        { label: "Name", value: input.name },
        ...(input.description ? [{ label: "What it is for", value: input.description }] : []),
        { label: "Compulsory", value: compulsoryWords(env.terms, input.required) },
        { label: "Questions", value: questionLines(fields) },
      ],
      warnings: [],
      button: "Create the form",
      href: "/forms",
      input,
    };
  },
  read(raw) {
    const r = record(raw);
    return { name: text(r.name, 400), description: maybeText(r.description, 1000), required: flag(r.required), fields: readQuestions(r.fields) };
  },
  async apply(input, env) {
    checkQuestions(input.fields);
    const problem = newFormProblem(input);
    if (problem) throw new ActionError(problem);
    const created = await createForm(env.supabase, input);
    return {
      text: `"${input.name.trim()}" is created with ${count(input.fields.length, "question", "questions")}.`,
      href: `/forms/${created}`,
      targetId: created,
    };
  },
};

type AddQuestionsInput = { form_id: string; fields: NewFormField[] };

const addFormQuestions: Action<AddQuestionsInput> = {
  async draft(args, env) {
    const form = await formRow(env, args.form_id);
    const fields = questionsFrom(args.questions);
    checkQuestions(fields);
    return {
      title: "Add questions",
      lines: [
        { label: "Form", value: form.name },
        { label: "Adds at the end", value: questionLines(fields) },
      ],
      warnings: form.active ? [] : ["This form is archived, so the phones won't show it until it is brought back."],
      button: `Add ${count(fields.length, "question", "questions")}`,
      href: `/forms/${form.id}`,
      input: { form_id: form.id, fields },
    };
  },
  read(raw) {
    const r = record(raw);
    return { form_id: id(r.form_id), fields: readQuestions(r.fields) };
  },
  async apply(input, env) {
    const form = await formRow(env, input.form_id);
    checkQuestions(input.fields);
    await addFormFields(env.supabase, form.id, input.fields);
    return {
      text: `${count(input.fields.length, "question was", "questions were")} added to "${form.name}".`,
      href: `/forms/${form.id}`,
      targetId: form.id,
    };
  },
};

type MoveInput = { form_id: string; question_id: string; position: number; seen: string[] };

async function questionOrder(env: ToolEnv, formId: string): Promise<{ id: string; label: string }[]> {
  const { data, error } = await env.supabase
    .from("form_fields")
    .select("id, label")
    .eq("form_template_id", formId)
    .order("sort_order")
    .order("id");
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; label: string }[];
}

function moved(order: string[], questionId: string, position: number): string[] {
  const rest = order.filter((q) => q !== questionId);
  const at = Math.min(Math.max(position, 1), order.length) - 1;
  return [...rest.slice(0, at), questionId, ...rest.slice(at)];
}

const moveFormQuestion: Action<MoveInput> = {
  async draft(args, env) {
    const form = await formRow(env, args.form_id);
    const order = await questionOrder(env, form.id);
    const qid = typeof args.question_id === "string" ? args.question_id.toLowerCase() : "";
    const from = order.findIndex((q) => q.id === qid);
    if (from === -1) throw new ActionError("That question isn't on this form. Look it up with forms and the form_id.");
    const position = typeof args.position === "number" && Number.isInteger(args.position) ? args.position : 0;
    if (position < 1 || position > order.length) throw new ActionError(`The place must be 1 to ${order.length}.`);
    const next = moved(order.map((q) => q.id), qid, position);
    if (sameList(next, order.map((q) => q.id))) throw new ActionError("It is already in that place.");
    return {
      title: "Move a question",
      lines: [
        { label: "Form", value: form.name },
        { label: "Moves", value: `"${order[from].label}" from place ${from + 1} to place ${position}` },
      ],
      warnings: [],
      button: "Move the question",
      href: `/forms/${form.id}`,
      input: { form_id: form.id, question_id: qid, position, seen: order.map((q) => q.id) },
    };
  },
  read(raw) {
    const r = record(raw);
    const position = r.position;
    if (typeof position !== "number" || !Number.isInteger(position) || position < 1 || position > 1000) {
      throw new ActionError(UNREADABLE);
    }
    return { form_id: id(r.form_id), question_id: id(r.question_id), position, seen: ids(r.seen) };
  },
  async apply(input, env) {
    const form = await formRow(env, input.form_id);
    const order = (await questionOrder(env, form.id)).map((q) => q.id);
    if (!sameList(order, input.seen)) {
      throw new ActionError("The form's questions changed since this was drafted. Ask the AI Manager again.");
    }
    await saveFieldOrder(env.supabase, moved(order, input.question_id, input.position));
    return { text: `The question is now in place ${input.position} on "${form.name}".`, href: `/forms/${form.id}`, targetId: form.id };
  },
};

type FormChangeInput = { form_id: string; seen: string; required: boolean | null; active: boolean | null };

const changeForm: Action<FormChangeInput> = {
  async draft(args, env) {
    const form = await formRow(env, args.form_id);
    const required = typeof args.compulsory === "boolean" && args.compulsory !== form.required ? args.compulsory : null;
    const active = typeof args.active === "boolean" && args.active !== form.active ? args.active : null;
    if (required === null && active === null) throw new ActionError("That is already how the form is.");
    const t = env.terms;
    const lines: Line[] = [{ label: "Form", value: form.name }];
    if (required !== null) lines.push({ label: "Compulsory", value: compulsoryWords(t, required) });
    if (active !== null) {
      lines.push({
        label: active ? "Brings back" : "Archives",
        value: active ? `It shows on the ${lower(t.staff.many)}' phones again` : "It leaves the phones. Answers already sent are kept",
      });
    }
    return {
      title: "Change a form",
      lines,
      warnings: [],
      button: "Make the change",
      href: `/forms/${form.id}`,
      input: { form_id: form.id, seen: form.updated_at, required, active },
    };
  },
  read(raw) {
    const r = record(raw);
    const input = { form_id: id(r.form_id), seen: text(r.seen, 64), required: maybeFlag(r.required), active: maybeFlag(r.active) };
    if (input.required === null && input.active === null) throw new ActionError(UNREADABLE);
    return input;
  },
  async apply(input, env) {
    const form = await formRow(env, input.form_id);
    const change: { required?: boolean; active?: boolean } = {};
    if (input.required !== null) change.required = input.required;
    if (input.active !== null) change.active = input.active;
    await updateForm(env.supabase, form.id, change, input.seen);
    const parts = [
      input.required === null ? null : input.required ? "is compulsory now" : "is optional now",
      input.active === null ? null : input.active ? "is back on the phones" : "is archived",
    ].filter(Boolean);
    return { text: `"${form.name}" ${parts.join(" and ")}.`, href: `/forms/${form.id}`, targetId: form.id };
  },
};

// ---------------------------------------------------------------- the menu

/** Each action with its input's type set aside: the menu holds them all, and `read` is what gives an input its shape. */
function loose<I>(a: Action<I>): Action<unknown> {
  return a as unknown as Action<unknown>;
}

const ACT: Record<ActionName, Action<unknown>> = {
  change_dashboard: loose(changeDashboard),
  reset_dashboard: loose(resetDashboard),
  create_promotion: loose(createPromotionAction),
  change_promotion: loose(changePromotion),
  create_form: loose(createFormAction),
  add_form_questions: loose(addFormQuestions),
  move_form_question: loose(moveFormQuestion),
  change_form: loose(changeForm),
};

export function isAction(name: string): name is ActionName {
  return ACTIONS.some((a) => a.name === name);
}

/**
 * Drafts the card for an action the assistant called. Never throws: a request
 * that can't be drafted becomes something the assistant can tell the person.
 */
export async function draftAction(name: ActionName, rawArgs: string, env: ToolEnv): Promise<ToolResult> {
  let args: Args;
  try {
    const parsed = JSON.parse(rawArgs || "{}") as unknown;
    args = parsed !== null && typeof parsed === "object" ? (parsed as Args) : {};
  } catch {
    return { model: { error: "The action's arguments could not be read." } };
  }
  try {
    const d = await ACT[name].draft(args, env);
    const action: ActionDraft = {
      id: globalThis.crypto.randomUUID(),
      name,
      title: d.title,
      lines: d.lines,
      warnings: d.warnings ?? [],
      button: d.button,
      href: d.href,
      input: d.input,
    };
    return {
      model: {
        shown_to_the_person_as_a_card: { title: d.title, lines: d.lines, warnings: action.warnings, button: d.button },
        not_done_yet: `Nothing has changed. It happens only if the person presses "${d.button}" on the card.`,
      },
      action,
    };
  } catch (reason) {
    if (reason instanceof ActionError) return { model: { error: reason.message } };
    const plain = writeRefusal(reason);
    if (plain) return { model: { error: plain } };
    console.error(`assistant: drafting ${name} failed`, reason instanceof Error ? reason.message : reason);
    return { model: { error: "That couldn't be got ready. Try again in a moment." } };
  }
}

/** The input a card's button sent, read as if typed by hand. */
export function readActionInput(name: ActionName, raw: unknown): { ok: true; input: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, input: ACT[name].read(raw) };
  } catch (reason) {
    return { ok: false, error: reason instanceof ActionError ? reason.message : UNREADABLE };
  }
}

/** Makes the change. Throws `ActionError` with words for the person, or the database's error. */
export async function applyAction(name: ActionName, input: unknown, env: ToolEnv): Promise<Applied> {
  return ACT[name].apply(input, env);
}
