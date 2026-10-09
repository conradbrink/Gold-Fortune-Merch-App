import type { ReactNode } from "react";
import { CircleCheck, Clock, Info, TriangleAlert } from "lucide-react";
import { hexToRgb, onWhite, readableOn, tint, type PdfLook, type Rgb } from "@/lib/document-style";
import {
  ageingParts,
  dayText,
  documentLook,
  invoiceBanner,
  moneyIn,
  periodText,
  quoteBanner,
  sellerOf,
  statementBanner,
  statementClosing,
  statementParts,
  type Banner,
  type DocumentView,
  type InvoiceView,
  type QuoteView,
  type Seller,
  type StatementView,
} from "@/lib/client-document";
import { invoiceHeading, PAYMENT_METHODS } from "@/lib/invoices";
import { formatQty, lineTotal } from "@/lib/money-docs";
import { statementDetail, STATEMENT_KIND_LABELS } from "@/lib/owed";
import { DownloadPdfButton } from "@/components/client-document/download-pdf-button";

/**
 * The client's view of an invoice, a quote or a statement (Stage 8.10), from
 * what `document_link_view()` returns. Rendered by /c/doc/[token];
 * presentational, so it can be checked with example data.
 *
 * It reads as the paper document does, in the company's own look: `classic` is
 * neutral with a dark heading, `bold` a band of the company's colour, `clean`
 * centred with thin lines. The paper is always light, so the company's colours
 * mean what they mean on its PDF whatever the reader's theme.
 */

const css = (c: Rgb) => `rgb(${c[0]} ${c[1]} ${c[2]})`;

function palette(look: PdfLook) {
  const primary = hexToRgb(look.primary);
  return {
    primary: look.primary,
    accent: look.accent,
    onPrimary: css(readableOn(primary)),
    /** The company's colour as text on white. */
    text: css(onWhite(primary)),
    wash: css(tint(primary, 0.93)),
  };
}
type Palette = ReturnType<typeof palette>;

const lines = (s: string | null | undefined) => (s ?? "").trim();

// ------------------------------------------------------------ the letterhead

/** Short facts side by side, each kept whole when the line wraps. */
function Spaced({ items, centre }: { items: string[]; centre: boolean }) {
  return (
    <p className={`flex flex-wrap gap-x-3 gap-y-0.5 ${centre ? "justify-center" : ""}`}>
      {items.map((t) => (
        <span key={t} className="break-words">
          {t}
        </span>
      ))}
    </p>
  );
}

function SellerDetails({ s, centre = false }: { s: Seller; centre?: boolean }) {
  const numbers = [
    s.registrationNumber && `Reg no: ${s.registrationNumber}`,
    s.taxNumber && `TIN: ${s.taxNumber}`,
    s.vatNumber && `VAT no: ${s.vatNumber}`,
  ].filter(Boolean) as string[];
  const contact = [s.phone, s.email].filter(Boolean) as string[];
  return (
    <div className={`space-y-0.5 text-xs text-neutral-600 ${centre ? "text-center" : ""}`}>
      {lines(s.address) && <p className="whitespace-pre-line">{lines(s.address)}</p>}
      {numbers.length > 0 && <Spaced items={numbers} centre={centre} />}
      {contact.length > 0 && <Spaced items={contact} centre={centre} />}
    </div>
  );
}

