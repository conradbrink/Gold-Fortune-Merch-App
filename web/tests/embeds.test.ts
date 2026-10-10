import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// A visit and a store are joined directly (visits.store_id) and again through
// the job report, which holds both. The data API then cannot tell which one a
// bare `stores(...)` means and refuses the request (PGRST201, HTTP 300), which
// broke the dashboard's "today" card. These embeds must name the constraint.

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

test("a select on visits names the constraint when it embeds stores, and a select on stores when it embeds visits", () => {
  const bad: string[] = [];
  for (const dir of ["app", "lib", "components"]) {
    for (const file of sources(dir)) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/\.from\("(visits|stores)"\)\s*\.select\(\s*(["'`])([\s\S]*?)\2/g)) {
        const [, table, , select] = m;
        // An alias in front (`site:stores(name)`) is still a bare embed.
        const embedded = table === "visits" ? /(^|[\s,(:])stores\(/ : /(^|[\s,(:])visits\(/;
        if (embedded.test(select)) bad.push(`${file}: ${table} select embeds ${table === "visits" ? "stores" : "visits"} without a constraint name`);
      }
    }
  }
  assert.deepEqual(bad, []);
});
