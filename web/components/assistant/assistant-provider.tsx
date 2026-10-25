"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ExportSheet } from "@/lib/export";
import { toolsFor, type ToolSpec } from "@/lib/assistant-tools";
import {
  decodeEvents,
  history,
  type ActionDraft,
  type ActionResult,
  type AssistantLink,
  type PlanDraft,
  type QuestionsLeft,
} from "@/lib/assistant-stream";
import { announceChange } from "@/lib/assistant-changed";
import { usePermissions } from "@/lib/use-permissions";
import { useIsManager } from "@/lib/use-is-manager";
import { useCompanyConfig } from "@/lib/use-company-config";

/**
 * Ask's state, above the panel so it outlives it.
 *
 * Closing the panel or moving to another page keeps the conversation; so does
 * a reload, through this tab's session storage. Nothing is kept anywhere else:
 * the server stores no chats, and signing out clears this tab's copy
 * (`forgetAssistant`), so the next person at this browser starts clean.
 */

export type AskTable = { sheet: ExportSheet; href: string };

/** A card under an answer: what it will change, and what pressing it did. */
export type AskAction = {
  draft: ActionDraft;
  /** Set once pressing it has an answer that stands: done, or refused for good. */
  result?: ActionResult;
};

export type AskMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  tables: AskTable[];
  /** While answering: what it is doing now. */
  status?: string;
  pending?: boolean;
  /** A drafted month of visits under the answer, and what saving it did. */
  plan?: PlanDraft;
  planSaved?: { added: number; already: number; pastDays?: number };
  /** Changes the AI Manager drafted, made only when the person presses their buttons. */
  actions?: AskAction[];
  /** Pages to do something on by hand. */
  links?: AssistantLink[];
  /** Not about the business: shown, but not sent back as context. */
  refused?: boolean;
  error?: string;
};

type AssistantState = {
  /** What this person may ask about; null until their access is known. */
  tools: ToolSpec[] | null;
  open: boolean;
  setOpen: (open: boolean) => void;
  messages: AskMessage[];
  busy: boolean;
  left: QuestionsLeft | null;
  ask: (question: string) => void;
  /** Saves the plan under an answer to the schedule. Resolves with an error to show, or null. */
  savePlan: (messageId: string) => Promise<string | null>;
  /** Makes the change on a card. Resolves with an error to show that pressing again may fix, or null. */
  doAction: (messageId: string, draftId: string) => Promise<string | null>;
  stop: () => void;
  reset: () => void;
};

const Ctx = createContext<AssistantState | null>(null);

const STORAGE_KEY = "tickd.ask.v1";

type Stored = { orgId: string; open: boolean; messages: AskMessage[]; left: QuestionsLeft | null };

/**
 * Bumped on sign-out. A provider remembers the one it started under and stops
 * saving once it changes, so an answer still streaming as somebody signs out
 * cannot write their conversation back for the next person at this tab.
 */
let signOuts = 0;

/** Clears this tab's conversation. Called on sign-out. */
export function forgetAssistant() {
  signOuts++;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage blocked: nothing was kept
  }
}

function load(orgId: string): Stored | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Stored;
    // Another company's conversation, from before a switch, is not shown here.
    return stored.orgId === orgId && Array.isArray(stored.messages) ? stored : null;
  } catch {
    return null;
  }
}

function save(stored: Stored) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Full or blocked: the conversation still works, it just won't survive a reload.
  }
}

let counter = 0;
const newId = () => `${Date.now().toString(36)}-${(counter++).toString(36)}`;


