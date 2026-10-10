// One server process renders every company's pages. The company's
// configuration used to be seeded into module state during the render, so the
// first company seeded was rendered for everyone after it: its name in the
// next company's sidebar (found in the 10 Oct 2026 audit). Rendered here
// twice in one process, as the server does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { CompanyConfigProvider, useCompanyConfig } from "@/lib/use-company-config";

const config = (orgId: string, name: string) => ({
  org_id: orgId,
  modules: {},
  settings: {},
  terms: {},
  branding: { name },
});

function CompanyName() {
  const c = useCompanyConfig();
  return createElement("span", null, c?.branding.name ?? "none");
}

const page = (raw: unknown) =>
  renderToString(createElement(CompanyConfigProvider, { initialConfig: raw, children: createElement(CompanyName) }));

test("each request renders its own company, not the first one seen", () => {
  const first = page(config("00000000-0000-0000-0000-00000000000a", "Sparkle Cleaning"));
  const second = page(config("00000000-0000-0000-0000-00000000000b", "Guard Patrols"));
  assert.match(first, /Sparkle Cleaning/);
  assert.match(second, /Guard Patrols/);
  assert.doesNotMatch(second, /Sparkle Cleaning/);
});

test("a request with no configuration renders none, not someone else's", () => {
  page(config("00000000-0000-0000-0000-00000000000a", "Sparkle Cleaning"));
  assert.match(page(null), /none/);
});
