/**
 * The shapes the assistant's tools describe their arguments in.
 *
 * Strict structured tools need every key listed as required, nullable instead
 * of optional; these keep the lookups and the actions written the same way.
 */

export type JsonSchema = Record<string, unknown>;

export const DATE = "A date as YYYY-MM-DD, in the company's time zone.";

export function object(properties: Record<string, JsonSchema>): JsonSchema {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

export const nullableString = (description: string): JsonSchema => ({
  type: ["string", "null"],
  description,
});

export const nullableBoolean = (description: string): JsonSchema => ({
  type: ["boolean", "null"],
  description,
});

export const stringList = (description: string): JsonSchema => ({
  type: "array",
  description,
  items: { type: "string" },
});
