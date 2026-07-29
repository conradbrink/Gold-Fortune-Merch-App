export type VisitStatus = "done" | "upcoming" | "missed" | "unplanned";

export type Place = {
  id: string;
  account: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  placeCode: string;
  territory: string;
  status: "Active" | "Inactive";
  latestActivityRep: string;
};

export type Rep = {
  id: string;
  name: string;
};

export type ScheduleVisit = {
  id: string;
  repId: string;
  place: string;
  startHour: number; // 24h, fractional
  endHour: number;
  status: VisitStatus;
};

export const kpis = {
  activeReps: { value: 293, deltaLabel: null as string | null },
  visits: { value: 9003, deltaLabel: null as string | null },
  activities: { value: 66836, deltaLabel: null as string | null },
  totalVisits: { value: 19458, deltaPct: -7 },
  visitsWithForms: { value: 12284, pctOfAll: 63 },
  contributingReps: { value: 78, previousWeek: 0 },
  totalFacings: { value: 260535 },
  coldBoxFacings: { value: 93226 },
  warmFacings: { value: 167309 },
  coveragePct: { covered: 86, notCovered: 14 },
};

export const places: Place[] = [
  { id: "p1", account: "Target Corporation", name: "Target Corporation", address: "131 Ridgedale Dr", city: "Minnetonka", state: "MN", zip: "55305", placeCode: "US-487-782", territory: "68", status: "Active", latestActivityRep: "Allen, David" },
  { id: "p2", account: "Whole Foods Market", name: "Whole Foods Market", address: "802 Malcolm Dr", city: "Westminster", state: "MD", zip: "21157", placeCode: "US-201-993", territory: "113", status: "Active", latestActivityRep: "Phillips, Nancy" },
  { id: "p3", account: "Costco Wholesale", name: "Costco Wholesale", address: "5230 Ashton Blvd", city: "Baltimore", state: "MD", zip: "21236", placeCode: "US-430-801", territory: "51", status: "Active", latestActivityRep: "Folds, Benjamin" },
  { id: "p4", account: "The Kroger Co.", name: "The Kroger Co.", address: "580 Main St", city: "Royal Oak", state: "MI", zip: "48067", placeCode: "US-332-801", territory: "51", status: "Active", latestActivityRep: "Cora, Craig" },
  { id: "p5", account: "Whole Foods Market", name: "Whole Foods Market", address: "791 Torry Ct", city: "Buffalo", state: "NY", zip: "21022", placeCode: "US-93-887", territory: "22", status: "Active", latestActivityRep: "Roberts, Anthony" },
  { id: "p6", account: "Target Corporation", name: "Target Corporation", address: "4600 Allen Rd", city: "St. Louis", state: "MO", zip: "20736", placeCode: "US-122-112", territory: "25", status: "Active", latestActivityRep: "Coll, Jason" },
  { id: "p7", account: "7-Eleven Inc.", name: "7-Eleven Inc.", address: "922 New Guinea Rd", city: "Fairfax", state: "VA", zip: "22032", placeCode: "US-133-8011", territory: "40", status: "Active", latestActivityRep: "Smith, Devon" },
  { id: "p8", account: "Costco Wholesale", name: "Costco Wholesale", address: "1226 E Dixie Dr", city: "Raleigh", state: "NC", zip: "48022", placeCode: "US-61-2211", territory: "119", status: "Inactive", latestActivityRep: "Henry, Christopher" },
];

export const reps: Rep[] = [
  { id: "r1", name: "Allen, David" },
  { id: "r2", name: "Phillips, Nancy" },
  { id: "r3", name: "Folds, Benjamin" },
  { id: "r4", name: "Cora, Craig" },
  { id: "r5", name: "Roberts, Anthony" },
  { id: "r6", name: "Coll, Jason" },
  { id: "r7", name: "Smith, Devon" },
  { id: "r8", name: "Henry, Christopher" },
  { id: "r9", name: "Williams, Ashley" },
  { id: "r10", name: "Alexander, William" },
];

