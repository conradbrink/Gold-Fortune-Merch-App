import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";
import { site } from "@/lib/site";

// Google Play and the App Store both ask for a page that says how to delete an
// account, and the phone app links here from its menu. Keep it in step with
// the Privacy policy: it promises nothing that page does not.

export const metadata: Metadata = { title: `Delete your account | ${site.name}` };

export default function DeleteAccountPage() {
  return (
    <LegalPage title="Delete your account" updated="31 October 2026">
      <p>You can ask for your {site.name} login to be deleted at any time. This page explains how, and what happens to your information.</p>

      <h2>If you work for a business that uses {site.name}</h2>
      <p>
        Your login was made by the business you work for, so ask your manager to remove you from the team in {site.name}.
        Once they have, your login no longer signs in.
      </p>
      <p>
        To have your login and your personal details deleted as well, or if you can&apos;t reach your manager, email{" "}
        <a href={`mailto:${site.email}`}>{site.email}</a> from the email address you sign in with, or tell us the phone
        number you sign in with. We&apos;ll let your company know, and email you once it&apos;s done.
      </p>

      <h2>If you own the business</h2>
      <p>
        Email <a href={`mailto:${site.email}`}>{site.email}</a> to close your company&apos;s account and delete its
        information.
      </p>

      <h2>What is deleted, and what is kept</h2>
      <ul>
        <li>Your login is deleted, with your name, email address and phone number.</li>
        <li>
          The work records you made for your company, such as visits, orders, photos and location records, belong to
          that business. They&apos;re kept for as long as its account is open, unless the business asks us to delete
          them.
        </li>
        <li>Invoices and payment records are kept for five years, as tax law requires.</li>
      </ul>
      <p>
        Our <Link href="/privacy">Privacy policy</Link> explains everything we keep and why.
      </p>
    </LegalPage>
  );
}
