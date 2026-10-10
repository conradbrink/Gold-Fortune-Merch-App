// The operator's list of people: every login, its company and role, the
// people using Tickd first, and the logins that belong to no company.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterUsers,
  loginLabel,
  readStatus,
  summarise,
  toPlatformUsers,
  type ProfileRow,
} from "@/lib/platform-users";

const companies = [
  { id: "org-gf", name: "Gold Fortune" },
  { id: "org-pl", name: "Ndlovu Plumbing" },
];
const jobRoles = [{ id: "role-admin", name: "Administrator" }];

const profile = (over: Partial<ProfileRow> & Pick<ProfileRow, "id" | "org_id">): ProfileRow => ({
  full_name: null,
  email: null,
  phone: null,
  job_title: null,
  job_role_id: null,
  role: "rep",
  is_active: true,
  created_at: "2026-10-01T08:00:00Z",
  ...over,
});

const profiles = [
  profile({ id: "u1", org_id: "org-gf", full_name: "Thabo Molefe", email: "thabo@gf.example", job_role_id: "role-admin", role: "manager" }),
  profile({ id: "u2", org_id: "org-gf", full_name: "Kagiso Dube", phone: "+26771234567", is_active: false }),
  profile({ id: "u3", org_id: "org-pl", full_name: "Sipho Ndlovu", email: "sipho@plumb.example" }),
];

const logins = [
  { id: "u1", email: "thabo@gf.example", last_sign_in_at: "2026-10-09T07:00:00Z", created_at: "2026-08-01T08:00:00Z" },
  { id: "u2", email: "26771234567@staff.tickd.co.za", last_sign_in_at: null, created_at: "2026-09-01T08:00:00Z" },
  { id: "u3", email: "sipho@plumb.example", last_sign_in_at: "2026-10-10T06:00:00Z", created_at: "2026-10-02T08:00:00Z" },
  { id: "u4", email: "nobody@example.com", last_sign_in_at: null, created_at: "2026-10-05T08:00:00Z" },
];

const users = toPlatformUsers(logins, profiles, companies, jobRoles);

test("each login gets its company and role, most recent sign-in first", () => {
  assert.deepEqual(
    users.map((u) => [u.id, u.companyName, u.role]),
    [
      ["u3", "Ndlovu Plumbing", "rep"],
      ["u1", "Gold Fortune", "Administrator"],
      ["u4", null, null],
      ["u2", "Gold Fortune", "rep"],
    ]
  );
});

test("a login with no profile is listed with no company", () => {
  const orphan = users.find((u) => u.id === "u4")!;
  assert.equal(orphan.isActive, null);
  assert.equal(orphan.login, "nobody@example.com");
});

test("a staff phone login shows the number, not the internal address", () => {
  assert.equal(users.find((u) => u.id === "u2")!.login, "+26771234567");
  assert.equal(loginLabel("27825550142@staff.tickd.co.za", null), "+27825550142");
  assert.equal(loginLabel("owner@example.com", "+27825550142"), "owner@example.com");
  assert.equal(loginLabel(null, null), null);
});

test("filters: search, company and status", () => {
  const ids = (list: { id: string }[]) => list.map((u) => u.id).sort();
  assert.deepEqual(ids(filterUsers(users, { q: "plumb" })), ["u3"]);
  assert.deepEqual(ids(filterUsers(users, { q: "  THABO " })), ["u1"]);
  assert.deepEqual(ids(filterUsers(users, { q: "+2677" })), ["u2"]);
  assert.deepEqual(ids(filterUsers(users, { company: "org-gf" })), ["u1", "u2"]);
  assert.deepEqual(ids(filterUsers(users, { status: "active" })), ["u1", "u3"]);
  assert.deepEqual(ids(filterUsers(users, { status: "inactive" })), ["u2"]);
  assert.deepEqual(ids(filterUsers(users, { status: "no-company" })), ["u4"]);
  assert.deepEqual(ids(filterUsers(users, {})), ["u1", "u2", "u3", "u4"]);
});

test("the status in the URL is read strictly", () => {
  assert.equal(readStatus("active"), "active");
  assert.equal(readStatus("deleted"), undefined);
  assert.equal(readStatus(["active"]), undefined);
});

test("the summary counts people, active, this week and no company", () => {
  assert.deepEqual(summarise(users, new Date("2026-10-10T12:00:00Z")), {
    people: 3,
    active: 2,
    signedInThisWeek: 2,
    noCompany: 1,
  });
});
