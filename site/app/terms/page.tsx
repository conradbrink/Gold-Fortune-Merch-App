import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { founding, legal, pricing, rand, site } from "@/lib/site";

// DRAFT for the owner's lawyer to check before launch (owner, 8 Oct 2026). It
// describes how the product actually works; change the product, change this.

export const metadata: Metadata = { title: `Terms | ${site.name}` };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use">
      <p>
        These terms are the agreement between you (the business that signs up) and {site.legalName}, a company
        registered in {legal.registeredIn} (UIN {legal.registrationNumber}) (&ldquo;we&rdquo;), the business behind{" "}
        {site.name}. By signing up or using {site.name}, you agree to them.
      </p>

      <h2>What {site.name} is</h2>
      <p>
        {site.name} is an app for teams that work on site: a phone app for your team and a web dashboard for you. Your
        team checks in at jobs, takes photos and fills in forms. You see where they worked, for how long and what was
        done.
      </p>

      <h2>Your free {founding.days} days</h2>
      <ul>
        <li>A Founding member runs {site.name} free for {founding.days} days from the day we set up their account. We don&apos;t ask for a card.</li>
        <li>During your free days you can have up to 10 users.</li>
        <li>
          If you don&apos;t choose a plan by the end of the free days, your account becomes read-only: you can still sign in and
          see everything, but you can&apos;t add or change anything until you choose a plan.
        </li>
      </ul>

      <h2 id="promise">Our {rand(founding.guarantee)} promise to Founding members</h2>
      <p>
        If you use {site.name} properly for your {founding.days} free days and it hasn&apos;t helped your business, we
        pay you {rand(founding.guarantee)}. &ldquo;Properly&rdquo; means you meet every one of these conditions. Our app
        records (sign-ins, clock-ins and check-ins) show whether you did.
      </p>
      <ol>
        <li>
          <strong>You are a Founding member.</strong> We accepted your business into the Founding {founding.spots} and set
          up your account. The promise is once per business.
        </li>
        <li>
          <strong>You set it up in the first 7 days.</strong> Within 7 days of the day we set up your account, you give us
          your list of sites or clients and the people who work for you, and every one of those people installs the app
          and signs in.
        </li>
        <li>
          <strong>Your whole team uses it every workday.</strong> For all {founding.days} days, every person who works
          away from the office clocks in on {site.name} on every day they work, and checks in at every site or job they
          go to. Missing a few days here and there is fine. But if your team clocked in on fewer than 90 out of every 100
          days that they worked, this condition isn&apos;t met.
        </li>
        <li>
          <strong>You use it too.</strong> You, or a manager you name, sign in to the {site.name} dashboard at least once
          a week, every week.
        </li>
        <li>
          <strong>You take part.</strong> You attend the training day, and you join at least 7 of the 8 weekly check-in
          calls.
        </li>
        <li>
          <strong>You give us a chance to fix it.</strong> If something isn&apos;t working for you, you tell us in
          writing (WhatsApp or email) before day 45, so that we have time to put it right.
        </li>
        <li>
          <strong>You claim in time.</strong> You email <a href={`mailto:${site.email}`}>{site.email}</a> within 7 days
          after your {founding.days} days end, and tell us why {site.name} didn&apos;t help your business.
        </li>
      </ol>
      <ul>
        <li>
          If you choose a paid plan at the end of the {founding.days} days, or carry on using {site.name}, you can&apos;t
          also claim the promise.
        </li>
        <li>
          The promise doesn&apos;t apply if your business improved while you used {site.name}. We compare your first
          two weeks with your last two weeks. If your team&apos;s productivity went up (for example more jobs or visits
          done per person per day, more time on site, or fewer missed tasks), you found value, and we don&apos;t pay.
        </li>
        <li>
          The promise doesn&apos;t apply if we suspended your account for misusing {site.name}, or if you deleted your
          records before claiming.
        </li>
        <li>
          Days when the clock is paused (15 December to 5 January) don&apos;t count towards the {founding.days} days.
        </li>
        <li>
          If you meet every condition, we pay {rand(founding.guarantee)} once, by EFT into your business&apos;s bank
          account, within 14 days of your claim. If you don&apos;t meet them, we tell you which ones and show you the
          records.
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
