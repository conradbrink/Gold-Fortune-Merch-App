// Lets `node --test` load the app's TypeScript the way Next does: `@/x`
// resolves to `<web>/x.ts` (or `.tsx`, or `x/index.ts`), as `tsconfig.json`'s
// `paths` says. Node 22 strips the types itself (`--experimental-strip-types`),
// so the tests need no compiler and no test framework dependency.
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(`
      import { existsSync } from "node:fs";
      import { pathToFileURL, fileURLToPath } from "node:url";
      const root = ${JSON.stringify(new URL("..", import.meta.url).href)};
      export async function resolve(specifier, context, next) {
        if (specifier.startsWith("@/")) {
          const base = fileURLToPath(new URL(specifier.slice(2), root));
          for (const candidate of [base + ".ts", base + ".tsx", base + "/index.ts", base]) {
            if (existsSync(candidate)) return next(pathToFileURL(candidate).href, context);
          }
        }
        return next(specifier, context);
      }
    `)
);
