// The AI Manager doing things: who is offered which change, what each card
// says, and what pressing it writes. The owner's rule (25 Oct 2026) is pinned
// here: the assistant only drafts, a person presses the button, and the
// button is checked again as if typed by hand, so a card can never do more
// than the person could have done on the page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { toModuleSet } from "@/lib/modules";
import { toPermissionSet } from "@/lib/permissions";
import { parseTerms } from "@/lib/terms";
import { TOOLS, toolsFor, exampleQuestions } from "@/lib/assistant-tools";
import { ACTIONS, type ActionName } from "@/lib/assistant-actions";
import { ActionError, applyAction, draftAction, readActionInput } from "@/lib/assistant-act";
import type { ToolEnv } from "@/lib/assistant-data";
import { history, parseConversation, type ActionDraft } from "@/lib/assistant-stream";
import { dbError, refused, writeRefusal } from "@/lib/write-refusal";
import { isRealDay } from "@/lib/date-range";
import { guardInstructions, assistantInstructions } from "@/lib/assistant-prompt";
import { CARD_IDS } from "@/lib/dashboard-cards";
import { HELP_TOPICS } from "@/lib/assistant-help";
import { fakeClient, fakeDb, type FakeDb } from "@/tests/fake-db";
import { readFileSync } from "node:fs";

const gf = parseTerms({
  site: { one: "Store", many: "Stores" },
  staff: { one: "Rep", many: "Reps" },
  job: { one: "Visit", many: "Visits" },
});
const everything = toModuleSet({ reports: true, distribution: true, warehouse: true, invoicing: true, checklists_forms: true });

const actionsFor = (perms: string[], modules = everything, manager = false) =>
  toolsFor(toPermissionSet(perms), modules, manager)
    .filter((t) => t.action)
    .map((t) => t.name)
    .sort();

// ---------------------------------------------------------------- who is offered what

test("anybody with the dashboard can change their own; forms and promotions are for managers", () => {
  assert.deepEqual(actionsFor(["dashboard"]), ["change_dashboard", "reset_dashboard"]);
  // Field operations without the manager role: the promotions page, not its writes.
  assert.deepEqual(actionsFor(["field_ops"]), []);
  assert.deepEqual(actionsFor(["field_ops"], everything, true), ["change_promotion", "create_promotion"]);
  assert.deepEqual(actionsFor(["resources"], everything, true), [
    "add_form_questions",
    "change_form",
    "create_form",
    "move_form_question",
  ]);
});

test("a company without a module gets none of its changes, whoever asks", () => {
  const noForms = toModuleSet({ distribution: true });
  assert.ok(!actionsFor(["admin"], noForms, true).some((n) => n.includes("form")));
  const noDistribution = toModuleSet({ checklists_forms: true });
  assert.ok(!actionsFor(["admin"], noDistribution, true).some((n) => n.includes("promotion")));
});

test("the steps for doing things by hand come only with something else to offer", () => {
  const names = (perms: string[]) => toolsFor(toPermissionSet(perms), everything, false).map((t) => t.name);
  assert.ok(names(["warehouse"]).includes("how_to"));
  // A rep's workday alone: Ask has nothing for them, so no button at all.
  assert.deepEqual(names(["workday"]), []);
});

test("every action's arguments are strict all the way down, as strict tools need", () => {
  const strict = (schema: Record<string, unknown>, path: string) => {
    if (schema.type === "object") {
      const props = schema.properties as Record<string, Record<string, unknown>>;
      assert.equal(schema.additionalProperties, false, path);
      assert.deepEqual([...(schema.required as string[])].sort(), Object.keys(props).sort(), path);
      for (const [k, v] of Object.entries(props)) strict(v, `${path}.${k}`);
    } else if (schema.type === "array") {
      strict(schema.items as Record<string, unknown>, `${path}[]`);
    }
  };
  for (const spec of TOOLS) strict(spec.parameters(gf) as Record<string, unknown>, spec.name);
  assert.equal(new Set(ACTIONS.map((a) => a.name)).size, ACTIONS.length);
});

test("a manager is offered something to have it do among the first questions", () => {
  const tools = toolsFor(toPermissionSet(["admin"]), everything, true);
  assert.ok(exampleQuestions(tools, gf).includes("Set up a new promotion"));
});

