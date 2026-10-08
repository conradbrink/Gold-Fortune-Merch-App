import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { legal, site } from "@/lib/site";

// DRAFT for the owner's lawyer to check before launch (owner, 8 Oct 2026),
// written against POPIA. It lists the services the app actually uses; add one
// to the app, add it here.

export const metadata: Metadata = { title: `Privacy | ${site.name}` };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy">
      <p>
        This policy explains what personal information {site.name} collects, why, where it is kept and what you can do
        about it. It follows Botswana&apos;s Data Protection Act and, for businesses and people in South Africa, the
        Protection of Personal Information Act (POPIA).
      </p>

      <h2>Who is responsible</h2>
      <ul>
        <li>
          {site.legalName}, registered in {legal.registeredIn} (UIN {legal.registrationNumber}), {legal.address}, is
          responsible for the information about the businesses that sign up and the people who manage their accounts.
        </li>
        <li>
          The information a business puts in about its own team (names, work locations, photos and so on) belongs to
          that business, which is responsible for it. We process it for them, on their instructions.
        </li>
        <li>
          Our data protection and information officer
          {legal.informationOfficer ? ` is ${legal.informationOfficer} and` : ""} can be reached at{" "}
          <a href={`mailto:${site.email}`}>{site.email}</a>.
        </li>
      </ul>

      <h2>This website</h2>
      <p>
        This website sets no cookies and uses no tracking or advertising tools. If you email us, we keep your email to
        answer you.
      </p>

      <h2>What the app collects</h2>
      <ul>
        <li>Account details: names, email addresses and phone numbers of the people who use it, and your business&apos;s details.</li>
        <li>Location: the phone app records where a team member is only while they have a workday open, and the place of each check-in.</li>
        <li>Work records: check-ins and check-outs, photos taken in the app, forms, orders and notes your team adds.</li>
        <li>
          Payments: Payfast handles your card. We receive a reference to the saved card and a record of each payment,
          never the card number.
        </li>
      </ul>

      <h2>Why we use it</h2>
      <ul>
        <li>To run {site.name} for your business: show you your team&apos;s day, keep your records and produce your reports.</li>
        <li>To bill you and keep invoices.</li>
        <li>To support you, keep the service safe and fix faults.</li>
      </ul>
      <p>We don&apos;t sell personal information and don&apos;t use it for advertising.</p>

      <h2>Where it is kept and who helps us</h2>
      <p>
        The app&apos;s data is stored by Supabase on servers in {legal.dataLocation}. A few other services help us run{" "}
        {site.name}, each only for its own part:
      </p>
      <ul>
        <li>Supabase: the database and file storage.</li>
        <li>Vercel: hosts the website and the dashboard.</li>
        <li>Payfast: takes card payments.</li>
        <li>Google Maps: shows maps and turns addresses into map positions.</li>
        <li>Sentry: tells us about faults in the app. It is set up not to receive IP addresses, cookies, passwords or sign-in details.</li>
        <li>OpenAI: only when a manager asks the dashboard&apos;s AI insights a question, the figures needed to answer it are sent.</li>
      </ul>
      <p>
        These services keep information outside Botswana and South Africa. We use them because they protect
        information to a standard at least as strict as the laws above, under their terms with us.
      </p>

      <h2>How long we keep it</h2>
      <ul>
        <li>For as long as your account is open.</li>
        <li>
          When a trial ends unpaid or a plan ends, the account becomes read-only. After 30 days we may delete the
          company&apos;s data, after letting you know.
        </li>
        <li>Invoices and payment records are kept for five years, as tax law requires.</li>
      </ul>

      <h2>Keeping it safe</h2>
      <p>
        Every business can only ever see its own data, access inside a business is by role, passwords are never stored
        in readable form, and all traffic is encrypted.
      </p>

      <h2>Your rights</h2>
      <ul>
        <li>You may ask what information we hold about you, and ask us to correct or delete it.</li>
        <li>You may object to how we use it.</li>
        <li>
          If you are a team member of a business that uses {site.name}, ask that business first: it decides what is
          recorded about its team. We will help it answer you.
        </li>
        <li>
          If you are not happy with our answer, you may complain to the data protection authority: in Botswana, the
          Information and Data Protection Commission; in South Africa, the Information Regulator (
          <a href="https://inforegulator.org.za" rel="noopener noreferrer">inforegulator.org.za</a>).
        </li>
      </ul>
      <p>
        To ask anything about your information, email <a href={`mailto:${site.email}`}>{site.email}</a>.
      </p>
    </LegalPage>
  );
}
