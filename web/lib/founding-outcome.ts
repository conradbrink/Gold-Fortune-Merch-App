/**
 * Telling a Founding applicant the answer (owner, 10 Oct 2026: applications close
 * 19 October, everyone is told by 23 October). The operator picks a status on the
 * applications page; for "accepted" they may also send the applicant the "you are
 * in" email through the outbox. Nobody is turned down (owner, 10 Oct 2026), so
 * there is no email for "declined": it only records that a business is not going
 * ahead. Nothing is sent by itself.
 */

export const FOUNDING_STATUSES = ["new", "contacted", "accepted", "declined", "waitlist"] as const;
export type FoundingStatus = (typeof FOUNDING_STATUSES)[number];

/** How a status reads on the page. "declined" is stored as such; it reads "Not going ahead" and sends nothing. */
export const FOUNDING_STATUS_LABEL: Record<FoundingStatus, string> = {
  new: "New",
  contacted: "Contacted",
  accepted: "Accepted",
  declined: "Not going ahead",
  waitlist: "Waiting list",
};

export function isFoundingStatus(v: string): v is FoundingStatus {
  return (FOUNDING_STATUSES as readonly string[]).includes(v);
}

/** The email that goes with a status, or null when that status has none. */
export function outcomeTemplate(status: FoundingStatus): "founding_accepted" | null {
  return status === "accepted" ? "founding_accepted" : null;
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
