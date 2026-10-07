/**
 * What an exported file is called: `gold-fortune-visits-2026-08-27.xlsx`.
 *
 * The company's name goes first so a manager's Downloads folder says whose
 * file it is, and a manager who works for two companies on the platform can
 * tell their exports apart. It used to be a fixed `gf-` prefix, which is one
 * customer's initials on every other customer's files.
 *
 * Pure, so the naming rule can be checked without a browser.
 */

/** Longest a single slug may run, so a long company name cannot swallow the file name. */
const MAX_SLUG = 40;

/**
 * Text as a file-name fragment: lower case, ASCII letters and digits, single
 * hyphens. Accents are folded ("Café Royal" → "cafe-royal") rather than
 * dropped, and anything else — slashes, quotes, emoji — becomes a separator,
 * so no company name can put a path or a shell character into a file name.
 */
export function fileSlug(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, "");
}

/**
 * `<company>-<report>-<date>.<extension>`. A company whose name leaves nothing
 * after slugging (no name yet, or only symbols) is called "export" rather than
 * producing a file that starts with a hyphen.
 */
export function exportFileName(
  companyName: string,
  base: string,
  extension: string,
  today: Date = new Date()
): string {
  const company = fileSlug(companyName) || "export";
  const report = fileSlug(base);
  const date = today.toISOString().slice(0, 10);
  return `${[company, report, date].filter((part) => part !== "").join("-")}.${extension}`;
}
