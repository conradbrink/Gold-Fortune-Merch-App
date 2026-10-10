/**
 * Telling a Founding applicant the answer (owner, 10 Oct 2026: applications close
 * 19 October, everyone is told by 23 October). The operator picks a status on the
 * applications page; for "accepted" and "declined" they may also send the
 * applicant the matching email through the outbox. Nothing is sent by itself.
 */

export const FOUNDING_STATUSES = ["new", "contacted", "accepted", "declined", "waitlist"] as const;
export type FoundingStatus = (typeof FOUNDING_STATUSES)[number];

/** How a status reads on the page. "declined" is "Not this time": it is what the applicant is told. */
export const FOUNDING_STATUS_LABEL: Record<FoundingStatus, string> = {
  new: "New",
  contacted: "Contacted",
  accepted: "Accepted",
  declined: "Not this time",
  waitlist: "Waiting list",
};

export function isFoundingStatus(v: string): v is FoundingStatus {
  return (FOUNDING_STATUSES as readonly string[]).includes(v);
}

/** The email that goes with a status, or null when that status has none. */
export function outcomeTemplate(status: FoundingStatus): "founding_accepted" | "founding_declined" | null {
  if (status === "accepted") return "founding_accepted";
  if (status === "declined") return "founding_declined";
  return null;
}

/** What the outcome email is filled in from. */
export function outcomePayload(a: { name: string; business_name: string; whatsapp: string }) {
  return {
    first_name: a.name.trim().split(/\s+/)[0] ?? "",
    business_name: a.business_name,
    whatsapp: a.whatsapp,
  };
}

/** The outbox rows that already tell this applicant an answer, for "already sent". */
export const OUTCOME_RELATED_KIND = "founding_outcome";
