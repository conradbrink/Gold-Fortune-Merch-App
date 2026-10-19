"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, ExternalLink, LoaderCircle, MessageSquareText, Square, SquarePen, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExportMenu } from "@/components/export-menu";
import { cn } from "@/lib/utils";
import { lower, type Terms } from "@/lib/terms";
import { useCompanyConfig, useTerms } from "@/lib/use-company-config";
import { exampleQuestions, type ToolSpec } from "@/lib/assistant-tools";
import {
  MAX_QUESTION_CHARS,
  QUESTIONS_PER_DAY,
  QUESTIONS_PER_HOUR,
  type QuestionsLeft,
} from "@/lib/assistant-stream";
import { parseAnswer, type Span } from "@/lib/assistant-text";
import { useAssistant, type AskMessage, type AskTable } from "@/components/assistant/assistant-provider";

/**
 * Ask: the chat window that opens from the round button in the corner.
 *
 * On a wide screen it floats above the button, over the bottom-right of the
 * page, and stays open from page to page. On a phone it covers the screen, the
 * way the menu does. It renders nothing while closed, and nothing for somebody
 * whose access gives it nothing to look up.
 */
export function AssistantPanel() {
  const { open, setOpen, tools, messages, busy, left, ask, stop, reset } = useAssistant();
  const company = useCompanyConfig();
  const t = useTerms();
  if (!open || tools === null || tools.length === 0) return null;
  return (
    <AssistantPanelView
      companyName={company?.branding.name || "your company"}
      terms={t}
      tools={tools}
      messages={messages}
      busy={busy}
      left={left}
      onAsk={ask}
      onStop={stop}
      onReset={reset}
      onClose={() => setOpen(false)}
    />
  );
}

type PanelViewProps = {
  companyName: string;
  terms: Terms;
  tools: readonly ToolSpec[];
  messages: AskMessage[];
  busy: boolean;
  left: QuestionsLeft | null;
  onAsk: (question: string) => void;
  onStop: () => void;
  onReset: () => void;
  onClose: () => void;
};

