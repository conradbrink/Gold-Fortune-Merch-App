"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { logoUrl } from "@/lib/branding";
import { refreshCompanyConfig, useCompanyConfig } from "@/lib/use-company-config";
import { brandText, DOCUMENT_STYLES, hexToRgb, readableOn, tint, wash, type DocumentStyle, type Rgb } from "@/lib/document-style";
import { todayIn } from "@/lib/client-document";
import { invoiceStatus, paperDate, paperLines, paperMoney, previewMoneyPdf, termsText, vatRows } from "@/lib/money-pdf";
import { cn } from "@/lib/utils";

const STYLE_WORDS: Record<DocumentStyle, { name: string; blurb: string }> = {
  classic: { name: "Classic", blurb: "Like a QuickBooks invoice: your logo on the right and your colour in a light band." },
  bold: { name: "Bold", blurb: "Your logo and the heading in a band of your brand colour, and the amount due on it too." },
  clean: { name: "Clean", blurb: "Your logo and name in the middle, thin lines in your colour and plenty of white space." },
};

const rgb = (c: Rgb) => `rgb(${c[0]} ${c[1]} ${c[2]})`;

/** A small drawing of an invoice in each look, in the company's own colours: heading, who it is for, the lines, the total. */
function StyleMock({ style, primary, accent, logo }: { style: DocumentStyle; primary: string; accent: string; logo: string | null }) {
  const p = hexToRgb(primary);
  const text = rgb(brandText(p));
  const line = "h-[3px] rounded-full bg-neutral-300";
  const mark = logo ? (
    // A plain <img>, as the sidebar does: the logo is a public file in the branding bucket.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={logo} alt="" className="h-6 w-auto max-w-[60px] object-contain" />
  ) : (
    <div className="h-6 w-6 rounded-sm bg-neutral-200" />
  );
  return (
    <div
      aria-hidden="true"
      className="relative mx-auto aspect-[3/4] w-full max-w-[220px] overflow-hidden rounded-md bg-white text-[0px] shadow-sm ring-1 ring-foreground/10 sm:max-w-none"
    >
      {style === "classic" && (
        <div className="flex items-start justify-between px-3 pt-3">
          <div className="space-y-1">
            <div className="h-2 w-12 rounded-full" style={{ background: text }} />
            <div className={`${line} w-14`} />
            <div className={`${line} w-10`} />
          </div>
          {mark}
        </div>
      )}
      {style === "bold" && (
        <>
          <div className="flex h-[17%] items-center justify-between px-3" style={{ background: primary }}>
            <div className="rounded-sm bg-white p-0.5">{mark}</div>
            <div className="h-2 w-10 rounded-full" style={{ background: rgb(readableOn(p)) }} />
          </div>
          <div className="h-[3px]" style={{ background: accent }} />
          <div className="space-y-1 px-3 pt-2">
            <div className={`${line} w-14`} />
            <div className={`${line} w-10`} />
          </div>
        </>
      )}
      {style === "clean" && (
        <div className="flex flex-col items-center gap-1 px-3 pt-3">
          {mark}
          <div className={`${line} w-16`} />
          <div className="mt-1 h-[1.5px] w-full" style={{ background: text }} />
          <div className="mt-1 self-start h-2 w-14 rounded-full" style={{ background: text, opacity: 0.85 }} />
        </div>
      )}
      <div className={cn("mt-2 space-y-1 px-3 py-2", style === "clean" && "py-1")} style={style === "clean" ? undefined : { background: rgb(wash(p)) }}>
        <div className="h-[4px] w-16 rounded-full" style={{ background: text }} />
        <div className={`${line} w-12`} />
        <div className="!mt-1.5 border-t border-dashed border-neutral-300" />
        <div className={`${line} w-14`} />
      </div>
      <div className="mt-2 px-3">
        <div
          className="h-2"
          style={style === "bold" ? { background: primary } : style === "clean" ? { borderBottom: `1.5px solid ${text}` } : { borderBottom: "1px solid #e5e5e5" }}
        />
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-2"
            style={style === "bold" ? { background: i % 2 === 1 ? rgb(tint(p, 0.95)) : "transparent" } : { borderBottom: "1px solid #e5e5e5" }}
          />
        ))}
      </div>
      <div className="absolute inset-x-3 bottom-3 flex flex-col items-end gap-1.5">
        {style === "bold" && <div className="h-4 w-20 rounded-sm" style={{ background: primary }} />}
        {style === "classic" && <div className="h-2 w-14 rounded-full bg-neutral-700" />}
        {style === "clean" && <div className="h-2.5 w-14 rounded-full" style={{ background: text }} />}
        <div className="h-1.5 w-9 rounded-full" style={{ background: "rgb(196 78 8)" }} />
      </div>
    </div>
  );
}

/**
 * The look of the company's invoices, credit notes, quotes and statements:
 * one layout, dressed three ways, shown in the company's own colours and logo,
 * and a preview of the chosen one as a real PDF before anything is saved.
 */
