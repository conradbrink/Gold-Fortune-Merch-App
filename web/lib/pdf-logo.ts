/**
 * The company's logo, ready to draw into a jsPDF document.
 *
 * jsPDF embeds PNG and JPEG reliably and WebP not at all without a plugin, and
 * the `branding` bucket accepts all three. Drawing the image onto a canvas and
 * taking a PNG back means every format the bucket allows comes out as one the
 * PDF can hold, and the canvas also tells us the image's real proportions.
 *
 * A logo is decoration. Every failure here — no logo, a slow or missing file,
 * an image the browser cannot decode — returns null and the document is drawn
 * without it; an export never fails because of its letterhead.
 */

export type LogoImage = {
  /** `data:image/png;base64,…`, for `doc.addImage`. */
  dataUrl: string;
  width: number;
  height: number;
};

/** Long enough for a small image on a slow line, short enough that Export still feels like a button. */
const FETCH_TIMEOUT_MS = 5000;

/**
 * The largest size with the image's proportions that fits in the box. Never
 * scales up past the box, and a zero-sized image comes back zero rather than
 * dividing by nothing.
 */
export function fitBox(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(maxWidth / width, maxHeight / height);
  return { width: width * scale, height: height * scale };
}

/** Fetch and decode the logo at `url`, or null if there is none or it cannot be had. */
export async function loadLogoImage(url: string | null): Promise<LogoImage | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const bitmap = await createImageBitmap(await res.blob());
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return { dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
  } catch {
    return null;
  }
}
