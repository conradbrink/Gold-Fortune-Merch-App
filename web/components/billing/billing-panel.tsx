"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CreditCard, FileText, Lock, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  changePlanAction,
  previewChangeAction,
  quoteAction,
  retryNowAction,
  setCancelAction,
} from "@/app/(dashboard)/billing/actions";
import {
  STATUS_LABEL,
  cardText,
  formatDate,
  formatRand,
  periodWord,
  type Account,
  type CardOnFile,
  type ChangePreview,
  type Line,
  type Period,
  type Plan,
  type Quote,
} from "@/lib/billing";
import type { SalesContact } from "@/lib/platform";
import { useTerms } from "@/lib/use-company-config";
import { count, lower, noun } from "@/lib/terms";

export type InvoiceRow = {
  id: string;
  number: string;
  kind: "invoice" | "credit_note";
  issuedAt: string;
  periodStart: string | null;
  periodEnd: string | null;
  totalCents: number;
  paidMethod: string | null;
};

type CheckoutNote = "paid" | "pending" | "failed" | "refused" | "refunded" | "cancelled" | "unknown";

type Props = {
  account: Account;
  period: Period | null;
  plan: Plan | null;
  planNext: Plan | null;
  activeReps: number;
  customPriceCents: number | null;
  periodEnd: string | null;
  nextCents: number | null;
  nextLabel: string | null;
  card: CardOnFile | null;
  invoices: InvoiceRow[];
  unpaid: { totalCents: number; lastError: string | null; nextRetryAt: string | null } | null;
  cardsReady: boolean;
  defaultEmail: string;
  checkout: CheckoutNote | null;
  cardUpdated: boolean;
  contact: SalesContact;
};

/**
 * The Billing page's moving parts (Stage 6; Paystack since 22 Oct 2026).
 * Every amount it shows comes back from the database (`billing_quote`,
 * `billing_preview_change`); it only asks. Paying, a failed payment and
 * "Update card" all go to Paystack's own page through /api/paystack/checkout,
 * which works out what is owed on the server.
 */
export function BillingPanel(props: Props) {
  const { account } = props;
  const canChoose =
    account.status === "trial" || account.status === "read_only" || account.status === "cancelled" ||
    (account.status === "exempt" && props.customPriceCents !== null);
  const owing = (account.status === "past_due" || account.status === "read_only") && props.unpaid !== null;

  return (
    <>
      <CheckoutNotice note={props.checkout} cardUpdated={props.cardUpdated} />
      {props.checkout === "pending" ? <AutoRefresh /> : (props.checkout || props.cardUpdated) && <ForgetNotice />}

      <CurrentPlan {...props} />
      {owing && <PaymentFailed {...props} />}
      {canChoose && !owing && <ChoosePlan {...props} />}
      {account.status === "active" && props.plan && props.customPriceCents === null && !props.unpaid &&
        props.periodEnd !== null && new Date(props.periodEnd) > new Date() && <ChangeReps {...props} />}
      {account.status === "exempt" && props.customPriceCents === null && <ManagedByUs contact={props.contact} />}
      <Invoices invoices={props.invoices} />
    </>
  );
}

