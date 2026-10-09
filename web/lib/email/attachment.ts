import { logoUrl } from "@/lib/branding";
import type { DocumentView } from "@/lib/client-document";
import { documentPdfSpec } from "@/lib/client-document-pdf";
import { buildMoneyPdf } from "@/lib/money-pdf";
import type { LogoImage } from "@/lib/pdf-logo";

/**
 * The PDF that goes with a document email, drawn on the server with the same
 * drawer the signed-in screens and the client's page use, from the same data
 * the client's page shows, so the attachment and the page cannot disagree.
 * Server only.
 *
 * An attachment is a courtesy on top of the link: a company logo the server
 * cannot read (a WebP, a slow file) is left off the PDF, and a PDF that cannot
 * be made at all means the email goes without it, with the link as ever.
 */

/** Brevo takes up to 4 MB of attachment per email; stay well under it. */
export const MAX_ATTACHMENT_BYTES = 3_000_000;
const LOGO_TIMEOUT_MS = 5000;
const MAX_LOGO_BYTES = 2_000_000;

type Dimensions = { format: "PNG" | "JPEG"; width: number; height: number };

/** The format and size of a PNG or a JPEG from its first bytes; null for anything else. */
export function imageDimensions(b: Uint8Array): Dimensions | null {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length >= 24 && png.every((v, i) => b[i] === v)) {
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { format: "PNG", width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      // Start of frame (any kind but the table, "JPG" and arithmetic markers): height, then width.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { format: "JPEG", height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
      }
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
  }
  return null;
}

/** The logo as the drawer takes it, or null when there is none or it cannot be had. */
export async function loadLogoServer(url: string | null, fetchImpl: typeof fetch = fetch): Promise<LogoImage | null> {
  if (!url) return null;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(LOGO_TIMEOUT_MS) });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_LOGO_BYTES) return null;
    const d = imageDimensions(bytes);
    if (!d || !(d.width > 0) || !(d.height > 0)) return null;
    const mime = d.format === "PNG" ? "image/png" : "image/jpeg";
    return { dataUrl: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`, width: d.width, height: d.height, format: d.format };
  } catch {
    return null;
  }
}

/** A file name the mail systems accept. */
export function safeFileName(name: string): string {
  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
  return `${clean.slice(0, 80) || "Document"}.pdf`;
}

/** The PDF of the document the link shows, as an attachment; null when it is too big to attach. */
export async function documentPdfAttachment(
  view: DocumentView,
  supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL
): Promise<{ name: string; content: string } | null> {
  const spec = documentPdfSpec(view);
  const logo = await loadLogoServer(supabaseUrl ? logoUrl(supabaseUrl, spec.seller.logoPath ?? null) : null);
  const look = spec.look ?? { style: "classic" as const, primary: "#0F3D3E", accent: "#F5A524" };
  const doc = await buildMoneyPdf(spec, look, logo);
  const bytes = Buffer.from(doc.output("arraybuffer"));
  if (bytes.length > MAX_ATTACHMENT_BYTES) return null;
  return { name: safeFileName(spec.fileName), content: bytes.toString("base64") };
}
