import type { ToolSpec } from "@/lib/assistant-tools";
import { FIELD_TYPES } from "@/lib/forms";
import { DATE, nullableBoolean, nullableString, object, stringList, type JsonSchema } from "@/lib/assistant-schema";
import { lower, type Terms } from "@/lib/terms";

/**
 * What the AI Manager may do in the app for a person, and who may have it.
 *
 * An action never writes when the assistant calls it. It reads what it needs,
 * checks the change as if the person had typed it, and shows them a card of
 * exactly what will change. Only the card's button, pressed by the person,
 * makes the change (`/api/assistant/act`), and that route checks everything
 * again, because the card comes back from the browser.
 *
 * Access is the lookups' rule (`toolAllowed`): an action names the page it
 * does the work of, and is offered only to somebody who may open that page at
 * a company that has its module. `managerOnly` follows the tables' own write
 * rules, which still ask `current_role() = 'manager'` for forms and
 * promotions; offering it to anybody else would draft a change they could
 * never save. The database is still the boundary behind all of it.
 *
 * Plain data, like the lookups: the panel (browser) and the routes (server)
 * both read it. What each action does is in `lib/assistant-act.ts`.
 */

export type ActionName =
  | "change_dashboard"
  | "reset_dashboard"
  | "create_promotion"
  | "change_promotion"
  | "create_form"
  | "add_form_questions"
  | "move_form_question"
  | "change_form";

/** What each action did, in a sentence's words: for the record of changes. */
const ACTION_LABELS: Record<ActionName, string> = {
  change_dashboard: "Changed their dashboard",
  reset_dashboard: "Reset their dashboard",
  create_promotion: "Set up a promotion",
  change_promotion: "Changed a promotion",
  create_form: "Created a form",
  add_form_questions: "Added questions to a form",
  move_form_question: "Moved a question on a form",
  change_form: "Changed a form",
};

/**
 * A recorded action's words. Looked up as an own key only: a name that is not
 * an action (the record keeps whatever it was given) reads as itself, never
 * as something inherited like `constructor`.
 */
export function actionLabel(action: string): string {
  return Object.hasOwn(ACTION_LABELS, action) ? ACTION_LABELS[action as ActionName] : action;
}

/** How a recorded change ended, in the same words wherever it is shown. */
export function outcomeWords(ok: boolean | null): string {
  return ok === null ? "Did not finish" : ok ? "Done" : "Not done";
}

const CARD = "It is only shown to the person as a card: nothing changes until they press its button.";

const CHANGE = ["keep", "add", "remove", "replace"] as const;

function sitesChoice(t: Terms, what: string): JsonSchema {
  const sites = lower(t.site.many);
  return object({
    all: { type: "boolean", description: `Every active ${lower(t.site.one)}.` },
    groups: stringList(`${sites} in these groups (the group names find_sites shows). Empty for any group.`),
    towns: stringList(`${sites} in these towns. Empty for any town. With groups, only that group's ${sites} in those towns.`),
    site_ids: stringList(`Single ${sites} ${what}, ids from find_sites. Empty for none.`),
  });
}

function productsChoice(): JsonSchema {
  return object({
    product_ids: stringList("Products, ids from find_products. Empty for none."),
    brands: stringList("Every active product of these brands, as find_products names them. Empty for none."),
  });
}

function questions(t: Terms): JsonSchema {
  return {
    type: "array",
    description: `The questions, in the order the ${lower(t.staff.one)} answers them.`,
    items: object({
      label: { type: "string", description: "The question as the phone shows it." },
      type: {
        type: "string",
        enum: [...FIELD_TYPES],
        description: '"boolean" is a Yes / No answer, "multiple_choice" picks one of the choices.',
      },
      required: { type: "boolean", description: "Must be answered before the form can be sent." },
      choices: stringList('For "multiple_choice" only: the choices, 2 to 20. Empty otherwise.'),
    }),
  };
}

