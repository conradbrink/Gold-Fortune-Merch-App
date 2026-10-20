import { getCompanyConfig } from "@/lib/use-company-config";
import { DEFAULT_ACCENT, DEFAULT_PRIMARY } from "@/lib/branding";
import { DEFAULT_DOCUMENT_STYLE, lookFrom, type PdfLook } from "@/lib/document-style";
import { todayIn } from "@/lib/client-document";
import type { Paper } from "@/lib/money-pdf";

/**
 * The look of the signed-in company's documents, and the currency and day
 * their words are in. Read from the same cached configuration the rest of the
 * app uses; a document never fails to download because these could not be
 * had: it is drawn classic in the product's colours, with plain amounts, instead.
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

/** The company's currency, and today on its clock (whether an invoice is overdue). */
export async function loadPaper(): Promise<Paper> {
  try {
    const config = await getCompanyConfig();
    if (config) return { currency: config.settings.currency_code, today: todayIn(config.timezone) };
  } catch {
    // fall through to plain amounts and the device's day
  }
  return { currency: null, today: todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone) };
}
