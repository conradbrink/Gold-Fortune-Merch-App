"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CreditCard, FileText, Minus, Plus } from "lucide-react";
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
  startCheckoutAction,
} from "@/app/(dashboard)/billing/actions";
import {
  STATUS_LABEL,
  formatDate,
  formatRand,
  periodWord,
  type Account,
  type ChangePreview,
  type Line,
  type Period,
  type Plan,
  type Quote,
} from "@/lib/billing";
import type { SalesContact } from "@/lib/platform";

export type AddonChoice = {
  code: string;
  name: string;
  /** Bought by the unit (warehouses); otherwise on or off. */
  perUnit: boolean;
  /** Monthly prices, one per tier, for the description. */
  prices: { label: string; cents: number }[];
};

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

type Props = {
  account: Account;
  period: Period | null;
  plan: Plan | null;
  planNext: Plan | null;
  customPriceCents: number | null;
  periodEnd: string | null;
  nextCents: number | null;
  includedUsers: number;
  addons: AddonChoice[];
  invoices: InvoiceRow[];
  unpaid: { totalCents: number; lastError: string | null; nextRetryAt: string | null } | null;
  payfastReady: boolean;
  updateCardUrl: string | null;
  defaultEmail: string;
  checkout: "done" | "cancelled" | null;
  cardUpdated: boolean;
  contact: SalesContact;
};

/**
 * The Billing page's moving parts (Stage 6). Every amount it shows comes back
 * from the database (`billing_quote`, `billing_preview_change`); it only asks.
 */