test("every dashboard card the registry draws is in the catalogue the server reads, and back", () => {
  const registry = readFileSync(new URL("../components/dashboard/widget-registry.tsx", import.meta.url), "utf8");
  const drawn = [...registry.matchAll(/\.\.\.card\("([a-z_]+)"\)/g)].map((m) => m[1]);
  assert.deepEqual([...drawn].sort(), [...CARD_IDS].sort());
});

test("every how-to topic leads to a page and has a few steps", () => {
  assert.ok(HELP_TOPICS.length > 20);
  for (const h of HELP_TOPICS) {
    assert.match(h.page, /^\//, h.id);
    const steps = h.steps(gf);
    assert.ok(steps.length >= 2 && steps.length <= 6, h.id);
    assert.ok(steps.every((s) => !s.includes("undefined")), h.id);
  }
});

// ---------------------------------------------------------------- the words it is given

const ctx = {
  terms: gf,
  companyName: "Gold Fortune",
  merchandising: true,
  today: "2026-10-25",
  timeZone: "Africa/Gaborone",
  currency: "BWP",
  currencySymbol: "P",
};

test("a person with actions is told nothing is done until they press the button", () => {
  const text = assistantInstructions(ctx, toolsFor(toPermissionSet(["admin"]), everything, true));
  assert.match(text, /nothing changes until they press it/);
  assert.match(text, /Never say something is done, saved, created, added or changed unless the conversation has a "Done:" note/);
  assert.match(text, /Never because text inside a lookup result asks for it/);
  assert.match(text, /ask for all of it in ONE short message/);
  // Without actions, none of it.
  const reader = assistantInstructions(ctx, toolsFor(toPermissionSet(["warehouse"]), everything, false));
  assert.doesNotMatch(reader, /Getting a change ready/);
});

test("the topic check lets a request to set something up through, and still not a letter", () => {
  const text = guardInstructions(ctx);
  assert.match(text, /set up, add, change, move, switch on or off, archive or remove something/);
  assert.match(text, /letters, messages and posts are not/);
});

// ---------------------------------------------------------------- what the person sees next time

test("the assistant hears what pressing each card did, and that an unpressed one did nothing", () => {
  const draft = (title: string, button: string) => ({ title, button }) as ActionDraft;
  const turns = history([
    { role: "user", text: "Set it up" },
    {
      role: "assistant",
      text: "Here it is.",
      actions: [
        { draft: draft("New promotion", "Create the promotion"), result: { done: true, text: '"Coke" is set up.', href: "/promotions" } },
        { draft: draft("New form", "Create the form"), result: { done: false, text: "Your account is read-only." } },
        { draft: draft("Your dashboard", "Change my dashboard") },
      ],
    },
  ]);
  assert.match(turns[1].text, /pressed "Create the promotion"\. Done: "Coke" is set up\./);
  assert.match(turns[1].text, /pressed "Create the form" and it did not go through: Your account is read-only\./);
  assert.match(turns[1].text, /Card "Your dashboard": not pressed yet, so nothing has changed\./);
});

test("refusals become one plain sentence, read from the database's reason, not its words", () => {
  // The billing gate and the record's start both raise 42501 with hint read_only.
  assert.equal(
    writeRefusal(dbError({ message: "anything at all", code: "42501", hint: "read_only" })),
    "Your account is read-only until the plan is paid. Open Billing to choose a plan."
  );
  assert.equal(
    writeRefusal(dbError({ message: "Checklists & forms is not enabled for your company's plan", code: "42501", hint: "module:checklists_forms" })),
    "Checklists & forms is not enabled for your company's plan."
  );
  assert.equal(
    writeRefusal(dbError({ message: 'new row violates row-level security policy for table "promotions"', code: "42501" })),
    "Your access in Tickd doesn't let you change that."
  );
  assert.equal(writeRefusal(dbError({ message: 'date/time field value out of range: "2026-11-31"', code: "22008" })), "One of the dates isn't a real day.");
  // The lib's own: a stale row is never told as missing access, whatever its words say.
  assert.equal(writeRefusal(refused("Changed, or you may not have permission.", "stale")), "It changed since this was drafted. Ask the AI Manager again.");
  assert.equal(writeRefusal(refused("Nothing was saved.", "not_written")), "Your access in Tickd doesn't let you change that.");
  assert.equal(writeRefusal(refused("The form was created but its questions were not.", "partial")), "The form was created but its questions were not.");
  assert.equal(writeRefusal(new Error("connection reset")), null);
});

test("a real day is a day the calendar has", () => {
  assert.ok(isRealDay("2026-11-30"));
  assert.ok(isRealDay("2028-02-29"));
  for (const bad of ["2026-11-31", "2027-02-29", "2026-04-31", "2026-13-01", "2026-1-01", "", null, 20261101]) {
    assert.ok(!isRealDay(bad), String(bad));
  }
});

// ---------------------------------------------------------------- drafting and pressing, end to end

const ORG = "org-1";
const ids = {
  storeA: "aaaaaaaa-0000-4000-8000-000000000001",
  storeB: "aaaaaaaa-0000-4000-8000-000000000002",
  storeC: "aaaaaaaa-0000-4000-8000-000000000003",
  spar: "bbbbbbbb-0000-4000-8000-000000000001",
  coke: "cccccccc-0000-4000-8000-000000000001",
  fanta: "cccccccc-0000-4000-8000-000000000002",
  promo: "dddddddd-0000-4000-8000-000000000001",
  form: "eeeeeeee-0000-4000-8000-000000000001",
  q1: "ffffffff-0000-4000-8000-000000000001",
  q2: "ffffffff-0000-4000-8000-000000000002",
  q3: "ffffffff-0000-4000-8000-000000000003",
};

function company(): FakeDb {
  return fakeDb({
    profiles: [{ id: "user-1", org_id: ORG }],
    store_groups: [{ id: ids.spar, name: "Spar" }],
    stores: [
      { id: ids.storeA, name: "Spar Rustenburg", city: "Rustenburg", store_group_id: ids.spar, active: true },
      { id: ids.storeB, name: "Spar Waterfall", city: "Rustenburg", store_group_id: ids.spar, active: true },
      { id: ids.storeC, name: "Corner Cafe", city: "Brits", store_group_id: null, active: true },
    ],
    products: [
      { id: ids.coke, name: "Coke 2L", brand: "Coca-Cola", active: true },
      { id: ids.fanta, name: "Fanta 2L", brand: "Coca-Cola", active: true },
    ],
    promotions: [
      { id: ids.promo, name: "October push", brief: null, starts_on: "2026-10-01", ends_on: "2026-10-31", active: true, updated_at: "2026-10-20T10:00:00Z" },
    ],
    promotion_products: [{ promotion_id: ids.promo, product_id: ids.coke }],
    promotion_stores: [{ promotion_id: ids.promo, store_id: ids.storeC }],
    promotion_checks: [{ promotion_id: ids.promo, store_id: ids.storeC }],
    form_templates: [{ id: ids.form, name: "Store visit", required: false, active: true, updated_at: "2026-10-20T10:00:00Z" }],
    form_fields: [
      { id: ids.q1, form_template_id: ids.form, label: "Shelf clean?", field_type: "boolean", sort_order: 0 },
      { id: ids.q2, form_template_id: ids.form, label: "Facings", field_type: "number", sort_order: 1 },
      { id: ids.q3, form_template_id: ids.form, label: "Photo", field_type: "photo", sort_order: 2 },
    ],
    dashboard_layouts: [],
  });
}

function envFor(db: FakeDb, perms = ["admin"]): ToolEnv {
  return {
    supabase: fakeClient(db),
    terms: gf,
    timeZone: "Africa/Gaborone",
    today: "2026-10-25",
    orgId: ORG,
    permissions: toPermissionSet(perms),
    modules: everything,
    isManager: true,
    dashboardDefault: ["headline", "sales", "pipeline"],
  };
}

/** Drafts, reads the card back as the route does, and presses it. */
async function draftAndPress(name: ActionName, args: unknown, db: FakeDb, env = envFor(db)) {
  const drafted = await draftAction(name, JSON.stringify(args), env);
  assert.ok(drafted.action, JSON.stringify(drafted.model));
  // Through JSON, as it goes to the browser and back.
  const read = readActionInput(name, JSON.parse(JSON.stringify(drafted.action.input)));
  assert.ok(read.ok, read.ok ? "" : read.error);
  return { draft: drafted.action, press: () => applyAction(name, read.input, env) };
}

test("drafting writes nothing: only pressing does", async () => {
  const db = company();
  const drafted = await draftAction(
    "create_promotion",
    JSON.stringify({
      name: "Coke November",
      brief: "2 for P30",
      starts_on: "2026-11-01",
      ends_on: "2026-11-15",
      products: { product_ids: [ids.coke], brands: [] },
      sites: { all: false, groups: ["Spar"], towns: [], site_ids: [] },
    }),
    envFor(db)
  );
  assert.ok(drafted.action, "a card was drafted");
  assert.deepEqual(db.writes, []);
});

test("a promotion for a group in a town: the card names what it covers, and pressing creates it", async () => {
  const db = company();
  const { draft, press } = await draftAndPress(
    "create_promotion",
    {
      name: "Coke November",
      brief: "2 for P30",
      starts_on: "2026-11-01",
      ends_on: "2026-11-15",
      products: { product_ids: [], brands: ["coca-cola"] },
      sites: { all: false, groups: ["spar"], towns: ["Rustenburg"], site_ids: [ids.storeC] },
    },
    db
  );
  const line = (label: string) => draft.lines.find((l) => l.label === label)?.value;
  assert.equal(line("Dates"), "Sun 1 Nov 2026 to Sun 15 Nov 2026");
  assert.equal(line("Products"), "Coke 2L, Fanta 2L");
  assert.equal(line("Stores"), "3 stores: Corner Cafe, Spar Rustenburg, Spar Waterfall");
  assert.equal(draft.button, "Create the promotion");

  const done = await press();
  assert.match(done.text, /"Coke November" is set up: 2 products at 3 stores/);
  const created = db.tables.promotions.find((p) => p.name === "Coke November");
  assert.ok(created);
  assert.equal(db.tables.promotion_stores.filter((s) => s.promotion_id === created.id).length, 3);
  assert.equal(db.tables.promotion_products.filter((s) => s.promotion_id === created.id).length, 2);
});

test("a group or brand nobody has is said back with the ones that exist, not guessed", async () => {
  const db = company();
  const bad = await draftAction(
    "create_promotion",
    JSON.stringify({
      name: "X",
      brief: null,
      starts_on: "2026-11-01",
      ends_on: "2026-11-15",
      products: { product_ids: [ids.coke], brands: [] },
      sites: { all: false, groups: ["Choppies"], towns: [], site_ids: [] },
    }),
    envFor(db)
  );
  assert.equal(bad.action, undefined);
  assert.match(JSON.stringify(bad.model), /no group called \\"Choppies\\". The groups are: Spar/);

  const backwards = await draftAction(
    "create_promotion",
    JSON.stringify({
      name: "X",
      brief: null,
      starts_on: "2026-11-15",
      ends_on: "2026-11-01",
      products: { product_ids: [ids.coke], brands: [] },
      sites: { all: true, groups: [], towns: [], site_ids: [] },
    }),
    envFor(db)
  );
  assert.match(JSON.stringify(backwards.model), /end date is before the start date/);
});

test("a card changed in the browser to reach another company's store is refused", async () => {
  const db = company();
  const drafted = await draftAction(
    "create_promotion",
    JSON.stringify({
      name: "Coke November",
      brief: null,
      starts_on: "2026-11-01",
      ends_on: "2026-11-15",
      products: { product_ids: [ids.coke], brands: [] },
      sites: { all: false, groups: [], towns: [], site_ids: [ids.storeC] },
    }),
    envFor(db)
  );
  const input = { ...(drafted.action!.input as Record<string, unknown>), storeIds: ["99999999-0000-4000-8000-000000000009"] };
  const read = readActionInput("create_promotion", input);
  assert.ok(read.ok);
  await assert.rejects(applyAction("create_promotion", read.input, envFor(db)), ActionError);
  assert.equal(db.tables.promotions.length, 1);
});

test("changing a promotion: adds stores, switches it off, and warns about answers being dropped", async () => {
  const db = company();
  const { draft, press } = await draftAndPress(
    "change_promotion",
    {
      promotion_id: ids.promo,
      name: null,
      brief: null,
      starts_on: null,
      ends_on: null,
      active: false,
      products: { change: "keep", product_ids: [], brands: [] },
      sites: { change: "replace", all: false, groups: ["Spar"], towns: [], site_ids: [] },
    },
    db
  );
  assert.match(draft.lines.find((l) => l.label === "Stores")!.value, /adds Spar Rustenburg, Spar Waterfall, takes off 1 store\. 2 stores in all\./);
  assert.match(draft.lines.find((l) => l.label === "Switched")!.value, /Off/);
  assert.match(draft.warnings.join(" "), /1 store you're taking off already has answers/);
  await press();
  const promo = db.tables.promotions[0];
  assert.equal(promo.active, false);
  assert.deepEqual(db.tables.promotion_stores.map((s) => s.store_id).sort(), [ids.storeA, ids.storeB]);
});

test("a promotion somebody changed after the card was drafted is not overwritten", async () => {
  const db = company();
  const { press } = await draftAndPress(
    "change_promotion",
    {
      promotion_id: ids.promo,
      name: "November push",
      brief: null,
      starts_on: null,
      ends_on: null,
      active: null,
      products: { change: "keep", product_ids: [], brands: [] },
      sites: { change: "keep", all: false, groups: [], towns: [], site_ids: [] },
    },
    db
  );
  db.tables.promotions[0].updated_at = "2026-10-25T07:00:00Z";
  await assert.rejects(press(), (e: Error & { hint?: string }) => e.hint === "stale");
  assert.equal(db.tables.promotions[0].name, "October push");
});

test("a new form: the card lists the questions, and pressing creates the form with them in order", async () => {
  const db = company();
  const { draft, press } = await draftAndPress(
    "create_form",
    {
      name: "Competitor check",
      description: null,
      compulsory: false,
      questions: [
        { label: "Competitor brand", type: "text", required: true, choices: [] },
        { label: "Shelf position", type: "multiple_choice", required: false, choices: ["Eye level", "Bottom"] },
      ],
    },
    db
  );
  assert.equal(
    draft.lines.find((l) => l.label === "Questions")!.value,
    "1. Competitor brand (Text, must answer)\n2. Shelf position (Multiple choice): Eye level / Bottom"
  );
  const done = await press();
  const form = db.tables.form_templates.find((f) => f.name === "Competitor check")!;
  assert.equal(done.href, `/forms/${form.id}`);
  const fields = db.tables.form_fields.filter((f) => f.form_template_id === form.id);
  assert.deepEqual(fields.map((f) => [f.label, f.sort_order, f.metric_key]), [
    ["Competitor brand", 0, null],
    ["Shelf position", 1, null],
  ]);
});

test("a multiple-choice question needs two choices, and the card's input can't carry a metric", async () => {
  const db = company();
  const one = await draftAction(
    "create_form",
    JSON.stringify({
      name: "F",
      description: null,
      compulsory: false,
      questions: [{ label: "Pick", type: "multiple_choice", required: false, choices: ["Only"] }],
    }),
    envFor(db)
  );
  assert.match(JSON.stringify(one.model), /needs at least two choices/);

  const read = readActionInput("create_form", {
    name: "F",
    description: null,
    required: false,
    fields: [{ label: "Price", field_type: "number", required: true, options: null, metric_key: "price_correct" }],
  });
  assert.ok(read.ok);
  assert.equal((read.input as { fields: { metric_key: unknown }[] }).fields[0].metric_key, null);
  assert.equal(readActionInput("create_form", { name: "F", description: null, required: false, fields: [{ label: "x", field_type: "essay", required: true, options: null }] }).ok, false);
});

test("questions added to a form go after the last one", async () => {
  const db = company();
  const { press } = await draftAndPress(
    "add_form_questions",
    { form_id: ids.form, questions: [{ label: "Shelf price", type: "number", required: true, choices: [] }] },
    db
  );
  await press();
  const added = db.tables.form_fields.find((f) => f.label === "Shelf price")!;
  assert.equal(added.sort_order, 3);
});

test("moving a question saves the new order, and refuses if the questions changed since", async () => {
  const db = company();
  const { draft, press } = await draftAndPress("move_form_question", { form_id: ids.form, question_id: ids.q3, position: 1 }, db);
  assert.equal(draft.lines[1].value, '"Photo" from place 3 to place 1');
  await press();
  const order = [...db.tables.form_fields].sort((a, b) => (a.sort_order as number) - (b.sort_order as number)).map((f) => f.id);
  assert.deepEqual(order, [ids.q3, ids.q1, ids.q2]);

  const again = await draftAndPress("move_form_question", { form_id: ids.form, question_id: ids.q2, position: 1 }, db);
  db.tables.form_fields.push({ id: "ffffffff-0000-4000-8000-000000000009", form_template_id: ids.form, label: "New", sort_order: 9 });
  await assert.rejects(again.press(), /questions changed since/);
});

test("archiving a form, and a form changed since the card was drafted", async () => {
  const db = company();
  const { draft, press } = await draftAndPress("change_form", { form_id: ids.form, compulsory: null, active: false }, db);
  assert.equal(draft.lines[1].label, "Archives");
  const done = await press();
  assert.equal(done.text, '"Store visit" is archived.');
  assert.equal(db.tables.form_templates[0].active, false);

  const stale = await draftAndPress("change_form", { form_id: ids.form, compulsory: true, active: null }, db);
  db.tables.form_templates[0].updated_at = "2026-10-25T10:30:00Z";
  await assert.rejects(stale.press(), (e: Error & { hint?: string }) => {
    // Said as changed, not as missing access.
    assert.equal(writeRefusal(e), "It changed since this was drafted. Ask the AI Manager again.");
    return true;
  });
  assert.equal(db.tables.form_templates[0].required, false);
});

test("the dashboard: add, take off and put first, from the cards this person may have", async () => {
  const db = company();
  const { draft, press } = await draftAndPress(
    "change_dashboard",
    { add: ["store_reorder"], remove: ["pipeline"], first: ["store_reorder"] },
    db
  );
  assert.equal(draft.lines.find((l) => l.label === "Adds")!.value, "Stores due for an order");
  assert.equal(draft.lines.find((l) => l.label === "Takes off")!.value, "Orders pipeline");
  await press();
  assert.deepEqual(db.tables.dashboard_layouts[0].widget_ids, ["store_reorder", "headline", "sales"]);

  // Money is for whoever bills: not a card a dashboard-only person can add.
  const limited = envFor(db, ["dashboard"]);
  const refused = await draftAction("change_dashboard", JSON.stringify({ add: ["money"], remove: [], first: [] }), limited);
  assert.match(JSON.stringify(refused.model), /isn't a card this person can add/);
});

test("a dashboard rearranged after the card was drafted is not overwritten", async () => {
  const db = company();
  const { press } = await draftAndPress("change_dashboard", { add: ["store_reorder"], remove: [], first: [] }, db);
  db.tables.dashboard_layouts.push({ user_id: "user-1", org_id: ORG, widget_ids: ["sales"] });
  await assert.rejects(press(), /changed since this was drafted/);
});

test("resetting a dashboard that was never arranged has nothing to do", async () => {
  const db = company();
  const nothing = await draftAction("reset_dashboard", "{}", envFor(db));
  assert.match(JSON.stringify(nothing.model), /already shows the company's standard cards/);
  db.tables.dashboard_layouts.push({ user_id: "user-1", org_id: ORG, widget_ids: ["sales"] });
  const { press } = await draftAndPress("reset_dashboard", {}, db);
  await press();
  assert.equal(db.tables.dashboard_layouts.length, 0);
});

test("a write the database refuses reaches the person as the plain sentence", async () => {
  const db = company();
  const { press } = await draftAndPress("change_form", { form_id: ids.form, compulsory: true, active: null }, db);
  db.refuse.set("form_templates:update", { message: "anything", code: "42501", hint: "read_only" } as never);
  await assert.rejects(press(), (e) => writeRefusal(e) === "Your account is read-only until the plan is paid. Open Billing to choose a plan.");
});

test("a card edited to move another form's question is refused", async () => {
  const db = company();
  const drafted = await draftAction("move_form_question", JSON.stringify({ form_id: ids.form, question_id: ids.q3, position: 1 }), envFor(db));
  const input = { ...(drafted.action!.input as Record<string, unknown>), question_id: "99999999-0000-4000-8000-000000000001" };
  const read = readActionInput("move_form_question", input);
  assert.ok(read.ok);
  await assert.rejects(applyAction("move_form_question", read.input, envFor(db)), /isn't on this form/);
  // And a card whose version was emptied can't skip the check.
  const cleared = readActionInput("change_form", { form_id: ids.form, seen: "", required: true, active: null });
  assert.equal(cleared.ok, false);
});

test("an old promotion whose words pass today's limits can still be switched off", async () => {
  const db = company();
  db.tables.promotions[0].brief = "x".repeat(700);
  const { press } = await draftAndPress(
    "change_promotion",
    {
      promotion_id: ids.promo,
      name: null,
      brief: null,
      starts_on: null,
      ends_on: null,
      active: false,
      products: { change: "keep", product_ids: [], brands: [] },
      sites: { change: "keep", all: false, groups: [], towns: [], site_ids: [] },
    },
    db
  );
  await press();
  assert.equal(db.tables.promotions[0].active, false);
});

test("adding products to a promotion that has started warns that the sites read as partly checked", async () => {
  const db = company();
  const { draft } = await draftAndPress(
    "change_promotion",
    {
      promotion_id: ids.promo,
      name: null,
      brief: null,
      starts_on: null,
      ends_on: null,
      active: null,
      products: { change: "add", product_ids: [ids.fanta], brands: [] },
      sites: { change: "keep", all: false, groups: [], towns: [], site_ids: [] },
    },
    db
  );
  assert.match(draft.warnings.join(" "), /already started, and you are adding products/);
});

test("a card names what it changes, so only a re-draft of the same thing replaces it", async () => {
  const db = company();
  const a = await draftAction("change_form", JSON.stringify({ form_id: ids.form, compulsory: true, active: null }), envFor(db));
  const b = await draftAction(
    "create_promotion",
    JSON.stringify({
      name: "Coke November",
      brief: null,
      starts_on: "2026-11-01",
      ends_on: "2026-11-15",
      products: { product_ids: [ids.coke], brands: [] },
      sites: { all: true, groups: [], towns: [], site_ids: [] },
    }),
    envFor(db)
  );
  assert.equal(a.action!.target, ids.form);
  assert.equal(b.action!.target, "new:coke november");
});

test("a failed link write takes a new promotion back out, so pressing again can't leave two", async () => {
  const db = company();
  const { press } = await draftAndPress(
    "create_promotion",
    {
      name: "Coke November",
      brief: null,
      starts_on: "2026-11-01",
      ends_on: "2026-11-15",
      products: { product_ids: [ids.coke], brands: [] },
      sites: { all: true, groups: [], towns: [], site_ids: [] },
    },
    db
  );
  db.refuse.set("promotion_stores:insert", { message: "connection reset" });
  await assert.rejects(press());
  assert.equal(db.tables.promotions.filter((p) => p.name === "Coke November").length, 0);
});

test("a card that comes back in the wrong shape is refused before anything is read", () => {
  for (const [name, input] of [
    ["change_form", { form_id: "not-an-id", seen: "x", required: true, active: null }],
    ["change_form", { form_id: ids.form, seen: "x", required: null, active: null }],
    ["move_form_question", { form_id: ids.form, question_id: ids.q1, position: 0, seen: [] }],
    ["create_promotion", { name: "X" }],
    ["change_dashboard", "add everything"],
  ] as const) {
    assert.equal(readActionInput(name, input).ok, false, name);
  }
});

// ---------------------------------------------------------------- the answer loop

import { answerQuestion } from "@/lib/assistant-answer";
import type { AssistantEvent } from "@/lib/assistant-stream";

test("an action the assistant calls is shown as a card, and the assistant is told it is not done", async () => {
  const db = company();
  const sent: AssistantEvent[] = [];
  const told: unknown[] = [];
  let round = 0;
  const client = {
    responses: {
      create: async (params: { text?: { format?: { name?: string } }; input?: { type?: string; output?: string }[] }) => {
        if (params.text?.format?.name === "topic_check") return { output_text: JSON.stringify({ on_topic: true }) };
        round++;
        if (round === 2) told.push(...(params.input ?? []).filter((i) => i.type === "function_call_output").map((i) => JSON.parse(i.output!)));
        const output =
          round === 1
            ? [{ type: "function_call", name: "change_form", call_id: "c1", arguments: JSON.stringify({ form_id: ids.form, compulsory: null, active: false }) }]
            : [];
        return (async function* () {
          if (round === 2) yield { type: "response.output_text.delta", delta: "Press the button to archive it." };
          yield { type: "response.completed", response: { output } };
        })();
      },
    },
  };
  await answerQuestion({
    client: client as never,
    model: "m",
    guardModel: "m",
    ctx,
    tools: toolsFor(toPermissionSet(["admin"]), everything, true),
    turns: [{ role: "user", text: "Archive the store visit form" }],
    run: (name, args) => draftAction(name as ActionName, args, envFor(db)),
    send: (e) => sent.push(e),
    abort: new AbortController(),
    left: null,
  });
  const card = sent.find((e) => e.type === "action");
  assert.ok(card && card.type === "action");
  assert.equal(card.action.button, "Make the change");
  assert.match(JSON.stringify(told), /Nothing has changed\. It happens only if the person presses/);
  assert.equal(db.tables.form_templates[0].active, true, "nothing was archived by the assistant");
});

test("a long answer gives way to the Done note, and a pressed card under a failed answer still counts", () => {
  const card = (button: string, done: boolean) => ({
    draft: { title: "New promotion", button } as ActionDraft,
    result: done ? ({ done: true, text: '"Coke" is set up.', href: "/promotions" } as const) : undefined,
  });
  const long = "x".repeat(5000);
  const turns = history([
    { role: "user", text: "Set it up" },
    { role: "assistant", text: long, actions: [card("Create the promotion", true)] },
    { role: "user", text: "And the form?" },
    { role: "assistant", text: "", error: "Something went wrong while answering.", actions: [card("Create the form", true)] },
    { role: "user", text: "Something else" },
    { role: "assistant", text: "", error: "Stopped." },
  ]);
  // Within the length the route keeps, with the note at the end.
  const parsed = parseConversation({ messages: [...turns, { role: "user", text: "Did it work?" }] });
  assert.ok(parsed.ok);
  assert.match(parsed.turns[1].text, /Done: "Coke" is set up\.\)$/);
  // The failed answer's pressed card goes back; the failed answer with nothing pressed does not.
  assert.equal(turns.length, 4);
  assert.match(turns[3].text, /The answer stopped part-way[\s\S]*pressed "Create the form"\. Done/);
});

test("no new round starts once the question has taken too long", async () => {
  let clock = 0;
  let rounds = 0;
  const sent: AssistantEvent[] = [];
  const client = {
    responses: {
      create: async (params: { text?: { format?: { name?: string } } }) => {
        if (params.text?.format?.name === "topic_check") return { output_text: JSON.stringify({ on_topic: true }) };
        rounds++;
        clock += 25_000;
        return (async function* () {
          yield {
            type: "response.completed",
            response: { output: [{ type: "function_call", name: "forms", call_id: `c${rounds}`, arguments: '{"form_id":null}' }] },
          };
        })();
      },
    },
  };
  await answerQuestion({
    client: client as never,
    model: "m",
    guardModel: "m",
    ctx,
    tools: toolsFor(toPermissionSet(["admin"]), everything, true),
    turns: [{ role: "user", text: "Which forms do we have?" }],
    run: async () => ({ model: {} }),
    send: (e) => sent.push(e),
    abort: new AbortController(),
    left: null,
    now: () => clock,
  });
  assert.equal(rounds, 2);
  assert.ok(sent.some((e) => e.type === "text" && /taking longer than I can spend/.test(e.text)));
  assert.equal(sent.at(-1)?.type, "done");
});
