"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RecipientsField, TickField, useRecipients } from "@/components/send/recipients-field";
import { createClient } from "@/lib/supabase/client";
import {
  defaultRecipients,
  documentSubject,
  fetchOverdueInvoices,
  MAX_MESSAGE,
  newAddresses,
  REMINDER_TONES,
  rememberAccountsContact,
  rememberedSentence,
  reminderMessage,
  sendPaymentReminder,
  sendResultSentence,
  suggestedTone,
  toneLabel,
  type OverdueInvoice,
  type ReminderTone,
  type SendClient,
  type SendResult,
} from "@/lib/document-sends";
import { formatMoney } from "@/lib/money";
import { lower } from "@/lib/terms";
import { useCompanyConfig, useTerms } from "@/lib/use-company-config";

/** Where a reminder is in a run through several clients: every message is read before it goes. */
export type ReminderProgress = { position: number; total: number; onNext: () => void };

/**
 * Remind a client of what is overdue. A person sends it, one client at a
 * time, after reading the message: it starts from a friendly, firm or final
 * notice wording that they can change. Never sent on a schedule.
 */
export function ReminderDialog({
  client,
  progress,
  onClose,
  onSent,
}: {
  client: SendClient | null;
  /** Set when walking through several clients: Skip and Next move on, closing stops. */
  progress?: ReminderProgress;
  onClose: () => void;
  onSent?: () => void;
}) {
  return (
    <Dialog open={!!client} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {client && (
          <ReminderForm
            key={`${client.storeId ?? ""}|${client.name}`}
            client={client}
            progress={progress}
            onClose={onClose}
            onSent={onSent}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReminderForm({
  client,
  progress,
  onClose,
  onSent,
}: {
  client: SendClient;
  progress?: ReminderProgress;
  onClose: () => void;
  onSent?: () => void;
}) {
  const supabase = createClient();
  const t = useTerms();
  const config = useCompanyConfig();
  const orgId = config?.orgId ?? null;
  const currency = config?.settings.currency_code ?? "";
  const company = config?.branding.legalName?.trim() || config?.branding.name || "";
  const recipients = useRecipients();
  const { setDefaults } = recipients;

  const [overdue, setOverdue] = useState<OverdueInvoice[] | null>(null);
  const [known, setKnown] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tone, setTone] = useState<ReminderTone>("friendly");
  const [message, setMessage] = useState("");
  const [edited, setEdited] = useState(false);
  const [copyMe, setCopyMe] = useState(false);
  const [remember, setRemember] = useState(true);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ result: SendResult; extra: string | null } | null>(null);

  const storeId = client.storeId;
  const name = client.name;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [invoices, found] = await Promise.all([
          fetchOverdueInvoices(supabase, { storeId, name }),
          defaultRecipients(supabase, { storeId }),
        ]);
        if (cancelled) return;
        const first = suggestedTone(Math.max(0, ...invoices.map((i) => i.daysOverdue)));
        setOverdue(invoices);
        setTone(first);
        setMessage(
          invoices.length ? reminderMessage(first, messageFacts(name, invoices, currency)) : ""
        );
        setDefaults(found.addresses);
        setKnown(found.known);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, storeId, name, currency, setDefaults]);

  const wording = useMemo(
    () => (overdue?.length ? reminderMessage(tone, messageFacts(name, overdue, currency)) : ""),
    [tone, overdue, name, currency]
  );

  function chooseTone(next: ReminderTone) {
    setTone(next);
    if (!edited && overdue?.length) setMessage(reminderMessage(next, messageFacts(name, overdue, currency)));
  }

  const total = (overdue ?? []).reduce((n, i) => n + i.outstanding, 0);
  const fresh = known === null ? [] : newAddresses(storeId, recipients.addresses, known);
  const clientWord = lower(t.client.one);

  async function send() {
    if (sendingRef.current) return;
    setError(null);
    const to = recipients.commit();
    if (!to) return;
    if (to.length === 0) return setError("Add an email address to send to.");
    if (!message.trim()) return setError("Write a message to send.");
    sendingRef.current = true;
    setSending(true);
    try {
      const result = await sendPaymentReminder(supabase, { storeId, name }, { to, tone, message, copyMe });
      const toRemember = newAddresses(storeId, to, known ?? []);
      let extra: string | null = null;
      if (remember && toRemember.length > 0 && result.queued > 0 && orgId && storeId) {
        extra = rememberedSentence(
          toRemember,
          name,
          await rememberAccountsContact(supabase, { orgId, storeId, emails: toRemember })
        );
      }
      setDone({ result, extra });
      onSent?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  const step = progress ? `${progress.position} of ${progress.total}` : null;
  const last = progress ? progress.position >= progress.total : true;
  const skipWord = progress ? "Skip" : "Cancel";
  const leave = progress ? progress.onNext : onClose;

  if (done) {
    return (
      <>
        <DialogHeader>
          <DialogTitle className="pr-8 text-pretty">{`Remind ${name}`}</DialogTitle>
          {step && <DialogDescription>{step}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-2" role="status">
          <p className={`text-sm text-pretty ${done.result.queued === 0 ? "text-destructive" : "text-foreground"}`}>
            {sendResultSentence(done.result)}
          </p>
          {done.extra && <p className="text-sm text-pretty text-muted-foreground">{done.extra}</p>}
        </div>
        <div className="flex justify-end">
          <Button onClick={leave}>{last ? "Done" : "Next"}</Button>
        </div>
      </>
    );
  }

  const nothingOverdue = overdue !== null && overdue.length === 0;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="pr-8 text-pretty">{`Remind ${name}`}</DialogTitle>
        <DialogDescription className="text-pretty">
          {step ? `${step}. ` : ""}Read the message, then send it. They get an email with a link to their statement.
        </DialogDescription>
      </DialogHeader>

      {loadError && (
        <p role="alert" className="text-sm text-pretty text-destructive">
          {loadError}
        </p>
      )}
      {overdue === null && !loadError && <div className="h-24 animate-pulse rounded-lg bg-muted/50" />}
      {nothingOverdue && <p className="text-sm text-muted-foreground">{`This ${clientWord} has nothing overdue.`}</p>}

      {overdue && overdue.length > 0 && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <div className="rounded-lg border border-border">
            <ul className="max-h-36 divide-y divide-border overflow-y-auto" aria-label="Overdue invoices">
              {overdue.map((i) => (
                <li key={i.invoiceId || i.number} className="flex items-baseline justify-between gap-3 px-3 py-1.5 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">{i.number}</span>
                    <span className="text-muted-foreground">
                      {` · ${i.daysOverdue} ${i.daysOverdue === 1 ? "day" : "days"} overdue`}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums">{formatMoney(i.outstanding, currency)}</span>
                </li>
              ))}
            </ul>
            <p className="flex justify-between border-t border-border bg-muted/40 px-3 py-1.5 text-sm font-medium">
              Total overdue <span className="tabular-nums">{formatMoney(total, currency)}</span>
            </p>
          </div>

          <RecipientsField recipients={recipients} disabled={sending} loading={known === null} />

          <div className="space-y-1.5">
            <p id="tone-label" className="text-sm leading-none font-medium">
              Tone
            </p>
            <div className="flex flex-wrap gap-2" role="group" aria-labelledby="tone-label">
              {REMINDER_TONES.map((o) => (
                <Button
                  key={o.key}
                  type="button"
                  size="sm"
                  variant={tone === o.key ? "default" : "outline"}
                  aria-pressed={tone === o.key}
                  disabled={sending}
                  onClick={() => chooseTone(o.key)}
                >
                  {o.label}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{REMINDER_TONES.find((o) => o.key === tone)?.hint}</p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="reminder-message">Message</Label>
              {edited && message !== wording && (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0"
                  disabled={sending}
                  onClick={() => {
                    setMessage(wording);
                    setEdited(false);
                  }}
                >
                  {`Use the ${lower(toneLabel(tone))} message`}
                </Button>
              )}
            </div>
            <Textarea
              id="reminder-message"
              value={message}
              maxLength={MAX_MESSAGE}
              disabled={sending}
              rows={9}
              onChange={(e) => {
                setMessage(e.target.value);
                setEdited(true);
              }}
              className="max-h-72 min-h-44 leading-relaxed"
            />
          </div>

          <div className="space-y-1">
            <TickField checked={copyMe} onChange={setCopyMe} disabled={sending}>
              Send me a copy
            </TickField>
            {fresh.length > 0 && (
              <TickField checked={remember} onChange={setRemember} disabled={sending}>
                {fresh.length === 1 ? `Remember this address for ${name}` : `Remember these addresses for ${name}`}
              </TickField>
            )}
          </div>

          <p className="truncate text-xs text-muted-foreground">
            Subject: <span className="text-foreground">{documentSubject("reminder", { company, total: formatMoney(total, currency), final: tone === "final" })}</span>
          </p>

          {error && (
            <p role="alert" className="text-sm text-pretty text-destructive">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={leave} disabled={sending}>
              {skipWord}
            </Button>
            <Button type="submit" disabled={sending}>
              {sending ? "Sending…" : "Send"}
            </Button>
          </div>
        </form>
      )}

      {(nothingOverdue || loadError) && (
        <div className="flex justify-end">
          <Button variant="outline" onClick={leave}>
            {progress ? (last ? "Done" : "Next") : "Close"}
          </Button>
        </div>
      )}
    </>
  );
}

function messageFacts(client: string, invoices: OverdueInvoice[], currency: string) {
  return {
    client,
    invoices: invoices.map((i) => ({ number: i.number, daysOverdue: i.daysOverdue })),
    total: formatMoney(
      invoices.reduce((n, i) => n + i.outstanding, 0),
      currency
    ),
  };
}
