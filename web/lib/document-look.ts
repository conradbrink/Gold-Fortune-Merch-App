import { getCompanyConfig } from "@/lib/use-company-config";
import { DEFAULT_ACCENT, DEFAULT_PRIMARY } from "@/lib/branding";
import { DEFAULT_DOCUMENT_STYLE, lookFrom, type PdfLook } from "@/lib/document-style";

/**
 * The look of the signed-in company's documents. Read from the same cached
 * configuration the rest of the app uses; a document never fails to download
 * because the look could not be had: it is drawn classic instead.
 */
export async function loadDocumentLook(): Promise<PdfLook> {
  try {
    const config = await getCompanyConfig();
    if (config) return lookFrom(config.settings, config.branding);
  } catch {
    // fall through to the default look
  }
  return { style: DEFAULT_DOCUMENT_STYLE, primary: DEFAULT_PRIMARY, accent: DEFAULT_ACCENT };
}
