import type { SupabaseClient } from "@supabase/supabase-js";
import { capital, lower, possessive, type Terms } from "@/lib/terms";
import { moduleEnabled, type ModuleSet } from "@/lib/modules";

/**
 * Alerts when something's off (Stage 8.4), the web's half. The database
 * finds them (`detect_alerts`, every five minutes, for the rules the company
 * has on) and emails them; this turns one into plain words and a link, the
 * same for the bell in the top bar and for the emails, and reads and writes
 * the company's alert settings.
 *
 * Plain functions, no React: the email templates import this on the server.
 */

export const ALERT_RULES = ["off_site_checkin", "short_job", "missed_planned", "patrol_gap", "no_gps"] as const;
export type AlertRule = (typeof ALERT_RULES)[number];

export type AlertEmailMode = "instant" | "digest" | "off";

/** One alert, as `my_alerts()` returns it and as the email payload carries it. */
export type AlertItem = {
  id: string;
  rule: string;
  occurred_at: string;
  /** The company day it belongs to, "YYYY-MM-DD". */
  day: string;
  visit_id: string | null;
  route_id: string | null;
  store_id: string | null;
  profile_id: string | null;
  site_name: string | null;
  staff_name: string | null;
  detail: Record<string, unknown> | null;
  /** For the signed-in person; the emails have none. */
  unread?: boolean;
};

export function isAlertRule(v: string): v is AlertRule {
  return (ALERT_RULES as readonly string[]).includes(v);
}

/** The rule codes in an `alerts_on` setting: known ones, each once, in the catalogue's order. */
export function rulesFromSetting(setting: string | null | undefined): AlertRule[] {
  const asked = new Set((setting ?? "").split(",").map((s) => s.trim()));
  return ALERT_RULES.filter((r) => asked.has(r));
}

/** The setting for a set of rules, in the catalogue's order. */
export function rulesSetting(rules: readonly AlertRule[]): string {
  return ALERT_RULES.filter((r) => rules.includes(r)).join(",");
}

/** Each rule's name and one line on what it catches, in the company's words. */
export function ruleLabels(t: Terms): Record<AlertRule, { label: string; explain: string }> {
  const site = lower(t.site.one);
  const job = lower(t.job.one);
  const jobs = lower(t.job.many);
  return {
    off_site_checkin: {
      label: `Checked in away from the ${site}`,
      explain: `A check-in further from the ${site} than its check-in distance.`,
    },
    short_job: {
      label: `Short ${job}`,
      explain: `A finished ${job} shorter than the shortest normal ${job} set on Operations.`,
    },
    missed_planned: {
      label: `Planned ${job} not done`,
      explain: `A ${job} on the day's plan with nothing finished at the ${site} by the end of the day.`,
    },
    patrol_gap: {
      label: `Long gap between ${jobs}`,
      explain: `A ${site} that goes longer than the longest gap between check-ins on one day.`,
    },
    no_gps: {
      label: "Check-in with no location",
      explain: "A check-in where the phone could not tell where it was.",
    },
  };
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** 640 → "640 m", 4490 → "4.5 km". */
export function distanceText(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

/** 150 → "2 h 30 min", 45 → "45 min", 0.5 → "under a minute". */
export function minutesText(minutes: number): string {
  if (minutes < 1) return "under a minute";
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${m} min`;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}

/** "HH:MM" on the company's clock. */
export function clock(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(+d)) return "";
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone });
}

/** "2026-10-09" → "Fri 9 Oct". */
export function dayText(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(+d)) return day;
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/** The alert in words: a short title and one sentence. */
export function alertText(a: AlertItem, t: Terms, timeZone: string): { title: string; body: string } {
  const site = a.site_name?.trim() || `the ${lower(t.site.one)}`;
  const who = a.staff_name?.trim() || "Someone";
  const job = lower(t.job.one);
  const at = clock(a.occurred_at, timeZone);
  const when = `${dayText(a.day)}${at ? ` at ${at}` : ""}`;
  const d = a.detail ?? {};
  switch (a.rule) {
    case "off_site_checkin": {
      const dist = num(d.distance_m);
      const radius = num(d.radius_m);
      const far = dist === null ? "away from" : `${distanceText(dist)} from`;
      const limit = radius === null ? "" : `, outside its ${distanceText(radius)} radius`;
      return {
        title: `Checked in away from the ${lower(t.site.one)}`,
        body: `${who} checked in ${far} ${site}${limit}. ${when}.`,
      };
    }
    case "short_job": {
      const secs = num(d.seconds);
      const limit = num(d.limit_minutes);
      const took = secs === null ? "" : ` after ${minutesText(secs / 60)}`;
      const under = limit === null ? "" : `, under the ${limit} minutes you set`;
      return { title: `Short ${job}`, body: `${who} finished at ${site}${took}${under}. ${when}.` };
    }
    case "missed_planned": {
      const planned = a.staff_name?.trim() ? `${possessive(a.staff_name.trim())} ${job}` : `The ${job}`;
      return {
        title: `Planned ${job} not done`,
        body: `${planned} at ${site} planned for ${dayText(a.day)} was not done by the end of the day.`,
      };
    }
    case "patrol_gap": {
      const gap = num(d.gap_minutes);
      const from = clock(typeof d.from === "string" ? d.from : null, timeZone);
      const to = clock(typeof d.to === "string" ? d.to : null, timeZone);
      const span = from && to ? `, ${from} to ${to}` : "";
      return {
        title: `Long gap between ${lower(t.job.many)}`,
        body: `${capital(site)} went ${gap === null ? "a long time" : minutesText(gap)} without a check-in${span}, ${dayText(a.day)}.`,
      };
    }
    case "no_gps":
      return { title: "Check-in without GPS", body: `${who} checked in at ${site} with no GPS position. ${when}.` };
    default:
      return { title: "Something to check", body: `${site}. ${when}.` };
  }
}

/** The day after "YYYY-MM-DD", for a range that ends at the start of the next day. */
function nextDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Where the alert's facts are: the staff member's day on Tracking when it is
 * about one person, the day's Proof of service for a site's gap (Reports,
 * when the company has them), else the list of jobs.
 */
export function alertHref(a: AlertItem, modules: ModuleSet | null): string {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(a.day) ? a.day : null;
  if (a.rule === "patrol_gap" && day && modules && moduleEnabled(modules, "reports")) {
    const q = new URLSearchParams({ tab: "service", view: "completed", from: day, to: nextDay(day) });
    return `/reports?${q.toString()}`;
  }
  if (a.profile_id) {
    return day ? `/tracking/${a.profile_id}?date=${day}` : `/tracking/${a.profile_id}`;
  }
  return "/visits";
}

/** The latest alerts for the signed-in person, newest first. */
export async function fetchAlerts(supabase: SupabaseClient, limit = 30): Promise<AlertItem[]> {
  const { data, error } = await supabase.rpc("my_alerts", { p_limit: limit });
  if (error) throw new Error(error.message);
  return (data ?? []) as AlertItem[];
}

/** Mark the given alerts read, or every one when no list is given. */
export async function markAlertsRead(supabase: SupabaseClient, ids: string[] | null): Promise<void> {
  const { error } = await supabase.rpc("mark_alerts_read", { p_ids: ids });
  if (error) throw new Error(error.message);
}
