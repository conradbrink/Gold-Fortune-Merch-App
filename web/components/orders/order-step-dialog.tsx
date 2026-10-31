"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorBanner } from "@/components/warehouse/stat-tile";
import {
  confirmOrder,
  dispatchOrder,
  fetchAvailability,
  fetchCarriers,
  fetchOrderDetail,
  fetchPickingList,
  fetchRepsForOrder,
  markDelivered,
  markPacked,
  PartialDispatchError,
  recordPick,
  returnUndelivered,
  startPicking,
  uploadDeliveryDocument,
  expiredNote,
  type AvailabilityRow,
  type OrderDetail,
  type PickingRow,
  type ShortfallAction,
} from "@/lib/orders";
import { fetchLocations, type StockLocation } from "@/lib/warehouse";
import {
  invoicesOnConfirm,
  podFileProblem,
  POD_TYPES,
  statusWords,
  stepLabel,
  type BoardStep,
} from "@/lib/order-board";
import { useCompanyConfig, useTerms } from "@/lib/use-company-config";
import { capital, lower, withArticle } from "@/lib/terms";

/**
 * One step of an order, done from the orders board (and, for the POD, from the
 * archive).
 *
 * Each step is the same database call the order page makes (`order_confirm`,
 * the pick and pack calls, `order_dispatch`, `order_mark_delivered`,
 * `order_return_undelivered`), asked for with the same questions. The dialog
 * reads the order fresh when it opens rather than trusting the card, because
 * somebody else may have moved it since the list loaded, and a step run
 * against an order that has moved on is refused anyway; better to say so first.
 *
 * Shortened for the board:
 * - Packing a confirmed order records the whole picking list as picked, which is
 *   what happens on most orders. Once picking has started (somebody pressed
 *   Start picking), the counts belong to the picker, so the dialog only sends
 *   the order to its picking list: packing "everything" there would overwrite a
 *   line the picker saved at 0 or short. An order invoiced without stock has
 *   no counts (nothing was reserved), so it is always packed whole from here.
 * - Recording a delivery takes the signed POD in the same dialog, because with
 *   the POD on file the order is finished and goes to the archive. The file is
 *   checked against the bucket's limits before the delivery is recorded.
 * - A failed delivery only goes back to Packed. Cancelling the order is done on
 *   its own page once it is back in Packed (`order_cancel` handles packed
 *   stock; cancelling straight from the road does not, see the PR).
 *
 * While a step is running the dialog cannot be closed, so a refusal is always
 * shown and a late answer never closes a different dialog.
 */

/** The status each step starts from. Anything else means the order moved on. */
const FROM: Record<BoardStep, string[]> = {
  confirm: ["new"],
  pack: ["confirmed", "picking"],
  dispatch: ["packed"],
  deliver: ["dispatched"],
  failed: ["dispatched"],
  pod: ["delivered"],
};

function titleOf(step: BoardStep, invoices: boolean): string {
  switch (step) {
    case "confirm":
      return invoices ? "Confirm and invoice" : "Confirm and reserve stock";
    case "pack":
      return "Mark it packed";
    case "dispatch":
      return "Dispatch it";
    case "deliver":
      return "Record the delivery";
    case "failed":
      return "The delivery did not happen";
    case "pod":
      return "Upload the signed POD";
  }
}

/**
 * The order changed, but not all the way: dispatched but not handed to a rep,
 * delivered but its POD not filed. The list behind the dialog is stale, so the
 * dialog closes and the message shows as an error, which says what to do next.
 */
class PartialStepError extends Error {}

export type StepTarget = {
  orderId: string;
  orderNumber: string;
  step: BoardStep;
  /** Already on the card: an order carrying an invoice number is not invoiced again. */
  invoiceNumber?: string | null;
};