function Notice({ tone, text }: { tone: "ok" | "warn" | "error"; text: string }) {
  const cls =
    tone === "ok"
      ? "border-primary/30 bg-primary/5 text-foreground"
      : tone === "warn"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300"
        : "border-destructive/40 bg-destructive/10 text-destructive";
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${cls}`} role="status">
      {text}
    </div>
  );
}

function CheckoutNotice({ note, cardUpdated }: { note: CheckoutNote | null; cardUpdated: boolean }) {
  if (cardUpdated) return <Notice tone="ok" text="Your new card is saved. The small card check is refunded to it." />;
  switch (note) {
    case "paid":
      return <Notice tone="ok" text="Thank you, your payment went through. Your invoice is below." />;
    case "pending":
      return <Notice tone="ok" text="Thank you. Paystack is confirming your payment; this page updates by itself when it has." />;
    case "failed":
      return <Notice tone="error" text="The payment did not go through, so nothing was charged. Try again, or use another card." />;
    case "refused":
      return <Notice tone="error" text="The amount paid was not what was due, so we did not accept it. Talk to us and we will sort it out." />;
    case "refunded":
      return <Notice tone="warn" text="That payment was for a bill that was already paid or had been replaced, so we have refunded it to your card. Nothing more is due for it." />;
    case "cancelled":
      return <Notice tone="warn" text="You cancelled the payment. Nothing was charged." />;
    case "unknown":
      return <Notice tone="warn" text="We could not tell which payment that was. If you paid, it shows here within a few minutes." />;
    default:
      return null;
  }
}

/**
 * A notice from the way back from Paystack is said once: the address loses
 * it, so a later refresh (after changing reps, say) does not repeat it.
 */
function ForgetNotice() {
  useEffect(() => {
    window.history.replaceState(window.history.state, "", window.location.pathname);
  }, []);
  return null;
}

/** Back from Paystack before the payment was confirmed: look again every few seconds, for a minute. */
function AutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 4000);
    const stop = setTimeout(() => clearInterval(t), 60000);
    return () => {
      clearInterval(t);
      clearTimeout(stop);
    };
  }, [router]);
  return null;
}

/**
 * Sends the browser to Paystack's page. The server decides what is paid for:
 * the plan for `reps`, an unpaid renewal, or a card check ("Update card").
 */
function useCheckout() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function go(body: { reps?: number; period?: Period; email?: string }) {
    setError(null);
    start(async () => {
      try {
        const res = await fetch("/api/paystack/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json().catch(() => ({}))) as { authorization_url?: string; error?: string };
        if (!res.ok || !json.authorization_url) {
          setError(json.error ?? "The payment page did not open. Try again in a moment.");
          return;
        }
        window.location.assign(json.authorization_url);
        // Stay "busy" while the browser leaves.
        await new Promise(() => {});
      } catch {
        setError("The payment page did not open. Check your connection and try again.");
      }
    });
  }
  return { go, pending, error };
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{children}</dd>
    </div>
  );
}

function CurrentPlan(props: Props) {
  const { account, period, plan, planNext, periodEnd, nextCents, nextLabel, customPriceCents, activeReps, card, cardsReady } = props;
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const checkout = useCheckout();
  const t = useTerms();
  const paying = account.status === "active" || account.status === "past_due";
  const places = plan?.seats ?? null;

  function toggleCancel(cancel: boolean) {
    setError(null);
    start(async () => {
      const r = await setCancelAction(cancel);
      if (!r.ok) setError(r.error);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Your plan</CardTitle>
        <CardDescription>
          {STATUS_LABEL[account.status]}
          {account.status === "trial" && account.trialEndsAt ? `, until ${formatDate(account.trialEndsAt)}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm">
        <dl className="divide-y divide-border">
          {paying && plan && period && (
            <Row label="Plan">
              {customPriceCents !== null ? "Your price, as agreed with us" : (nextLabel ?? `Plan for ${count(t, "staff", places ?? 0)}`)}, paid every {periodWord(period)}
            </Row>
          )}
          <Row label={t.staff.many}>
            {activeReps} active {noun(t, "staff", activeReps)}
            {places !== null && paying && customPriceCents === null && (
              <span className="text-muted-foreground">
                {" "}
                of {places} {places === 1 ? "place" : "places"} on your plan
              </span>
            )}
          </Row>
          {account.status === "active" && periodEnd && nextCents !== null && (
            <Row label="Next payment">
              {account.cancelAtPeriodEnd ? (
                <>Your plan ends on {formatDate(periodEnd)}. Nothing more will be charged.</>
              ) : (
                <>
                  <span className="font-medium tabular-nums">{formatRand(nextCents)}</span> on {formatDate(periodEnd)}
                  {planNext && <span className="text-muted-foreground">, for {count(t, "staff", planNext.seats)} from then</span>}
                </>
              )}
            </Row>
          )}
          {(card || paying) && (
            <Row label="Card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <CreditCard className="size-4 text-muted-foreground" aria-hidden />
                  {card ? cardText(card) : "No card on file"}
                </span>
                {cardsReady && paying && (
                  <Button size="sm" variant="outline" disabled={checkout.pending} onClick={() => checkout.go({})}>
                    {checkout.pending ? "Opening Paystack…" : card ? "Update card" : "Add a card"}
                  </Button>
                )}
              </div>
              {checkout.error && <p className="mt-2 text-destructive">{checkout.error}</p>}
            </Row>
          )}
        </dl>

        {paying && period && (
          <div className="flex flex-wrap gap-2 pt-3">
            {account.cancelAtPeriodEnd ? (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => toggleCancel(false)}>
                Keep my plan
              </Button>
            ) : (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => toggleCancel(true)}>
                Cancel at the end of this {periodWord(period)}
              </Button>
            )}
          </div>
        )}
        {error && <p className="pt-2 text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

function PaymentFailed({ unpaid, account, card, cardsReady, defaultEmail }: Props) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  const checkout = useCheckout();
  if (!unpaid) return null;
  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-base text-destructive">Your last payment did not go through</CardTitle>
        <CardDescription>
          {formatRand(unpaid.totalCents)} is due{unpaid.lastError ? ` (${unpaid.lastError.replace(/^Paystack: /, "")})` : ""}.
          {account.status === "read_only"
            ? " Your account is read-only until it is paid."
            : account.graceEndsAt
              ? ` Pay it before ${formatDate(account.graceEndsAt)} or your account becomes read-only.`
              : ""}
          {unpaid.nextRetryAt && account.status !== "read_only" ? ` We try your card again on ${formatDate(unpaid.nextRetryAt)}.` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {cardsReady ? (
          <div className="flex flex-wrap gap-2">
            <Button disabled={checkout.pending || pending} onClick={() => checkout.go({ email: defaultEmail })}>
              <CreditCard className="size-4" aria-hidden />
              {checkout.pending ? "Opening Paystack…" : `Pay ${formatRand(unpaid.totalCents)} now`}
            </Button>
            {card && (
              <Button
                variant="outline"
                disabled={pending || checkout.pending}
                onClick={() =>
                  start(async () => {
                    const r = await retryNowAction();
                    setMessage(r.ok ? { ok: true, text: r.value } : { ok: false, text: r.error });
                    router.refresh();
                  })
                }
              >
                {pending ? "Trying…" : `Try ${cardText(card).split(",")[0]} again`}
              </Button>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Card payments are not switched on yet. Talk to us to pay.</p>
        )}
        <p className="text-xs text-muted-foreground">Paying with a new card also saves it for your next payments.</p>
        {checkout.error && <p className="text-sm text-destructive">{checkout.error}</p>}
        {message && <p className={`text-sm ${message.ok ? "text-foreground" : "text-destructive"}`}>{message.text}</p>}
      </CardContent>
    </Card>
  );
}

function Stepper({ value, min, onChange, label }: { value: number; min: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <Button size="icon-sm" variant="outline" aria-label={`Fewer ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}>
        <Minus className="size-4" aria-hidden />
      </Button>
      <span className="w-10 text-center text-sm font-medium tabular-nums" aria-live="polite">
        {value}
      </span>
      <Button size="icon-sm" variant="outline" aria-label={`More ${label}`} disabled={value >= 1000} onClick={() => onChange(value + 1)}>
        <Plus className="size-4" aria-hidden />
      </Button>
    </div>
  );
}

function LinesTable({ lines, totalCents, note }: { lines: Line[]; totalCents: number; note?: string }) {
  return (
    <div className="rounded-md border border-border">
      <table className="w-full text-sm">
        <tbody>
          {lines.map((l, i) => (
            <tr key={`${l.code}-${i}`} className="border-b border-border last:border-0">
              <td className="px-3 py-2">
                {l.label}
                {l.quantity > 1 ? ` × ${l.quantity}` : ""}
                {l.once ? " (once-off)" : ""}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{formatRand(l.amountCents)}</td>
            </tr>
          ))}
          <tr>
            <td className="px-3 py-2 font-medium">Total{note ? ` ${note}` : ""}</td>
            <td className="px-3 py-2 text-right font-medium tabular-nums">{formatRand(totalCents)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ChoosePlan({ plan, defaultEmail, cardsReady, contact, customPriceCents, activeReps, account }: Props) {
  const [period, setPeriod] = useState<Period>("monthly");
  const [reps, setReps] = useState(Math.max(plan?.seats ?? activeReps, 1));
  const [email, setEmail] = useState(defaultEmail);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const checkout = useCheckout();
  const t = useTerms();
  const least = Math.max(quote?.seatsUsed ?? activeReps, 1);

  useEffect(() => {
    let live = true;
    void quoteAction(period, reps).then((r) => {
      if (!live) return;
      if (r.ok) {
        setQuote(r.value);
        setError(null);
        // Never fewer places than reps already working.
        if (r.value.seatsUsed !== null && reps < r.value.seatsUsed) setReps(r.value.seatsUsed);
      } else {
        setQuote(null);
        setError(r.error);
      }
    });
    return () => {
      live = false;
    };
  }, [period, reps]);

  const planLine = quote?.lines.find((l) => l.code === "base");
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Choose your plan</CardTitle>
        <CardDescription>
          {customPriceCents !== null
            ? "Your price was agreed with us. Pay it by card here."
            : `Your price depends on how many ${lower(t.staff.many)} you have. Managers and office users are free.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="inline-flex rounded-md border border-border p-0.5" role="radiogroup" aria-label="How often to pay">
          {(["monthly", "yearly"] as const).map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={period === p}
              onClick={() => setPeriod(p)}
              className={`rounded px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                period === p ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-secondary"
              }`}
            >
              {p === "yearly" ? "Yearly, 2 months free" : "Monthly"}
            </button>
          ))}
        </div>

        {customPriceCents === null && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{t.staff.many}</p>
              <p className="text-xs text-muted-foreground">
                You have {activeReps} active {noun(t, "staff", activeReps)}
                {planLine ? `. This is the ${planLine.label.replace(/^Plan/, "plan")}.` : "."}
              </p>
            </div>
            <Stepper value={reps} min={least} label={lower(t.staff.many)} onChange={setReps} />
          </div>
        )}

        {quote && <LinesTable lines={quote.lines} totalCents={quote.totalCents} note="today" />}
        {quote && quote.lines.some((l) => l.once) && (
          <p className="text-xs text-muted-foreground">Setup is paid once, with your first monthly payment. It is free if you pay yearly.</p>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="billing-email">Email for invoices and receipts</Label>
          <Input
            id="billing-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            aria-invalid={email.trim() !== "" && !emailOk}
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {checkout.error && <p className="text-sm text-destructive">{checkout.error}</p>}
        {cardsReady ? (
          <Button
            onClick={() => checkout.go({ reps, period, email: email.trim() })}
            disabled={checkout.pending || !quote || !emailOk}
          >
            <CreditCard className="size-4" aria-hidden />
            {checkout.pending ? "Opening Paystack…" : quote ? `Pay ${formatRand(quote.totalCents)} by card` : "Pay by card"}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            Card payments are not switched on yet.{" "}
            {contact.email ? (
              <a className="underline" href={`mailto:${contact.email}`}>
                Email us
              </a>
            ) : (
              "Talk to us"
            )}{" "}
            to start your plan.
          </p>
        )}
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            You pay on Paystack&apos;s secure page. We never see your card number; Paystack keeps the card for your next payments.
            {account.status === "trial" ? ` Your free pilot is not cut short: your paid ${periodWord(period)} starts when it ends.` : ""}
          </span>
        </p>
      </CardContent>
    </Card>
  );
}

function ChangeReps({ plan, period, periodEnd, activeReps, card }: Props) {
  const [reps, setReps] = useState(plan!.seats);
  const [fetched, setPreview] = useState<ChangePreview | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const t = useTerms();
  const staff = lower(t.staff.many);
  const seats = plan!.seats;
  const addons = plan!.addons;
  const changed = reps !== seats;

  // Nothing changed: nothing to preview (the last answer is kept, not shown).
  const preview = changed ? fetched : null;

  function choose(n: number) {
    setMessage(null);
    setReps(n);
  }

  // Asked again when the number changes, not when the page re-reads the plan
  // after saving (that would wipe the answer the save gave).
  const addonsKey = JSON.stringify(addons);
  useEffect(() => {
    if (!changed) return;
    let live = true;
    void previewChangeAction(reps, JSON.parse(addonsKey) as Record<string, number>).then((r) => {
      if (!live) return;
      if (r.ok) {
        setPreview(r.value);
      } else {
        setPreview(null);
        setMessage({ ok: false, text: r.error });
      }
    });
    return () => {
      live = false;
    };
  }, [reps, changed, addonsKey]);

  const chargeNow = preview && preview.more && preview.totalCents > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Change the number of {staff}</CardTitle>
        <CardDescription>
          More {staff} are paid for now, for what is left of this {periodWord(period)}. Fewer apply from {formatDate(periodEnd)}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Places for {staff}</p>
            <p className="text-xs text-muted-foreground">You have {activeReps} active {noun(t, "staff", activeReps)} now.</p>
          </div>
          <Stepper value={reps} min={Math.max(activeReps, 1)} label={staff} onChange={choose} />
        </div>
        {chargeNow && <LinesTable lines={preview.lines} totalCents={preview.totalCents} note="today" />}
        {preview && (
          <p className="text-sm text-muted-foreground">
            From {formatDate(preview.periodEnd)}: {formatRand(preview.nextTotalCents)} a {periodWord(period)}.
          </p>
        )}
        {message && <p className={`text-sm ${message.ok ? "text-foreground" : "text-destructive"}`}>{message.text}</p>}
        <Button
          disabled={!changed || pending || !preview || (Boolean(chargeNow) && !card)}
          onClick={() =>
            start(async () => {
              const r = await changePlanAction(reps, addons);
              setMessage(r.ok ? { ok: true, text: r.value.message } : { ok: false, text: r.error });
              router.refresh();
            })
          }
        >
          {pending ? "Saving…" : chargeNow ? `Pay ${formatRand(preview.totalCents)} and add the ${staff}` : "Save the change"}
        </Button>
        {chargeNow && !card && <p className="text-xs text-muted-foreground">Add a card above first.</p>}
      </CardContent>
    </Card>
  );
}

function ManagedByUs({ contact }: { contact: SalesContact }) {
  const whatsapp = contact.whatsapp?.replace(/\D/g, "") || null;
  return (
    <Card>
      <CardContent className="space-y-2 py-5 text-sm">
        <p>Your company&apos;s plan is managed by us, outside the app.</p>
        <div className="flex flex-wrap gap-3">
          {whatsapp && (
            <a className="underline" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer">
              Talk to us on WhatsApp
            </a>
          )}
          {contact.email && (
            <a className="underline" href={`mailto:${contact.email}`}>
              Email us
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Invoices({ invoices }: { invoices: InvoiceRow[] }) {
  if (invoices.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Invoices</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {invoices.map((i) => (
            <li key={i.id} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 py-2.5 text-sm sm:grid-cols-[1fr_10rem_6rem]">
              <Link href={`/billing/invoices/${i.id}`} className="flex items-center gap-2 font-medium hover:underline">
                <FileText className="size-4 text-muted-foreground" aria-hidden />
                {i.number}
                {i.kind === "credit_note" ? " (credit note)" : ""}
              </Link>
              <span className="order-3 col-span-2 text-muted-foreground sm:order-none sm:col-span-1">{formatDate(i.issuedAt)}</span>
              <span className="text-right tabular-nums">{formatRand(i.totalCents)}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
