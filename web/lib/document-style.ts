/**
 * The look of the company's paperwork: invoices, credit notes, quotes and
 * statements. `classic` is the layout they have always had (and the default);
 * `bold` and `clean` use the company's own brand colours. Pure, so the PDF
 * drawer, the settings page and the tests share one set of rules.
 */

export const DOCUMENT_STYLES = ["classic", "bold", "clean"] as const;
export type DocumentStyle = (typeof DOCUMENT_STYLES)[number];

export const DEFAULT_DOCUMENT_STYLE: DocumentStyle = "classic";

export function isDocumentStyle(v: unknown): v is DocumentStyle {
  return typeof v === "string" && (DOCUMENT_STYLES as readonly string[]).includes(v);
}

/** What a PDF needs to know to look like the company's: a style and two colours. */
export type PdfLook = { style: DocumentStyle; primary: string; accent: string };

export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return [15, 61, 62];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/** Relative luminance, 0 (black) to 1 (white). */
export function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

const WHITE: Rgb = [255, 255, 255];
const INK: Rgb = [20, 20, 20];

/** White or near-black text, whichever reads better on this colour. */
export function readableOn(background: Rgb): Rgb {
  return luminance(background) > 0.4 ? INK : WHITE;
}

/** `amount` (0 to 1) of the way from `from` to `to`. */
export function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  return [0, 1, 2].map((i) => Math.round(from[i] + (to[i] - from[i]) * amount)) as Rgb;
}

/** A pale wash of a colour, for striped rows. */
export function tint(colour: Rgb, amount = 0.92): Rgb {
  return mix(colour, WHITE, amount);
}

/** The colour as text on white paper: itself, or darkened until it can be read. */
export function onWhite(colour: Rgb): Rgb {
  let c = colour;
  for (let i = 0; i < 10 && luminance(c) > 0.3; i++) c = mix(c, [0, 0, 0], 0.2);
  return c;
}

/** The look from `my_company_config()`: anything unknown is classic in the product's colours. */
export function lookFrom(settings: { document_style?: unknown }, branding: { primary: string; accent: string }): PdfLook {
  return {
    style: isDocumentStyle(settings.document_style) ? settings.document_style : DEFAULT_DOCUMENT_STYLE,
    primary: branding.primary,
    accent: branding.accent,
  };
}
