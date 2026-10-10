/**
 * How far each company has got with Tickd: the Control Centre's onboarding
 * pipeline and activation (owner's spec sections 20, 29, 36; the reasoning is
 * in the step 3 worksheet).
 *
 * The first result an owner sees is their team's first job finished in Tickd,
 * with times and photos nobody had to chase. That is "activated". Everything
 * here is worked out from facts the database already holds
 * (platform_company_activation()), so it covers companies made before today.
 * Pure, so the tests reach every rule.
 */

export type CompanyActivation = {
  orgId: string;
  name: string;
  createdAt: string;
  setupStarted: boolean;
  setupFinishedAt: string | null;
  people: number;
  teamOnAt: string | null;
  firstClientAt: string | null;
  firstWorkdayAt: string | null;
  firstJobStartedAt: string | null;
  firstJobFinishedAt: string | null;
  finishedDays14: number;
  lastActivityAt: string | null;
  lastSignInAt: string | null;
  trialEndsAt: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
};

/** Jobs finished on this many different days in the last 14: the whole team, every workday. */
export const HABIT_DAYS = 5;

export const STAGES = [
  { key: "new", label: "New", reached: () => true },
  { key: "setup", label: "Setup started", reached: (c: CompanyActivation) => c.setupStarted },
  { key: "team", label: "Team on Tickd", reached: (c: CompanyActivation) => c.people >= 2 },
  { key: "clients", label: "Clients or sites added", reached: (c: CompanyActivation) => c.firstClientAt !== null },
  {
    key: "activity",
    label: "First workday",
    reached: (c: CompanyActivation) => c.firstWorkdayAt !== null || c.firstJobStartedAt !== null,
  },
  { key: "activated", label: "First job finished", reached: (c: CompanyActivation) => c.firstJobFinishedAt !== null },
  { key: "onboarded", label: "Using it every workday", reached: (c: CompanyActivation) => c.finishedDays14 >= HABIT_DAYS },
] as const;

export type StageKey = (typeof STAGES)[number]["key"];

/**
 * The furthest stage a company has reached. Companies can skip a step (the
 * operator may do the setup for them), so it is the last one that holds,
 * not the first one that doesn't.
 */
export function stageOf(c: CompanyActivation): number {
  let reached = 0;
  STAGES.forEach((s, i) => {
    if (s.reached(c)) reached = i;
  });
  return reached;
}

export function isActivated(c: CompanyActivation): boolean {
  return c.firstJobFinishedAt !== null;
}

const DAY = 24 * 60 * 60 * 1000;
const daysBetween = (from: string, to: Date) => Math.floor((to.getTime() - Date.parse(from)) / DAY);

/** Whole days from the company being made to its first job finished, or null. */
export function daysToFirstJob(c: CompanyActivation): number | null {
  if (!c.firstJobFinishedAt) return null;
  return Math.max(0, Math.floor((Date.parse(c.firstJobFinishedAt) - Date.parse(c.createdAt)) / DAY));
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export type Attention = { reason: string; action: string; urgency: number };

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/**
 * Why a company needs the operator now, each with the next thing to do. Fixed
 * thresholds from the worksheet: the first job should be finished within days,
 * long before the 60 free days end. Most urgent first.
 */
export function attentionFor(c: CompanyActivation, now: Date): Attention[] {
  const out: Attention[] = [];
  const age = daysBetween(c.createdAt, now);
  const activated = isActivated(c);

  if (c.trialEndsAt) {
    const left = Math.ceil((Date.parse(c.trialEndsAt) - now.getTime()) / DAY);
    if (left <= 7 && left >= -14) {
      out.push({
        reason: left >= 0 ? `Free period ends in ${plural(left, "day")}` : `Free period ended ${plural(-left, "day")} ago`,
        action: "Talk to them about carrying on before it ends.",
        urgency: 90,
      });
    }
  }
  if (!activated && age >= 5) {
    out.push({
      reason: `No job finished yet, ${plural(age, "day")} in`,
      action: "Book a 15-minute call and do the first job together.",
      urgency: 80,
    });
  }
  if (activated && c.lastActivityAt && daysBetween(c.lastActivityAt, now) >= 5) {
    out.push({
      reason: `Nothing done for ${plural(daysBetween(c.lastActivityAt, now), "day")}`,
      action: "Check in: something has stopped them.",
      urgency: 70,
    });
  }
  if (age >= 7 && (!c.lastSignInAt || daysBetween(c.lastSignInAt, now) >= 7)) {
    out.push({
      reason: c.lastSignInAt ? `Nobody has signed in for ${plural(daysBetween(c.lastSignInAt, now), "day")}` : "Nobody has signed in yet",
      action: "They may have stopped using Tickd. Call them.",
      urgency: 60,
    });
  }
  if (!activated && age >= 3 && !c.firstWorkdayAt && !c.firstJobStartedAt) {
    out.push({
      reason: "Nobody has started a workday yet",
      action: "Ask the owner to have one person clock in and do one job today.",
      urgency: 50,
    });
  }
  if (!activated && age >= 3 && !c.firstClientAt) {
    out.push({
      reason: "No clients or sites added yet",
      action: "Offer to add their first clients and sites for them.",
      urgency: 40,
    });
  }
  if (age >= 2 && c.people < 2) {
    out.push({
      reason: "Only the owner is on Tickd",
      action: "Help the owner add their team and get them signed in on the phone app.",
      urgency: 30,
    });
  }
  return out.sort((a, b) => b.urgency - a.urgency);
}

/** How many companies are at each stage (by the furthest stage reached). */
export function pipeline(companies: CompanyActivation[]): number[] {
  const counts = STAGES.map(() => 0);
  for (const c of companies) counts[stageOf(c)] += 1;
  return counts;
}

/** A phone number as wa.me wants it (digits, international), or null. */
export function whatsappNumber(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return /^[1-9]\d{8,14}$/.test(digits) ? digits : null;
}

export function fromRow(r: {
  org_id: string;
  name: string;
  created_at: string;
  setup_started: boolean;
  setup_finished_at: string | null;
  people: number;
  team_on_at: string | null;
  first_client_at: string | null;
  first_workday_at: string | null;
  first_job_started_at: string | null;
  first_job_finished_at: string | null;
  finished_days_14: number;
  last_activity_at: string | null;
  last_sign_in_at: string | null;
  trial_ends_at: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
}): CompanyActivation {
  return {
    orgId: r.org_id,
    name: r.name,
    createdAt: r.created_at,
    setupStarted: r.setup_started,
    setupFinishedAt: r.setup_finished_at,
    people: r.people,
    teamOnAt: r.team_on_at,
    firstClientAt: r.first_client_at,
    firstWorkdayAt: r.first_workday_at,
    firstJobStartedAt: r.first_job_started_at,
    firstJobFinishedAt: r.first_job_finished_at,
    finishedDays14: r.finished_days_14,
    lastActivityAt: r.last_activity_at,
    lastSignInAt: r.last_sign_in_at,
    trialEndsAt: r.trial_ends_at,
    contactName: r.contact_name,
    contactEmail: r.contact_email,
    contactPhone: r.contact_phone,
  };
}
