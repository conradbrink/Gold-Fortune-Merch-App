"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RecipientsField, TickField, useRecipients } from "@/components/send/recipients-field";
import { createClient } from "@/lib/supabase/client";
import {
  defaultRecipients,
  documentSubject,
  MAX_NOTE,
  newAddresses,
  rememberAccountsContact,
  rememberedSentence,
  sendInvoiceEmail,
  sendQuoteEmail,
  sendResultSentence,
  sendStatementEmail,
  shortDate,
  type SendResult,
} from "@/lib/document-sends";
import { periodText } from "@/lib/client-document";
import { useCompanyConfig } from "@/lib/use-company-config";

/** What is being sent. A statement is a client and the dates on screen. */
export type SendTarget =
  | { kind: "invoice" | "quote"; id: string; number: string; clientName: string; storeId: string | null; email: string | null }
  | { kind: "statement"; clientName: string; storeId: string | null; from: string; to: string };

const targetKey = (t: SendTarget) => (t.kind === "statement" ? `statement:${t.storeId ?? t.clientName}:${t.from}:${t.to}` : `${t.kind}:${t.id}`);

const dateOnly = (d: string) => shortDate(`${d}T00:00:00`);

/**
 * Send an invoice, a quote or a client's statement by email. The address is
 * found for the person (the document's own, else the people at the place who
 * get the accounts) and they can change it; the client gets a link to a page
 * that opens without logging in. When it is done the dialog says plainly who
 * it went to and who it could not.
 */
export function SendDocumentDialog({
  target,
  onClose,
  onSent,
}: {
  target: SendTarget | null;
  onClose: () => void;
  /** Called once an email has gone, so the screen behind can show it. */
  onSent?: () => void;
}) {
  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        {target && <SendForm key={targetKey(target)} target={target} onClose={onClose} onSent={onSent} />}
      </DialogContent>
    </Dialog>
  );
}

function SendForm({ target, onClose, onSent }: { target: SendTarget; onClose: () => void; onSent?: () => void }) {
  const supabase = createClient();
  const config = useCompanyConfig();
  const orgId = config?.orgId ?? null;
  const company = config?.branding.legalName?.trim() || config?.branding.name || "";
  const recipients = useRecipients();
  const { setDefaults } = recipients;
  const [known, setKnown] = useState<string[] | null>(null);
  const [note, setNote] = useState("");
  const [copyMe, setCopyMe] = useState(false);
  const [remember, setRemember] = useState(true);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ result: SendResult; sentence: string; extra: string | null } | null>(null);

  const email = target.kind === "statement" ? null : target.email;
  const storeId = target.storeId;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const found = await defaultRecipients(supabase, { email, storeId });
      if (cancelled) return;
      setDefaults(found.addresses);
      setKnown(found.known);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, email, storeId, setDefaults]);

  const fresh = known === null ? [] : newAddresses(storeId, recipients.addresses, known);
  const noun = target.kind === "statement" ? "statement" : target.kind;
  const subject = documentSubject(target.kind, {
    number: target.kind === "statement" ? undefined : target.number,
    company,
    period: target.kind === "statement" ? periodText(target.from, target.to) : undefined,
  });

  async function send() {
    if (sendingRef.current) return;
    setError(null);
    const to = recipients.commit();
    if (!to) return;
    if (to.length === 0) return setError("Add an email address to send to.");
    sendingRef.current = true;
    setSending(true);
    try {
      const options = { to, note, copyMe };
      const result =
        target.kind === "statement"
          ? await sendStatementEmail(
              supabase,
              { storeId: target.storeId, name: target.clientName },
              { from: target.from, to: target.to },
              options
            )
          : target.kind === "invoice"
            ? await sendInvoiceEmail(supabase, target.id, options)
            : await sendQuoteEmail(supabase, target.id, options);
      // Remembering an address is a kindness for next time: if it fails the email has still gone.
      const toRemember = newAddresses(storeId, to, known ?? []);
      let extra: string | null = null;
      if (remember && toRemember.length > 0 && result.queued > 0 && orgId && storeId) {
        extra = rememberedSentence(
          toRemember,
          target.clientName,
          await rememberAccountsContact(supabase, { orgId, storeId, emails: toRemember })
        );
      }
      setDone({ result, sentence: sendResultSentence(result), extra });
      onSent?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  const title =
    target.kind === "statement" ? `Send ${target.clientName}'s statement` : `Send ${noun} ${target.number}`;

  if (done) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2" role="status">
          <p className={`text-sm text-pretty ${done.result.queued === 0 ? "text-destructive" : "text-foreground"}`}>
            {done.sentence}
          </p>
          {done.extra && <p className="text-sm text-pretty text-muted-foreground">{done.extra}</p>}
        </div>
        <div className="flex justify-end">
          <Button onClick={onClose}>Done</Button>
        </div>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="pr-8 text-pretty">{title}</DialogTitle>
        <DialogDescription className="text-pretty">
          {target.kind === "statement"
            ? `For ${dateOnly(target.from)} to ${dateOnly(target.to)}. `
            : `For ${target.clientName}. `}
          They get an email with a link to open it. They do not need to log in.
        </DialogDescription>
      </DialogHeader>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <RecipientsField recipients={recipients} disabled={sending} loading={known === null} />

        <div className="space-y-1.5">
          <Label htmlFor="send-note">Add a note (optional)</Label>
          <Textarea
            id="send-note"
            value={note}
            maxLength={MAX_NOTE}
            disabled={sending}
            onChange={(e) => setNote(e.target.value)}
            className="min-h-16"
          />
          {note.length >= MAX_NOTE * 0.9 && (
            <p className="text-xs text-muted-foreground tabular-nums">
              {note.length.toLocaleString("en-GB")} of {MAX_NOTE.toLocaleString("en-GB")} characters
            </p>
          )}
        </div>

        <div className="space-y-1">
          <TickField checked={copyMe} onChange={setCopyMe} disabled={sending}>
            Send me a copy
          </TickField>
          {fresh.length > 0 && (
            <TickField checked={remember} onChange={setRemember} disabled={sending}>
              {fresh.length === 1
                ? `Remember this address for ${target.clientName}`
                : `Remember these addresses for ${target.clientName}`}
            </TickField>
          )}
        </div>

        <p className="truncate text-xs text-muted-foreground">
          Subject: <span className="text-foreground">{subject}</span>
        </p>

        {error && (
          <p role="alert" className="text-sm text-pretty text-destructive">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={sending}>
            Cancel
          </Button>
          <Button type="submit" disabled={sending}>
            {sending ? "Sending…" : "Send"}
          </Button>
        </div>
      </form>
    </>
  );
}
