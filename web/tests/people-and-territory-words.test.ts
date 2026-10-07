// The territory, rep and role helpers in the company's words. Their messages
// are built from the terms, and Gold Fortune's must read exactly as they did
// before the terminology system; another company sees its own words.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createTerritory,
  deleteTerritory,
  moveTerritory,
  renameTerritory,
  setStoreTerritory,
} from "@/lib/territories";
import { changeRepEmail, setRepActive, updateRep } from "@/lib/representatives";
import { isAppRole, roleLabels } from "@/lib/roles";
import { DEFAULT_TERMS, parseTerms } from "@/lib/terms";

const goldFortune = parseTerms({
  site: { one: "Store", many: "Stores" },
  site_group: { one: "Chain", many: "Chains" },
  job: { one: "Visit", many: "Visits" },
  staff: { one: "Rep", many: "Reps" },
  territory: { one: "Territory", many: "Territories" },
});

type Result = { data: unknown; error: { code?: string; message: string } | null };

/**
 * A stand-in for the PostgREST builder: every call returns the builder, and
 * awaiting it (or `.single()`) gives the one answer the test set up.
 */
function answering(result: Result): SupabaseClient {
  const builder: Record<string, unknown> = {};
  for (const name of ["from", "insert", "update", "delete", "select", "eq", "single"]) {
    builder[name] = () => builder;
  }
  builder.then = (resolve: (r: Result) => unknown) => resolve(result);
  return builder as unknown as SupabaseClient;
}

const duplicate = answering({ data: null, error: { code: "23505", message: "dup" } });
const nothing = answering({ data: [], error: null });

async function message(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("expected a refusal");
}

test("Gold Fortune's territory refusals read as they always did", async () => {
  assert.equal(
    await message(createTerritory(duplicate, "org", " Palapye ", "r1", "territory", goldFortune)),
    'There is already a territory called "Palapye" here.'
  );
  assert.equal(
    await message(renameTerritory(duplicate, "t1", "Palapye", goldFortune)),
    'There is already a territory called "Palapye" here.'
  );
  assert.equal(
    await message(moveTerritory(nothing, "t1", "r1", goldFortune)),
    "The territory was not moved — you may not have permission."
  );
  assert.equal(
    await message(setStoreTerritory(nothing, "s1", "t1", goldFortune)),
    "The store was not moved — you may not have permission."
  );
  assert.equal(
    await message(
      deleteTerritory(answering({ data: null, error: { code: "23503", message: "fk" } }), "t1", goldFortune)
    ),
    "Still in use. Move its stores and sub-territories out first."
  );
});

test("another company's territory refusals use its words", async () => {
  assert.equal(
    await message(createTerritory(duplicate, "org", "North", "r1", "territory", DEFAULT_TERMS)),
    'There is already an area called "North" here.'
  );
  assert.equal(
    await message(moveTerritory(nothing, "t1", "r1", DEFAULT_TERMS)),
    "The area was not moved — you may not have permission."
  );
  assert.equal(
    await message(setStoreTerritory(nothing, "s1", "t1", DEFAULT_TERMS)),
    "The site was not moved — you may not have permission."
  );
  assert.equal(
    await message(
      deleteTerritory(answering({ data: null, error: { code: "23503", message: "fk" } }), "t1", DEFAULT_TERMS)
    ),
    "Still in use. Move its sites and sub-areas out first."
  );
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** An error page where JSON was expected, as a proxy in front of the API sends. */
function htmlAnswer(status: number) {
  globalThis.fetch = (async () => new Response("<html></html>", { status })) as typeof fetch;
}

test("Gold Fortune's rep messages read as they always did", async () => {
  assert.equal(
    await message(updateRep(nothing, "r1", { full_name: "A" }, goldFortune)),
    "Nothing was saved — you may not have permission to edit this rep."
  );
  htmlAnswer(502);
  assert.equal(
    await message(setRepActive("r1", false, goldFortune)),
    "Unexpected 502 response from the rep endpoint."
  );
  assert.equal(
    await message(changeRepEmail("r1", "a@b.c", goldFortune)),
    "Unexpected 502 response from the rep endpoint."
  );
  assert.equal(roleLabels(goldFortune).rep, "Field rep");
});

test("another company's people messages use its words", async () => {
  assert.equal(
    await message(updateRep(nothing, "r1", { full_name: "A" }, DEFAULT_TERMS)),
    "Nothing was saved — you may not have permission to edit this staff member."
  );
  htmlAnswer(500);
  assert.equal(
    await message(setRepActive("r1", true, DEFAULT_TERMS)),
    "Unexpected 500 response from the staff member endpoint."
  );
  assert.equal(roleLabels(DEFAULT_TERMS).rep, "Field staff member");
  assert.equal(roleLabels(DEFAULT_TERMS).manager, "Manager");
});

test("a role code is recognised by its stored value, not its label", () => {
  assert.equal(isAppRole("rep"), true);
  assert.equal(isAppRole("hr_manager"), true);
  assert.equal(isAppRole("Field rep"), false);
  assert.equal(isAppRole("toString"), false);
});