export function OrderStepDialog({
  target,
  onClose,
  onDone,
  finalFocus,
}: {
  /** The order and step to open, or null when closed. */
  target: StepTarget | null;
  /**
   * Closed without finishing. `changed` is true when part of the step went
   * through (picking was started), so the list behind it is out of date.
   */
  onClose: (changed: boolean) => void;
  /**
   * Finished. `ok` false means it changed but not all the way (see
   * PartialStepError). The caller refreshes its list before resolving, so the
   * dialog stays open, busy, over a list that is still the old one: closing
   * first left a live "Dispatch" button on a card that had just gone out.
   */
  onDone: (message: string, ok: boolean) => Promise<void> | void;
  /**
   * Where focus goes when the dialog closes, when not back to the button that
   * opened it: after a step that button has usually moved columns or gone.
   */
  finalFocus?: () => HTMLElement | null;
}) {
  // The last order shown, kept through the closing animation: clearing it with
  // `target` faded out an empty box.
  const [shown, setShown] = useState<StepTarget | null>(target);
  const [opened, setOpened] = useState(0);
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  if (target !== null && target !== shown) {
    setShown(target);
    setOpened((n) => n + 1);
    setBusy(false);
    setChanged(false);
  }

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onClose(changed);
      }}
      onOpenChangeComplete={(open) => {
        if (!open) setShown(null);
      }}
    >
      <DialogContent showCloseButton={!busy} finalFocus={finalFocus ? () => finalFocus() ?? true : undefined}>
        {shown && (
          // Keyed per opening, so every opening starts with empty fields and a fresh read.
          <StepBody
            key={opened}
            target={shown}
            busy={busy}
            setBusy={setBusy}
            markChanged={() => setChanged(true)}
            onClose={() => onClose(changed)}
            onDone={onDone}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function StepBody({
  target,
  busy,
  setBusy,
  markChanged,
  onClose,
  onDone,
}: {
  target: StepTarget;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  markChanged: () => void;
  onClose: () => void;
  onDone: (message: string, ok: boolean) => Promise<void> | void;
}) {
  const supabase = createClient();
  const router = useRouter();
  const terms = useTerms();
  const config = useCompanyConfig();
  const invoices = invoicesOnConfirm(config);
  const orgId = config?.orgId ?? null;
  const id = useId();
  const { orderId, orderNumber, step } = target;

  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Confirm.
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [fulfilFrom, setFulfilFrom] = useState("");
  const [stock, setStock] = useState<{ locationId: string; rows: AvailabilityRow[] } | null>(null);
  const [stockError, setStockError] = useState<{ locationId: string; message: string } | null>(null);
  const stockSeq = useRef(0);
  const [shortfall, setShortfall] = useState<ShortfallAction>("reject");

  // Pack.
  const [pickList, setPickList] = useState<PickingRow[] | null>(null);
  /** Picking started while this dialog was open (by this dialog, or somebody else). */
  const [pickingStarted, setPickingStarted] = useState(false);

  // Dispatch.
  const [carriers, setCarriers] = useState<{
    drivers: { id: string; full_name: string }[];
    vehicles: { id: string; registration: string }[];
  }>({ drivers: [], vehicles: [] });
  const [reps, setReps] = useState<{ id: string; full_name: string | null }[]>([]);
  const [repId, setRepId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [courier, setCourier] = useState("");
  const [tracking, setTracking] = useState("");
  const [expectedOn, setExpectedOn] = useState("");

  // Deliver, POD, failed.
  const [receivedBy, setReceivedBy] = useState("");
  /** Null while "Signed by" still copies "Who took delivery?". */
  const [signedBy, setSignedBy] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // The order and what this step needs, read together: none of the
        // step's reads depends on the order's.
        const [d, locs, list, carriersRead, repRows] = await Promise.all([
          fetchOrderDetail(supabase, orderId),
          step === "confirm" ? fetchLocations(supabase) : null,
          step === "pack" ? fetchPickingList(supabase, orderId) : null,
          step === "dispatch" ? fetchCarriers(supabase) : null,
          step === "dispatch" ? fetchRepsForOrder(supabase) : null,
        ]);
        if (cancelled) return;
        if (locs) {
          setLocations(locs);
          // The order's own location if it still exists, else the default:
          // the same fallback `order_confirm` uses.
          const named = d.order.fulfil_location_id;
          setFulfilFrom(
            (named && locs.some((l) => l.id === named) ? named : null) ??
              locs.find((l) => l.is_default)?.id ??
              locs[0]?.id ??
              ""
          );
        }
        if (list) setPickList(list);
        if (carriersRead) setCarriers(carriersRead);
        if (repRows) {
          setReps(repRows);
          // The order's rep, when they are still an active rep. A select whose
          // value matches no option shows the first one, which would hand the
          // delivery to whoever heads the list.
          setRepId(repRows.some((r) => r.id === d.order.rep_id) ? (d.order.rep_id ?? "") : "");
        }
        setDetail(d);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, orderId, step]);

  // The stock check for the warehouse chosen. Advisory: `order_confirm` counts
  // the shelf again under a lock, so a failed check does not stop anybody.
  useEffect(() => {
    if (step !== "confirm" || !fulfilFrom || !detail) return;
    const run = ++stockSeq.current;
    (async () => {
      try {
        const rows = await fetchAvailability(supabase, orderId, fulfilFrom);
        if (run !== stockSeq.current) return;
        setStock({ locationId: fulfilFrom, rows });
        setStockError(null);
      } catch (e) {
        if (run !== stockSeq.current) return;
        setStockError({ locationId: fulfilFrom, message: e instanceof Error ? e.message : String(e) });
      }
    })();
  }, [supabase, step, fulfilFrom, detail, orderId]);

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setError(null);
    try {
      const message = await fn();
      await onDone(message, true);
    } catch (e) {
      if (e instanceof PartialStepError) await onDone(e.message, false);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** The order's status now, read on its own: for deciding what a refusal meant. */
  async function statusNow(): Promise<string | null> {
    const { data } = await supabase.from("orders").select("status").eq("id", orderId).maybeSingle();
    return (data as { status: string } | null)?.status ?? null;
  }

  const willInvoice = invoices && !(detail?.order.invoice_number ?? target.invoiceNumber);
  const title = `${titleOf(step, willInvoice)}: ${orderNumber}`;

  function frame(body: ReactNode, footer?: ReactNode) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {body}
          <ErrorBanner message={error} />
        </div>
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </>
    );
  }

  const cancelButton = (
    <Button variant="outline" onClick={onClose} disabled={busy}>
      Cancel
    </Button>
  );

  if (loadError) {
    return frame(
      <ErrorBanner message={`The order could not be read: ${loadError}`} />,
      <Button variant="outline" onClick={onClose}>
        Close
      </Button>
    );
  }
  if (!detail) {
    return frame(
      <div className="space-y-2" aria-busy="true">
        <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
        <div className="h-9 animate-pulse rounded bg-muted/70" />
        <div className="h-9 animate-pulse rounded bg-muted/70" />
      </div>
    );
  }

  const o = detail.order;
  /** Invoiced without stock: nothing reserved, so nothing counted when it is picked. */
  const noStock = o.fulfil_location_id === null;
  const movedOn = !FROM[step].includes(o.status) || (step === "pod" && o.pod_status !== "outstanding");
  if (movedOn || (o.on_hold && step !== "pod")) {
    return frame(
      <p>
        {movedOn ? (
          <>
            {orderNumber} has moved on since this page was loaded. It is now{" "}
            <strong>{statusWords(o.status, invoices)}</strong>
            {step === "pod" && o.status === "delivered" ? " with its POD on file" : ""}
            {o.on_hold ? " and on hold" : ""}.
          </>
        ) : (
          <>
            {orderNumber} is on hold{o.hold_reason ? ` (${o.hold_reason})` : ""}.{" "}
            <Link href={`/orders/${orderId}`} className="font-medium underline underline-offset-2">
              Open the order
            </Link>{" "}
            to release the hold first.
          </>
        )}
      </p>,
      movedOn ? (
        <Button onClick={() => run(async () => `${orderNumber} had already moved on. The list is up to date now.`)}>
          Refresh
        </Button>
      ) : (
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      )
    );
  }

  // ------------------------------------------------------------ confirm
  if (step === "confirm") {
    const fulfilName = locations.find((l) => l.id === fulfilFrom)?.name ?? null;
    const rows = stock?.locationId === fulfilFrom ? stock.rows : null;
    const failed = stockError?.locationId === fulfilFrom ? stockError.message : null;
    const short = (rows ?? []).filter((r) => r.qty_short > 0);
    const unpriced = detail.lines.filter((l) => l.unit_price == null).length;
    const blocked = willInvoice && unpriced > 0;
    const units = (n: number) => `${n} ${n === 1 ? "unit" : "units"}`;

    return frame(
      <>
        <p className="text-muted-foreground">
          {detail.storeName ?? capital(lower(terms.site.one))} · {detail.lines.length}{" "}
          {detail.lines.length === 1 ? "line" : "lines"}
        </p>
        {/* Only when there is a choice to make. */}
        {locations.length > 1 && (
          <div className="space-y-1">
            <Label htmlFor={`${id}-from`}>Fulfil from</Label>
            <NativeSelect
              id={`${id}-from`}
              value={fulfilFrom}
              onChange={(e) => setFulfilFrom(e.target.value)}
              disabled={busy}
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.type !== "warehouse" ? ` (${l.type})` : ""}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}

        {fulfilFrom === "" ? (
          <p className="text-muted-foreground">
            There is no active location to fulfil this order from. A manager adds one under Warehouse setup,
            Locations.
          </p>
        ) : failed ? (
          <p className="text-muted-foreground">
            Stock could not be checked{fulfilName ? ` at ${fulfilName}` : ""}. Confirming counts it properly and
            refuses what is not there.
          </p>
        ) : rows === null ? (
          <p className="text-muted-foreground">Checking stock{fulfilName ? ` at ${fulfilName}` : ""}…</p>
        ) : short.length > 0 ? (
          <div className="space-y-1.5">
            <p>
              {short.length} {short.length === 1 ? "line is" : "lines are"} short
              {fulfilName ? ` at ${fulfilName}` : ""}:
            </p>
            <ul className="max-h-36 space-y-0.5 overflow-y-auto text-muted-foreground">
              {short.map((s) => (
                <li key={s.order_line_id}>
                  {s.product_name}: {s.qty_available} of {s.qty_ordered},{" "}
                  <span className="text-amber-700 dark:text-amber-500">{s.qty_short} short</span>
                  {expiredNote(s)}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-muted-foreground">
            Everything is in stock{fulfilName ? ` at ${fulfilName}` : ""}. Confirming holds it for this order.
          </p>
        )}

        <div className="space-y-1">
          <Label htmlFor={`${id}-short`}>If there is not enough stock</Label>
          <NativeSelect
            id={`${id}-short`}
            value={shortfall}
            onChange={(e) => setShortfall(e.target.value as ShortfallAction)}
            disabled={busy}
          >
            <option value="reject">Do not confirm, leave it as a purchase order</option>
            <option value="partial">Reserve what there is, flag the short lines</option>
            <option value="backorder">Reserve what there is, back-order the rest</option>
            <option value="hold">Reserve what there is and put the order on hold</option>
          </NativeSelect>
        </div>

        {willInvoice &&
          (blocked ? (
            <p className="text-destructive">
              Confirming issues the invoice, so{" "}
              {unpriced === 1 ? "the line with no price needs one" : `the ${unpriced} lines with no price need one`}{" "}
              first.{" "}
              <Link href={`/orders/${orderId}`} className="font-medium underline underline-offset-2">
                Price it on the order
              </Link>
              .
            </p>
          ) : (
            <p className="text-muted-foreground">
              Confirming also issues the invoice. Anything not sent, returned or cancelled later is credited for you.
            </p>
          ))}
      </>,
      <>
        {cancelButton}
        <Button
          disabled={busy || blocked || fulfilFrom === ""}
          onClick={() =>
            run(async () => {
              const result = await confirmOrder(supabase, orderId, shortfall, fulfilFrom || null);
              // What actually happened, from the database's answer: with a
              // shortfall choice the order can be confirmed short, or on hold.
              const missing = Number(result.total_short ?? 0);
              let said = `${orderNumber} is confirmed`;
              if (result.on_hold === true) {
                said += ` and on hold, ${units(missing)} short. Release the hold on the order when the stock is in.`;
              } else if (missing > 0) {
                said +=
                  shortfall === "backorder"
                    ? `, with ${units(missing)} back-ordered.`
                    : `, with ${units(missing)} short, flagged on the order.`;
              } else {
                said += " and its stock reserved.";
              }
              return willInvoice ? `${said} Its invoice is issued.` : said;
            })
          }
        >
          {busy ? "Confirming…" : stepLabel("confirm", willInvoice)}
        </Button>
      </>
    );
  }

  // --------------------------------------------------------------- pack
  if (step === "pack") {
    // Without stock there are no counts to protect, so a pick somebody started is packed whole too.
    const picking = !noStock && (pickingStarted || o.status === "picking");

    /**
     * Starts picking. True when this dialog started it; false when somebody
     * else had just started it (the order is `picking` either way, and this
     * dialog switches to sending them to the picking list). Any other refusal
     * is thrown.
     */
    async function beginPicking(): Promise<boolean> {
      let mine = true;
      try {
        await startPicking(supabase, orderId);
      } catch (e) {
        if ((await statusNow()) !== "picking") throw e;
        mine = false;
      }
      setPickingStarted(true);
      markChanged();
      return mine;
    }

    async function openPickingList() {
      setBusy(true);
      setError(null);
      try {
        if (!picking) await beginPicking();
        router.push(`/orders/${orderId}/pick`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setBusy(false);
      }
    }

    if (picking) {
      // The picker's counts are on the picking list. Packing "everything" here
      // would overwrite a line saved at 0 or short, so this only sends them there.
      return frame(
        <p>
          Picking has started on {orderNumber}. Finish it on the picking list, where the picker&apos;s counts are
          kept, and pack it from there.
        </p>,
        <>
          {cancelButton}
          <Button onClick={openPickingList} disabled={busy}>
            {busy ? "Opening…" : "Open the picking list"}
          </Button>
        </>
      );
    }

    const list = pickList ?? [];
    const items = list.reduce((n, r) => n + r.qty_to_pick, 0);
    return frame(
      <>
        {list.length === 0 ? (
          <p className="text-muted-foreground">
            {noStock
              ? "Nothing is left on this order to pack."
              : "Nothing is reserved for this order, so there is nothing to pack."}
          </p>
        ) : (
          <>
            <p>
              Everything on the picking list goes in the box: {list.length} {list.length === 1 ? "line" : "lines"},{" "}
              {items} {items === 1 ? "item" : "items"}.
            </p>
            <ul className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border border-border bg-muted/30 p-2 text-muted-foreground">
              {list.map((r) => (
                <li key={r.allocation_id ?? r.order_line_id} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">
                    {r.product_name}
                    {r.batch_number ? ` · batch ${r.batch_number}` : ""}
                  </span>
                  <span className="shrink-0 tabular-nums text-foreground">{r.qty_to_pick}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="text-muted-foreground">
          {noStock
            ? "Your company does not track stock, so nothing is counted: the whole order goes in the box, as invoiced."
            : "If something was short, use the picking list instead."}
        </p>
      </>,
      <>
        {cancelButton}
        <Button variant="outline" onClick={openPickingList} disabled={busy}>
          Open the picking list
        </Button>
        <Button
          disabled={busy || list.length === 0}
          onClick={() =>
            run(async () => {
              if (noStock) {
                // Nothing reserved, so nothing to record: start the pick if nobody has, then pack it.
                if (o.status === "confirmed") await beginPicking();
                await markPacked(supabase, orderId);
                return `${orderNumber} is packed and ready to go out.`;
              }
              // Somebody else's pick is theirs to finish: never packed in full over it.
              if (!(await beginPicking())) {
                throw new Error(`Somebody started picking ${orderNumber} a moment ago. Finish it on the picking list.`);
              }
              // Read again now that the order is ours to pick: the list shown
              // was read when the dialog opened.
              const fresh = await fetchPickingList(supabase, orderId);
              await recordPick(
                supabase,
                orderId,
                fresh.map((r) => ({ allocation_id: r.allocation_id, qty_picked: r.qty_to_pick }))
              );
              await markPacked(supabase, orderId);
              return `${orderNumber} is packed and ready to go out.`;
            })
          }
        >
          {busy ? "Packing…" : stepLabel("pack", willInvoice)}
        </Button>
      </>
    );
  }

  // ----------------------------------------------------------- dispatch
  if (step === "dispatch") {
    const staff = lower(terms.staff.one);
    const named = driverId || vehicleId || courier.trim();
    return frame(
      <>
        <div className="space-y-1">
          <Label htmlFor={`${id}-handler`}>{terms.staff.one} who is handling it</Label>
          <NativeSelect id={`${id}-handler`} value={repId} onChange={(e) => setRepId(e.target.value)} disabled={busy}>
            <option value="">Nobody, the warehouse handles it</option>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.full_name ?? `Unnamed ${staff}`}
              </option>
            ))}
          </NativeSelect>
          <p className="text-xs text-muted-foreground">
            {capital(withArticle(terms, "staff"))} named here sees this delivery in the app.
          </p>
        </div>
        <p className="text-muted-foreground">Name a driver, a vehicle or a courier, at least one.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={`${id}-driver`}>Driver</Label>
            <NativeSelect
              id={`${id}-driver`}
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
              disabled={busy}
            >
              <option value="">None</option>
              {carriers.drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.full_name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-vehicle`}>Vehicle</Label>
            <NativeSelect
              id={`${id}-vehicle`}
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              disabled={busy}
            >
              <option value="">None</option>
              {carriers.vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.registration}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-courier`}>Courier</Label>
          <Input
            id={`${id}-courier`}
            value={courier}
            onChange={(e) => setCourier(e.target.value)}
            placeholder="If a third party is taking it"
            disabled={busy}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={`${id}-tracking`}>Tracking reference</Label>
            <Input id={`${id}-tracking`} value={tracking} onChange={(e) => setTracking(e.target.value)} disabled={busy} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-expected`}>Expected delivery</Label>
            <Input
              id={`${id}-expected`}
              type="date"
              value={expectedOn}
              onChange={(e) => setExpectedOn(e.target.value)}
              disabled={busy}
            />
          </div>
        </div>
      </>,
      <>
        {cancelButton}
        <Button
          disabled={busy || !named}
          onClick={() =>
            run(async () => {
              const who = reps.find((r) => r.id === repId)?.full_name ?? `that ${staff}`;
              try {
                await dispatchOrder(
                  supabase,
                  orderId,
                  {
                    driverId,
                    vehicleId,
                    carrierName: courier,
                    trackingReference: tracking,
                    expectedDeliveryOn: expectedOn,
                    assignedRepId: repId || null,
                  },
                  terms
                );
              } catch (e) {
                // It went out, but nobody has it. Said for this screen, which
                // has no delivery card to set the person on.
                if (e instanceof PartialDispatchError) {
                  throw new PartialStepError(
                    `${orderNumber} is dispatched, but it could not be given to ${who}: ${e.reason} ` +
                      `Open ${orderNumber} and set the ${staff} on its delivery. Do not dispatch it again.`
                  );
                }
                throw e;
              }
              return repId
                ? `${orderNumber} is dispatched, and it is on ${who}'s phone.`
                : `${orderNumber} is dispatched. Nobody has been given it yet.`;
            })
          }
        >
          {busy ? "Dispatching…" : stepLabel("dispatch", willInvoice)}
        </Button>
      </>
    );
  }

  const openDispatch = detail.dispatches.find((d) => d.status === "in_transit");
  /** Said instead of a greyed-out button when there is no consignment to record against. */
  const noConsignment = !openDispatch && (
    <p className="text-destructive">
      {orderNumber} has no consignment on the road, so this cannot be recorded here.{" "}
      <Link href={`/orders/${orderId}`} className="font-medium underline underline-offset-2">
        Open the order
      </Link>
      .
    </p>
  );

  // ------------------------------------------------------------- failed
  if (step === "failed") {
    return frame(
      <>
        <div className="space-y-1">
          <Label htmlFor={`${id}-reason`}>What happened?</Label>
          <Input
            id={`${id}-reason`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={`${terms.site.one} closed, the ${lower(terms.client.one)} refused it, the vehicle broke down…`}
            disabled={busy}
          />
        </div>
        <p className="text-muted-foreground">
          {noStock && !o.packed_at
            ? "It was sent before it could be packed, so it goes back to Invoiced to be packed and sent again"
            : noStock
              ? "It goes back to Packed, ready to go out again"
              : "It goes back to Packed with its stock still reserved, ready to go out again"}
          . If the order is off altogether, cancel it on its own page once it is back.
        </p>
        {noConsignment}
      </>,
      <>
        {cancelButton}
        <Button
          disabled={busy || !reason.trim() || !openDispatch}
          onClick={() =>
            run(async () => {
              if (!openDispatch) throw new Error("This consignment is no longer on the road. Refresh the list.");
              const back = await returnUndelivered(supabase, openDispatch.id, reason, false);
              // An order sent without stock before it could be packed comes back to Invoiced.
              if (back.status === "confirmed") return `${orderNumber} is back with the orders waiting to be packed.`;
              return noStock
                ? `${orderNumber} is back. It is packed and ready to go out again.`
                : `${orderNumber}'s stock is back. It is packed and ready to go out again.`;
            })
          }
        >
          {busy ? "Saving…" : "Record it"}
        </Button>
      </>
    );
  }

  // ------------------------------------------------------ deliver, pod
  const arrived = detail.dispatches.find((d) => d.status === "delivered");
  const signer = signedBy ?? receivedBy;
  const fileProblem = file ? podFileProblem(file) : null;
  const fileField = (
    <div className="space-y-1">
      <Label htmlFor={`${id}-file`}>Signed POD{step === "deliver" ? " (if you have it now)" : ""}</Label>
      <Input
        id={`${id}-file`}
        type="file"
        accept={POD_TYPES.join(",")}
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        aria-describedby={`${id}-file-help`}
        aria-invalid={fileProblem !== null}
        disabled={busy}
      />
      <p id={`${id}-file-help`} className={fileProblem ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
        {fileProblem ?? "PDF or a photograph, up to 15 MB."}
      </p>
    </div>
  );
  const signedField = (
    <div className="space-y-1">
      <Label htmlFor={`${id}-signed`}>Signed by</Label>
      <Input
        id={`${id}-signed`}
        value={signer}
        onChange={(e) => setSignedBy(e.target.value)}
        placeholder="Name on the signature"
        disabled={busy}
      />
    </div>
  );

  if (step === "pod") {
    return frame(
      <>
        <p className="text-muted-foreground">With the signed POD on file, the order is finished.</p>
        {fileField}
        {signedField}
      </>,
      <>
        {cancelButton}
        <Button
          disabled={busy || !file || fileProblem !== null || !signer.trim()}
          onClick={() =>
            run(async () => {
              if (!file) throw new Error("Choose the file first.");
              if (!orgId) throw new Error("Could not work out your company. Refresh the page.");
              await uploadDeliveryDocument(supabase, {
                orgId,
                orderId,
                // Filed against the consignment that arrived, never a returned one.
                dispatchId: arrived?.id ?? null,
                docType: "pod",
                file,
                signedByName: signer.trim(),
              });
              return `${orderNumber}'s POD is filed. The order is finished and in the archive.`;
            })
          }
        >
          {busy ? "Uploading…" : stepLabel("pod", willInvoice)}
        </Button>
      </>
    );
  }

  return frame(
    <>
      <div className="space-y-1">
        <Label htmlFor={`${id}-received`}>Who took delivery?</Label>
        <Input
          id={`${id}-received`}
          value={receivedBy}
          onChange={(e) => setReceivedBy(e.target.value)}
          placeholder={`Name of the person at the ${lower(terms.site.one)}`}
          disabled={busy}
        />
      </div>
      {fileField}
      {file && signedField}
      <p className="text-muted-foreground">
        {file
          ? "The order goes to the archive once the POD is filed."
          : "Without the POD it waits in Delivered until the POD is uploaded."}{" "}
        The whole consignment is recorded as delivered. If the {lower(terms.client.one)} would not take something,
        drag it back to Packed as a failed delivery instead.
      </p>
      {noConsignment}
    </>,
    <>
      {cancelButton}
      <Button
        disabled={
          busy || !receivedBy.trim() || !openDispatch || (file !== null && (fileProblem !== null || !signer.trim()))
        }
        onClick={() =>
          run(async () => {
            if (!openDispatch) throw new Error("This consignment is no longer on the road. Refresh the list.");
            // Everything the POD needs is checked before anything is written,
            // so a file that was never going to be filed stops the dialog here
            // instead of leaving the delivery half recorded.
            if (file && podFileProblem(file)) throw new Error(podFileProblem(file)!);
            if (file && !orgId) throw new Error("Could not work out your company, so the POD cannot be filed. Refresh the page.");
            await markDelivered(supabase, openDispatch.id, receivedBy.trim());
            markChanged();
            if (!file || !orgId) return `${orderNumber} is delivered. Its POD is still to come, so it waits in Delivered.`;
            // Delivered now, whatever happens to the file. A failed upload is
            // reported as such, not as a failed delivery, or the obvious next
            // move is to record the delivery again.
            try {
              await uploadDeliveryDocument(supabase, {
                orgId,
                orderId,
                dispatchId: openDispatch.id,
                docType: "pod",
                file,
                signedByName: signer.trim(),
              });
            } catch (e) {
              throw new PartialStepError(
                `${orderNumber} is recorded as delivered, but the POD did not upload: ${
                  e instanceof Error ? e.message : String(e)
                } Upload it from its card in Delivered.`
              );
            }
            return `${orderNumber} is delivered, its POD filed, and the order is in the archive.`;
          })
        }
      >
        {busy ? "Saving…" : stepLabel("deliver", willInvoice)}
      </Button>
    </>
  );
}
