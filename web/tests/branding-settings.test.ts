// The settings screen's own checks for words, logos and colours. Each mirrors
// a rule the database enforces, so a mismatch here means the screen either
// refuses something the database would take or lets through something it
// will refuse with a less helpful message.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LOGO_MAX_BYTES,
  fitWithin,
  logoFileError,
  logoObjectPath,
  logoUploadError,
  newLogoSuffix,
  normalizeHex,
  planTermChanges,
  resolveTermDraft,
  termWordError,
  type TermDefinition,
} from "@/lib/branding-settings";

const ORG = "71170c8a-d53c-4a07-bdd4-97704a3cf4bc";
// The shape `organizations_logo_path_own_folder` and lib/branding.ts accept.
const LOGO_PATH = /^[0-9a-f-]{36}\/logo-[A-Za-z0-9_-]{1,40}\.(png|jpg|jpeg|webp)$/;

const defs: TermDefinition[] = [
  { key: "site", singular: "Site", plural: "Sites", article: null },
  { key: "job", singular: "Job", plural: "Jobs", article: null },
  { key: "staff", singular: "Staff member", plural: "Staff", article: null },
];

test("a word is 1 to 40 characters after trimming, counted as Postgres counts them", () => {
  assert.equal(termWordError("Store"), null);
  assert.equal(termWordError("  Store  "), null);
  assert.match(termWordError("   ") ?? "", /between 1 and 40/);
  assert.match(termWordError("x".repeat(41)) ?? "", /between 1 and 40/);
  assert.equal(termWordError("x".repeat(40)), null);
  // 40 emoji are 80 UTF-16 units but 40 characters.
  assert.equal(termWordError("🏪".repeat(40)), null);
});

test("a word cannot carry markup or control characters", () => {
  for (const bad of ["<b>", "Store>", "{site}", "Sto\nre", "Sto\u0007re", "a\u0085b"]) {
    assert.match(termWordError(bad) ?? "", /cannot contain/, JSON.stringify(bad));
  }
  assert.equal(termWordError("Today's route"), null);
  assert.equal(termWordError("Point-of-sale (POS)"), null);
});

test("a blank field means the default", () => {
  assert.deepEqual(resolveTermDraft({ one: " ", many: "", article: null }, defs[0]), {
    one: "Site",
    many: "Sites",
    article: null,
  });
});

test("saving writes only what changed, and a term edited back to the default loses its override", () => {
  const plan = planTermChanges(
    defs,
    [
      { key: "site", one: "Store", many: "Stores", article: null },
      { key: "staff", one: "Rep", many: "Reps", article: null },
    ],
    {
      site: { one: "Store", many: "Stores", article: null }, // unchanged
      job: { one: " Visit ", many: "Visits", article: null }, // new override
      staff: { one: "Staff member", many: "", article: null }, // back to default
    }
  );
  assert.deepEqual(plan.errors, {});
  assert.deepEqual(plan.upserts, [
    { key: "job", singular: "Visit", plural: "Visits", article: null },
  ]);
  assert.deepEqual(plan.deletes, ["staff"]);
});

test("a default typed into a term with no override changes nothing", () => {
  const plan = planTermChanges(defs, [], {
    site: { one: "Site", many: "Sites", article: null },
  });
  assert.deepEqual(plan, { upserts: [], deletes: [], errors: {} });
});

test("an article change alone is a change", () => {
  const plan = planTermChanges(defs, [], { site: { one: "Site", many: "Sites", article: "a" } });
  assert.deepEqual(plan.upserts, [{ key: "site", singular: "Site", plural: "Sites", article: "a" }]);
});

test("a bad word is reported against its term and nothing is planned for it", () => {
  const plan = planTermChanges(defs, [], {
    site: { one: "<Store>", many: "Stores", article: null },
    job: { one: "Visit", many: "Visits", article: null },
  });
  assert.match(plan.errors.site ?? "", /cannot contain/);
  assert.deepEqual(plan.upserts.map((u) => u.key), ["job"]);
});

test("only PNG, JPEG and WebP logos are accepted", () => {
  assert.equal(logoFileError({ type: "image/png", size: 1000 }), null);
  assert.equal(logoFileError({ type: "image/jpeg", size: 1000 }), null);
  assert.equal(logoFileError({ type: "image/webp", size: 1000 }), null);
  for (const type of ["image/svg+xml", "image/gif", "application/pdf", ""]) {
    assert.match(logoFileError({ type, size: 1000 }) ?? "", /PNG, JPEG or WebP/, type);
  }
});

test("a huge file is refused before decoding; the upload itself must be 1 MB or less", () => {
  assert.match(logoFileError({ type: "image/png", size: 50 * 1024 * 1024 }) ?? "", /under 1 MB/);
  assert.equal(logoUploadError({ size: LOGO_MAX_BYTES }), null);
  assert.match(logoUploadError({ size: LOGO_MAX_BYTES + 1 }) ?? "", /1 MB or smaller/);
});

test("a large image is shrunk to 512 px on its longest side, keeping its shape", () => {
  assert.equal(fitWithin(512, 300), null);
  assert.equal(fitWithin(200, 200), null);
  assert.deepEqual(fitWithin(2048, 1024), { width: 512, height: 256 });
  assert.deepEqual(fitWithin(600, 1200), { width: 256, height: 512 });
  assert.deepEqual(fitWithin(5000, 3), { width: 512, height: 1 });
});

test("every upload gets a new name in the company's folder, in the shape the database accepts", () => {
  const a = logoObjectPath(ORG, "image/png", newLogoSuffix(1));
  const b = logoObjectPath(ORG, "image/jpeg", newLogoSuffix(1));
  assert.match(a, LOGO_PATH);
  assert.match(b, LOGO_PATH);
  assert.ok(a.endsWith(".png"));
  assert.ok(b.endsWith(".jpg"));
  assert.ok(a.startsWith(`${ORG}/logo-`));
  assert.match(logoObjectPath(ORG, "image/webp", newLogoSuffix()), LOGO_PATH);
  assert.throws(() => logoObjectPath(ORG, "image/svg+xml", "x"));
  assert.throws(() => logoObjectPath(ORG, "image/png", "../x"));
});

test("colours are stored as #RRGGBB in capitals, whatever form they were typed in", () => {
  assert.equal(normalizeHex("#16224f"), "#16224F");
  assert.equal(normalizeHex("16224F"), "#16224F");
  assert.equal(normalizeHex(" #abc "), "#AABBCC");
  assert.equal(normalizeHex("#12345"), null);
  assert.equal(normalizeHex("red"), null);
  assert.equal(normalizeHex("#16224F;}</style>"), null);
});
