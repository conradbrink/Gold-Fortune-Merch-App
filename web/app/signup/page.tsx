import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listTemplates, trialDays } from "@/lib/platform";
import { industryFromQuery } from "@/lib/signup";
import { SignupForm } from "@/components/signup/signup-form";
import { ProductBrand } from "@/components/product-brand";

/**
 * The public free-trial sign-up. Reached from the sales site's "Start free
 * trial" (optionally `?industry=<template code>`, which pre-picks that trade).
 *
 * Public in `proxy.ts`; someone already signed in is sent to their dashboard.
 * The industries and the trial length come from the database.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Start your free trial" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/");

  const [templates, days] = await Promise.all([listTemplates(), trialDays()]);
  const industry = industryFromQuery((await searchParams).industry, templates.map((t) => t.code));

  return (
    <div className="flex min-h-screen justify-center bg-secondary/40 px-4 py-10">
      <div className="w-full max-w-2xl space-y-6">
        <ProductBrand />
        <SignupForm templates={templates} trialDays={days} initialIndustry={industry} />
      </div>
    </div>
  );
}