/** The panel itself, from plain props: what `AssistantPanel` shows once it is open. */
export function AssistantPanelView({
  companyName: name,
  terms: t,
  tools,
  messages,
  busy,
  left,
  onAsk,
  onStop,
  onReset,
  onClose,
}: Readonly<PanelViewProps>) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const examples = useMemo(() => exampleQuestions(tools, t), [tools, t]);
  const outOfQuestions = left !== null && left.hour <= 0;

  // Opening puts the cursor in the box, ready to type.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Follow the answer as it arrives, unless the person has scrolled up to read.
  const lastText = messages[messages.length - 1]?.text.length ?? 0;
  const lastTables = messages[messages.length - 1]?.tables.length ?? 0;
  const count = messages.length;
  const pinned = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [count, lastText, lastTables]);

  function submit(text: string) {
    if (busy || outOfQuestions || !text.trim()) return;
    pinned.current = true;
    onAsk(text);
    setDraft("");
  }

  return (
    <aside
      aria-label="Ask about your business"
      onKeyDown={(e) => {
        // Only from inside the panel itself: Escape in a download menu (portalled,
        // but still bubbling through React) closes that menu, not the panel.
        if (e.key === "Escape" && e.currentTarget.contains(e.target as Node)) onClose();
      }}
      className={cn(
        "fixed inset-0 z-50 flex flex-col bg-background print:hidden",
        // Floating above the button from md up: the phone's bottom bar is gone by then.
        "md:inset-auto md:right-6 md:bottom-24 md:h-[min(640px,calc(100dvh-8rem))] md:w-[400px] md:overflow-hidden md:rounded-2xl md:border md:border-border md:shadow-2xl md:shadow-black/15",
        // Grows out of the button: short, eased, and not at all with reduced motion.
        "origin-bottom-right animate-in fade-in-0 zoom-in-95 duration-200 ease-out motion-reduce:animate-none"
      )}
    >
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <MessageSquareText className="size-4 shrink-0 text-primary" aria-hidden />
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">Ask about your business</h2>
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" onClick={onReset} disabled={busy} className="gap-1.5">
            <SquarePen className="size-3.5" />
            New chat
          </Button>
        )}
        <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </header>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-5"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <div className="space-y-5">
            <p className="text-sm leading-relaxed text-foreground">
              Ask in your own words about {name}&apos;s {lower(t.site.many)}, sales, orders and more. Answers
              come from your own data in Tickd, and only what your access lets you see.
            </p>
            {examples.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Try one of these</p>
                <ul className="space-y-1.5">
                  {examples.map((q) => (
                    <li key={q}>
                      <button
                        type="button"
                        onClick={() => submit(q)}
                        disabled={busy || outOfQuestions}
                        className="w-full rounded-lg border border-border px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:scale-[0.99] disabled:opacity-50 motion-reduce:active:scale-100"
                      >
                        {q}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <ol className="space-y-5">
            {messages.map((m) => (
              <li key={m.id}>{m.role === "user" ? <Question text={m.text} /> : <Answer message={m} />}</li>
            ))}
          </ol>
        )}
      </div>

      <form
        className="shrink-0 border-t border-border px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
      >
        <div className="flex items-end gap-2 rounded-xl border border-input bg-background py-1.5 pr-1.5 pl-3 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
          <label htmlFor="ask-question" className="sr-only">
            Your question
          </label>
          <textarea
            id="ask-question"
            ref={inputRef}
            rows={1}
            value={draft}
            maxLength={MAX_QUESTION_CHARS}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit(draft);
              }
            }}
            placeholder={outOfQuestions ? "No questions left this hour" : "Ask a question"}
            disabled={outOfQuestions}
            className="field-sizing-content max-h-40 min-h-8 flex-1 resize-none bg-transparent py-1 text-base text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed md:text-sm"
          />
          {busy ? (
            <Button type="button" size="icon-sm" variant="outline" aria-label="Stop answering" onClick={onStop}>
              <Square className="size-3 fill-current" />
            </Button>
          ) : (
            <Button type="submit" size="icon-sm" aria-label="Send question" disabled={!draft.trim() || outOfQuestions}>
              <ArrowUp className="size-4" />
            </Button>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {left === null
            ? `${QUESTIONS_PER_HOUR} questions an hour, ${QUESTIONS_PER_DAY} a day. Only questions about ${name} are answered.`
            : `${left.hour} ${left.hour === 1 ? "question" : "questions"} left this hour, ${left.day} today.`}
        </p>
      </form>
    </aside>
  );
}

function Question({ text }: Readonly<{ text: string }>) {
  return (
    <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap text-primary-foreground">
      {text}
    </div>
  );
}

function Answer({ message }: Readonly<{ message: AskMessage }>) {
  return (
    <div className="space-y-3">
      {message.refused ? (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm leading-relaxed text-foreground">{message.text}</p>
      ) : (
        message.text && <AnswerText text={message.text} />
      )}
      {message.pending && message.status && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
          {message.status}…
        </p>
      )}
      {!message.refused && message.tables.map((table, i) => <AnswerTable key={i} table={table} />)}
      {message.error && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {message.error}
        </p>
      )}
    </div>
  );
}

function SpanText({ spans }: Readonly<{ spans: Span[] }>) {
  return (
    <>
      {spans.map((s, i) => (s.bold ? <strong key={i} className="font-semibold">{s.text}</strong> : <span key={i}>{s.text}</span>))}
    </>
  );
}

function AnswerText({ text }: Readonly<{ text: string }>) {
  const blocks = useMemo(() => parseAnswer(text), [text]);
  return (
    <div className="space-y-2.5 text-sm leading-relaxed text-foreground">
      {blocks.map((b, i) =>
        b.type === "p" ? (
          <p key={i} className="text-pretty">
            <SpanText spans={b.spans} />
          </p>
        ) : b.type === "ul" ? (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {b.items.map((item, j) => (
              <li key={j}>
                <SpanText spans={item} />
              </li>
            ))}
          </ul>
        ) : (
          <ol key={i} className="list-decimal space-y-1 pl-5">
            {b.items.map((item, j) => (
              <li key={j}>
                <SpanText spans={item} />
              </li>
            ))}
          </ol>
        )
      )}
    </div>
  );
}

/** Rows shown before "Show all": enough to read, few enough to keep the answer in view. */
const PREVIEW_ROWS = 8;

