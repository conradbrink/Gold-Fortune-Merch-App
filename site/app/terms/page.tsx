import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { biggestPlan, founding, foundingPrice, legal, pricing, rand, site } from "@/lib/site";

// DRAFT for the owner's lawyer to check before launch (owner, 8 Oct 2026). It
// describes how the product actually works; change the product, change this.

export const metadata: Metadata = { title: `Terms | ${site.name}` };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use">
      <p>
        These terms are the agreement between you (the business that signs up) and {site.legalName}, a company
        registered in {legal.registeredIn} (registration number {legal.registrationNumber}) (&ldquo;we&rdquo;), the business behind{" "}
        {site.name}. By signing up or using {site.name}, you agree to them.
      </p>

      <h2>What {site.name} is</h2>
      <p>
        {site.name} is an app for distributors and their reps: a phone app for your reps and a web dashboard for you.
        Your reps check in at stores, take photos, fill in forms and take orders. You see where they went, for how long,
        what was done and what was ordered.
      </p>

      <h2 id="founding">The Founding {founding.spots} pilot and founding price</h2>
      <ul>
        <li>
          A Founding distributor runs {site.name} free for {founding.pilotDays} days (the pilot) from the day we set up
          their account. We don&apos;t ask for a card for the pilot.
        </li>
        <li>
          During the pilot you can have up to {founding.pilotReps} reps and drivers. Office and warehouse logins don&apos;t count.
        </li>
        <li>
          After the pilot, a Founding distributor pays {founding.percentOff}% less than the normal price of the plan that
          fits their team, for their first {founding.priceMonths} months (the founding price):{" "}
          {pricing.plans.map((p) => `${rand(foundingPrice(p))} a month for up to ${p.reps} reps and drivers`).join(", ")}. A team of
          more than {biggestPlan.reps} reps and drivers is priced with us. The setup, the training day by video call and the bonuses we
          list on our website are included. After the {founding.priceMonths} months, the normal price of your plan
          applies.
        </li>
        <li>There is no contract. You can stop at the end of any month. The founding price is once per business.</li>
        <li>
          If you don&apos;t carry on after the pilot, your account becomes read-only: you can still sign in and see
          everything, but you can&apos;t add or change anything until you choose a plan.
        </li>
      </ul>

      <h2 id="guarantee">Our {founding.guaranteeDays}-day promise to Founding distributors</h2>
      <p>
        Run {site.name} for {founding.guaranteeDays} days. If your reps aren&apos;t visiting more stores, we refund your
        month, and you keep the Rep Leak Audit. Our app records (clock-ins and store check-ins) show whether they are.
        The promise holds when you meet every one of these conditions.
      </p>
      <ol>
        <li>
          <strong>You are a Founding distributor.</strong> We set up your account as one of the Founding {founding.spots}, and
          you paid the founding price for your first month. The promise is once per business.
        </li>
        <li>
          <strong>How we measure it.</strong> The {founding.guaranteeDays} days start on the day we set up your account. We
          compare the store visits per rep per workday in your first 5 workdays with your last 5 workdays of the{" "}
          {founding.guaranteeDays} days. If the number didn&apos;t go up, your reps aren&apos;t visiting more stores.
        </li>
        <li>
          <strong>Your reps use it every workday.</strong> Every rep clocks in on {site.name} on every day they work, and
          checks in at every store they visit. Missing a few days is fine. But if your reps clocked in on fewer than 90
          out of every 100 days that they worked, this condition isn&apos;t met.
        </li>
        <li>
          <strong>You claim in time.</strong> You email <a href={`mailto:${site.email}`}>{site.email}</a> within 7 days
          after the {founding.guaranteeDays} days end.
        </li>
      </ol>
      <ul>
        <li>
          If you meet every condition and the visits didn&apos;t go up, we refund what you paid for your first month at
          the founding price, within 14 days of your claim. You keep the Rep Leak Audit. If you don&apos;t meet them, we
          tell you which ones and show you the records.
        </li>
        <li>
          The promise doesn&apos;t apply if we suspended your account for misusing {site.name}, or if you deleted your
          records before claiming.
        </li>
      </ul>

      <h2>Plans and prices</h2>
      <ul>
        <li>
          Apart from the founding price above, you pay monthly or yearly, in rand, at the prices on our website on the
          day you pay. Today that is{" "}
          {pricing.plans.map((p) => `${rand(p.monthly)} a month for up to ${p.reps} reps and drivers`).join("; ")}. A year costs{" "}
          {pricing.yearlyMonths} months.
        </li>
        <li>We are not registered for VAT, so no VAT is added.</li>
        <li>A once-off setup fee of {rand(pricing.setupValue)} is added to your first monthly payment. It is free on yearly plans.</li>
        <li>You choose a plan by the number of reps. Moving to a bigger plan costs a share of the difference for the rest of your current period, charged straight away. A smaller plan takes effect from your next renewal.</li>
        <li>We may raise prices once a year, by no more than inflation. We will tell you at least 30 days before.</li>
      </ul>

      <h2>Paying</h2>
      <ul>
        <li>
          You pay by card on the secure page of our payment provider, Payfast. Payfast keeps your card so that later
          payments happen by themselves; we never see or store your card number.
        </li>
        <li>Each renewal is charged to your card on the day your paid period ends. You get an invoice in the app.</li>
        <li>
          If a payment fails, we try again over the next week. If it is still not paid after 7 days, your account
          becomes read-only until it is paid. Paying puts everything back straight away.
        </li>
      </ul>

      <h2>Cancelling</h2>
      <p>
        You can cancel at any time in the app. Your plan then stops at the end of the period you have paid for, and
        nothing more is charged. See <a href="/refunds">Cancellations and refunds</a>.
      </p>

      <h2>Your data</h2>
      <ul>
        <li>The information you and your team put into {site.name} is yours. We use it only to run {site.name} for you.</li>
        <li>
          You are responsible for telling your team that {site.name} records their location while a workday is open,
          and for having a lawful reason to do so under the data protection law that applies to you (Botswana&apos;s Data
          Protection Act, or South Africa&apos;s Protection of Personal Information Act).
        </li>
        <li>
          If your account stays read-only for 30 days, we may delete your company&apos;s data. We will let you know before
          we do. Invoices are kept for as long as the law requires.
        </li>
        <li>How we handle personal information is set out in our <a href="/privacy">Privacy policy</a>.</li>
      </ul>

      <h2>Using {site.name} fairly</h2>
      <ul>
        <li>Keep your passwords safe. You are responsible for what happens under your users&apos; logins.</li>
        <li>Don&apos;t use {site.name} to break the law, to track people outside their work, or to try to get at other businesses&apos; data.</li>
        <li>We may suspend an account that does, after telling you why.</li>
      </ul>

      <h2>Our responsibility</h2>
      <ul>
        <li>We work to keep {site.name} running and your data safe, but we can&apos;t promise it will never be unavailable or never have a fault.</li>
        <li>
          As far as the law allows, we are not liable for indirect losses (such as lost profit), and our total liability
          to you is limited to what you paid us in the 12 months before the claim.
        </li>
        <li>Nothing in these terms takes away rights the law of your country gives you that can&apos;t be excluded, such as South Africa&apos;s Consumer Protection Act or Electronic Communications and Transactions Act, where they apply to you.</li>
      </ul>

      <h2>Changes and the law</h2>
      <ul>
        <li>We may update these terms. If a change matters, we will tell you at least 30 days before it applies.</li>
        <li>These terms are governed by the law of {legal.registeredIn}.</li>
        <li>Questions: <a href={`mailto:${site.email}`}>{site.email}</a>.</li>
      </ul>
    </LegalPage>
  );
}
