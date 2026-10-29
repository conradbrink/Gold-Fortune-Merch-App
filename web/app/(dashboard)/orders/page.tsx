"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, CalendarClock, Clock, FileText, Plus, Printer, Receipt, Search, User } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { ErrorBanner } from "@/components/warehouse/stat-tile";
import { OrderStepDialog, type StepTarget } from "@/components/orders/order-step-dialog";
import { fetchPipelineOrders, type PipelineOrder } from "@/lib/order-pipeline";
import { printDeliveryNote, printDeliveryNotes, printPickingLists, sheetFor, sheetsFor } from "@/lib/order-paper";
import {
  BOARD_COLUMNS,
  boardSince,
  boardViewFromQuery,
  columnEmptyText,
  columnLabel,
  columnOf,
  dayInZone,
  daysBetween,
  dropAnswer,
  invoicesOnConfirm,
  deliversOrders,
  invoicesWithoutStock,
  keepsStock,
  matchesSearch,
  nextStepOf,
  poExpiry,
  stepLabel,
  waitTone,
  waitWords,
  type BoardColumn,
  type BoardStep,
} from "@/lib/order-board";
import { formatMoney, formatMoneyShort } from "@/lib/money";
import { dayLabel } from "@/lib/store-reorder";
import { useCompanyConfig, useTerms } from "@/lib/use-company-config";
import { lower, withArticle } from "@/lib/terms";

/**
 * The drag payload's type. Not `text/plain`: a card let go over a text box
 * would type its order id into it (Firefox does), including the board's own
 * search box, which then hides every card.
 */
const DRAG_TYPE = "application/x-tickd-order";

/**
 * Orders, as a board: purchase orders, invoiced, packed, dispatched, delivered.
 *
 * Built the way the leads board is (same columns, same drag, same reasons),
 * with one difference that matters: moving a lead changes a label, and moving
 * an order moves stock and issues invoices. So a drop opens the step's dialog
 * (`OrderStepDialog`) and the card only lands in its new column when the
 * database has said yes. Which drops mean what is in `lib/order-board.ts`.
 *
 * Every card also carries its next step as a button. HTML5 drag events do not
 * fire for touch or the keyboard, and a board that only drags is a board half
 * the warehouse cannot use.
 *
 * Finished orders are not here. Once delivered with its signed POD on file, an
 * order goes to the archive (`/orders/archive`, newest first).
 */