export const ACTIONS: readonly ToolSpec[] = [
  {
    name: "change_dashboard",
    page: "/",
    action: true,
    description: () =>
      `Adds cards to this person's own dashboard, takes cards off, or moves cards to the top. Ids come from ` +
      `dashboard_cards. Only their own dashboard changes. ${CARD}`,
    parameters: () =>
      object({
        add: stringList("Card ids to add, at the end unless also in first. Empty for none."),
        remove: stringList("Card ids to take off. Empty for none."),
        first: stringList("Card ids to put at the top, in this order. Empty to leave the order."),
      }),
    working: () => "Getting your dashboard ready",
  },
  {
    name: "reset_dashboard",
    page: "/",
    action: true,
    description: () =>
      `Puts this person's dashboard back to the company's standard cards, as the Customise panel's reset does. ${CARD}`,
    parameters: () => object({}),
    working: () => "Getting your dashboard ready",
  },
  {
    name: "create_promotion",
    page: "/promotions",
    action: true,
    managerOnly: true,
    description: (t) =>
      `Sets up a new promotion: a deal on some products at some ${lower(t.site.many)} between two dates, which ` +
      `${lower(t.staff.many)} are asked to check at each ${lower(t.job.one)}. Find the products with find_products and the ` +
      `${lower(t.site.many)} with find_sites first. ${CARD}`,
    parameters: (t) =>
      object({
        name: { type: "string", description: 'A short name, like "Coke 2L 2-for-1 November".' },
        brief: nullableString(
          `What the ${lower(t.staff.one)} should look for at the ${lower(t.site.one)}: the deal, the display, the price. Or null.`
        ),
        starts_on: { type: "string", description: `First day. ${DATE}` },
        ends_on: { type: "string", description: `Last day. ${DATE}` },
        products: productsChoice(),
        sites: sitesChoice(t, "to add"),
      }),
    working: () => "Getting the promotion ready",
  },
  {
    name: "change_promotion",
    page: "/promotions",
    action: true,
    managerOnly: true,
    description: (t) =>
      `Changes a promotion (id from promotions): its name, what to look for, its dates, which products or ` +
      `${lower(t.site.many)} it covers, or switches it off or on. Null or "keep" leaves that part as it is. ${CARD}`,
    parameters: (t) =>
      object({
        promotion_id: { type: "string", description: "The promotion's id, from promotions." },
        name: nullableString("A new name, or null to keep it."),
        brief: nullableString("New words for what to look for, or null to keep them."),
        starts_on: nullableString(`A new first day, or null to keep it. ${DATE}`),
        ends_on: nullableString(`A new last day, or null to keep it. ${DATE}`),
        active: nullableBoolean("false switches it off (it leaves every phone), true switches it on, null leaves it."),
        products: object({
          change: { type: "string", enum: [...CHANGE], description: '"keep" leaves the products as they are.' },
          ...(productsChoice() as { properties: Record<string, JsonSchema> }).properties,
        }),
        sites: object({
          change: { type: "string", enum: [...CHANGE], description: `"keep" leaves the ${lower(t.site.many)} as they are.` },
          ...(sitesChoice(t, "to add or take off") as { properties: Record<string, JsonSchema> }).properties,
        }),
      }),
    working: () => "Getting the change ready",
  },
  {
    name: "create_form",
    page: "/forms",
    action: true,
    managerOnly: true,
    description: (t) =>
      `Creates a new form with its questions, which ${lower(t.staff.many)} fill in on their phones at a ` +
      `${lower(t.site.one)}. Suggest sensible questions when the person only says what the form is for. ${CARD}`,
    parameters: (t) =>
      object({
        name: { type: "string", description: "The form's name." },
        description: nullableString("One line on what the form is for, or null."),
        compulsory: {
          type: "boolean",
          description: `true means ${lower(t.staff.many)} can't check out of a ${lower(t.site.one)} until it is sent. Usually false.`,
        },
        questions: questions(t),
      }),
    working: () => "Getting the form ready",
  },
  {
    name: "add_form_questions",
    page: "/forms",
    action: true,
    managerOnly: true,
    description: () => `Adds questions at the end of a form (id from forms). ${CARD}`,
    parameters: (t) =>
      object({
        form_id: { type: "string", description: "The form's id, from forms." },
        questions: questions(t),
      }),
    working: () => "Getting the questions ready",
  },
  {
    name: "move_form_question",
    page: "/forms",
    action: true,
    managerOnly: true,
    description: () => `Moves one question on a form to another place (ids from forms with its form_id). ${CARD}`,
    parameters: () =>
      object({
        form_id: { type: "string", description: "The form's id, from forms." },
        question_id: { type: "string", description: "The question's id, from forms with this form_id." },
        position: { type: "integer", description: "Its new place, 1 for first." },
      }),
    working: () => "Getting the change ready",
  },
  {
    name: "change_form",
    page: "/forms",
    action: true,
    managerOnly: true,
    description: (t) =>
      `Makes a form compulsory or optional, or archives it (it leaves the ${lower(t.staff.many)}' phones, ` +
      `answers are kept) or brings it back. ${CARD}`,
    parameters: (t) =>
      object({
        form_id: { type: "string", description: "The form's id, from forms." },
        compulsory: nullableBoolean(
          `true: ${lower(t.staff.many)} can't check out until it is sent. false: optional. null: leave it.`
        ),
        active: nullableBoolean("false archives it, true brings it back, null leaves it."),
      }),
    working: () => "Getting the change ready",
  },
];