export function DocumentStyleCard({ orgId, canEdit }: { orgId: string; canEdit: boolean }) {
  const config = useCompanyConfig();
  const [draft, setDraft] = useState<DocumentStyle | null>(null);
  const [busy, setBusy] = useState<"save" | "preview" | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!config) return null;
  const current = config.settings.document_style;
  const chosen = draft ?? current;
  const { primary, accent } = config.branding;
  const logo = process.env.NEXT_PUBLIC_SUPABASE_URL ? logoUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, config.branding.logoPath) : null;

  async function save() {
    setBusy("save");
    setError(null);
    const { error: e } = await createClient()
      .from("company_settings")
      .upsert([{ org_id: orgId, key: "document_style", value: chosen }], { onConflict: "org_id,key" });
    setBusy(null);
    if (e) return setError(`Not saved: ${e.message}`);
    refreshCompanyConfig();
    setDraft(null);
    setSaved(true);
  }

  async function preview() {
    if (!config) return;
    setBusy("preview");
    setError(null);
    try {
      const { data, error: e } = await createClient()
        .from("organizations")
        .select("name, legal_name, address, tax_number, vat_number, registration_number, phone, support_email, logo_path, bank_details, invoice_footer, invoice_terms_days")
        .limit(1)
        .single();
      if (e) throw new Error(e.message);
      const o = data;
      const today = todayIn(config.timezone);
      const due = new Date(`${today}T12:00:00Z`);
      due.setUTCDate(due.getUTCDate() + (o.invoice_terms_days ?? 30));
      const dueDate = due.toISOString().slice(0, 10);
      const fmt = paperMoney({ currency: config.settings.currency_code, today });
      const rate = config.vatRate;
      const lines = [
        { description: "Sample product, box of 10", qty: 2, price: 250 },
        { description: "Sample product, single", qty: 1, price: 180 },
        { description: "Delivery", qty: 1, price: 95 },
      ];
      const subtotal = lines.reduce((n, l) => n + l.qty * l.price, 0);
      const vat = Math.round(subtotal * rate) / 100;
      await previewMoneyPdf({
        heading: rate > 0 ? "TAX INVOICE" : "INVOICE",
        fileName: "Sample invoice",
        seller: {
          name: o.legal_name || o.name,
          address: o.address,
          registrationNumber: o.registration_number,
          taxNumber: o.tax_number,
          vatNumber: o.vat_number,
          phone: o.phone,
          email: o.support_email,
          logoPath: o.logo_path,
        },
        metaTitle: "Invoice details",
        meta: [
          ["Invoice no.", "SAMPLE-0001"],
          ["Terms", termsText(today, dueDate)],
          ["Invoice date", paperDate(today)],
          ["Due date", paperDate(dueDate)],
        ],
        billTo: { label: "Bill to", name: "Sample client", address: "12 Example Street", email: "accounts@example.com" },
        ...paperLines(
          lines.map((l) => ({ description: l.description, qty: String(l.qty), rate: fmt(l.price), amount: fmt(l.qty * l.price) })),
          rate > 0
        ),
        totals: [...vatRows(rate, false, subtotal, vat, fmt), ["Total", fmt(subtotal + vat)]],
        status: invoiceStatus({ status: "issued", due_date: dueDate }, { outstanding: subtotal + vat, paid: 0 }, today),
        footer: o.invoice_footer,
        payTo: o.bank_details,
        look: { style: chosen, primary, accent },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">How your documents look</CardTitle>
        <CardDescription className="text-pretty">
          Pick the look of your invoices, credit notes, quotes and statements. All three have the same layout, with your
          logo, your company details and your brand colour, which you can change under Branding.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div role="radiogroup" aria-label="Document style" className="grid gap-4 sm:grid-cols-3">
          {DOCUMENT_STYLES.map((style) => {
            const on = chosen === style;
            return (
              <label
                key={style}
                className={cn(
                  "flex cursor-pointer flex-col gap-3 rounded-xl p-3 ring-1 transition-shadow",
                  on ? "ring-2 ring-primary" : "ring-foreground/10 hover:ring-foreground/25",
                  !canEdit && "cursor-default opacity-80"
                )}
              >
                <input
                  type="radio"
                  name="document-style"
                  value={style}
                  checked={on}
                  disabled={!canEdit}
                  onChange={() => {
                    setSaved(false);
                    setDraft(style);
                  }}
                  className="sr-only"
                />
                <StyleMock style={style} primary={primary} accent={accent} logo={logo} />
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    {STYLE_WORDS[style].name}
                    {style === current && <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-normal text-muted-foreground">In use</span>}
                  </span>
                  <span className="mt-0.5 block text-xs text-pretty text-muted-foreground">{STYLE_WORDS[style].blurb}</span>
                </span>
              </label>
            );
          })}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={busy !== null} onClick={preview}>
            {busy === "preview" ? "Opening…" : "See a sample invoice"}
          </Button>
          {canEdit && (
            <Button disabled={busy !== null || chosen === current} onClick={save}>
              {busy === "save" ? "Saving…" : "Use this look"}
            </Button>
          )}
          {saved && <span className="text-sm text-muted-foreground">Saved. Your next document uses it.</span>}
        </div>
      </CardContent>
    </Card>
  );
}
