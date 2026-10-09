"use client";

import { useState } from "react";
import { Mail } from "lucide-react";
import { sendLine, type SendRow } from "@/lib/document-sends";

const SHOWN = 3;

/**
 * Where an invoice or a quote has been sent, newest first: who got it, when,
 * and whether they opened it. Nothing at all until it has been sent.
 */
export function SentLines({ rows }: { rows: SendRow[] }) {
  const [all, setAll] = useState(false);
  if (rows.length === 0) return null;
  const shown = all ? rows : rows.slice(0, SHOWN);
  return (
    <div aria-label="Sent" className="space-y-0.5 text-sm">
      {shown.map((r) => {
        const line = sendLine(r);
        return (
          <p key={r.id} className={`flex items-start gap-1.5 ${line.problem ? "text-destructive" : "text-muted-foreground"}`}>
            <Mail className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 break-words">{line.text}</span>
          </p>
        );
      })}
      {rows.length > SHOWN && (
        <button
          type="button"
          className="text-xs text-primary hover:underline"
          onClick={() => setAll((v) => !v)}
        >
          {all ? "Show fewer" : `Show ${rows.length - SHOWN} earlier`}
        </button>
      )}
    </div>
  );
}
