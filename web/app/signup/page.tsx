import Image from "next/image";
import { redirect } from "next/navigation";
import { Check } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { listTemplates, platformAdminClient, trialDays } from "@/lib/platform";
import { SELF_SERVE_SIGNUP_OPEN, industryFromQuery } from "@/lib/signup";
import { FOUNDING_OFFER } from "@/lib/founding-offer";
import { SignupForm } from "@/components/signup/signup-form";
import { PRODUCT_MARK, PRODUCT_NAME, PRODUCT_TAGLINE } from "@/lib/product";

/**
 * Where "Start free trial" lands. Public in `proxy.ts`; someone already signed
 * in is sent to their dashboard.
 *
 * While self-serve sign-up is closed (`SELF_SERVE_SIGNUP_OPEN`), this is the
 * Founding offer: 60 days free, set up for you, and a button to the
 * application on the sales site. Open, it is the three-step trial form.
 *
 * Laid out like the sales site the person just left: on a wide screen the
 * Tickd panel (teal, the tagline, three reasons) sits beside the page; on a
 * phone the mark and name sit on top. The colours are the product's own, in
 * both themes (teal #0f3d3e, amber #f5a524, sand #f7f7f2), because nobody is
 * signed in and there is no company.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Become a founding member" };

/** The spots left, one setting only the owner changes; null when it cannot be read. */
async function spotsLeft(): Promise<number | null> {
  try {
    const { data, error } = await platformAdminClient().rpc("founding_spots_left");
    return error || typeof data !== "number" ? null : data;
  } catch {
    return null;
  }
}

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

  const open = SELF_SERVE_SIGNUP_OPEN;
  const [templates, days, left] = open
    ? await Promise.all([listTemplates(), trialDays(), Promise.resolve(null)])
    : [[], 0, await spotsLeft()];
  const industry = industryFromQuery((await searchParams).industry, templates.map((t) => t.code));

  const reasons = open
    ? [
        `Free for ${days} days. No card needed.`,
        "Your trade's words, checklists and forms, ready when you finish.",
        "Your team works on the Android phones they already have.",
      ]
    : [
        `Free for ${FOUNDING_OFFER.days} days. No card needed.`,
        "We set it all up for you: your team, your places and your checklists.",
        "Your team works on the Android phones they already have.",
      ];

  return (
    <div className="min-h-dvh bg-[#f7f7f2] lg:grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
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
              <p className="text-lg font-extrabold tracking-tight text-[#0f3d3e]">{PRODUCT_NAME}</p>
              <p className="text-sm text-[#44625f]">{PRODUCT_TAGLINE}</p>
            </div>
          </div>

          {open ? (
            <SignupForm templates={templates} trialDays={days} initialIndustry={industry} />
          ) : (
            <section className="space-y-6">
              <div className="space-y-3">
                <p className="inline-block rounded-full bg-[#f5a524]/20 px-3 py-1 text-sm font-semibold text-[#7a4b00]">
                  {left !== null && left > 0
                    ? `${left} of ${FOUNDING_OFFER.spots} spots left`
                    : `The Founding ${FOUNDING_OFFER.spots}`}
                </p>
                <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-[#0f3d3e] text-balance sm:text-4xl">
                  Become a founding member
                </h1>
                <p className="text-lg leading-relaxed text-[#2f4a47] text-pretty">
                  We are taking on our first founding businesses to run {PRODUCT_NAME} free for {FOUNDING_OFFER.days} days. We set it
                  all up for you, and you see your team&apos;s whole day with proof of every task.
                </p>
              </div>

              <ul className="grid gap-3 lg:hidden">
                {reasons.map((r) => (
                  <li key={r} className="flex gap-3 leading-relaxed text-[#2f4a47]">
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[#f5a524] text-[#0f3d3e]">
                      <Check className="size-3" strokeWidth={3.5} aria-hidden="true" />
                    </span>
                    {r}
                  </li>
                ))}
              </ul>

              <div className="grid gap-3">
                <a
                  href={FOUNDING_OFFER.applyUrl}
                  className="flex min-h-12 items-center justify-center rounded-full bg-[#f5a524] px-7 py-3 text-lg font-bold text-[#0f3d3e] transition-[background-color,transform] duration-150 ease-out hover:bg-[#ffb73a] active:scale-[0.97]"
                >
                  Apply to be a founding member
                </a>
                <p className="text-center text-sm font-semibold text-[#0f3d3e]">
                  Applications close {FOUNDING_OFFER.closes}. After the free days it is R{FOUNDING_OFFER.price} a month for{" "}
                  {FOUNDING_OFFER.priceMonths} months.
                </p>
              </div>

              <p className="text-center text-sm text-[#44625f]">
                Already have an account?{" "}
                <a href="/login" className="font-semibold text-[#0f3d3e] underline underline-offset-4">
                  Sign in
                </a>
              </p>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
