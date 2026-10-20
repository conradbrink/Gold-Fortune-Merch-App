import type { ReactNode } from "react";
import { CircleCheck, Clock, Info, TriangleAlert } from "lucide-react";
import { brandText, hexToRgb, mix, readableOn, tint, wash, type DocumentStyle, type PdfLook, type Rgb } from "@/lib/document-style";
import {
  documentLook,
  invoiceBanner,
  moneyIn,
  quoteBanner,
  sellerOf,
  statementBanner,
  statementClosing,
  statementParts,
  type Banner,
  type DocumentView,
  type InvoiceView,
  type QuoteView,
  type StatementView,
} from "@/lib/client-document";
import { invoiceViewPdfSpec, quoteViewPdfSpec, statementViewPdfSpec } from "@/lib/client-document-pdf";
import { paperDate, type PdfSpec, type PdfStatus } from "@/lib/money-pdf";
import { PAYMENT_METHODS } from "@/lib/invoices";
import { formatQty, lineTotal } from "@/lib/money-docs";
import { statementActivity, statementDetail } from "@/lib/owed";
import { DownloadPdfButton } from "@/components/client-document/download-pdf-button";

/**
 * The client's view of an invoice, a quote or a statement (Stage 8.10), from
 * what `document_link_view()` returns. Rendered by /c/doc/[token];
 * presentational, so it can be checked with example data.
 *
 * It reads as the paper document does, from the same spec the PDF is drawn
 * from and in the company's look: the heading and the company at the top, who
 * it is for and the document's numbers, the lines, then a note to the customer
 * beside the totals. `classic` puts who it is for on a light band of the brand
 * colour; `bold` the heading in a band of it, the table's heading and the
 * amount due on it too; `clean` centres the letterhead and keeps to thin
 * lines. Above the paper, a banner says in words what the client owes or what
 * the quote is. The paper is always light, so the company's colours mean what
 * they mean on its PDF whatever the reader's theme.
 */

const css = (c: Rgb) => `rgb(${c[0]} ${c[1]} ${c[2]})`;

function palette(look: PdfLook) {
  const primary = hexToRgb(look.primary);
  const band = wash(primary);
  return {
    style: look.style as DocumentStyle,
    primary: look.primary,
    accent: look.accent,
    onPrimary: css(readableOn(primary)),
    /** The company's colour as text on white and on its band. */
    text: css(brandText(primary)),
    wash: css(band),
    stripe: css(tint(primary, 0.95)),
    rule: css(mix(band, [33, 33, 33], 0.2)),
  };
}
type Palette = ReturnType<typeof palette>;

const lines = (s: string | null | undefined) => (s ?? "").trim();

// ------------------------------------------------------------ the letterhead