export default function OrdersBoardPage() {
  const router = useRouter();
  const terms = useTerms();
  const config = useCompanyConfig();
  const invoices = invoicesOnConfirm(config);
  const currency = config?.settings.currency_code ?? "";
  const timeZone = config?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  /**
   * Moving an order on (confirming, packing, dispatching) is the warehouse
   * module; the board itself only needs distribution. Without the module every
   * step would be refused, so the board shows where orders are and moves none.
   */
  const canMove = keepsStock(config);
  /**
   * No Inventory: a new order is invoiced on its own page and, with
   * Deliveries, dispatched and delivered from there too.
   */
  const withoutStock = invoicesWithoutStock(config);
  const delivers = deliversOrders(config);

  const [orders, setOrders] = useState<PipelineOrder[]>([]);
  /** When the board was read: "today" and every "waiting 3 days" are counted to it. */
  const [readAt, setReadAt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Orders ticked to print together. Only cards still on the board print, so a filter never prints what it hides. */
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  /** What the last step did, or why a drop was not a move. */
  const [notice, setNotice] = useState<{ text: string; tone: "done" | "hint" } | null>(null);
  const [query, setQuery] = useState("");
  const [repFilter, setRepFilter] = useState("all");
  /** Every rep seen on the board, so a filtered rep keeps a name when their last card leaves. */
  const [repNames, setRepNames] = useState<Map<string, string>>(new Map());
  /** Columns a dashboard link asked for, outlined so the eye lands there. */
  const [lit, setLit] = useState<BoardColumn[]>([]);
  const [target, setTarget] = useState<StepTarget | null>(null);
  /** Where keyboard focus goes when a step's dialog closes: its card, in its new column. */
  const focusAfter = useRef<string | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);

  /**
   * The dragged card, in a ref as well as state: `dragover` fires before React
   * re-renders from `dragstart`, and a column that skips `preventDefault` on
   * that first event is not a drop target. Same as the leads board.
   */
  const draggingRef = useRef<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<BoardColumn | null>(null);

  /** Reads the board, keeping the cards on screen while it reloads. */
  const load = useCallback(async () => {
    try {
      const rows = await fetchPipelineOrders(createClient());
      setOrders(rows);
      setReadAt(Date.now());
      setRepNames((prev) => {
        const next = new Map(prev);
        for (const o of rows) if (o.repId) next.set(o.repId, o.repName ?? "Unnamed");
        return next;
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // The links the old orders list understood (`?q=`, `?status=`, `?pod=`),
  // read from `window` rather than `useSearchParams`, which would force a
  // Suspense boundary on this page. A link that only asks for finished orders
  // is sent to the archive.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const view = boardViewFromQuery(params);
    if (view.archive) {
      router.replace(view.archive);
      return;
    }
    const q = params.get("q");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (q) setQuery(q);
    setLit(view.columns);
    load();
  }, [load, router]);

  // Bring the column a link asked for into view, once there is something to see.
  // On a phone the columns stack, and the one asked for may be four screens down.
  useEffect(() => {
    if (loading || lit.length === 0) return;
    const el = document.getElementById(`column-${lit[0]}`);
    // Only when it is off screen: on a laptop every column is already in view.
    if (el && el.getBoundingClientRect().top > window.innerHeight * 0.6) el.scrollIntoView({ block: "start" });
  }, [loading, lit]);

  const reps = useMemo(() => {
    const seen = new Map<string, string>();
    for (const o of orders) if (o.repId) seen.set(o.repId, o.repName ?? "Unnamed");
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [orders]);
  // A rep chosen whose last card has left still needs an option, or the select
  // shows "Every rep" while the board stays filtered to nobody.
  const chosenGone = repFilter !== "all" && !reps.some(([id]) => id === repFilter);

  const visible = useMemo(
    () =>
      orders
        .filter((o) => (repFilter === "all" || o.repId === repFilter) && matchesSearch(o, query))
        // Longest waiting at the top of each column: it is the one to deal with first.
        .sort((a, b) => Date.parse(boardSince(a)) - Date.parse(boardSince(b))),
    [orders, repFilter, query]
  );
  const filtered = query.trim() !== "" || repFilter !== "all";

  // One clock for the whole board: the moment it was read, in the company's
  // calendar. Lateness and waiting are both counted to it.
  // Before the first read nothing is shown that needs it (the skeleton is up).
  const today = dayInZone(readAt, timeZone);
  const daysOf = (o: PipelineOrder) => daysBetween(dayInZone(boardSince(o), timeZone), today);
  const stale = visible.filter((o) => columnOf(o) !== "delivered" && waitTone(daysOf(o)) === "red").length;
  const money = (n: number) => formatMoney(n, currency);

  const dragged = dragging ? orders.find((o) => o.id === dragging) : undefined;
  // Printing reads dispatches and drivers, which are part of the warehouse module, like moving a card.
  const tickedOrders = canMove ? visible.filter((o) => ticked.has(o.id)) : [];
  const sheets = sheetsFor(tickedOrders);

  function tick(ids: string[], on: boolean) {
    setTicked((t) => {
      const next = new Set(t);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  /** Every ticked sheet of one kind in one PDF, in the board's order: one print box. */
  function printTicked(print: typeof printPickingLists, ids: string[]) {
    setError(null);
    print(createClient(), ids).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }

  function open(o: PipelineOrder, step: BoardStep) {
    setNotice(null);
    setTarget({ orderId: o.id, orderNumber: o.orderNumber, step, invoiceNumber: o.invoiceNumber });
  }

  function drop(o: PipelineOrder, to: BoardColumn) {
    const answer = dropAnswer(o, to, invoices);
    if (answer === null) return;
    if ("refuse" in answer) {
      setNotice({ text: answer.refuse, tone: "hint" });
      return;
    }
    open(o, answer.step);
  }

  /**
   * A step finished. The board is re-read before the dialog closes, so for the
   * length of the reload the dialog stays (busy) over the old board rather than
   * handing back a card that still offers the step just done.
   */
  async function stepDone(message: string, ok: boolean) {
    const orderId = target?.orderId ?? null;
    await load();
    focusAfter.current = orderId;
    setTarget(null);
    // After the reload, which clears the error banner.
    if (ok) setNotice({ text: message, tone: "done" });
    else setError(message);
  }

  function clearFilters() {
    setQuery("");
    setRepFilter("all");
  }

  const subtitle = loading
    ? "Every order on its way out."
    : error && orders.length === 0
      ? "The board could not be loaded."
      : filtered
        ? `${visible.length} of ${orders.length} ${orders.length === 1 ? "order" : "orders"} on the board`
        : `${orders.length} ${orders.length === 1 ? "order" : "orders"} on the board`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Orders</h1>
          <p className="text-sm text-muted-foreground">
            {subtitle}
            {!loading && stale > 0 && ` · ${stale} waiting over a week`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" nativeButton={false} render={<Link href="/orders/archive" />}>
            <Archive className="mr-1.5 h-4 w-4" /> Archive
          </Button>
          {/* The dashboard's Orders pipeline card as a page: how long each order has waited. */}
          <Button variant="outline" nativeButton={false} render={<Link href="/orders/pipeline" />}>
            Pipeline
          </Button>
          <Button nativeButton={false} render={<Link href="/orders/new" />}>
            <Plus className="mr-1.5 h-4 w-4" /> Capture an order
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-sm">
          <Search className="absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search order, invoice, PO, ${lower(terms.site.one)} or contact`}
            aria-label="Search the board"
            className="pl-8"
          />
        </div>
        <NativeSelect
          value={repFilter}
          onChange={(e) => setRepFilter(e.target.value)}
          aria-label={`Filter by ${lower(terms.staff.one)}`}
        >
          <option value="all">{`Every ${lower(terms.staff.one)}`}</option>
          {chosenGone && (
            <option value={repFilter}>{`${repNames.get(repFilter) ?? "Unnamed"} (nothing on the board)`}</option>
          )}
          {reps.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </NativeSelect>
        {query.trim() && (
          <Link
            href={`/orders/archive?q=${encodeURIComponent(query.trim())}`}
            className="text-sm text-primary hover:underline"
          >
            Search the archive too
          </Link>
        )}
      </div>

      {!canMove && (
        <p className="rounded-lg border border-border bg-muted/40 p-2.5 text-sm text-muted-foreground">
          {withoutStock
            ? delivers
              ? "Your company does not track stock, so orders are not picked or packed. Open an order to invoice it, dispatch it and record its delivery."
              : "Your company does not track stock, so orders are not packed or dispatched here. Open a purchase order to confirm and invoice it."
            : "Confirming, packing and dispatching orders is part of Inventory, which is not switched on for your company. The board shows where each order is, but cannot move it on."}
        </p>
      )}
      <ErrorBanner message={error} />
      {/* Always in the page, so screen readers announce what is put in it. */}
      <div role="status" aria-live="polite">
        {notice && (
          <p
            ref={noticeRef}
            tabIndex={-1}
            className={
              notice.tone === "hint"
                ? "rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-sm text-amber-700 dark:text-amber-500"
                : "rounded-lg border border-border bg-muted/40 p-2.5 text-sm text-foreground"
            }
          >
            {notice.text}
          </p>
        )}
      </div>

      {loading ? (
        <div className="grid gap-3 lg:grid-cols-5">
          {BOARD_COLUMNS.map((c) => (
            <div key={c} className="h-48 animate-pulse rounded-md bg-muted/50" />
          ))}
        </div>
      ) : (
        <>
          {orders.length === 0 && !error && (
            <p className="text-sm text-muted-foreground">
              No orders are in progress. Capture one, or wait for {withArticle(terms, "staff")} to send one in.
              Finished orders are in the{" "}
              <Link href="/orders/archive" className="text-primary hover:underline">
                archive
              </Link>
              .
            </p>
          )}
          {orders.length > 0 && visible.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No order on the board matches.{" "}
              <button type="button" onClick={clearFilters} className="font-medium text-primary hover:underline">
                Show every order
              </button>
              {query.trim() ? ", or search the archive with the link above." : "."}
            </p>
          )}
          {/* What the ticks are for: each kind of sheet for every ticked order, in one PDF. */}
          {tickedOrders.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 p-2.5">
              <p className="mr-auto text-sm">
                {tickedOrders.length === 1 ? "1 order ticked" : `${tickedOrders.length} orders ticked`}
              </p>
              {sheets.picking.length > 0 && (
                <Button size="sm" onClick={() => printTicked(printPickingLists, sheets.picking)}>
                  <Printer className="mr-1.5 h-4 w-4" />
                  {sheets.picking.length === 1 ? "Print the picking list" : `Print ${sheets.picking.length} picking lists`}
                </Button>
              )}
              {sheets.delivery.length > 0 && (
                <Button size="sm" onClick={() => printTicked(printDeliveryNotes, sheets.delivery)}>
                  <Printer className="mr-1.5 h-4 w-4" />
                  {sheets.delivery.length === 1 ? "Print the delivery note" : `Print ${sheets.delivery.length} delivery notes`}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setTicked(new Set())}>
                Clear
              </Button>
            </div>
          )}
          <div className="grid gap-3 lg:grid-cols-5">
            {BOARD_COLUMNS.map((column) => {
              const cards = visible.filter((o) => columnOf(o) === column);
              // A column whose orders print a sheet can be ticked as a whole.
              const printable = canMove ? cards.filter((o) => sheetFor(o.status)) : [];
              const columnTicked = printable.length > 0 && printable.every((o) => ticked.has(o.id));
              const total = cards.reduce((n, o) => n + o.total, 0);
              const answer = dragged ? dropAnswer(dragged, column, invoices) : null;
              const accepts = answer !== null && "step" in answer;
              const look =
                dragOver === column && accepts
                  ? "border-dashed border-primary bg-primary/10"
                  : dragOver === column
                    ? "border-dashed border-muted-foreground/40 bg-muted/40"
                    : accepts
                      ? "border-dashed border-primary/50 bg-muted/20"
                      : lit.includes(column)
                        ? "border-primary/60 bg-muted/20"
                        : "border-border bg-muted/20";
              const under =
                column === "delivered"
                  ? cards.length > 0
                    ? "Waiting for the signed POD"
                    : "Goes to the archive with its POD"
                  : cards.length > 0
                    ? formatMoneyShort(total, currency)
                    : " ";
              return (
                <section
                  key={column}
                  id={`column-${column}`}
                  aria-label={columnLabel(column, invoices)}
                  // preventDefault on every dragover is what makes this a drop
                  // target. Every column accepts the drop, including the wrong
                  // ones, so a wrong drop can say why instead of just bouncing.
                  onDragOver={(e) => {
                    if (!draggingRef.current) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setDragOver((s) => (s === column ? s : column));
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setDragOver((s) => (s === column ? null : s));
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData(DRAG_TYPE) || draggingRef.current;
                    draggingRef.current = null;
                    setDragOver(null);
                    setDragging(null);
                    const o = orders.find((x) => x.id === id);
                    if (o) drop(o, column);
                  }}
                  className={[
                    // Always border-2, so a highlight never shifts the cards.
                    // scroll-mt clears the sticky top bar when a link scrolls here.
                    "flex min-w-0 scroll-mt-20 flex-col rounded-md border-2 transition-colors duration-150",
                    look,
                  ].join(" ")}
                >
                  <header className="border-b border-border px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        {printable.length > 0 && (
                          <Checkbox
                            checked={columnTicked}
                            aria-label={`Tick every order in ${columnLabel(column, invoices)}`}
                            onCheckedChange={(v) => tick(printable.map((o) => o.id), v === true)}
                          />
                        )}
                        <h2 className="text-sm font-medium text-foreground">{columnLabel(column, invoices)}</h2>
                      </div>
                      <Badge variant={column === "delivered" && cards.length > 0 ? "destructive" : "secondary"}>
                        {cards.length}
                      </Badge>
                    </div>
                    <p className="text-xs tabular-nums text-muted-foreground">{under}</p>
                  </header>

                  <div className="min-h-28 flex-1 space-y-2 p-2">
                    {cards.length === 0 ? (
                      <p className="px-1 py-6 text-center text-xs text-muted-foreground">
                        {dragOver === column && accepts
                          ? "Drop to move it here"
                          : filtered
                            ? "Nothing here matches."
                            : canMove
                              ? columnEmptyText(column, invoices)
                              : "Nothing here."}
                      </p>
                    ) : (
                      cards.map((o) => (
                        <OrderCard
                          key={o.id}
                          order={o}
                          days={daysOf(o)}
                          today={today}
                          invoices={invoices}
                          canMove={canMove}
                          withoutStock={withoutStock}
                          delivers={delivers}
                          money={money}
                          staffWord={lower(terms.staff.one)}
                          siteWord={lower(terms.site.one)}
                          faded={dragging === o.id}
                          onStep={(step) => open(o, step)}
                          ticked={ticked.has(o.id)}
                          onTick={(on) => tick([o.id], on)}
                          onPrint={() => {
                            setError(null);
                            printDeliveryNote(createClient(), o.id).catch((e) =>
                              setError(e instanceof Error ? e.message : String(e))
                            );
                          }}
                          onDragStart={(e) => {
                            e.dataTransfer.setData(DRAG_TYPE, o.id);
                            e.dataTransfer.effectAllowed = "move";
                            draggingRef.current = o.id;
                            // A frame later: the browser snapshots the drag image
                            // straight after this handler, and fading the card now
                            // makes the ghost faded too.
                            requestAnimationFrame(() => setDragging(o.id));
                          }}
                          onDragEnd={() => {
                            draggingRef.current = null;
                            setDragging(null);
                            setDragOver(null);
                          }}
                        />
                      ))
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}

      {!loading && (
        <Button variant="outline" size="sm" onClick={() => load()}>
          Refresh
        </Button>
      )}

      <OrderStepDialog
        target={target}
        onClose={(changed) => {
          focusAfter.current = null;
          setTarget(null);
          // Part of the step went through (picking was started): the card has moved on.
          if (changed) load();
        }}
        onDone={stepDone}
        finalFocus={() =>
          (focusAfter.current ? document.getElementById(`card-${focusAfter.current}`) : null) ??
          (focusAfter.current ? noticeRef.current : null)
        }
      />
    </div>
  );
}

function OrderCard({
  order: o,
  days,
  today,
  invoices,
  canMove,
  withoutStock,
  delivers,
  money,
  staffWord,
  siteWord,
  faded,
  onStep,
  ticked,
  onTick,
  onPrint,
  onDragStart,
  onDragEnd,
}: {
  order: PipelineOrder;
  days: number;
  today: string;
  invoices: boolean;
  canMove: boolean;
  /** No warehouse: a new order is confirmed and invoiced on its own page. */
  withoutStock: boolean;
  /** With Deliveries, such an order is then dispatched and delivered from its page too. */
  delivers: boolean;
  money: (n: number) => string;
  staffWord: string;
  siteWord: string;
  faded: boolean;
  onStep: (step: BoardStep) => void;
  /** Ticked to print with others. */
  ticked: boolean;
  onTick: (on: boolean) => void;
  /** Print the delivery note that goes with the goods. */
  onPrint: () => void;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
}) {
  const column = columnOf(o);
  const step = nextStepOf(o);
  const tone = column === "delivered" ? "red" : waitTone(days);
  const late = o.requiredBy !== null && o.requiredBy < today;
  // A delivered order no longer depends on the PO being open.
  const po =
    o.customerPoExpiresOn && column !== "delivered"
      ? poExpiry(o.customerPoExpiresOn, today, dayLabel(o.customerPoExpiresOn, today))
      : null;
  const toneClass = (t: "calm" | "amber" | "red") =>
    t === "red" ? "font-medium text-destructive" : t === "amber" ? "font-medium text-amber-700 dark:text-amber-500" : "";
  const toneText = toneClass(tone);

  let action: ReactNode = null;
  if (!canMove) {
    // Each step of an order with no stock is on its own page; the card says
    // which one is next. One that went through the warehouse before the
    // company dropped Inventory can still be delivered, not dispatched.
    const open =
      withoutStock && o.status === "new"
        ? "Open to confirm and invoice"
        : withoutStock && delivers && o.status === "confirmed" && !o.fromStock
          ? "Open to dispatch"
          : withoutStock && delivers && o.status === "dispatched"
            ? "Open to record the delivery"
            : withoutStock && delivers && column === "delivered"
              ? "Open to upload the POD"
              : null;
    action = open ? (
      <Button
        variant="outline"
        size="sm"
        className="w-full text-xs"
        nativeButton={false}
        render={<Link href={`/orders/${o.id}`} draggable={false} />}
      >
        {open}
      </Button>
    ) : null;
  } else if (o.status === "confirmed" && !o.fromStock) {
    // Invoiced without stock before the company bought Inventory: nothing to
    // pick or pack, so it goes out from its own page.
    action = (
      <Button
        variant="outline"
        size="sm"
        className="w-full text-xs"
        nativeButton={false}
        render={<Link href={`/orders/${o.id}`} draggable={false} />}
      >
        Open to dispatch
      </Button>
    );
  } else if (o.onHold && column !== "delivered") {
    action = (
      <Button
        variant="outline"
        size="sm"
        className="w-full text-xs"
        nativeButton={false}
        render={<Link href={`/orders/${o.id}`} draggable={false} />}
      >
        Open to release the hold
      </Button>
    );
  } else if (o.status === "picking") {
    // The picker's counts live on the picking list; packing from here would
    // overwrite them, so the card goes there.
    action = (
      <Button
        variant="outline"
        size="sm"
        className="w-full text-xs"
        nativeButton={false}
        render={<Link href={`/orders/${o.id}/pick`} draggable={false} />}
      >
        Finish picking
      </Button>
    );
  } else if (step) {
    action = (
      <div className="space-y-0.5">
        <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => onStep(step)}>
          {stepLabel(step, invoices && !o.invoiceNumber)}
        </Button>
        {/* The keyboard's way of dragging it back to Packed. Under the main
            button, not beside it: a column is narrow on a laptop. */}
        {o.status === "dispatched" && (
          <Button variant="ghost" size="xs" className="w-full text-xs text-muted-foreground" onClick={() => onStep("failed")}>
            {stepLabel("failed", invoices)}
          </Button>
        )}
      </div>
    );
  }

  return (
    <article
      id={`card-${o.id}`}
      // Focus lands here when this order's step finishes, so the keyboard
      // carries on from the card rather than from the top of the page.
      tabIndex={-1}
      draggable={canMove}
      onDragStart={canMove ? onDragStart : undefined}
      onDragEnd={canMove ? onDragEnd : undefined}
      className={[
        "space-y-1.5 rounded-md border border-border bg-card p-2.5 shadow-sm",
        "outline-none transition-[opacity,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-ring/50",
        faded ? "opacity-40" : canMove ? "cursor-grab hover:shadow-md active:cursor-grabbing" : "",
      ].join(" ")}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {canMove && sheetFor(o.status) && (
            <Checkbox checked={ticked} aria-label={`Tick ${o.orderNumber} to print`} onCheckedChange={(v) => onTick(v === true)} />
          )}
          <Link href={`/orders/${o.id}`} draggable={false} className="text-sm font-medium text-primary hover:underline">
            {o.orderNumber}
          </Link>
        </div>
        <span className="text-xs font-medium tabular-nums text-foreground">{money(o.total)}</span>
      </div>
      <p className="text-sm leading-tight text-foreground">{o.storeName ?? `No ${siteWord} named`}</p>

      {(o.onHold || o.status === "picking" || column === "delivered") && (
        <div className="flex flex-wrap gap-1">
          {o.onHold && (
            <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-500">
              On hold
            </Badge>
          )}
          {o.status === "picking" && <Badge variant="secondary">Being picked</Badge>}
          {column === "delivered" && <Badge variant="destructive">No POD</Badge>}
        </div>
      )}

      <div className="space-y-0.5 text-[11px] text-muted-foreground">
        {o.invoiceNumber && (
          <p className="flex items-center gap-1">
            <FileText className="h-3 w-3 shrink-0" />
            Invoice {o.invoiceNumber}
          </p>
        )}
        {o.customerPoNumber && (
          <p className="flex items-center gap-1">
            <Receipt className="h-3 w-3 shrink-0" />
            <span className="truncate">PO {o.customerPoNumber}</span>
          </p>
        )}
        {po && (
          <p className={`flex items-center gap-1 ${toneClass(po.tone)}`}>
            <CalendarClock className="h-3 w-3 shrink-0" />
            {po.words}
          </p>
        )}
        <p className="flex items-center gap-1">
          <User className="h-3 w-3 shrink-0" />
          {o.repName ?? `No ${staffWord}`}
        </p>
        {o.requiredBy && column !== "delivered" && (
          <p className={late ? "flex items-center gap-1 font-medium text-destructive" : "flex items-center gap-1"}>
            <CalendarClock className="h-3 w-3 shrink-0" />
            {late ? "Was needed by " : "Needed by "}
            {dayLabel(o.requiredBy, today)}
          </p>
        )}
        <p className={`flex items-center gap-1 ${toneText}`}>
          <Clock className="h-3 w-3 shrink-0" />
          {waitWords(days, column === "delivered")}
        </p>
      </div>

      {action}
      {/* The note that goes on the truck with the goods, from the moment
          they are packed until they have left. */}
      {canMove && (o.status === "packed" || o.status === "dispatched") && (
        <Button variant="ghost" size="xs" className="w-full text-xs text-muted-foreground" onClick={onPrint}>
          <Printer /> Print delivery note
        </Button>
      )}
    </article>
  );
}