export function AssistantProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const permissions = usePermissions();
  // Planning is offered once the database says this person is a manager.
  const isManager = useIsManager();
  const company = useCompanyConfig();
  const tools = useMemo(
    () => (permissions && company ? toolsFor(permissions, company.modules, isManager === true) : null),
    [permissions, company, isManager]
  );

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AskMessage[]>([]);
  const [left, setLeft] = useState<QuestionsLeft | null>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [session] = useState(() => signOuts);

  const orgId = company?.orgId ?? null;

  // Restore this tab's conversation once the company is known.
  useEffect(() => {
    if (!orgId || loadedFor === orgId) return;
    const stored = load(orgId);
    /* eslint-disable react-hooks/set-state-in-effect -- restoring from storage once the company is known */
    setMessages(stored?.messages ?? []);
    setLeft(stored?.left ?? null);
    setOpen(stored?.open ?? false);
    setLoadedFor(orgId);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [orgId, loadedFor]);

  useEffect(() => {
    if (!orgId || loadedFor !== orgId || session !== signOuts) return;
    // A question whose answer is still coming is left out with it: restored
    // alone it would read as asked and never answered.
    const done = messages.filter((m, i) => !m.pending && !(m.role === "user" && messages[i + 1]?.pending));
    save({ orgId, open, left, messages: done });
  }, [orgId, loadedFor, session, open, left, messages]);

  // The real count, each time the window opens: after signing in again, on
  // another device, or once the hour has moved on.
  const hasTools = tools !== null && tools.length > 0;
  useEffect(() => {
    if (!open || !hasTools) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/assistant", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { left?: QuestionsLeft | null };
        if (!cancelled && body.left) setLeft(body.left);
      } catch {
        // Not worth an error: the next answer brings the count anyway.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, hasTools]);

  const update = useCallback((id: string, change: (m: AskMessage) => AskMessage) => {
    setMessages((all) => all.map((m) => (m.id === id ? change(m) : m)));
  }, []);

  const ask = useCallback(
    (question: string) => {
      const text = question.trim();
      if (!text || busy) return;

      const user: AskMessage = { id: newId(), role: "user", text, tables: [] };
      const answer: AskMessage = {
        id: newId(),
        role: "assistant",
        text: "",
        tables: [],
        pending: true,
        status: "Sending",
      };
      const turns = [...history(messages), { role: "user" as const, text }];
      setMessages((all) => [...all, user, answer]);
      setBusy(true);

      const controller = new AbortController();
      abortRef.current = controller;

      void (async () => {
        try {
          const res = await fetch("/api/assistant", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages: turns }),
            signal: controller.signal,
          });

          // Refused before it started (signed out, limit reached): a JSON error.
          if (!res.ok || !res.body) {
            const raw = await res.text();
            let message = `Ask could not answer (${res.status}). Try again in a moment.`;
            try {
              const parsed = JSON.parse(raw) as { error?: string };
              if (parsed.error) message = parsed.error;
            } catch {
              // not JSON: keep the plain message
            }
            if (res.status === 429) setLeft((l) => (l ? { ...l, hour: 0 } : { hour: 0, day: 0 }));
            update(answer.id, (m) => ({ ...m, pending: false, status: undefined, error: message }));
            return;
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const { events, rest } = decodeEvents(buffer);
            buffer = rest;
            for (const e of events) {
              if (e.type === "status") update(answer.id, (m) => ({ ...m, status: e.text }));
              else if (e.type === "text") update(answer.id, (m) => ({ ...m, text: m.text + e.text, status: undefined }));
              else if (e.type === "table") update(answer.id, (m) => ({ ...m, tables: [...m.tables, { sheet: e.sheet, href: e.href }] }));
              else if (e.type === "plan") update(answer.id, (m) => ({ ...m, plan: e.plan }));
              else if (e.type === "action") update(answer.id, (m) => ({ ...m, actions: [...(m.actions ?? []), { draft: e.action }] }));
              else if (e.type === "link")
                update(answer.id, (m) =>
                  (m.links ?? []).some((l) => l.href === e.link.href) ? m : { ...m, links: [...(m.links ?? []), e.link] }
                );
              else if (e.type === "refused")
                update(answer.id, (m) => ({ ...m, text: e.text, tables: [], actions: undefined, links: undefined, refused: true }));
              else if (e.type === "error") update(answer.id, (m) => ({ ...m, error: e.text }));
              else if (e.type === "done") {
                if (e.left) setLeft(e.left);
                update(answer.id, (m) => ({ ...m, pending: false, status: undefined }));
              }
            }
          }
          // The stream ended without saying it was done: the connection dropped.
          update(answer.id, (m) =>
            m.pending
              ? { ...m, pending: false, status: undefined, error: m.text ? undefined : "The answer was cut off. Try again." }
              : m
          );
        } catch {
          update(answer.id, (m) => ({
            ...m,
            pending: false,
            status: undefined,
            error: controller.signal.aborted
              ? m.text
                ? undefined
                : "Stopped."
              : "Ask couldn't be reached. Check your connection and try again.",
          }));
        } finally {
          if (abortRef.current === controller) abortRef.current = null;
          setBusy(false);
        }
      })();
    },
    [busy, messages, update]
  );

  const savePlan = useCallback(
    async (messageId: string): Promise<string | null> => {
      const plan = messages.find((m) => m.id === messageId)?.plan;
      if (!plan) return "That plan is no longer here. Ask for a new draft.";
      try {
        const res = await fetch("/api/assistant/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ staffId: plan.staffId, days: plan.days }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          added?: number;
          already?: number;
          pastDays?: number;
        };
        if (!res.ok) return body.error ?? `The plan could not be saved (${res.status}).`;
        update(messageId, (m) => ({
          ...m,
          planSaved: { added: body.added ?? 0, already: body.already ?? 0, pastDays: body.pastDays ?? 0 },
        }));
        return null;
      } catch {
        return "The plan couldn't be saved. Check your connection and try again.";
      }
    },
    [messages, update]
  );

  const doAction = useCallback(
    async (messageId: string, draftId: string): Promise<string | null> => {
      const draft = messages.find((m) => m.id === messageId)?.actions?.find((a) => a.draft.id === draftId)?.draft;
      if (!draft) return "That card is no longer here. Ask the AI Manager again.";
      const settle = (result: ActionResult) =>
        update(messageId, (m) => ({
          ...m,
          actions: m.actions?.map((a) => (a.draft.id === draftId ? { ...a, result } : a)),
        }));
      try {
        const res = await fetch("/api/assistant/act", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: draft.name, input: draft.input }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string; done?: string; href?: string };
        if (res.ok) {
          settle({ done: true, text: body.done ?? "Done.", href: body.href ?? draft.href });
          // The page behind the chat reads its data again, so the change shows.
          announceChange(body.href ?? draft.href);
          return null;
        }
        const message = body.error ?? `That couldn't be done (${res.status}).`;
        // Refused for good (not allowed, changed since, no longer valid): the
        // card says so and stays that way. Anything else may work next time.
        if (res.status === 400 || res.status === 403 || res.status === 409) {
          settle({ done: false, text: message });
          return null;
        }
        return message;
      } catch {
        return "That couldn't be done. Check your connection and try again.";
      }
    },
    [messages, update]
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
  }, []);

  const value = useMemo<AssistantState>(
    () => ({ tools, open, setOpen, messages, busy, left, ask, savePlan, doAction, stop, reset }),
    [tools, open, messages, busy, left, ask, savePlan, doAction, stop, reset]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAssistant(): AssistantState {
  const state = useContext(Ctx);
  if (!state) throw new Error("useAssistant must be used inside AssistantProvider.");
  return state;
}