/** The company's name, address and numbers, and how to reach it in a column beside them. */
function SellerColumns({ spec, withName }: { spec: PdfSpec; withName: boolean }) {
  const s = spec.seller;
  const numbers = [
    s.vatNumber && `VAT no: ${s.vatNumber}`,
    s.taxNumber && `TIN: ${s.taxNumber}`,
    s.registrationNumber && `Reg no: ${s.registrationNumber}`,
  ].filter(Boolean) as string[];
  const contact = [s.email, s.phone].filter(Boolean) as string[];
  return (
    <div className="grid gap-x-10 gap-y-2 text-xs text-neutral-600 sm:grid-cols-[minmax(0,15rem)_auto]">
      <div className="space-y-0.5">
        {withName && <p className="font-semibold break-words text-neutral-900">{s.name}</p>}
        {lines(s.address) && <p className="whitespace-pre-line">{lines(s.address)}</p>}
        {numbers.map((n) => (
          <p key={n} className="break-words">
            {n}
          </p>
        ))}
      </div>
      {contact.length > 0 && (
        <div className="space-y-0.5">
          {contact.map((c) => (
            <p key={c} className="break-words">
              {c}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function Logo({ src, className }: { src: string | null; className: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="" className={className} /> : null;
}

function Masthead({ p, spec, logo }: { p: Palette; spec: PdfSpec; logo: string | null }) {
  const s = spec.seller;
  if (p.style === "bold") {
    return (
      <header>
        <div className="flex items-center justify-between gap-4 px-5 py-5 sm:px-8 sm:py-6" style={{ background: p.primary, color: p.onPrimary }}>
          {logo ? (
            <span className="inline-flex shrink-0 rounded-md bg-white p-2">
              <Logo src={logo} className="h-10 w-auto max-w-36 object-contain" />
            </span>
          ) : (
            <p className="min-w-0 text-lg font-bold text-balance break-words">{s.name}</p>
          )}
          <h1 className="text-right text-xl font-bold tracking-[0.04em] text-balance sm:text-2xl">{spec.heading}</h1>
        </div>
        <div className="h-1" style={{ background: p.accent }} />
        <div className="px-5 py-6 sm:px-8">
          <SellerColumns spec={spec} withName={!!logo} />
        </div>
      </header>
    );
  }
  if (p.style === "clean") {
    const numbers = [
      s.vatNumber && `VAT no: ${s.vatNumber}`,
      s.taxNumber && `TIN: ${s.taxNumber}`,
      s.registrationNumber && `Reg no: ${s.registrationNumber}`,
    ].filter(Boolean) as string[];
    const contact = [s.email, s.phone].filter(Boolean) as string[];
    return (
      <header className="px-5 pt-8 sm:px-8">
        <div className="flex flex-col items-center gap-1.5 text-center">
          <Logo src={logo} className="mb-1 h-14 w-auto max-w-44 object-contain" />
          <p className="text-base font-semibold text-balance text-neutral-900">{s.name}</p>
          <div className="space-y-0.5 text-xs text-neutral-600">
            {lines(s.address) && <p className="text-balance">{lines(s.address).split(/\s*\n\s*/).join(", ")}</p>}
            {numbers.length > 0 && <p>{numbers.join("  ·  ")}</p>}
            {contact.length > 0 && <p className="break-words">{contact.join("  ·  ")}</p>}
          </div>
        </div>
        <div className="mt-5 h-px" style={{ background: p.text }} />
        <h1 className="pt-7 text-xl font-light tracking-[0.18em] text-balance sm:text-2xl" style={{ color: p.text }}>
          {spec.heading}
        </h1>
      </header>
    );
  }
  return (
    <header className="flex items-start justify-between gap-6 px-5 pt-6 pb-6 sm:px-8 sm:pt-8">
      <div className="min-w-0 space-y-3">
        <h1 className="text-lg font-bold tracking-[0.06em] text-balance" style={{ color: p.text }}>
          {spec.heading}
        </h1>
        <SellerColumns spec={spec} withName />
      </div>
      <Logo src={logo} className="h-16 w-auto max-w-32 shrink-0 object-contain sm:h-20 sm:max-w-40" />
    </header>
  );
}

/** Who it is for, where it goes, and the document's numbers and dates, on the band. */
function Band({ p, spec }: { p: Palette; spec: PdfSpec }) {
  const bill = [lines(spec.billTo.address), lines(spec.billTo.email)].filter(Boolean).join("\n");
  const ship = lines(spec.shipTo?.address);
  return (
    <section className={p.style === "clean" ? "px-5 pt-4 pb-2 sm:px-8" : "px-5 py-6 sm:px-8"} style={p.style === "clean" ? undefined : { background: p.wash }}>
      <div className="grid gap-4 sm:grid-cols-[11fr_9fr]">
        <div className="min-w-0">
          <p className="text-lg break-words" style={{ color: p.text }}>
            {spec.billTo.name}
          </p>
          {bill && (
            <>
              <p className="mt-0.5 text-xs font-semibold text-neutral-900">{spec.billTo.label ?? "Bill to"}</p>
              <p className="text-sm break-words whitespace-pre-line text-neutral-700">{bill}</p>
            </>
          )}
        </div>
        {ship && (
          <div className="min-w-0 sm:pt-7">
            <p className="text-xs font-semibold text-neutral-900">{spec.shipTo?.label ?? "Ship to"}</p>
            <p className="text-sm break-words whitespace-pre-line text-neutral-700">{ship}</p>
          </div>
        )}
      </div>
      <div className="my-5 border-t border-dashed" style={{ borderColor: p.style === "clean" ? "rgb(218 218 218)" : p.rule }} />
      <h2 className="text-xs font-semibold text-neutral-900">{spec.metaTitle ?? "Details"}</h2>
      <ul className={`mt-1.5 space-y-0.5 text-sm text-neutral-700 ${spec.meta.length > 5 ? "sm:columns-2" : ""}`}>
        {spec.meta.map(([k, v]) => (
          <li key={k}>
            {k}: <span className="tabular-nums">{v}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ----------------------------------------------------------------- pieces

const TONES: Record<Banner["tone"], { icon: typeof Clock; box: string }> = {
  paid: { icon: CircleCheck, box: "bg-emerald-50 text-emerald-900 ring-emerald-200" },
  overdue: { icon: TriangleAlert, box: "bg-red-50 text-red-900 ring-red-200" },
  ended: { icon: Info, box: "bg-neutral-100 text-neutral-800 ring-neutral-200" },
  due: { icon: Clock, box: "bg-white text-neutral-900 ring-foreground/10" },
  info: { icon: Clock, box: "bg-white text-neutral-900 ring-foreground/10" },
};

function BannerBox({ banner }: { banner: Banner }) {
  const tone = TONES[banner.tone];
  const Icon = tone.icon;
  return (
    <div role="status" className={`flex items-start gap-3 rounded-xl px-4 py-3 ring-1 ${tone.box}`}>
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

type Row = { title: string; sub: string | null; code: string | null; qty: string; price: string; amount: string };

/** The table's heading and rows in the company's look: plain (classic), on the brand colour with stripes (bold), under a rule of it (clean). */
function tableLook(p: Palette) {
  if (p.style === "bold") {
    return {
      th: "font-semibold",
      headRow: "",
      head: { background: p.primary, color: p.onPrimary },
      row: "",
      stripe: (i: number) => (i % 2 === 1 ? { background: p.stripe } : undefined),
      edge: "pl-2",
      edgeRight: "pr-2",
    };
  }
  return {
    th: p.style === "clean" ? "text-xs font-semibold" : "font-normal",
    headRow: p.style === "clean" ? "border-b" : "border-b border-neutral-200 text-neutral-900",
    head: p.style === "clean" ? { color: p.text, borderColor: p.text } : undefined,
    row: "border-b border-neutral-200",
    stripe: () => undefined,
    edge: "pl-0",
    edgeRight: "pr-0",
  };
}

/** The lines: stacked on a phone, a table from a tablet up, numbered as on the paper. */
function Lines({ rows, taxed, p }: { rows: Row[]; taxed: boolean; p: Palette }) {
  const hasCode = rows.some((r) => r.code);
  const look = tableLook(p);
  const th = `px-2 py-2.5 whitespace-nowrap ${look.th}`;
  const td = "px-2 py-3 align-top";
  return (
    <section aria-label="Lines">
      <ul className="divide-y divide-neutral-200 border-y border-neutral-200 sm:hidden">
        {rows.map((r, i) => (
          <li key={i} className="flex items-start justify-between gap-4 py-3">
            <div className="min-w-0 space-y-0.5">
              {r.code && <p className="text-sm font-semibold break-words text-neutral-900">{r.code}</p>}
              <p className={`text-sm break-words text-neutral-900 ${r.code ? "" : "font-medium"}`}>{r.title}</p>
              {r.sub && <p className="text-xs text-neutral-600">{r.sub}</p>}
              <p className="text-xs text-neutral-600 tabular-nums">
                {r.qty} at {r.price}
                {taxed ? ", VAT" : ""}
              </p>
            </div>
            <p className="shrink-0 text-sm font-semibold tabular-nums text-neutral-900">{r.amount}</p>
          </li>
        ))}
      </ul>
      <table className="hidden w-full text-sm sm:table">
        <thead>
          <tr className={`text-left ${look.headRow}`} style={look.head}>
            <th className={`${th} w-8 ${look.edge}`}>#</th>
            <th className={th}>Product or service</th>
            {hasCode && <th className={th}>Description</th>}
            <th className={`${th} text-right`}>Qty</th>
            <th className={`${th} text-right`}>Rate</th>
            <th className={`${th} text-right`}>Amount</th>
            {taxed && <th className={`${th} text-right ${look.edgeRight}`}>Tax</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={`text-neutral-900 ${look.row}`} style={look.stripe(i)}>
              <td className={`${td} ${look.edge} text-xs text-neutral-600 tabular-nums`}>{i + 1}.</td>
              {hasCode ? (
                <>
                  <td className={`${td} font-semibold break-words`}>{r.code}</td>
                  <td className={td}>
                    <span className="break-words">{r.title}</span>
                    {r.sub && <span className="block text-xs text-neutral-600">{r.sub}</span>}
                  </td>
                </>
              ) : (
                <td className={td}>
                  <span className="break-words">{r.title}</span>
                  {r.sub && <span className="block text-xs text-neutral-600">{r.sub}</span>}
                </td>
              )}
              <td className={`${td} text-right whitespace-nowrap tabular-nums`}>{r.qty}</td>
              <td className={`${td} text-right whitespace-nowrap tabular-nums`}>{r.price}</td>
              <td className={`${td} text-right whitespace-nowrap tabular-nums`}>{r.amount}</td>
              {taxed && <td className={`${td} text-right ${look.edgeRight}`}>VAT</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

const STATUS_COLOUR: Record<PdfStatus["tone"], string> = {
  overdue: "rgb(196 78 8)",
  due: "rgb(23 23 23)",
  paid: "rgb(21 128 61)",
  void: "rgb(185 28 28)",
};

/** The amounts on the right, as on the paper: VAT small, the amount to pay large, then whether it is paid. */
function Totals({ spec, p }: { spec: Pick<PdfSpec, "totals" | "status">; p: Palette }) {
  const last = spec.totals.length - 1;
  return (
    <dl className="w-full text-sm">
      {spec.totals.map(([k, v, strong], i) =>
        i < last ? (
          <div key={k} className={`flex justify-between gap-4 py-1 ${strong ? "mt-2 border-t border-neutral-200 pt-3 font-semibold" : ""}`}>
            <dt className={strong ? "text-neutral-900" : "text-neutral-600"}>{k}</dt>
            <dd className="tabular-nums text-neutral-900">{v}</dd>
          </div>
        ) : p.style === "bold" ? (
          <div key={k} className="my-2 flex items-center justify-between gap-4 rounded-md px-3 py-2.5" style={{ background: p.primary, color: p.onPrimary }}>
            <dt className="font-semibold">{k}</dt>
            <dd className="text-xl font-bold tabular-nums">{v}</dd>
          </div>
        ) : p.style === "clean" ? (
          <div key={k} className={`flex items-baseline justify-between gap-4 py-3 ${last > 0 ? "mt-2 border-t" : ""}`} style={{ borderColor: p.text }}>
            <dt className="text-neutral-600">{k}</dt>
            <dd className="text-2xl font-bold tabular-nums" style={{ color: p.text }}>
              {v}
            </dd>
          </div>
        ) : (
          <div key={k} className={`flex items-baseline justify-between gap-4 py-3 ${last > 0 ? "mt-2 border-t border-neutral-200" : ""}`}>
            <dt className="font-semibold text-neutral-900">{k}</dt>
            <dd className="text-2xl font-bold tabular-nums text-neutral-900">{v}</dd>
          </div>
        )
      )}
      {spec.status && (
        <div className="flex items-baseline justify-between gap-4 border-t border-neutral-200 pt-3">
          <dt className="text-base font-bold" style={{ color: STATUS_COLOUR[spec.status.tone] }}>
            {spec.status.label}
          </dt>
          {spec.status.detail && <dd className="tabular-nums text-neutral-600">{spec.status.detail}</dd>}
        </div>
      )}
    </dl>
  );
}

/** Under the lines: the note to the customer on the left, the totals on the right. */
function Bottom({ spec, notes, p }: { spec: Pick<PdfSpec, "totals" | "status">; notes: string[]; p: Palette }) {
  const said = notes.map(lines).filter(Boolean);
  return (
    <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,17rem)] sm:gap-10">
      <div className="order-2 min-w-0 space-y-1 sm:order-1 sm:pt-3 sm:pl-8">
        {said.length > 0 && (
          <>
            <h2 className="text-base text-neutral-900" style={p.style === "classic" ? undefined : { color: p.text }}>
              Note to customer
            </h2>
            {said.map((n, i) => (
              <p key={i} className="text-sm break-words whitespace-pre-line text-neutral-700">
                {n}
              </p>
            ))}
          </>
        )}
      </div>
      <div className="order-1 sm:order-2">
        <Totals spec={spec} p={p} />
      </div>
    </div>
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

// ---------------------------------------------------------------- invoice

function Invoice({ v, logo, today, p }: { v: InvoiceView; logo: string | null; today: string; p: Palette }) {
  const inv = v.invoice;
  const money = moneyIn(v.look.currency);
  const seller = sellerOf(v);
  const spec = invoiceViewPdfSpec(v, today);
  return (
    <>
      <Masthead p={p} spec={spec} logo={logo} />
      <Band p={p} spec={spec} />
      <div className="space-y-8 px-5 pt-6 pb-8 sm:px-8">
        <Lines
          p={p}
          taxed={Number(inv.vat_rate) > 0}
          rows={v.lines.map((l) => ({
            title: l.description,
            sub: null,
            code: l.sku,
            qty: l.unit ? `${formatQty(l.qty)} ${l.unit}` : formatQty(l.qty),
            price: money(l.unit_price),
            amount: money(l.line_total),
          }))}
        />
        <Bottom p={p} spec={spec} notes={[...(spec.notes ?? []), spec.footer ?? ""]} />
        <List
          title="Payments received"
          items={v.payments.map((x) => ({
            key: x.id,
            main: paperDate(x.paid_on),
            sub: [PAYMENT_METHODS[x.method] ?? x.method, x.reference].filter(Boolean).join(", "),
            amount: money(x.amount),
          }))}
        />
        <List
          title="Credit notes"
          items={v.credit_notes.map((c) => ({
            key: c.id,
            main: `${c.credit_number}, ${paperDate(c.issue_date)}`,
            sub: c.reason,
            amount: money(-c.total),
          }))}
        />
        {v.outstanding > 0 && <HowToPay details={seller.bankDetails} reference={inv.invoice_number} />}
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

function Quote({ v, logo, today, p }: { v: QuoteView; logo: string | null; today: string; p: Palette }) {
  const q = v.quote;
  const money = moneyIn(v.look.currency);
  const seller = sellerOf(v);
  const spec = quoteViewPdfSpec(v, today);
  return (
    <>
      <Masthead p={p} spec={spec} logo={logo} />
      <Band p={p} spec={spec} />
      <div className="space-y-8 px-5 pt-6 pb-8 sm:px-8">
        <Lines
          p={p}
          taxed={Number(q.vat_rate) > 0}
          rows={v.lines.map((l) => ({
            title: l.description,
            sub: discountText(l, money),
            code: l.sku,
            qty: l.unit ? `${formatQty(l.qty)} ${l.unit}` : formatQty(l.qty),
            price: money(l.unit_price),
            amount: money(lineTotal(l.qty, l.unit_price)),
          }))}
        />
        <Bottom p={p} spec={spec} notes={spec.notes ?? []} />
        <HowToPay details={seller.bankDetails} reference={q.quote_number} />
      </div>
    </>
  );
}

// -------------------------------------------------------------- statement

/** A statement's ageing, as on its PDF: what is owed by how late, in a strip of cells. */
function AgeingStrip({ cells, p }: { cells: [string, string][]; p: Palette }) {
  return (
    <dl
      aria-label="What is owed, by how late"
      className={`grid grid-cols-2 gap-px overflow-hidden sm:grid-cols-5 ${p.style === "clean" ? "border-t border-b border-neutral-200" : "rounded-md"}`}
      style={p.style === "clean" ? { borderTopColor: p.text } : { background: p.wash }}
    >
      {cells.map(([label, value]) => (
        <div key={label} className="px-3 py-2.5">
          <dt className="text-xs text-neutral-600">{label}</dt>
          <dd className="text-sm font-semibold tabular-nums text-neutral-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Statement({ v, logo, today, p }: { v: StatementView; logo: string | null; today: string; p: Palette }) {
  const s = v.statement;
  const money = moneyIn(v.look.currency);
  const seller = sellerOf(v);
  const spec = statementViewPdfSpec(v, today);
  const closing = statementClosing(s.rows);
  const { opening, moves } = statementParts(s.rows);
  const look = tableLook(p);
  const th = `px-2 py-2.5 whitespace-nowrap ${look.th}`;
  return (
    <>
      <Masthead p={p} spec={spec} logo={logo} />
      <Band p={p} spec={spec} />
      <div className="space-y-8 px-5 pt-6 pb-8 sm:px-8">
        <section aria-label="Account">
          {moves.length === 0 ? (
            <>
              <p className="flex justify-between gap-4 border-b border-neutral-200 py-2.5 text-sm">
                <span className="text-neutral-600">Balance brought forward</span>
                <span className="tabular-nums text-neutral-900">{money(opening)}</span>
              </p>
              <p className="border-b border-neutral-200 py-3 text-sm text-neutral-600">Nothing happened on the account in this period.</p>
            </>
          ) : (
            <>
              <ul className="divide-y divide-neutral-200 border-y border-neutral-200 sm:hidden">
                <li className="flex justify-between gap-4 py-3 text-sm">
                  <span className="text-neutral-600">Balance brought forward</span>
                  <span className="tabular-nums text-neutral-900">{money(opening)}</span>
                </li>
                {moves.map((r, i) => (
                  <li key={i} className="flex items-start justify-between gap-4 py-3">
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-xs tabular-nums text-neutral-600">{paperDate(r.entry_date)}</p>
                      <p className="text-sm font-medium break-words text-neutral-900">{statementActivity(r)}</p>
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
                  <tr className={`text-left ${look.headRow}`} style={look.head}>
                    <th className={`${th} ${look.edge}`}>Date</th>
                    <th className={th}>Activity</th>
                    <th className={`${th} text-right`}>Charged</th>
                    <th className={`${th} text-right`}>Paid or credited</th>
                    <th className={`${th} text-right ${look.edgeRight}`}>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {[null, ...moves].map((r, i) => (
                    <tr key={i} className={`text-neutral-900 ${look.row}`} style={look.stripe(i)}>
                      <td className={`px-2 py-3 align-top whitespace-nowrap tabular-nums ${look.edge}`}>{paperDate(r ? r.entry_date : s.from)}</td>
                      <td className="px-2 py-3 align-top">
                        <span className="break-words">{r ? statementActivity(r) : "Balance brought forward"}</span>
                        {r && statementDetail(r) && <span className="block text-xs break-words text-neutral-600">{statementDetail(r)}</span>}
                      </td>
                      <td className="px-2 py-3 text-right align-top tabular-nums">{r && r.debit !== null && r.debit !== 0 ? money(r.debit) : ""}</td>
                      <td className="px-2 py-3 text-right align-top tabular-nums">{r && r.credit !== null && r.credit !== 0 ? money(r.credit) : ""}</td>
                      <td className={`px-2 py-3 text-right align-top tabular-nums ${look.edgeRight}`}>{money(r ? r.balance : opening)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>

        {spec.ageing && <AgeingStrip cells={spec.ageing} p={p} />}

        <Bottom p={p} spec={spec} notes={[]} />

        {closing > 0 && <HowToPay details={seller.bankDetails} reference="the number of the invoice you are paying" />}
      </div>
    </>
  );
}

// ------------------------------------------------------------------- page

/** What the banner above the paper says: what is owed and when, or where a quote stands. */
function bannerOf(v: DocumentView, today: string): Banner | null {
  const money = moneyIn(v.look.currency);
  if (v.kind === "invoice") return invoiceBanner({ outstanding: v.outstanding, due_date: v.invoice.due_date }, today, money);
  if (v.kind === "quote") return quoteBanner(v.quote, today);
  return statementBanner(statementClosing(v.statement.rows), v.statement.to, money);
}

export function ClientDocument({ v, logo, today }: { v: DocumentView; logo: string | null; today: string }) {
  const p = palette(documentLook(v.look));
  const seller = sellerOf(v);
  const contact = [seller.phone, seller.email].filter(Boolean).join(", ");
  const banner = bannerOf(v, today);
  return (
    <main className="min-h-dvh bg-secondary/40 px-4 py-6 sm:py-10 print:bg-white print:p-0">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-start sm:justify-between print:hidden">
          <div className="min-w-0 flex-1">{banner && <BannerBox banner={banner} />}</div>
          <div className="flex justify-end">
            <DownloadPdfButton view={v} />
          </div>
        </div>
        <article className="overflow-hidden rounded-xl bg-white text-neutral-900 ring-1 ring-foreground/10 print:rounded-none print:ring-0">
          {v.kind === "invoice" ? (
            <Invoice v={v} logo={logo} today={today} p={p} />
          ) : v.kind === "quote" ? (
            <Quote v={v} logo={logo} today={today} p={p} />
          ) : (
            <Statement v={v} logo={logo} today={today} p={p} />
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