export function BillingPanel(props: Props) {
  const { account } = props;
  const canChoose =
    account.status === "trial" || account.status === "read_only" || account.status === "cancelled" ||
    (account.status === "exempt" && props.customPriceCents !== null);

  return (
    <>
      {props.checkout === "done" && <Notice tone="ok" text="Thank you. Your payment is being confirmed; this page updates when it is." />}
      {props.checkout === "cancelled" && <Notice tone="warn" text="The payment was cancelled. Nothing was charged." />}
      {props.cardUpdated && <Notice tone="ok" text="Your card is updated." />}
      {props.checkout === "done" && account.status !== "active" && <AutoRefresh />}

      <CurrentPlan {...props} />
      {account.status === "past_due" && props.unpaid && <PaymentFailed {...props} />}
      {canChoose && <ChoosePlan {...props} />}
      {account.status === "active" && props.plan && props.customPriceCents === null && <ChangePlan {...props} />}
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
  return <div className={`rounded-lg border px-4 py-3 text-sm ${cls}`}>{text}</div>;
}

/** Back from Payfast before its notification landed: look again in a few seconds. */
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

function CurrentPlan({ account, period, plan, planNext, periodEnd, nextCents, customPriceCents, addons }: Props) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const paying = account.status === "active" || account.status === "past_due";

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
          {account.status === "trial" && account.trialEndsAt ? ` until ${formatDate(account.trialEndsAt)}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {paying && plan && period && (
          <>
            <p>
              {customPriceCents !== null ? "Plan as agreed" : `${plan.seats} ${plan.seats === 1 ? "user" : "users"}`}, paid every {periodWord(period)}.
              {Object.keys(plan.addons).length > 0 && ` Add-ons: ${Object.entries(plan.addons).map(([k, q]) => {
                const name = addons.find((a) => a.code === k)?.name ?? k;
                return q > 1 ? `${name} × ${q}` : name;
              }).join(", ")}.`}
            </p>
            {periodEnd && nextCents !== null && (
              <p className="text-muted-foreground">
                {account.cancelAtPeriodEnd
                  ? `Ends on ${formatDate(periodEnd)}; nothing more will be charged.`
                  : `Next payment: ${formatRand(nextCents)} on ${formatDate(periodEnd)}.`}
                {planNext && !account.cancelAtPeriodEnd && ` From then: ${planNext.seats} users.`}
              </p>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
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
          </>
        )}
        {error && <p className="text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

function PaymentFailed({ unpaid, updateCardUrl, account }: Props) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  if (!unpaid) return null;
  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-base text-destructive">Your last payment did not go through</CardTitle>
        <CardDescription>
          {formatRand(unpaid.totalCents)} is due{unpaid.lastError ? ` (${unpaid.lastError})` : ""}.
          {account.graceEndsAt ? ` Your account becomes read-only on ${formatDate(account.graceEndsAt)} unless it is paid.` : ""}
          {unpaid.nextRetryAt ? ` We try again on ${formatDate(unpaid.nextRetryAt)}.` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {updateCardUrl && (
          <Button size="sm" variant="outline" nativeButton={false} render={<a href={updateCardUrl} />}>
            <CreditCard className="size-4" aria-hidden /> Update card
          </Button>
        )}
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await retryNowAction();
              setMessage(r.ok ? { ok: true, text: r.value } : { ok: false, text: r.error });
              router.refresh();
            })
          }
        >
          Try again now
        </Button>
        {message && <p className={`w-full text-sm ${message.ok ? "text-foreground" : "text-destructive"}`}>{message.text}</p>}
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
      <span className="w-10 text-center text-sm font-medium tabular-nums">{value}</span>
      <Button size="icon-sm" variant="outline" aria-label={`More ${label}`} onClick={() => onChange(value + 1)}>
        <Plus className="size-4" aria-hidden />
      </Button>
    </div>
  );
}

function AddonPicker({
  addons,
  value,
  onChange,
}: {
  addons: AddonChoice[];
  value: Record<string, number>;
  onChange: (v: Record<string, number>) => void;
}) {
  if (addons.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Add-ons</p>
      {addons.map((a) => {
        const q = value[a.code] ?? 0;
        return (
          <div key={a.code} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
            <div>
              <p className="text-sm">{a.name}</p>
              <p className="text-xs text-muted-foreground">
                {a.prices.map((p) => `${p.label}: ${formatRand(p.cents)} a month`).join(" · ")}
              </p>
            </div>
            {a.perUnit ? (
              <Stepper value={q} min={0} label={a.name} onChange={(v) => onChange({ ...value, [a.code]: v })} />
            ) : (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={q > 0}
                  onChange={(e) => onChange({ ...value, [a.code]: e.target.checked ? 1 : 0 })}
                />
                Include
              </label>
            )}
          </div>
        );
      })}
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
                {l.once ? " (once)" : ""}
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

function ChoosePlan({ addons, plan, defaultEmail, payfastReady, includedUsers, contact, customPriceCents }: Props) {
  const [period, setPeriod] = useState<Period>("yearly");
  const [seats, setSeats] = useState(Math.max(plan?.seats ?? includedUsers, 1));
  const [chosen, setChosen] = useState<Record<string, number>>(plan?.addons ?? {});
  const [email, setEmail] = useState(defaultEmail);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, startPaying] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const [form, setForm] = useState<{ url: string; fields: [string, string][] } | null>(null);

  useEffect(() => {
    let live = true;
    void quoteAction(period, seats, chosen).then((r) => {
      if (!live) return;
      if (r.ok) {
        setQuote(r.value);
        setError(null);
        // Never fewer seats than people already signed in.
        if (r.value.seatsUsed !== null && seats < r.value.seatsUsed) setSeats(r.value.seatsUsed);
      } else {
        setQuote(null);
        setError(r.error);
      }
    });
    return () => {
      live = false;
    };
  }, [period, seats, chosen]);

  useEffect(() => {
    if (form) formRef.current?.submit();
  }, [form]);

  function pay() {
    setError(null);
    startPaying(async () => {
      const r = await startCheckoutAction(period, seats, chosen, email);
      if (!r.ok) setError(r.error);
      else setForm(r.value);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Choose your plan</CardTitle>
        <CardDescription>
          {customPriceCents !== null
            ? "Your price was agreed with us. Pay it by card here."
            : `${includedUsers} users are included; each extra user is charged per ${periodWord(period)}. Yearly is two months free.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="inline-flex rounded-md border border-border p-0.5" role="radiogroup" aria-label="How often to pay">
          {(["yearly", "monthly"] as const).map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={period === p}
              onClick={() => setPeriod(p)}
              className={`rounded px-3 py-1.5 text-sm ${period === p ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-secondary"}`}
            >
              {p === "yearly" ? "Yearly" : "Monthly"}
            </button>
          ))}
        </div>

        {customPriceCents === null && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Users</p>
                <p className="text-xs text-muted-foreground">Everyone who signs in, on the phone or here.</p>
              </div>
              <Stepper value={seats} min={Math.max(quote?.seatsUsed ?? 1, 1)} label="users" onChange={setSeats} />
            </div>
            <AddonPicker addons={addons} value={chosen} onChange={setChosen} />
          </>
        )}

        {quote && <LinesTable lines={quote.lines} totalCents={quote.totalCents} note={`per ${periodWord(period)}`} />}
        {quote && quote.lines.some((l) => l.once) && (
          <p className="text-xs text-muted-foreground">Setup is charged once, with the first monthly payment. It is free on yearly.</p>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="billing-email">Email for receipts</Label>
          <Input id="billing-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {payfastReady ? (
          <Button onClick={pay} disabled={paying || !quote || !email.trim()}>
            <CreditCard className="size-4" aria-hidden />
            {quote ? `Pay ${formatRand(quote.totalCents)} by card` : "Pay by card"}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            Card payments are not switched on yet.{" "}
            {contact.email ? <a className="underline" href={`mailto:${contact.email}`}>Email us</a> : "Talk to us"} to start your plan.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          You pay on Payfast&apos;s secure page; your card is kept by Payfast for the next payments, never by us.
          {" "}If your trial is still running, your paid {periodWord(period)} starts when it ends.
        </p>

        {form && (
          <form ref={formRef} method="POST" action={form.url} className="hidden">
            {form.fields.map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function ChangePlan({ plan, addons, period, periodEnd }: Props) {
  const [seats, setSeats] = useState(plan!.seats);
  const [chosen, setChosen] = useState<Record<string, number>>(plan!.addons);
  const [fetched, setPreview] = useState<ChangePreview | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const changed =
    seats !== plan!.seats || JSON.stringify(normal(chosen)) !== JSON.stringify(normal(plan!.addons));

  // Nothing changed: nothing to preview (the last answer is kept, not shown).
  const preview = changed ? fetched : null;

  useEffect(() => {
    if (!changed) return;
    let live = true;
    void previewChangeAction(seats, chosen).then((r) => {
      if (!live) return;
      if (r.ok) {
        setPreview(r.value);
        setMessage(null);
      } else {
        setPreview(null);
        setMessage({ ok: false, text: r.error });
      }
    });
    return () => {
      live = false;
    };
  }, [seats, chosen, changed]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Change your plan</CardTitle>
        <CardDescription>
          More users or add-ons are charged now, for the rest of this {periodWord(period)}. Fewer apply from {formatDate(periodEnd)}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium">Users</p>
          <Stepper value={seats} min={Math.max(preview?.seatsUsed ?? 1, 1)} label="users" onChange={setSeats} />
        </div>
        <AddonPicker addons={addons} value={chosen} onChange={setChosen} />
        {preview && preview.more && preview.totalCents > 0 && (
          <LinesTable lines={preview.lines} totalCents={preview.totalCents} note="today" />
        )}
        {preview && (
          <p className="text-sm text-muted-foreground">
            From {formatDate(preview.periodEnd)}: {formatRand(preview.nextTotalCents)} per {periodWord(period)}.
          </p>
        )}
        {message && <p className={`text-sm ${message.ok ? "text-foreground" : "text-destructive"}`}>{message.text}</p>}
        <Button
          disabled={!changed || pending || !preview}
          onClick={() =>
            start(async () => {
              const r = await changePlanAction(seats, chosen);
              setMessage(r.ok ? { ok: true, text: r.value.message } : { ok: false, text: r.error });
              router.refresh();
            })
          }
        >
          {preview && preview.more && preview.totalCents > 0 ? `Pay ${formatRand(preview.totalCents)} and change` : "Save the change"}
        </Button>
      </CardContent>
    </Card>
  );
}

function normal(a: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(a).filter(([, v]) => v > 0).sort(([x], [y]) => x.localeCompare(y)));
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
            <li key={i.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <Link href={`/billing/invoices/${i.id}`} className="flex items-center gap-2 hover:underline">
                <FileText className="size-4 text-muted-foreground" aria-hidden />
                {i.number}
                {i.kind === "credit_note" ? " (credit note)" : ""}
              </Link>
              <span className="text-muted-foreground">{formatDate(i.issuedAt)}</span>
              <span className="tabular-nums">{formatRand(i.totalCents)}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
