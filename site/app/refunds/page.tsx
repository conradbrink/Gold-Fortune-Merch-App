import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { founding, site } from "@/lib/site";

// DRAFT for the owner's lawyer to check before launch (owner, 8 Oct 2026).
// Card payment providers ask for a cancellation and refund policy on the
// website (Payfast's review did; billing moved to Paystack on 22 Oct 2026).

export const metadata: Metadata = { title: `Cancellations and refunds | ${site.name}` };

export default function RefundsPage() {
  return (
    <LegalPage title="Cancellations and refunds">
      <h2>Try it first</h2>
      <p>
        Every Founding distributor starts with a free {founding.pilotDays}-day pilot, with no card needed, so you can see
        whether {site.name} works for your reps before you pay anything.
      </p>

      <h2>Cancelling</h2>
      <ul>
        <li>You can cancel at any time on the Billing page in the app. No notice period, no cancellation fee.</li>
        <li>Your plan keeps working until the end of the month or year you have already paid for. After that, nothing more is charged.</li>
        <li>You can change your mind and keep your plan until that date.</li>
        <li>When the plan ends, your account becomes read-only. You can still sign in and see your records for 30 days.</li>
      </ul>

      <h2>Refunds</h2>
      <ul>
        <li>We don&apos;t refund part of a month or year you have already paid for, or the setup fee once your account has been set up.</li>
        <li>A smaller plan takes effect from your next renewal, so there is nothing to refund when you move down.</li>
        <li>
          Founding distributors have our {founding.guaranteeDays}-day promise: if your reps aren&apos;t visiting more stores, we
          refund your first month. The conditions are in <a href="/terms#guarantee">our terms</a>.
        </li>
        <li>If we charged you in error, or charged you twice, we refund the full amount.</li>
        <li>
          If South Africa&apos;s Electronic Communications and Transactions Act gives you a cooling-off right as a
          consumer, you may use it as that Act allows, and we refund any payment it covers in full.
        </li>
        <li>Refunds go back to the card you paid with, through Paystack, and you get a credit note in the app.</li>
      </ul>

      <h2>Ask us</h2>
      <p>
        For a refund or any question about a charge, email <a href={`mailto:${site.email}`}>{site.email}</a> with your
        business name and the invoice number.
      </p>
    </LegalPage>
  );
}
