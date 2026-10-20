/**
 * The look of the company's paperwork: invoices, credit notes, quotes and
 * statements. Every look has one layout (the owner's, 20 Oct: modelled on the
 * QuickBooks invoice their clients already know) and the company picks how it
 * is dressed: `classic` (the default) is that invoice, with the brand colour
 * in a light band; `bold` puts the heading and logo in a band of the brand
 * colour; `clean` centres the letterhead and keeps to thin lines. Pure, so the
 * PDF drawer, the client's page, the settings page and the tests share one set
 * of rules.
 */

export const DOCUMENT_STYLES = ["classic", "bold", "clean"] as const;
export type DocumentStyle = (typeof DOCUMENT_STYLES)[number];

export const DEFAULT_DOCUMENT_STYLE: DocumentStyle = "classic";

export function isDocumentStyle(v: unknown): v is DocumentStyle {
  return typeof v === "string" && (DOCUMENT_STYLES as readonly string[]).includes(v);
}

/** What a document needs to know to look like the company's: a style and two colours. */
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

/**
 * The brand colour as small text on the paper and on its wash: darkened until
 * it is at least 4.5 times darker than the band, as body text must be.
 */
export function brandText(colour: Rgb): Rgb {
  let c = colour;
  for (let i = 0; i < 12 && luminance(c) > 0.15; i++) c = mix(c, [0, 0, 0], 0.15);
  return c;
}

/**
 * The band behind who the document is for: the brand's own hue, very light.
 * Mixing a dark brand colour with white turns it grey (navy becomes a cool
 * grey); keeping the hue and some of its saturation keeps it the brand's.
 */
export function wash([r, g, b]: Rgb): Rgb {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const d = max - min;
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (d > 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    h = max === R ? ((G - B) / d + 6) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  }
  const light = 0.955;
  const c = (1 - Math.abs(2 * light - 1)) * Math.min(s, 0.6);
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = light - c / 2;
  const [r1, g1, b1] =
    h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  return [r1, g1, b1].map((v) => Math.round((v + m) * 255)) as Rgb;
}

/** The look from `my_company_config()`: anything unknown is classic. */
export function lookFrom(settings: { document_style?: unknown }, branding: { primary: string; accent: string }): PdfLook {
  return {
    style: isDocumentStyle(settings.document_style) ? settings.document_style : DEFAULT_DOCUMENT_STYLE,
    primary: branding.primary,
    accent: branding.accent,
  };
}
