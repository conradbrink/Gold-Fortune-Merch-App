/**
 * A company's name, logo and colours, from `my_company_config().branding`.
 *
 * Each company sees its own (decided 7 Oct 2026): Gold Fortune keeps navy
 * #16224F and gold #E0B84B; a company that never chose gets the product's
 * neutral palette. Before sign-in there is no company yet, so those pages use
 * the product name (`lib/product.ts`) instead.
 *
 * Pure, so the server layout can turn colours into CSS before the first paint
 * and the PDF and export code can use the same values.
 */

export type Branding = {
  name: string;
  legalName: string | null;
  /** Path inside the public `branding` bucket, e.g. "<org>/logo-a1b2.png". */
  logoPath: string | null;
  primary: string;
  accent: string;
};

/** `setting_definitions` defaults for the two colour settings. */
export const DEFAULT_PRIMARY = "#1E293B";
export const DEFAULT_ACCENT = "#0EA5A4";

const HEX = /^#[0-9A-Fa-f]{6}$/;
const LOGO_PATH = /^[0-9a-f-]{36}\/logo-[A-Za-z0-9_-]{1,40}\.(png|jpg|jpeg|webp)$/;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** The `branding` object of the config payload, checked field by field. */
export function parseBranding(raw: unknown): Branding {
  const r =
    raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const primary = str(r.primary);
  const accent = str(r.accent);
  const logo = str(r.logo_path);
  return {
    name: str(r.name) ?? "",
    legalName: str(r.legal_name),
    logoPath: logo && LOGO_PATH.test(logo) ? logo : null,
    primary: primary && HEX.test(primary) ? primary.toUpperCase() : DEFAULT_PRIMARY,
    accent: accent && HEX.test(accent) ? accent.toUpperCase() : DEFAULT_ACCENT,
  };
}

/** The public URL of a logo in the `branding` bucket. */
export function logoUrl(supabaseUrl: string, path: string | null): string | null {
  if (!path || !LOGO_PATH.test(path)) return null;
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/branding/${path}`;
}

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance of a #RRGGBB colour, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Text that reads on the colour: near-white on dark, near-black on light. */
export function readableOn(hex: string): string {
  // Contrast against white vs. against near-black (#0F172A, luminance ~0.0089).
  const l = luminance(hex);
  const onWhite = 1.05 / (l + 0.05);
  const onDark = (l + 0.05) / (0.0089 + 0.05);
  return onWhite >= onDark ? "#FFFFFF" : "#0F172A";
}

/**
 * The CSS custom properties a company's colours set, light theme only. The
 * dark palette stays the product's own: a brand navy on a dark background is
 * unreadable, and every dark rule is written against those greys.
 */
export function brandCssVariables(b: Pick<Branding, "primary" | "accent">): Record<string, string> {
  const primary = HEX.test(b.primary) ? b.primary : DEFAULT_PRIMARY;
  const accent = HEX.test(b.accent) ? b.accent : DEFAULT_ACCENT;
  const onPrimary = readableOn(primary);
  // A pale tint of the accent for hover and selected backgrounds, with the
  // primary as its text, as the original navy-on-pale-gold did.
  const accentTint = `color-mix(in oklch, ${accent} 30%, white)`;
  return {
    "--primary": primary,
    "--primary-foreground": onPrimary,
    "--ring": primary,
    "--accent": accentTint,
    "--accent-foreground": primary,
    "--gold": accent,
    "--gold-foreground": readableOn(accent),
    "--chart-1": accent,
    "--chart-2": primary,
    "--sidebar-primary": primary,
    "--sidebar-primary-foreground": onPrimary,
    "--sidebar-accent": accentTint,
    "--sidebar-accent-foreground": primary,
    "--sidebar-ring": primary,
  };
}

/**
 * The style sheet for `<style>` in the dashboard layout. Every value has been
 * through `HEX` or is built from values that have, so nothing a company typed
 * can close the rule or the tag.
 */
export function brandStyleSheet(b: Pick<Branding, "primary" | "accent">): string {
  const body = Object.entries(brandCssVariables(b))
    .map(([k, v]) => `${k}:${v};`)
    .join("");
  return `:root:not(.dark){${body}}`;
}
