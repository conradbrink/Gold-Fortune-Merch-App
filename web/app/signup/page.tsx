import Image from "next/image";
import { redirect } from "next/navigation";
import { Check } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { listTemplates, trialDays } from "@/lib/platform";
import { industryFromQuery } from "@/lib/signup";
import { SignupForm } from "@/components/signup/signup-form";
import { PRODUCT_MARK, PRODUCT_NAME, PRODUCT_TAGLINE } from "@/lib/product";

/**
 * The public free-trial sign-up. Reached from the sales site's "Start free
 * trial" (optionally `?industry=<template code>`, which pre-picks that trade).
 *
 * Public in `proxy.ts`; someone already signed in is sent to their dashboard.
 * The industries and the trial length come from the database.
 *
 * Laid out like the sales site the person just left: on a wide screen the
 * Tickd panel (teal, the tagline, three reasons) sits beside the form; on a
 * phone the mark and name sit on top. The panel's colours are the product's
 * own, in both themes, because nobody is signed in and there is no company.
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

  const reasons = [
    `Free for ${days} days. No card needed.`,
    "Your trade's words, checklists and forms, ready when you finish.",
    "Your team works on the Android phones they already have.",
  ];

  return (
    <div className="min-h-dvh bg-background lg:grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <aside className="hidden flex-col justify-between gap-12 bg-[#0f3d3e] p-12 text-[#f7f7f2] lg:flex xl:p-16">
        <div className="flex items-center gap-3">
          <Image src={PRODUCT_MARK} alt="" width={44} height={44} className="rounded-lg" loading="eager" />
          <span className="text-2xl font-extrabold tracking-tight">{PRODUCT_NAME}</span>
        </div>
        <div className="grid max-w-md gap-8">
          <p className="text-4xl font-bold leading-[1.1] tracking-tight text-balance">{PRODUCT_TAGLINE}</p>
          <ul className="grid gap-4">
            {reasons.map((r) => (
              <li key={r} className="flex gap-3 leading-relaxed text-[#dcebea]">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[#f5a524] text-[#0f3d3e]">
                  <Check className="size-3" strokeWidth={3.5} aria-hidden="true" />
                </span>
                {r}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-[#dcebea]/80">Made for teams that work on site, across Southern Africa.</p>
      </aside>

      <main className="flex justify-center px-4 py-8 sm:px-6 sm:py-12 lg:items-center lg:py-16">
        <div className="w-full max-w-lg space-y-8">
          <div className="flex items-center gap-3 lg:hidden">
            <Image src={PRODUCT_MARK} alt="" width={40} height={40} className="rounded-lg" loading="eager" />
            <div className="leading-tight">
              <p className="text-lg font-extrabold tracking-tight text-foreground">{PRODUCT_NAME}</p>
              <p className="text-sm text-muted-foreground">{PRODUCT_TAGLINE}</p>
            </div>
          </div>
          <SignupForm templates={templates} trialDays={days} initialIndustry={industry} />
        </div>
      </main>
    </div>
  );
}