/** A cell as shown. A number column with cents anywhere shows cents everywhere, so money lines up. */
function cell(value: string | number | null | undefined, decimals: number | null): string {
  if (value === null || value === undefined || value === "") return "";
  if (decimals !== null && typeof value === "number") {
    return value.toLocaleString("en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: 2 });
  }
  return String(value);
}

function AnswerTable({ table }: Readonly<{ table: AskTable }>) {
  const { sheet, href } = table;
  const [all, setAll] = useState(false);
  const rows = all ? sheet.rows : sheet.rows.slice(0, PREVIEW_ROWS);
  const decimals = useMemo(
    () =>
      Object.fromEntries(
        sheet.columns.map((c) => [
          c.key,
          c.numeric
            ? sheet.rows.some((r) => typeof r[c.key] === "number" && !Number.isInteger(r[c.key]))
              ? 2
              : 0
            : null,
        ])
      ) as Record<string, number | null>,
    [sheet]
  );

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-1.5">
        <p className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {sheet.title} <span className="font-normal text-muted-foreground">({sheet.rows.length})</span>
        </p>
        <ExportMenu build={() => sheet} label="Download" compact />
      </div>
      <div className={cn("overflow-auto", all && "max-h-96")}>
        <table className="w-full text-xs tabular-nums">
          <thead className="sticky top-0 bg-background">
            <tr>
              {sheet.columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn(
                    "px-2.5 py-1.5 font-medium whitespace-nowrap text-muted-foreground",
                    c.numeric ? "text-right" : "text-left"
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-border/60">
                {sheet.columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn("px-2.5 py-1.5 whitespace-nowrap text-foreground", c.numeric && "text-right")}
                  >
                    {cell(row[c.key], decimals[c.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-xs">
        {sheet.rows.length > PREVIEW_ROWS && (
          <button
            type="button"
            onClick={() => setAll((a) => !a)}
            className="font-medium text-primary hover:underline focus-visible:underline focus-visible:outline-none"
          >
            {all ? "Show fewer" : `Show all ${sheet.rows.length}`}
          </button>
        )}
        <Link
          href={href}
          className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
        >
          Open the page
          <ExternalLink className="size-3" aria-hidden />
        </Link>
      </div>
    </div>
  );
}

/**
 * The round button in the bottom-right corner, on every page, the way a chat
 * button sits on a website. It opens and closes the chat window above it; on a
 * phone it sits above the bottom bar and hides while the chat fills the screen.
 * Nothing for somebody Ask can't help yet.
 */
export function AssistantLauncher() {
  const { open, setOpen, tools } = useAssistant();
  if (!tools || tools.length === 0) return null;
  return <LauncherButton open={open} onToggle={() => setOpen(!open)} />;
}

/** The button itself, from plain props. */
export function LauncherButton({ open, onToggle }: Readonly<{ open: boolean; onToggle: () => void }>) {
  const ref = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(open);

  // Closing the window hands the keyboard back to the button that opened it.
  useEffect(() => {
    if (wasOpen.current && !open) ref.current?.focus();
    wasOpen.current = open;
  }, [open]);

  const label = open ? "Close Ask" : "Ask about your business";
  return (
    <button
      ref={ref}
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={label}
      className={cn(
        "group fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-black/25 transition-transform duration-150 ease-out hover:scale-105 focus-visible:ring-4 focus-visible:ring-ring/50 focus-visible:outline-none active:scale-95 md:right-6 md:bottom-6 motion-reduce:transition-none motion-reduce:hover:scale-100 motion-reduce:active:scale-100 print:hidden",
        open && "max-md:hidden"
      )}
    >
      {open ? <X className="size-6" aria-hidden /> : <MessageSquareText className="size-6" aria-hidden />}
      {/* What the button is for, beside it on hover. Not on touch screens, where nothing hovers. */}
      {!open && (
        <span
          aria-hidden
          className="pointer-events-none absolute right-full mr-3 hidden rounded-lg bg-foreground px-2.5 py-1 text-xs font-medium whitespace-nowrap text-background opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 md:block"
        >
          {label}
        </span>
      )}
    </button>
  );
}

/**
 * Room at the foot of every page for the button, so it never sits on top of
 * the last row or a page's own buttons once scrolled to the end.
 */
export function AssistantSpacer() {
  const { tools } = useAssistant();
  if (!tools || tools.length === 0) return null;
  return <div aria-hidden className="h-16 print:hidden" />;
}
