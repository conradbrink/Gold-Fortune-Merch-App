import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  listTemplates,
  moduleCatalogue,
  moduleDependencies,
  settingDefinitions,
  termDefinitions,
} from "@/lib/platform";
import { AddCompanyWizard } from "@/components/platform/add-company-wizard";
import { createCompanyAction, previewTemplates } from "@/app/platform/actions";

/**
 * Platform operator: add a company from industry templates.
 *
 * Gated like `/platform`: the proxy insists on a session, and
 * `is_platform_admin()` is asked here before the catalogue is read; everyone
 * else gets a 404. The form's two server actions (`previewTemplates`,
 * `createCompanyAction`) check again — this page is not what protects them.
 *
 * Everything the form offers comes from the catalogue tables — the templates,
 * modules, settings and terms — so a template or setting added by a migration
 * appears here without a code change.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Platform · Add company" };

export default async function AddCompanyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: isOperator, error } = await supabase.rpc("is_platform_admin");
  if (error) throw error;
  if (!isOperator) notFound();

  const [templates, modules, dependencies, settings, terms] = await Promise.all([
    listTemplates(),
    moduleCatalogue(),
    moduleDependencies(),
    settingDefinitions(),
    termDefinitions(),
  ]);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-8">
      <header className="space-y-1">
        <Link href="/platform" className="text-sm text-muted-foreground hover:underline">
          ← Companies
        </Link>
        <h1 className="text-2xl font-bold text-foreground">Add company</h1>
        <p className="text-sm text-muted-foreground">
          Start from one or more industry templates, review what the company gets, and
          create it with its owner&apos;s login. Nothing is created until the last step,
          and if anything is refused, nothing is left behind.
        </p>
      </header>
      <AddCompanyWizard
        templates={templates}
        modules={modules}
        dependencies={dependencies}
        settings={settings}
        terms={terms}
        preview={previewTemplates}
        create={createCompanyAction}
      />
    </main>
  );
}
