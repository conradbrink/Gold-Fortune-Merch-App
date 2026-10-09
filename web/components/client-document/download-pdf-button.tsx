"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadDocumentPdf } from "@/lib/client-document-pdf";
import type { DocumentView } from "@/lib/client-document";

/** Draws the page's document as a PDF on the client's own device. */
export function DownloadPdfButton({ view }: { view: DocumentView }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function download() {
    setBusy(true);
    setFailed(false);
    try {
      await downloadDocumentPdf(view);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1 print:hidden">
      <Button type="button" variant="outline" className="h-11 gap-2 px-4 text-sm" onClick={download} disabled={busy}>
        <Download aria-hidden />
        {busy ? "Preparing the PDF" : "Download PDF"}
      </Button>
      {failed && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-400">
          The PDF could not be made. Please try again.
        </p>
      )}
    </div>
  );
}