export const scheduleVisits: ScheduleVisit[] = [
  { id: "v1", repId: "r1", place: "Whole Foods Market", startHour: 15.5, endHour: 16.25, status: "unplanned" },
  { id: "v2", repId: "r4", place: "Costco Wholesale", startHour: 7, endHour: 10.5, status: "unplanned" },
  { id: "v3", repId: "r4", place: "Target Corporation", startHour: 10.5, endHour: 13, status: "unplanned" },
  { id: "v4", repId: "r5", place: "Whole Foods Market", startHour: 7, endHour: 9.5, status: "done" },
  { id: "v5", repId: "r6", place: "Costco Wholesale", startHour: 7, endHour: 10, status: "unplanned" },
  { id: "v6", repId: "r6", place: "Target Corporation", startHour: 10, endHour: 12.5, status: "unplanned" },
  { id: "v7", repId: "r7", place: "Target Corporation", startHour: 7, endHour: 13, status: "missed" },
  { id: "v8", repId: "r8", place: "Target Corporation", startHour: 7, endHour: 13, status: "missed" },
  { id: "v9", repId: "r8", place: "The Kroger Co.", startHour: 7, endHour: 13, status: "missed" },
  { id: "v10", repId: "r8", place: "Whole Foods Market", startHour: 13.5, endHour: 14.5, status: "done" },
  { id: "v11", repId: "r8", place: "Target Corporation", startHour: 14.5, endHour: 15.25, status: "done" },
  { id: "v12", repId: "r9", place: "The Kroger Co.", startHour: 10, endHour: 12.5, status: "unplanned" },
  { id: "v13", repId: "r10", place: "Costco Wholesale", startHour: 8, endHour: 10.5, status: "unplanned" },
  { id: "v14", repId: "r10", place: "Whole Foods Market", startHour: 11.5, endHour: 13, status: "upcoming" },
];

export const facingsByLocation = [
  { location: "Bottom", value: 8 },
  { location: "Eye-Level", value: 3 },
  { location: "Middle", value: 5 },
];

export const shelfFacingStats = { min: 1, avg: 5.9, max: 15, sum: 171 };

export const couponAvailability = [
  { name: "Yes", value: 17, color: "var(--color-chart-1)" },
  { name: "No", value: 13, color: "var(--color-chart-4)" },
];

export const formTemplates = [
  { id: "f1", name: "Merchandising Conditions Audit", submissions: 342, lastUpdated: "2026-07-18" },
  { id: "f2", name: "New Product Launch Checklist", submissions: 118, lastUpdated: "2026-07-11" },
  { id: "f3", name: "Cooler Door Compliance", submissions: 205, lastUpdated: "2026-06-30" },
  { id: "f4", name: "Competitor Pricing Snapshot", submissions: 76, lastUpdated: "2026-06-22" },
];

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: "Admin" | "Manager" | "Rep";
  status: "Active" | "Invited";
};

export const teamMembers: TeamMember[] = [
  { id: "u1", name: "Conrad Brink", email: "conrad@goldfortune.com", role: "Admin", status: "Active" },
  { id: "u2", name: "Nancy Phillips", email: "nancy.phillips@goldfortune.com", role: "Manager", status: "Active" },
  { id: "u3", name: "David Allen", email: "david.allen@goldfortune.com", role: "Rep", status: "Active" },
  { id: "u4", name: "Devon Smith", email: "devon.smith@goldfortune.com", role: "Rep", status: "Invited" },
];

export const companyDetails = {
  name: "Gold Fortune Inc.",
  legalName: "Gold Fortune Trading LLC",
  industry: "FMCG / Consumer Goods Distribution",
  website: "www.goldfortune.com",
  address: "1400 Commerce Way, Suite 220, Atlanta, GA 30303",
  supportEmail: "support@goldfortune.com",
};

export const currentPlan = {
  name: "Growth",
  price: "$249",
  billingCycle: "per month",
  seatsUsed: 4,
  seatsIncluded: 10,
  storesUsed: 8,
  storesIncluded: 50,
  renewsOn: "2026-09-01",
};

export const availablePlans = [
  { id: "starter", name: "Starter", price: "$99/mo", seats: 3, stores: 10 },
  { id: "growth", name: "Growth", price: "$249/mo", seats: 10, stores: 50 },
  { id: "enterprise", name: "Enterprise", price: "Custom", seats: Infinity, stores: Infinity },
];

export const unitsSoldTrend = [
  { week: "W1", units: 4200 },
  { week: "W2", units: 4800 },
  { week: "W3", units: 4100 },
  { week: "W4", units: 5300 },
  { week: "W5", units: 5900 },
  { week: "W6", units: 5400 },
];