function Logo({ src, className }: { src: string | null; className: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="" className={className} /> : null;
}

function Meta({ rows, align = "left" }: { rows: [string, string][]; align?: "left" | "right" | "centre" }) {
  if (rows.length === 0) return null;
  const place = align === "right" ? "justify-start sm:justify-end" : align === "centre" ? "justify-center" : "justify-start";
  return (
    <dl className={`grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-sm ${place}`}>
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-neutral-600">{k}</dt>
          <dd className="font-medium tabular-nums text-neutral-900">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** "TAX INVOICE" to "Tax invoice": the PDF shouts, the page does not. */
const sentence = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

function Masthead({
  look,
  p,
  seller,
  logo,
  heading,
  number,
  meta,
}: {
  look: PdfLook;
  p: Palette;
  seller: Seller;
  logo: string | null;
  heading: string;
  number: string | null;
  meta: [string, string][];
}) {
  if (look.style === "bold") {
    return (
      <header>
        <div className="flex flex-col gap-4 px-5 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-8" style={{ background: p.primary, color: p.onPrimary }}>
          {logo ? (
            <span className="inline-flex self-start rounded-md bg-white p-2">
              <Logo src={logo} className="h-10 w-auto max-w-40 object-contain" />
            </span>
          ) : (
            <p className="text-lg font-semibold text-balance">{seller.name}</p>
          )}
          <div className="sm:text-right">
            <h1 className="text-2xl font-bold text-balance sm:text-3xl">{heading}</h1>
            {number && <p className="text-sm tabular-nums opacity-90">{number}</p>}
          </div>
        </div>
        <div className="h-1" style={{ background: p.accent }} />
        <div className="grid gap-5 px-5 pt-6 sm:grid-cols-2 sm:px-8">
          <div className="space-y-1">
            {logo && <p className="text-sm font-semibold text-neutral-900">{seller.name}</p>}
            <SellerDetails s={seller} />
          </div>
          <Meta rows={meta} align="right" />
        </div>
      </header>
    );
  }
  if (look.style === "clean") {
    return (
      <header className="space-y-5 px-5 pt-8 sm:px-8">
        <div className="flex flex-col items-center gap-2">
          <Logo src={logo} className="h-12 w-auto max-w-44 object-contain" />
          <p className="text-base font-semibold text-neutral-900">{seller.name}</p>
          <SellerDetails s={seller} centre />
        </div>
        <div className="h-px" style={{ background: p.text }} />
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-xl font-light tracking-[0.18em] text-balance uppercase sm:text-2xl" style={{ color: p.text }}>
            {heading}
          </h1>
          {number && <p className="text-sm font-medium tabular-nums text-neutral-900">{number}</p>}
          <Meta rows={meta} align="centre" />
        </div>
      </header>
    );
  }
  return (
    <header className="grid gap-6 px-5 pt-6 sm:grid-cols-2 sm:px-8 sm:pt-8">
      <div className="space-y-2">
        <Logo src={logo} className="h-12 w-auto max-w-44 object-contain" />
        <p className="text-base font-semibold text-neutral-900">{seller.name}</p>
        <SellerDetails s={seller} />
      </div>
      <div className="space-y-2 sm:text-right">
        <h1 className="text-2xl font-bold text-balance text-neutral-900 sm:text-3xl">{heading}</h1>
        {number && <p className="text-sm font-medium tabular-nums text-neutral-900">{number}</p>}
        <Meta rows={meta} align="right" />
      </div>
    </header>
  );
}

// ----------------------------------------------------------------- pieces

const TONES: Record<Banner["tone"], { icon: typeof Clock; box: string }> = {
  paid: { icon: CircleCheck, box: "bg-emerald-50 text-emerald-900" },
  overdue: { icon: TriangleAlert, box: "bg-red-50 text-red-900" },
  ended: { icon: Info, box: "bg-neutral-100 text-neutral-800" },
  due: { icon: Clock, box: "" },
  info: { icon: Clock, box: "" },
};

function BannerBox({ banner, p }: { banner: Banner; p: Palette }) {
  const tone = TONES[banner.tone];
  const Icon = tone.icon;
  const brand = banner.tone === "due" || banner.tone === "info";
  return (
    <div
      role="status"
      className={`flex items-start gap-3 rounded-lg px-4 py-3 ${tone.box}`}
      style={brand ? { background: p.wash, color: p.text } : undefined}
    >
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0">
        <p className="text-base font-semibold text-balance">{banner.headline}</p>
        {banner.note && <p className="text-sm">{banner.note}</p>}
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1">
      <h2 className="text-xs font-semibold text-neutral-600">{title}</h2>
      {children}
    </section>
  );
}

function Who({ label, name, address }: { label: string; name: string; address: string | null }) {
  return (
    <Block title={label}>
      <p className="text-base font-semibold text-neutral-900">{name}</p>
      {lines(address) && <p className="text-sm whitespace-pre-line text-neutral-700">{lines(address)}</p>}
    </Block>
  );
}

type Row = { title: string; sub: string | null; code: string | null; qty: string; price: string; amount: string };

/** The lines: stacked on a phone, a table from a tablet up. */
function Lines({ rows, p, look }: { rows: Row[]; p: Palette; look: PdfLook }) {
  const hasCode = rows.some((r) => r.code);
  const head =
    look.style === "bold"
      ? { background: p.primary, color: p.onPrimary }
      : look.style === "clean"
        ? { color: p.text, borderBottom: `1px solid ${p.text}` }
        : { background: "rgb(30 41 59)", color: "rgb(255 255 255)" };
  const cell = look.style === "clean" ? "border-b border-neutral-200" : "border-b border-neutral-200";
  return (
    <section aria-label="Lines">
      <ul className="divide-y divide-neutral-200 border-y border-neutral-200 sm:hidden">
        {rows.map((r, i) => (
          <li key={i} className="flex items-start justify-between gap-4 py-3">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium break-words text-neutral-900">{r.title}</p>
              {r.sub && <p className="text-xs text-neutral-600">{r.sub}</p>}
              <p className="text-xs text-neutral-600 tabular-nums">
                {r.qty} at {r.price}
                {r.code ? `, ${r.code}` : ""}
              </p>
            </div>
            <p className="shrink-0 text-sm font-semibold tabular-nums text-neutral-900">{r.amount}</p>
          </li>
        ))}
      </ul>
      <table className="hidden w-full text-sm sm:table">
        <thead>
          <tr className="text-left text-xs font-semibold" style={head}>
            <th className="px-3 py-2">Description</th>
            {hasCode && <th className="px-3 py-2 whitespace-nowrap">Code</th>}
            <th className="px-3 py-2 text-right whitespace-nowrap">Qty</th>
            <th className="px-3 py-2 text-right whitespace-nowrap">Unit price</th>
            <th className="px-3 py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={cell} style={look.style === "bold" && i % 2 === 1 ? { background: p.wash } : undefined}>
              <td className="px-3 py-2.5 align-top text-neutral-900">
                <span className="break-words">{r.title}</span>
                {r.sub && <span className="block text-xs text-neutral-600">{r.sub}</span>}
              </td>
              {hasCode && <td className="px-3 py-2.5 align-top whitespace-nowrap text-neutral-700">{r.code}</td>}
              <td className="px-3 py-2.5 text-right align-top whitespace-nowrap tabular-nums text-neutral-900">{r.qty}</td>
              <td className="px-3 py-2.5 text-right align-top whitespace-nowrap tabular-nums text-neutral-900">{r.price}</td>
              <td className="px-3 py-2.5 text-right align-top font-medium whitespace-nowrap tabular-nums text-neutral-900">{r.amount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

type Total = [label: string, value: string];

/** The totals, the last of them (what is due) made large in the company's style. */
function Totals({ rows, p, look }: { rows: Total[]; p: Palette; look: PdfLook }) {
  const last = rows.length - 1;
  return (
    <dl className="ml-auto w-full space-y-1 text-sm sm:max-w-xs">
      {rows.map(([k, v], i) => {
        if (i < last) {
          return (
            <div key={k} className="flex justify-between gap-4">
              <dt className="text-neutral-600">{k}</dt>
              <dd className="tabular-nums text-neutral-900">{v}</dd>
            </div>
          );
        }
        if (look.style === "bold") {
          return (
            <div key={k} className="mt-2 flex items-center justify-between gap-4 rounded-md px-3 py-2.5 text-base font-semibold" style={{ background: p.primary, color: p.onPrimary }}>
              <dt>{k}</dt>
              <dd className="tabular-nums">{v}</dd>
            </div>
          );
        }
        if (look.style === "clean") {
          return (
            <div key={k} className="mt-2 flex items-baseline justify-between gap-4 pt-2" style={{ borderTop: `1px solid ${p.text}` }}>
              <dt className="text-neutral-600">{k}</dt>
              <dd className="text-xl font-bold tabular-nums" style={{ color: p.text }}>
                {v}
              </dd>
            </div>
          );
        }
        return (
          <div key={k} className={`flex justify-between gap-4 text-base font-bold ${rows.length > 1 ? "border-t border-neutral-300 pt-2" : ""}`}>
            <dt className="text-neutral-900">{k}</dt>
            <dd className="tabular-nums text-neutral-900">{v}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function HowToPay({ details, reference }: { details: string | null; reference: string | null }) {
  if (!lines(details)) return null;
  return (
    <section className="space-y-1 rounded-lg bg-neutral-50 p-4 ring-1 ring-neutral-200">
      <h2 className="text-sm font-semibold text-neutral-900">How to pay</h2>
      <p className="text-sm whitespace-pre-line text-neutral-800">{lines(details)}</p>
      {reference && <p className="text-sm text-neutral-700">Please use {reference} as the payment reference.</p>}
    </section>
  );
}

function List({ title, items }: { title: string; items: { key: string; main: string; sub: string | null; amount: string }[] }) {
  if (items.length === 0) return null;
  return (
    <Block title={title}>
      <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
        {items.map((it) => (
          <li key={it.key} className="flex items-start justify-between gap-4 py-2.5 text-sm">
            <div className="min-w-0">
              <p className="font-medium break-words text-neutral-900">{it.main}</p>
              {it.sub && <p className="text-xs break-words text-neutral-600">{it.sub}</p>}
            </div>
            <p className="shrink-0 font-medium tabular-nums text-neutral-900">{it.amount}</p>
          </li>
        ))}
      </ul>
    </Block>
  );
}

function vatLabel(rate: number, included: boolean) {
  return included ? `VAT ${rate}% (included)` : `VAT ${rate}%`;
}

// ---------------------------------------------------------------- invoice

function Invoice({ v, logo, today, look, p }: { v: InvoiceView; logo: string | null; today: string; look: PdfLook; p: Palette }) {
  const inv = v.invoice;
  const money = moneyIn(v.look.currency);
  const seller = sellerOf(v);
  const banner = invoiceBanner({ outstanding: v.outstanding, due_date: inv.due_date }, today, money);
  const meta: [string, string][] = [
    ["Date", dayText(inv.issue_date)],
    ["Due", dayText(inv.due_date)],
  ];
  if (inv.period_start && inv.period_end) meta.push(["Period", periodText(inv.period_start, inv.period_end)]);
  if (inv.order_number) meta.push(["Order", inv.order_number]);
  else if (inv.source === "quote" && inv.reference) meta.push(["Quote", inv.reference]);
  else if (inv.reference) meta.push(["Reference", inv.reference]);
  const rate = Number(inv.vat_rate);
  const totals: Total[] = rate === 0 ? [] : [["Subtotal (excl. VAT)", money(inv.subtotal)], [vatLabel(rate, inv.prices_include_vat), money(inv.vat)]];
  const settled = v.credited > 0 || v.paid > 0;
  if (settled) {
    totals.push(["Total", money(inv.total)]);
    if (v.credited > 0) totals.push(["Credit notes", money(-v.credited)]);
    if (v.paid > 0) totals.push(["Paid", money(-v.paid)]);
    totals.push(["Still to pay", money(Math.max(0, v.outstanding))]);
  } else {
    totals.push(["Total", money(inv.total)]);
  }
  return (
    <>
      <Masthead look={look} p={p} seller={seller} logo={logo} heading={sentence(invoiceHeading(inv))} number={inv.invoice_number} meta={meta} />
      <div className="space-y-6 px-5 pt-6 pb-8 sm:px-8">
        <BannerBox banner={banner} p={p} />
        <Who label="Billed to" name={inv.customer_name} address={inv.customer_address} />
        <Lines
          p={p}
          look={look}
          rows={v.lines.map((l) => ({
            title: l.description,
            sub: null,
            code: l.sku,
            qty: l.unit ? `${formatQty(l.qty)} ${l.unit}` : formatQty(l.qty),
            price: money(l.unit_price),
            amount: money(l.line_total),
          }))}
        />
        <Totals rows={totals} p={p} look={look} />
        <List
          title="Payments received"
          items={v.payments.map((x) => ({
            key: x.id,
            main: dayText(x.paid_on),
            sub: [PAYMENT_METHODS[x.method] ?? x.method, x.reference].filter(Boolean).join(", "),
            amount: money(x.amount),
          }))}
        />
        <List
          title="Credit notes"
          items={v.credit_notes.map((c) => ({
            key: c.id,
            main: `${c.credit_number}, ${dayText(c.issue_date)}`,
            sub: c.reason,
            amount: money(-c.total),
          }))}
        />
        {v.outstanding > 0 && <HowToPay details={seller.bankDetails} reference={inv.invoice_number} />}
        {lines(inv.footer) && <p className="text-sm whitespace-pre-line text-neutral-700">{lines(inv.footer)}</p>}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ quote

function discountText(l: QuoteView["lines"][number], money: (n: number) => string): string | null {
  if (l.discount_amount > 0) return `${money(l.discount_amount)} off the line, list price ${money(l.list_price)}`;
  if (l.discount_pct > 0) return `${l.discount_pct}% off, list price ${money(l.list_price)}`;
  return null;
}

function Quote({ v, logo, today, look, p }: { v: QuoteView; logo: string | null; today: string; look: PdfLook; p: Palette }) {
  const q = v.quote;
  const money = moneyIn(v.look.currency);
  const seller = sellerOf(v);
  const banner = quoteBanner(q, today);
  const meta: [string, string][] = [["Date", dayText(q.created_at.slice(0, 10))]];
  if (q.valid_until) meta.push(["Valid until", dayText(q.valid_until)]);
  const rate = Number(q.vat_rate);
  const totals: Total[] = rate === 0 ? [["Total", money(v.total)]] : [["Subtotal (excl. VAT)", money(v.subtotal)], [vatLabel(rate, q.prices_include_vat), money(v.vat)], ["Total", money(v.total)]];
  return (
    <>
      <Masthead look={look} p={p} seller={seller} logo={logo} heading="Quote" number={q.quote_number} meta={meta} />
      <div className="space-y-6 px-5 pt-6 pb-8 sm:px-8">
        {banner && <BannerBox banner={banner} p={p} />}
        <Who label="Quote for" name={v.customer_name ?? ""} address={v.customer_address} />
        <Lines
          p={p}
          look={look}
          rows={v.lines.map((l) => ({
            title: l.description,
            sub: discountText(l, money),
            code: l.sku,
            qty: l.unit ? `${formatQty(l.qty)} ${l.unit}` : formatQty(l.qty),
            price: money(l.unit_price),
            amount: money(lineTotal(l.qty, l.unit_price)),
          }))}
        />
        <Totals rows={totals} p={p} look={look} />
        {lines(q.notes) && (
          <Block title="Notes">
            <p className="text-sm whitespace-pre-line text-neutral-800">{lines(q.notes)}</p>
          </Block>
        )}
        <HowToPay details={seller.bankDetails} reference={q.quote_number} />
      </div>
    </>
  );
}

// -------------------------------------------------------------- statement

function Statement({ v, logo, look, p }: { v: StatementView; logo: string | null; look: PdfLook; p: Palette }) {
  const s = v.statement;
  const money = moneyIn(v.look.currency);
  const seller = sellerOf(v);
  const closing = statementClosing(s.rows);
  const { opening, moves } = statementParts(s.rows);
  const banner = statementBanner(closing, s.to, money);
  const ageing = ageingParts(s.ageing);
  const label = (r: (typeof moves)[number]) => {
    const kind = STATEMENT_KIND_LABELS[r.entry_kind] ?? r.entry_kind;
    if (!r.document_number) return kind;
    return r.entry_kind === "payment" ? `${kind} for ${r.document_number}` : `${kind} ${r.document_number}`;
  };
  const head =
    look.style === "bold"
      ? { background: p.primary, color: p.onPrimary }
      : look.style === "clean"
        ? { color: p.text, borderBottom: `1px solid ${p.text}` }
        : { background: "rgb(30 41 59)", color: "rgb(255 255 255)" };
  return (
    <>
      <Masthead look={look} p={p} seller={seller} logo={logo} heading="Statement" number={null} meta={[["Period", periodText(s.from, s.to)]]} />
      <div className="space-y-6 px-5 pt-6 pb-8 sm:px-8">
        <BannerBox banner={banner} p={p} />
        <Who label="Statement for" name={s.client_name} address={s.client_address} />

        <section aria-label="Account">
          <p className="flex justify-between gap-4 border-b border-neutral-200 py-2 text-sm">
            <span className="text-neutral-600">Balance brought forward</span>
            <span className="font-medium tabular-nums text-neutral-900">{money(opening)}</span>
          </p>
          {moves.length === 0 ? (
            <p className="border-b border-neutral-200 py-3 text-sm text-neutral-600">Nothing happened on the account in this period.</p>
          ) : (
            <>
              <ul className="divide-y divide-neutral-200 border-b border-neutral-200 sm:hidden">
                {moves.map((r, i) => (
                  <li key={i} className="flex items-start justify-between gap-4 py-3">
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-xs tabular-nums text-neutral-600">{dayText(r.entry_date)}</p>
                      <p className="text-sm font-medium break-words text-neutral-900">{label(r)}</p>
                      {statementDetail(r) && <p className="text-xs break-words text-neutral-600">{statementDetail(r)}</p>}
                    </div>
                    <div className="shrink-0 text-right tabular-nums">
                      <p className="text-sm font-semibold text-neutral-900">{r.debit !== null ? money(r.debit) : money(-(r.credit ?? 0))}</p>
                      <p className="text-xs text-neutral-600">Balance {money(r.balance)}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <table className="hidden w-full text-sm sm:table">
                <thead>
                  <tr className="text-left text-xs font-semibold" style={head}>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Details</th>
                    <th className="px-3 py-2 text-right">Charged</th>
                    <th className="px-3 py-2 text-right">Paid or credited</th>
                    <th className="px-3 py-2 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {moves.map((r, i) => (
                    <tr key={i} className="border-b border-neutral-200" style={look.style === "bold" && i % 2 === 1 ? { background: p.wash } : undefined}>
                      <td className="px-3 py-2.5 align-top whitespace-nowrap tabular-nums text-neutral-900">{dayText(r.entry_date)}</td>
                      <td className="px-3 py-2.5 align-top text-neutral-900">
                        <span className="break-words">{label(r)}</span>
                        {statementDetail(r) && <span className="block text-xs break-words text-neutral-600">{statementDetail(r)}</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right align-top tabular-nums text-neutral-900">{r.debit !== null && r.debit !== 0 ? money(r.debit) : ""}</td>
                      <td className="px-3 py-2.5 text-right align-top tabular-nums text-neutral-900">{r.credit !== null && r.credit !== 0 ? money(r.credit) : ""}</td>
                      <td className="px-3 py-2.5 text-right align-top font-medium tabular-nums text-neutral-900">{money(r.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>

        <Totals rows={[[`Balance at ${dayText(s.to)}`, money(closing)]]} p={p} look={look} />

        {ageing.length > 0 && (
          <Block title="What is owed, by age">
            <dl className="divide-y divide-neutral-200 border-y border-neutral-200 text-sm">
              {ageing.map((w) => (
                <div key={w.key} className="flex justify-between gap-4 py-2">
                  <dt className="text-neutral-700">{w.label}</dt>
                  <dd className={`font-semibold tabular-nums ${w.key === "not_due" ? "text-neutral-900" : "text-red-800"}`}>{money(w.amount)}</dd>
                </div>
              ))}
            </dl>
          </Block>
        )}

        {closing > 0 && <HowToPay details={seller.bankDetails} reference="the number of the invoice you are paying" />}
      </div>
    </>
  );
}

// ------------------------------------------------------------------- page

export function ClientDocument({ v, logo, today }: { v: DocumentView; logo: string | null; today: string }) {
  const look = documentLook(v.look);
  const p = palette(look);
  const seller = sellerOf(v);
  const contact = [seller.phone, seller.email].filter(Boolean).join(", ");
  return (
    <main className="min-h-dvh bg-secondary/40 px-4 py-6 sm:py-10 print:bg-white print:p-0">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div className="flex justify-end">
          <DownloadPdfButton view={v} />
        </div>
        <article className="overflow-hidden rounded-xl bg-white text-neutral-900 ring-1 ring-foreground/10 print:rounded-none print:ring-0">
          {v.kind === "invoice" ? (
            <Invoice v={v} logo={logo} today={today} look={look} p={p} />
          ) : v.kind === "quote" ? (
            <Quote v={v} logo={logo} today={today} look={look} p={p} />
          ) : (
            <Statement v={v} logo={logo} look={look} p={p} />
          )}
        </article>
        <footer className="pb-6 text-center text-xs text-muted-foreground print:hidden">
          {seller.name}
          {contact ? `, ${contact}` : ""}. Sent with Tickd.
        </footer>
      </div>
    </main>
  );
}
