"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyRow, ErrorBanner } from "@/components/warehouse/stat-tile";
import { OrderStepDialog, type StepTarget } from "@/components/orders/order-step-dialog";
import { archiveMonths, fetchArchivedOrders, type ArchivedOrder } from "@/lib/orders";
import { formatMoney } from "@/lib/money";
import { useCompanyConfig, useTerms } from "@/lib/use-company-config";
import { lower } from "@/lib/terms";

type Show = "delivered" | "cancelled";

/** What the table shows, and which list it is: `key` is the switch and the search it was read for. */
type List = { key: string; rows: ArchivedOrder[]; more: boolean };

/**
 * The orders archive: everything finished, the newest first.
 *
 * An order leaves the board for here once it is delivered with its signed POD
 * on file (the owner, 19 Oct 2026: "when it's delivered, it's archived ... from
 * the newest date going downwards"). Newest by the day it was delivered, then
 * the day it was taken, in month blocks so a long list still scans. Cancelled
 * orders are finished too, and sit behind the switch.
 *
 * A delivered order whose POD never came is listed here as well, marked, so
 * the archive is the whole record; it also stays on the board until the POD is
 * uploaded.
 *
 * Days and months are the company's (its time zone), not the browser's, so a
 * delivery just after midnight on the 1st is that month's wherever the page is
 * opened.
 */
