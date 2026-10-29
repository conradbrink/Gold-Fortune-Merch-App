import { moduleEnabled, type ModuleCode, type ModuleSet } from "@/lib/modules";

/**
 * What a plan includes, as Settings > Plan lists it: the company's switched-on
 * modules in the words an owner uses, in a sensible order. No module codes,
 * no "On" or "Not in your plan": a customer sees what they have; what they
 * could add is a conversation with Tickd (owner, 22 Oct 2026).
 *
 * Core is always on and is two things to an owner. A module not listed here
 * (one built later) is left out until it is given a name.
 */
export const PLAN_FEATURES: { module: ModuleCode; labels: string[] }[] = [
  { module: "core", labels: ["Field tracking", "Check-ins"] },
  { module: "recurring_jobs", labels: ["Scheduling"] },
  { module: "checklists_forms", labels: ["Forms and checklists"] },
  { module: "reports", labels: ["Reports"] },
  { module: "owner_notifications", labels: ["Alerts and daily summaries"] },
  { module: "distribution", labels: ["Distribution"] },
  { module: "invoicing", labels: ["Quotes and invoices"] },
  { module: "deliveries", labels: ["Deliveries"] },
  { module: "warehouse", labels: ["Stock control"] },
  { module: "hr", labels: ["HR"] },
  { module: "vehicle_logbook", labels: ["Vehicle logbook"] },
];

/** The features this company's plan includes, in order. */
export function planIncludes(modules: ModuleSet): string[] {
  return PLAN_FEATURES.filter((f) => moduleEnabled(modules, f.module)).flatMap((f) => f.labels);
}
