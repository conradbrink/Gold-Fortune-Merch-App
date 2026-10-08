"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, Copy } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";

/**
 * Where staff get the phone app: a code their phone's camera opens, and the
 * address written out. The owner shows it on their own screen when handing a
 * login over, so nothing has to be sent (owner, 8 Oct 2026: "a link to the app
 * here or a QR code ... as we won't be sending whatsapps"). The address is this
 * site's own /download page, so it is right on whichever domain serves the web.
 */
export function GetTheApp({ title, note, size = 128 }: { title: string; note: string; size?: number }) {
  // Only the browser knows the address it is on; the server draws nothing.
  const origin = useSyncExternalStore(neverChanges, () => window.location.origin, () => null);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!origin) return null;
  const url = `${origin}/download`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }

  return (
    <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
      {/* Dark on light in both themes: a phone's camera reads it either way. */}
      <div className="shrink-0 rounded-lg bg-[#fbfcfb] p-1.5 ring-1 ring-foreground/10">
        <QRCodeSVG
          value={url}
          size={size}
          level="M"
          marginSize={1}
          bgColor="#fbfcfb"
          fgColor="#0f1d1a"
          title="Code that opens the app download page"
        />
      </div>
      <div className="min-w-0 space-y-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-pretty text-muted-foreground">{note}</p>
        <div className="flex flex-wrap items-center justify-center gap-x-2 sm:justify-start">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {url.replace(/^https?:\/\//, "")}
          </a>
          <Button variant="ghost" size="sm" onClick={copy}>
            {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
            {copied ? "Copied" : "Copy link"}
          </Button>
        </div>
        {failed && <p className="text-xs text-destructive">That could not be copied. Copy the address by hand.</p>}
      </div>
    </div>
  );
}

/** The page's address does not change while it is open. */
function neverChanges() {
  return () => {};
}