export default function OrdersArchivePage() {
  const router = useRouter();
  const terms = useTerms();
  const config = useCompanyConfig();
  const currency = config?.settings.currency_code ?? "";
  const timeZone = config?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  const [show, setShow] = useState<Show>("delivered");
  const [search, setSearch] = useState("");
  /** The term the query runs on, a beat behind the box, trimmed. */
  const [term, setTerm] = useState("");
  const [list, setList] = useState<List | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [target, setTarget] = useState<StepTarget | null>(null);
  /** Set once the link's `?show=` and `?q=` are read, so the first read uses them. */
  const [ready, setReady] = useState(false);
  /** Bumped by "Try again", to read the same list again. */
  const [attempt, setAttempt] = useState(0);
  /** The newest read, so a slow one cannot land on top of a newer search. */
  const seq = useRef(0);
  const noticeRef = useRef<HTMLParagraphElement>(null);

  const listKey = `${show}|${term}`;
  /** The list asked for, once read. An older one is not shown under a new search as if it matched. */
  const shown = list !== null && list.key === listKey ? list : null;
  /** Set when a POD was filed, so focus goes to the message rather than the vanished button. */
  const focusNotice = useRef(false);

  // Read from `window`, not `useSearchParams`, which would force a Suspense
  // boundary here. The board's "Search the archive too" link lands with `?q=`.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = (params.get("q") ?? "").trim();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (params.get("show") === "cancelled") setShow("cancelled");
    setSearch(q);
    setTerm(q);
    setReady(true);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setTerm(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!ready) return;
    const run = ++seq.current;
    const key = `${show}|${term}`;
    (async () => {
      try {
        const page = await fetchArchivedOrders(createClient(), { show, search: term });
        if (run !== seq.current) return;
        setList({ key, rows: page.rows, more: page.more });
        setError(null);
      } catch (e) {
        if (run === seq.current) setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [ready, show, term, attempt]);

  // Keeps the address in step, so a refresh or a shared link shows the same list.
  useEffect(() => {
    if (!ready) return;
    const params = new URLSearchParams();
    if (show === "cancelled") params.set("show", "cancelled");
    if (term) params.set("q", term);
    const next = params.toString();
    window.history.replaceState(null, "", next ? `/orders/archive?${next}` : "/orders/archive");
  }, [ready, show, term]);

  async function showMore() {
    if (!shown) return;
    const run = seq.current;
    const key = shown.key;
    setLoadingMore(true);
    try {
      const page = await fetchArchivedOrders(createClient(), { show, search: term, offset: shown.rows.length });
      if (run !== seq.current) return;
      // By id, in case an order was archived between the two reads and shifted
      // the page by one.
      setList((prev) => {
        if (!prev || prev.key !== key) return prev;
        const seen = new Set(prev.rows.map((r) => r.id));
        return { key, rows: [...prev.rows, ...page.rows.filter((r) => !seen.has(r.id))], more: page.more };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingMore(false);
    }
  }

  function choose(next: Show) {
    if (next === show) return;
    setNotice(null);
    setShow(next);
  }

  /**
   * A POD was filed (or had been already). Only that row changes, so it is
   * changed in place: re-reading the first page threw away every older page the
   * clerk had opened to reach it.
   */
  function podDone(message: string, ok: boolean) {
    const done = target?.orderId;
    setList((prev) =>
      prev ? { ...prev, rows: prev.rows.map((r) => (r.id === done ? { ...r, podStatus: "received" } : r)) } : prev
    );
    focusNotice.current = true;
    setTarget(null);
    if (ok) setNotice(message);
    else setError(message);
  }

  const money = (n: number) => formatMoney(n, currency);
  const day = (iso: string | null) => {
    if (!iso) return "Not recorded";
    try {
      return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone });
    } catch {
      return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
    }
  };
  const cols = 6;
  const months = shown ? archiveMonths(shown.rows, timeZone) : [];

  let body;
  if (shown && shown.rows.length > 0) {
    body = months.map((block, i) => (
      <Fragment key={block.month}>
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={cols} className="bg-muted/40 py-1.5 text-xs font-medium text-muted-foreground">
            {block.month}
            {/* A count only for a month that is all on screen: the last block
                may carry on into the next page. */}
            {(i < months.length - 1 || !shown.more) &&
              ` · ${block.rows.length} ${block.rows.length === 1 ? "order" : "orders"}`}
          </TableCell>
        </TableRow>
        {block.rows.map((o) => (
          <TableRow key={o.id} onClick={() => router.push(`/orders/${o.id}`)} className="cursor-pointer">
            <TableCell className="whitespace-nowrap text-muted-foreground">{day(o.closedAt)}</TableCell>
            <TableCell>
              <Link
                href={`/orders/${o.id}`}
                onClick={(e) => e.stopPropagation()}
                className="font-medium text-primary hover:underline"
              >
                {o.orderNumber}
              </Link>
              {o.invoiceNumber && <div className="text-xs text-muted-foreground">Invoice {o.invoiceNumber}</div>}
            </TableCell>
            <TableCell>
              <div>{o.storeName ?? `No ${lower(terms.site.one)} named`}</div>
              {o.contactName && <div className="text-xs text-muted-foreground">{o.contactName}</div>}
            </TableCell>
            <TableCell>
              {show === "cancelled" ? (
                <span className="text-muted-foreground">{o.cancelReason ?? "No reason given"}</span>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span>{o.receivedBy ?? <span className="text-muted-foreground">Not recorded</span>}</span>
                  {o.podStatus === "outstanding" && (
                    <>
                      <Badge variant="destructive">No POD</Badge>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setNotice(null);
                          setTarget({ orderId: o.id, orderNumber: o.orderNumber, step: "pod" });
                        }}
                      >
                        Upload POD
                      </Button>
                    </>
                  )}
                </div>
              )}
            </TableCell>
            <TableCell className="text-muted-foreground">{o.repName ?? "None"}</TableCell>
            <TableCell className="text-right font-medium tabular-nums">{money(o.total)}</TableCell>
          </TableRow>
        ))}
      </Fragment>
    ));
  } else if (shown) {
    body = (
      <EmptyRow colSpan={cols}>
        {term
          ? show === "delivered"
            ? `No delivered order matches "${term}". It may be cancelled (switch to Cancelled) or still on the orders board.`
            : `No cancelled order matches "${term}". It may be delivered (switch to Delivered) or still on the orders board.`
          : show === "delivered"
            ? "Nothing has been delivered yet."
            : "No orders have been cancelled."}
      </EmptyRow>
    );
  } else if (error) {
    // The list asked for could not be read. The old one is not shown under the
    // new search as if it matched.
    body = (
      <EmptyRow colSpan={cols}>
        This list could not be loaded.{" "}
        <button type="button" onClick={() => setAttempt((n) => n + 1)} className="font-medium text-primary hover:underline">
          Try again
        </button>
      </EmptyRow>
    );
  } else {
    body = Array.from({ length: 6 }, (_, i) => (
      <TableRow key={i}>
        <TableCell colSpan={cols}>
          <div className="h-5 animate-pulse rounded bg-muted/60" />
        </TableCell>
      </TableRow>
    ));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/orders" className="text-sm text-muted-foreground hover:underline">
            ← Orders board
          </Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground">Archive</h1>
          <p className="text-sm text-muted-foreground">
            {show === "delivered" ? "Delivered orders, the newest delivery first." : "Cancelled orders, the newest first."}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Which orders" className="inline-flex rounded-lg border border-border p-0.5">
          {(["delivered", "cancelled"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={show === s}
              onClick={() => choose(s)}
              className={[
                "rounded-md px-3 py-1 text-sm transition-colors duration-150",
                "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                show === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              ].join(" ")}
            >
              {s === "delivered" ? "Delivered" : "Cancelled"}
            </button>
          ))}
        </div>
        <div className="relative min-w-56 flex-1 sm:max-w-sm">
          <Search className="absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search order, invoice, ${lower(terms.site.one)} or contact`}
            aria-label="Search the archive"
            className="pl-8"
          />
        </div>
      </div>

      <ErrorBanner message={error} />
      {/* Always in the page, so screen readers announce what is put in it. */}
      <div role="status" aria-live="polite">
        {notice && (
          <p
            ref={noticeRef}
            tabIndex={-1}
            className="rounded-lg border border-border bg-muted/40 p-2.5 text-sm text-foreground"
          >
            {notice}
          </p>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{show === "delivered" ? "Delivered" : "Cancelled"}</TableHead>
              <TableHead>Order</TableHead>
              <TableHead>{terms.site.one}</TableHead>
              <TableHead>{show === "delivered" ? "Received by" : "Why"}</TableHead>
              <TableHead>{terms.staff.one}</TableHead>
              <TableHead className="text-right">Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>{body}</TableBody>
        </Table>
      </div>

      {shown?.more && (
        <Button variant="outline" onClick={showMore} disabled={loadingMore}>
          {loadingMore ? "Loading…" : "Show older orders"}
        </Button>
      )}

      <OrderStepDialog
        target={target}
        onClose={() => {
          focusNotice.current = false;
          setTarget(null);
        }}
        onDone={podDone}
        // The row's Upload POD button is gone once the POD is filed: the
        // message that says so takes the focus instead.
        finalFocus={() => (focusNotice.current ? noticeRef.current : null)}
      />
    </div>
  );
}
