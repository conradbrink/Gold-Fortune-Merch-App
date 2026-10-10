import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// A visit and a store are joined directly (visits.store_id) and again through
// the job report, which holds both. The data API then cannot tell which one a
// bare `stores(...)` means and refuses the request (PGRST201, HTTP 300), which
// broke the dashboard's "today" card. These embeds must name the constraint.

/** The selects on visits or stores that embed the other without naming the constraint. */
export function bareEmbeds(text: string): string[] {
  const bad: string[] = [];
  // Any quote style for the table name and for the select string.
  for (const m of text.matchAll(/\.from\(\s*(["'`])(visits|stores)\1\s*\)\s*\.select\(\s*(["'`])([\s\S]*?)\3/g)) {
    const [, , table, , select] = m;
    // An alias in front (`site:stores(name)`) is still a bare embed.
    const other = table === "visits" ? "stores" : "visits";
    if (new RegExp(`(^|[\\s,(:])${other}\\(`).test(select)) bad.push(`${table} select embeds ${other}`);
  }
  return bad;
}

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.(ts|tsx)$/.test(name) && !path.endsWith("supabase/types.ts")) out.push(path);
  }
  return out;
}

test("the guard sees a bare embed in every quote style, an alias, and a stores select embedding visits", () => {
  assert.equal(bareEmbeds(`supabase.from("visits").select("id, stores(name)")`).length, 1);
  assert.equal(bareEmbeds(`supabase.from('visits').select('id, stores(name)')`).length, 1);
  assert.equal(bareEmbeds("supabase.from(`visits`).select(`id, stores(name)`)").length, 1);
  assert.equal(bareEmbeds(`supabase.from("visits").select("id, site:stores(name)")`).length, 1);
  assert.equal(bareEmbeds(`supabase.from("stores").select("id, visits(id)")`).length, 1);
  assert.deepEqual(bareEmbeds(`supabase.from("visits").select("id, stores!visits_store_id_fkey(name)")`), []);
  assert.deepEqual(bareEmbeds(`supabase.from("routes").select("id, stores(name), visits(id)")`), []);
});

test("no select on visits embeds stores, and none on stores embeds visits, without a constraint name", () => {
  const bad: string[] = [];
  for (const dir of ["app", "lib", "components"]) {
    for (const file of sources(dir)) for (const b of bareEmbeds(readFileSync(file, "utf8"))) bad.push(`${file}: ${b} without a constraint name`);
  }
  assert.deepEqual(bad, []);
});
