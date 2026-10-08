import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { pricing, rand, site } from "@/lib/site";

// DRAFT for the owner's lawyer to check before launch (owner, 8 Oct 2026). It
// describes how the product actually works; change the product, change this.

export const metadata: Metadata = { title: `Terms | ${site.name}` };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use">
      <p>
        These terms are the agreement between you (the business that signs up) and {site.legalName} (&ldquo;we&rdquo;),
        the business behind {site.name}. By signing up or using {site.name}, you agree to them.
      </p>

      <h2>What {site.name} is</h2>
      <p>
        {site.name} is an app for teams that work on site: a phone app for your team and a web dashboard for you. Your
        team checks in at jobs, takes photos and fills in forms. You see where they worked, for how long and what was
        done.
      </p>

      <h2>Your free trial</h2>
      <ul>
        <li>The trial is free for {site.trialDays} days from the day you sign up. We don&apos;t ask for a card.</li>
        <li>During the trial you can have up to 10 users.</li>
        <li>
          If you don&apos;t choose a plan by the end of the trial, your account becomes read-only: you can still sign in and
          see everything, but you can&apos;t add or change anything until you choose a plan.
        </li>
      </ul>

      <h2>Plans and prices</h2>
      <ul>
        <li>
          You pay monthly or yearly, in rand, at the prices on our website on the day you pay. Today that is from{" "}
          {rand(pricing.monthly.base)} a month or {rand(pricing.yearly.base)} a year for {pricing.includedUsers} users.
        </li>
        <li>We are not registered for VAT, so no VAT is added.</li>
        <li>A once-off setup fee of {rand(pricing.setupValue)} is added to your first monthly payment. It is free on yearly plans.</li>
        <li>You pay for a number of users. Adding users costs a share of the price for the rest of your current period, charged straight away. Fewer users take effect from your next renewal.</li>
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
          and for having a lawful reason to do so under the Protection of Personal Information Act (POPIA).
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
        <li>Nothing in these terms takes away rights you have under the Consumer Protection Act or the Electronic Communications and Transactions Act, where they apply to you.</li>
      </ul>

      <h2>Changes and the law</h2>
      <ul>
        <li>We may update these terms. If a change matters, we will tell you at least 30 days before it applies.</li>
        <li>These terms are governed by the law of South Africa.</li>
        <li>Questions: <a href={`mailto:${site.email}`}>{site.email}</a>.</li>
      </ul>
    </LegalPage>
  );
}
