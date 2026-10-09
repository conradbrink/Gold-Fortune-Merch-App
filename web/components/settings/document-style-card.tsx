"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { logoUrl } from "@/lib/branding";
import { refreshCompanyConfig, useCompanyConfig } from "@/lib/use-company-config";
import { DOCUMENT_STYLES, hexToRgb, onWhite, readableOn, type DocumentStyle } from "@/lib/document-style";
import { previewMoneyPdf } from "@/lib/money-pdf";
import { cn } from "@/lib/utils";

const STYLE_WORDS: Record<DocumentStyle, { name: string; blurb: string }> = {
  classic: { name: "Classic", blurb: "A dark table heading and plain type. The look you have now." },
  bold: { name: "Bold", blurb: "A band of your brand colour across the top, with your logo and the heading in it." },
  clean: { name: "Clean", blurb: "Your logo and name in the middle, thin lines and plenty of white space." },
};

const rgb = (c: [number, number, number]) => `rgb(${c[0]} ${c[1]} ${c[2]})`;

/** A small drawing of a document in each style, in the company's own colours. */
function StyleMock({ style, primary, accent, logo }: { style: DocumentStyle; primary: string; accent: string; logo: string | null }) {
  const p = hexToRgb(primary);
  const ink = rgb(readableOn(p));
  const line = "h-[3px] rounded-full bg-neutral-300";
  const mark = logo ? (
    // A plain <img>, as the sidebar does: the logo is a public file in the branding bucket.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={logo} alt="" className="h-6 w-auto max-w-[70px] object-contain" />
  ) : (
    <div className="h-5 w-12 rounded-sm bg-neutral-300" />
  );
  return (
    <div
      aria-hidden="true"
      className="relative mx-auto aspect-[3/4] w-full max-w-[220px] overflow-hidden sm:max-w-none rounded-md bg-white text-[0px] shadow-sm ring-1 ring-foreground/10"
    >
      {style === "bold" && (
        <>
          <div className="flex h-[26%] items-start justify-between px-3 pt-3" style={{ background: primary }}>
            <div className="rounded-sm bg-white p-1">{mark}</div>
            <div className="mt-1 h-2 w-10 rounded-full" style={{ background: ink }} />
          </div>
          <div className="h-[3px]" style={{ background: accent }} />
        </>
      )}
      {style === "classic" && (
        <div className="flex items-start justify-between px-3 pt-3">
          <div className="space-y-1">
            {mark}
            <div className="h-[3px] w-14 rounded-full bg-neutral-400" />
          </div>
          <div className="h-2 w-10 rounded-full bg-neutral-700" />
        </div>
      )}
      {style === "clean" && (
        <div className="flex flex-col items-center gap-1 px-3 pt-3">
          {mark}
          <div className="h-[3px] w-20 rounded-full bg-neutral-400" />
          <div className="mt-1 h-[1.5px] w-full" style={{ background: rgb(onWhite(p)) }} />
          <div className="mt-1 self-start h-2.5 w-14 rounded-full" style={{ background: rgb(onWhite(p)), opacity: 0.85 }} />
        </div>
      )}
      <div className={cn("space-y-1 px-3", style === "bold" ? "pt-3" : "pt-3")}>
        <div className={cn(line, "w-16")} />
        <div className={cn(line, "w-12")} />
      </div>
      <div className="mt-3 space-y-px px-3">
        <div
          className="h-2"
          style={style === "classic" ? { background: "#1e293b" } : style === "bold" ? { background: primary } : { borderBottom: `1.5px solid ${rgb(onWhite(p))}` }}
        />
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-2"
            style={
              style === "bold"
                ? { background: i % 2 === 0 ? "#f1f1f1" : "transparent" }
                : style === "classic"
                  ? { background: i % 2 === 0 ? "#f5f5f5" : "transparent" }
                  : { borderBottom: "1px solid #e5e5e5" }
            }
          />
        ))}
      </div>
      <div className="absolute inset-x-3 bottom-3 flex justify-end">
        {style === "bold" && <div className="h-4 w-20 rounded-sm" style={{ background: primary }} />}
        {style === "classic" && <div className="h-2 w-16 rounded-full bg-neutral-700" />}
        {style === "clean" && <div className="h-4 w-16 rounded-sm" style={{ background: rgb(onWhite(p)), opacity: 0.85 }} />}
      </div>
    </div>
  );
}

/**
 * The look of the company's invoices, credit notes, quotes and statements:
 * three to choose from, shown in the company's own colours and logo, and a
 * preview of the chosen one as a real PDF before anything is saved.
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
    setBusy("preview");
    setError(null);
    try {
      const { data, error: e } = await createClient()
        .from("organizations")
        .select("name, legal_name, address, tax_number, vat_number, registration_number, phone, support_email, logo_path, bank_details")
        .limit(1)
        .single();
      if (e) throw new Error(e.message);
      const o = data;
      await previewMoneyPdf({
        heading: "INVOICE",
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
        meta: [
          ["Invoice no", "SAMPLE-0001"],
          ["Date", new Date().toISOString().slice(0, 10)],
        ],
        billTo: { name: "Sample client", address: "12 Example Street", email: "client@example.com" },
        head: ["Description", "Qty", "Price", "Total"],
        rows: [
          ["Sample line one", "2", "250.00", "500.00"],
          ["Sample line two", "1", "180.00", "180.00"],
          ["Sample line three", "3", "95.00", "285.00"],
        ],
        numeric: [1, 2, 3],
        totals: [
          ["Subtotal", "965.00"],
          ["Total due", "965.00"],
        ],
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
          Pick the look of your invoices, credit notes, quotes and statements. They all carry your logo and company
          details. Bold and Clean use your brand colours, which you can change under Branding.
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
