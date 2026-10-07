// No business word is written into a screen. The requirement ("No hard-coded
// business words in UI, app, reports or PDFs. Use the terminology system") is
// only true for as long as nobody adds one back, so this test reads the source
// and fails on any user-visible text that names a store, visit, rep and so on
// instead of asking `useTerms()` for the company's own word.
//
// What counts as user-visible: JSX text; the placeholder/title/label/alt/
// aria-label attributes; and any string or template literal that reads as
// prose (it has a space in it). What does not: import paths, route paths,
// object keys, type positions, and the arguments of database calls
// (`.select("id, stores(name)")` is a query, not a sentence).
//
// A genuine plain-English use ("Play Store", "management chain") goes in
// tests/terms-allowlist.json with a reason.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCAN = ["app", "components", "lib"];
const SKIP_FILES = new Set([
  "lib/terms.ts", // the defaults themselves
  "lib/supabase/types.ts", // generated from the schema
]);

/** The words a company names for itself (lib/terms.ts), plus the old brand. */
export const BUSINESS_WORDS =
  /\b(stores?|visits?|reps?|representatives?|chains?|territor(?:y|ies)|customers?|outlets?|shops?|merchandis\w*|call cycles?|gold fortune)\b/i;

const VISIBLE_ATTRIBUTES = new Set(["placeholder", "title", "label", "alt", "aria-label", "description"]);

/** Query builders and other calls whose string arguments are code, not prose. */
const CODE_CALLS = new Set([
  "select", "from", "rpc", "eq", "neq", "in", "is", "order", "like", "ilike", "match",
  "filter", "or", "not", "contains", "overlaps", "channel", "on", "upload", "remove",
  "createSignedUrl", "getPublicUrl", "storage", "get", "set", "has", "startsWith", "endsWith",
  "includes", "replace", "split", "test", "querySelector", "getElementById",
  "error", "warn", "log", "info", "debug", // console.*: logs, not screens
]);

type Finding = { file: string; line: number; text: string };
type Allow = { file: string; text: string; reason: string };

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

function isCodeArgument(node: ts.Node): boolean {
  const parent = node.parent;
  if (!parent || !ts.isCallExpression(parent) || !parent.arguments.includes(node as ts.Expression)) {
    return false;
  }
  const callee = parent.expression;
  const name = ts.isPropertyAccessExpression(callee)
    ? callee.name.text
    : ts.isIdentifier(callee)
      ? callee.text
      : "";
  return CODE_CALLS.has(name);
}

/** Anywhere inside a console.* call: a log line for operators, not a screen. */
function inConsoleCall(node: ts.Node): boolean {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === "console"
    ) {
      return true;
    }
    if (ts.isFunctionDeclaration(n) || ts.isSourceFile(n)) return false;
  }
  return false;
}

function inTypeOrImport(node: ts.Node): boolean {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isTypeNode(n)) return true;
    if (ts.isStatement(n) || ts.isBlock(n)) return false;
  }
  return false;
}

export function findHardcodedWords(file: string, source: string): Finding[] {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const found: Finding[] = [];
  const report = (node: ts.Node, text: string) => {
    if (!BUSINESS_WORDS.test(text)) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    found.push({ file, line: line + 1, text: text.trim().replace(/\s+/g, " ").slice(0, 120) });
  };
  const prose = (text: string) => /\s/.test(text.trim()) || /^[A-Z][a-z]+s?$/.test(text.trim());

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      if (node.text.trim()) report(node, node.text);
    } else if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sf);
      const init = node.initializer;
      if (VISIBLE_ATTRIBUTES.has(name) && init && ts.isStringLiteral(init)) report(init, init.text);
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const p = node.parent;
      const isKey = p && (ts.isPropertyAssignment(p) || ts.isPropertySignature(p)) && p.name === node;
      const isJsxAttr = p && ts.isJsxAttribute(p);
      if (!isKey && !isJsxAttr && !inTypeOrImport(node) && !isCodeArgument(node) && !inConsoleCall(node) &&
          !node.text.startsWith("/") && prose(node.text)) {
        report(node, node.text);
      }
    } else if (ts.isTemplateExpression(node)) {
      if (!isCodeArgument(node) && !inConsoleCall(node)) {
        const parts = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)];
        const whole = parts.join(" ");
        if (!whole.trimStart().startsWith("/") && /\s/.test(whole)) report(node, whole);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

test("no screen hard-codes a business word", () => {
  const allow: Allow[] = JSON.parse(readFileSync(join(ROOT, "tests/terms-allowlist.json"), "utf8"));
  for (const a of allow) assert.ok(a.reason?.trim(), `allowlist entry without a reason: ${a.file} "${a.text}"`);

  const findings: Finding[] = [];
  for (const dir of SCAN) {
    for (const path of sourceFiles(join(ROOT, dir))) {
      const file = relative(ROOT, path);
      if (SKIP_FILES.has(file)) continue;
      findings.push(...findHardcodedWords(file, readFileSync(path, "utf8")));
    }
  }
  const left = findings.filter(
    (f) => !allow.some((a) => a.file === f.file && f.text.includes(a.text))
  );
  assert.equal(
    left.length,
    0,
    `${left.length} hard-coded business word(s). Use useTerms() / lib/terms.ts, ` +
      `or add a plain-English use to tests/terms-allowlist.json with a reason:\n` +
      left.map((f) => `  ${f.file}:${f.line}  "${f.text}"`).join("\n")
  );
});

test("the guard sees what a person would read, and nothing else", () => {
  const src = `
    import { x } from "@/lib/stores";
    const q = supabase.from("stores").select("id, name, stores(name)");
    const label = "Search stores…";
    const route = "/stores/review";
    const code = "rep";
    type K = "store visit";
    const o = { "Store name": 1 };
    function A() { return <p title="Rep on site">Every visit logged</p>; }
    const t = \`\${n} reps worked\`;
  `;
  const hits = findHardcodedWords("x.tsx", src).map((f) => f.text);
  assert.deepEqual(hits.sort(), ["Every visit logged", "Rep on site", "Search stores…", "reps worked"].sort());
});
