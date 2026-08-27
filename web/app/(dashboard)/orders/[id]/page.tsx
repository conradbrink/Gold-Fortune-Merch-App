"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, FileUp, History, Truck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ErrorBanner } from "@/components/warehouse/stat-tile";
import { fetchOrgId } from "@/lib/representatives";
import { STATUS_LABELS, fetchLocations, type StockLocation } from "@/lib/warehouse";
import {
  fetchOrderDetail,
  fetchAvailability,
  fetchCarriers,
  confirmOrder,
  startPicking,
  markPacked,
  assignDispatchRep,
  dispatchOrder,
  markDelivered,
  returnUndelivered,
  cancelOrder,
  holdOrder,
  releaseHold,
  uploadDeliveryDocument,
  signedDocumentUrl,
  orderTotals,
  setLinePrice,
  setLineQty,
  removeOrderLine,
  addOrderLine,
  updateOrderDetails,
  requiredByRange,
  unitPriceFor,
  fetchOrderableProducts,
  type OrderDetail,
  type AvailabilityRow,
  type ShortfallAction,
} from "@/lib/orders";

/**
 * What an availability check was a check of: this order, as these lines, at
 * this location. A result is only about the screen in front of the clerk while
 * both still match.
 */
type AvailabilityCheck = { locationId: string; linesKey: string };

type DialogKind =
  | null
  | "confirm"
  | "dispatch"
  | "deliver"
  | "failed"
  | "cancel"
  | "hold"
  | "upload";

/**
 * One order, and every action the warehouse can take on it.
 *
 * The buttons offered are derived from the order's status rather than from
 * anything the page decides for itself, so the screen can never present an
 * action the database would refuse. When one is refused anyway — a race with
 * another clerk, stock that went in the meantime — the message from the RPC is
 * shown as-is: those messages were written to be read by the person holding the
 * order, not to be translated here.
 */
export default function OrderDetailPage() {
  const supabase = createClient();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const orderId = params.id;

  const [detail, setDetail] = useState<OrderDetail | null>(null);
  /**
   * The last availability check, tagged with what it was a check *of*.
   *
   * Both halves of the tag are load-bearing, because both can change under it.
   * Rows counted at Gaborone say nothing about Maun, and rows counted before a
   * quantity was corrected say nothing about the order as it now stands —
   * showing either under the new heading would be the screen inventing stock.
   * Anything whose tag does not match is treated as not yet checked.
   */
  const [availability, setAvailability] = useState<
    (AvailabilityCheck & { rows: AvailabilityRow[] }) | null
  >(null);
  /**
   * Why the pre-confirm check could not be made, if it could not.
   *
   * Tagged like the result, and for the same reason: a failure at Maun must
   * stop being reported the moment the clerk selects Gaborone, or the dialog
   * blames the wrong warehouse for a refusal it never made.
   *
   * Kept apart from the page's error banner on purpose. This check is advisory
   * — `order_confirm` counts the shelf again under a row lock — so a failed
   * check must not read as a failed action, and must not stop the clerk
   * confirming.
   */
  const [availabilityError, setAvailabilityError] = useState<
    (AvailabilityCheck & { message: string }) | null
  >(null);
  /** Newest check, so a slow one cannot land on top of a newer one. */
  const availabilitySeq = useRef(0);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  /**
   * Which location the order will be fulfilled from.
   *
   * Seeded from the order if it already names one, otherwise the default
   * warehouse — the same fallback `order_confirm` applies, so the screen and
   * the database agree before anybody touches the picker.
   */
  const [fulfilFrom, setFulfilFrom] = useState("");
  const [carriers, setCarriers] = useState<{
    drivers: { id: string; full_name: string }[];
    vehicles: { id: string; registration: string }[];
  }>({ drivers: [], vehicles: [] });
  const [orgId, setOrgId] = useState<string | null>(null);

  /**
   * Prices the warehouse is typing, keyed by line id.
   *
   * A rep's order arrives unpriced — customers sit on different pricing tiers,
   * so the phone is the wrong place to decide. This is where the tier is known,
   * and `order_lines` only accepts the edit while the order is still `new`,
   * which is the right window: confirming is the promise.
   */
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({});
  const [pricing, setPricing] = useState(false);
  const [catalogue, setCatalogue] = useState<
    {
      id: string;
      // Carried since the add-a-product control existed; `fetchOrderableProducts`
      // always selected it and this type simply did not say so.
      name: string;
      units_per_shrink: number | null;
      shrink_price_excl_vat: number | null;
    }[]
  >([]);

  /**
   * Field reps, for handing a delivery to one.
   *
   * Only `role = 'rep'`: the Android app lets nobody else in, so assigning a
   * delivery to a warehouse clerk would be a job with nowhere to appear. The
   * RPC refuses it too — this list is so nobody is offered the refusal.
   */
  const [reps, setReps] = useState<{ id: string; full_name: string | null }[]>([]);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);

  /**
   * Which of the two the shared cancel/hold dialog is showing.
   *
   * Held apart from `dialog` because the dialog stays mounted while it animates
   * closed, by which point `dialog` is already null and every label inside it
   * would fall through to its "hold" branch. Cancelling an order flashed "Put
   * this order on hold" on the way out — naming the opposite action at the one
   * moment the clerk is looking for confirmation that the right thing happened.
   */
  const [confirmKind, setConfirmKind] = useState<"cancel" | "hold">("cancel");

  /** Opens the shared dialog, latching which of the two it is. */
  function openConfirm(kind: "cancel" | "hold") {
    setConfirmKind(kind);
    setDialog(kind);
  }

  // Corrections while the order is still `new`. Quantities ride along with the
  // prices rather than getting a button of their own: a clerk fixing an order a
  // shop has just changed on the phone is doing one job, and two save buttons
  // over one table is two chances to walk away with half of it saved.
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({});
  const [addProductId, setAddProductId] = useState("");
  const [addQty, setAddQty] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingDetails, setEditingDetails] = useState(false);
  const [detailsDraft, setDetailsDraft] = useState({
    contact_name: "",
    contact_phone: "",
    required_by: "",
    notes: "",
  });
  const [savingDetails, setSavingDetails] = useState(false);

  // Dialog fields.
  const [shortfall, setShortfall] = useState<ShortfallAction>("reject");
  const [driverId, setDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [carrierName, setCarrierName] = useState("");
  const [tracking, setTracking] = useState("");
  const [expectedOn, setExpectedOn] = useState("");
  const [receivedBy, setReceivedBy] = useState("");
  const [reason, setReason] = useState("");
  const [cancelAfterReturn, setCancelAfterReturn] = useState(false);
  const [docType, setDocType] = useState<"pod" | "delivery_note" | "delivery_photo">("pod");
  const [signedBy, setSignedBy] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const reload = useCallback(async () => {
    const [d, org] = await Promise.all([
      fetchOrderDetail(supabase, orderId),
      fetchOrgId(supabase),
    ]);
    setDetail(d);
    setOrgId(org);
    return d;
  }, [supabase, orderId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [c, cat, locs, repRows] = await Promise.all([
          fetchCarriers(supabase),
          fetchOrderableProducts(supabase),
          fetchLocations(supabase),
          supabase
            .from("profiles")
            .select("id, full_name")
            .eq("role", "rep")
            .eq("is_active", true)
            .order("full_name"),
        ]);
        const d = await reload();
        if (cancelled) return;
        setCarriers(c);
        setCatalogue(cat);
        setLocations(locs);
        // Fails loudly. A discarded error here empties the assignment dropdown,
        // which reads as "there are no reps" — and the next thing somebody does
        // is unassign a delivery to make the control agree with the list.
        if (repRows.error) throw new Error(repRows.error.message);
        setReps(
          (repRows.data ?? []) as { id: string; full_name: string | null }[]
        );
        // A location the order names but the picker cannot offer — retired
        // since — falls back to the default rather than being held in state
        // invisibly: a native select with no matching option displays the
        // first one, and confirming would then reserve somewhere the clerk
        // was never shown.
        const named = d.order.fulfil_location_id;
        setFulfilFrom(
          (named && locs.some((l) => l.id === named) ? named : null) ??
            locs.find((l) => l.is_default)?.id ??
            locs[0]?.id ??
            ""
        );
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, reload]);

  /**
   * What the availability check is about: these lines, at this location.
   *
   * Availability is derived from both rather than fetched alongside the order,
   * so adding a product, correcting a quantity and switching warehouse all
   * re-check it — and no call site has to remember to. Empty once the order is
   * past `new`, because after confirming the question is what was reserved,
   * not what is on the shelf.
   */
  const linesKey =
    detail?.order.status === "new"
      ? detail.lines.map((l) => `${l.id}:${l.qty_ordered}`).join(",")
      : "";

  useEffect(() => {
    if (!linesKey || !fulfilFrom) return;
    const runId = ++availabilitySeq.current;
    (async () => {
      try {
        const rows = await fetchAvailability(supabase, orderId, fulfilFrom);
        if (runId !== availabilitySeq.current) return;
        setAvailability({ locationId: fulfilFrom, linesKey, rows });
        setAvailabilityError(null);
      } catch (e) {
        if (runId !== availabilitySeq.current) return;
        setAvailabilityError({
          locationId: fulfilFrom,
          linesKey,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    })();
  }, [supabase, orderId, linesKey, fulfilFrom]);

  /**
   * Runs an action, then reloads. Errors from the database are shown verbatim.
   *
   * `goTo` is for the transitions whose whole point is the screen that follows
   * them. Navigating instead of reloading skips a render of a page the user is
   * about to leave.
   */
  async function run(fn: () => Promise<unknown>, success: string, goTo?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (goTo) {
        router.push(goTo);
        return;
      }
      await reload();
      setNotice(success);
      setDialog(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!detail) {
    return <ErrorBanner message={error ?? "That order could not be loaded."} />;
  }

  const o = detail.order;
  const fulfilName = locations.find((l) => l.id === fulfilFrom)?.name ?? null;

  /** Whether a check describes the order and location now on screen. */
  const describesNow = (c: AvailabilityCheck | null | undefined) =>
    c != null && c.locationId === fulfilFrom && c.linesKey === linesKey;

  /** Only rows counted for this order at this location. See `availability`. */
  const stockHere = describesNow(availability) ? availability!.rows : null;
  const short = (stockHere ?? []).filter((a) => a.qty_short > 0);
  const checkFailure = describesNow(availabilityError)
    ? availabilityError!.message
    : null;
  /**
   * A check is on its way and there is no answer yet.
   *
   * Conditioned on exactly what the effect above needs to run, so a case it
   * skips — an order with no lines, nowhere to fulfil from — reads as "nothing
   * to check" rather than spinning forever.
   */
  const checkingStock =
    o.status === "new" &&
    detail.lines.length > 0 &&
    fulfilFrom !== "" &&
    stockHere === null &&
    checkFailure === null;

  // Only while the order is still `new`. `order_lines_insert`/`update` admit a
  // line only in that state, so offering the box later would be offering an
  // edit the database refuses.
  const canPrice = o.status === "new";
  const unpricedLines = detail.lines.filter((l) => l.unit_price == null).length;

  /** The catalogue's per-unit price for a line, as a prefill. */
  function suggested(productId: string): string {
    const p = catalogue.find((c) => c.id === productId);
    return p ? (unitPriceFor(p) ?? "") : "";
  }

  /** Saves every price typed, then reloads. */
  async function savePrices() {
    setPricing(true);
    setError(null);
    setNotice(null);
    try {
      const edits = detail!.lines
        .map((l) => ({ id: l.id, raw: priceDraft[l.id], name: l.product_name }))
        .filter((e) => e.raw !== undefined && e.raw !== "");

      // Every price is checked before any is written. Validating inside the
      // write loop meant a bad third line left the first two already saved,
      // with the clerk shown only the error and no hint that half of it had
      // gone through — the same half-saved state the stocktake counts had.
      const priced = edits.map((e) => {
        const n = Number(e.raw);
        if (!Number.isFinite(n) || n < 0) {
          throw new Error(
            `${e.name}: a price has to be a number and cannot be negative. Nothing was saved.`
          );
        }
        return { id: e.id, price: n, name: e.name };
      });

      // Quantities are validated *here*, before any price is written, not
      // after. Validating them below the price loop meant a rejected quantity
      // produced "Nothing was saved" over prices that had already gone in —
      // the exact half-saved state the all-or-nothing check above exists to
      // prevent, reintroduced by adding a second field to the same button.
      //
      // A box the clerk emptied is rejected rather than skipped. Treating it as
      // "no edit" reads as deleting the line to the person who cleared it, and
      // silently keeping the old number is the worst of the three answers.
      const qtyEdits = detail!.lines
        .map((l) => ({ id: l.id, raw: qtyDraft[l.id], name: l.product_name }))
        .filter((e) => e.raw !== undefined)
        .map((e) => {
          const n = Number(e.raw);
          if (e.raw!.trim() === "" || !Number.isInteger(n) || n < 1) {
            throw new Error(
              `${e.name}: a quantity has to be a whole number, one or more. ` +
                `To take the line off the order, remove it. Nothing was saved.`
            );
          }
          return { id: e.id, qty: n, name: e.name };
        })
        // An unchanged number is not an edit. Typing over a 5 with a 5 should
        // not spend a write or be counted in "3 changes saved".
        .filter((e) => {
          const line = detail!.lines.find((l) => l.id === e.id);
          return line == null || line.qty_ordered !== e.qty;
        });

      // Validated above, so nothing here fails on a bad number. What can still
      // fail is the network, one line in — and there is no transaction across
      // these writes, because `order_lines` is updated column by column under a
      // grant rather than through an RPC. Making it atomic means a
      // `security definer` RPC taking the whole array, which is a migration and
      // is noted on the PR.
      //
      // Until then the partial state is reported rather than hidden: the same
      // choice `saveCounts` makes, and for the same reason — a clerk told only
      // "failed" retypes prices that are already saved.
      const failed: string[] = [];
      for (const e of priced) {
        try {
          await setLinePrice(supabase, e.id, e.price);
        } catch {
          failed.push(e.name);
        }
      }
      if (failed.length > 0) {
        throw new Error(
          `${priced.length - failed.length} of ${priced.length} prices saved. ` +
            `These did not: ${failed.join(", ")}. Re-enter only those.`
        );
      }
      const qtyFailed: string[] = [];
      for (const e of qtyEdits) {
        try {
          await setLineQty(supabase, e.id, e.qty);
        } catch {
          qtyFailed.push(e.name);
        }
      }
      if (qtyFailed.length > 0) {
        throw new Error(
          `${qtyEdits.length - qtyFailed.length} of ${qtyEdits.length} ` +
            `quantities saved. These did not: ${qtyFailed.join(", ")}.`
        );
      }

      await reload();
      setPriceDraft({});
      setQtyDraft({});
      const changes = edits.length + qtyEdits.length;
      setNotice(changes === 1 ? "Change saved." : `${changes} changes saved.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPricing(false);
    }
  }

  /** Puts a product the shop asked for late onto an order still open. */
  async function addLine() {
    setAdding(true);
    setError(null);
    setNotice(null);
    try {
      if (!orgId) throw new Error("Still loading. Try again in a moment.");
      const qty = Number(addQty);
      const product = catalogue.find((c) => c.id === addProductId);
      if (!product) throw new Error("Pick a product first.");
      await addOrderLine(supabase, {
        orgId,
        orderId,
        productId: addProductId,
        qty,
        // Prefilled from the catalogue so the line is not born unpriced, and
        // still editable in the table above like every other price.
        unitPrice: unitPriceFor(product) == null ? null : Number(unitPriceFor(product)),
      });
      await reload();
      setAddProductId("");
      setAddQty("");
      setNotice(`${product.name} added.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  }

  async function removeLine(lineId: string, name: string) {
    setError(null);
    setNotice(null);
    try {
      await removeOrderLine(supabase, lineId);
      await reload();
      setNotice(`${name} taken off the order.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function startEditingDetails() {
    setDetailsDraft({
      contact_name: o.contact_name ?? "",
      contact_phone: o.contact_phone ?? "",
      required_by: o.required_by ?? "",
      notes: o.notes ?? "",
    });
    setEditingDetails(true);
  }

  async function saveDetails() {
    setSavingDetails(true);
    setError(null);
    setNotice(null);
    try {
      await updateOrderDetails(supabase, orderId, {
        contact_name: detailsDraft.contact_name.trim() || null,
        contact_phone: detailsDraft.contact_phone.trim() || null,
        required_by: detailsDraft.required_by || null,
        notes: detailsDraft.notes.trim() || null,
      });
      await reload();
      setEditingDetails(false);
      setNotice("Order details saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingDetails(false);
    }
  }
  const openDispatch = detail.dispatches.find((d) => d.status === "in_transit");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/orders" className="text-sm text-muted-foreground hover:underline">
            ← Orders
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
            {o.order_number}
            <Badge variant={o.status === "cancelled" ? "outline" : "secondary"}>
              {STATUS_LABELS[o.status] ?? o.status}
            </Badge>
            {o.on_hold && (
              <Badge variant="outline" className="border-amber-500/50 text-amber-600">
                on hold
              </Badge>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">
            {detail.storeName}
            {detail.storeAddress ? ` · ${detail.storeAddress}` : ""}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {o.status === "new" && (
            <Button onClick={() => setDialog("confirm")} disabled={busy}>
              Confirm and reserve
            </Button>
          )}
          {o.status === "confirmed" && (
            <Button
              onClick={() =>
                run(
                  () => startPicking(supabase, orderId),
                  "Picking started.",
                  // Straight to the list. Pressing "Start picking" and being
                  // shown a second button that opens the picking list is two
                  // clicks for one intention, and the picker is standing in
                  // the aisle holding a phone.
                  `/orders/${orderId}/pick`
                )
              }
              disabled={busy}
            >
              Start picking
            </Button>
          )}
          {o.status === "picking" && (
            <>
              <Button nativeButton={false} render={<Link href={`/orders/${orderId}/pick`} />}>
                Open picking list
              </Button>
              <Button
                variant="outline"
                onClick={() => run(() => markPacked(supabase, orderId), "Marked as packed.")}
                disabled={busy}
              >
                Mark packed
              </Button>
            </>
          )}
          {o.status === "packed" && (
            <Button onClick={() => setDialog("dispatch")} disabled={busy}>
              Dispatch
            </Button>
          )}
          {o.status === "dispatched" && openDispatch && (
            <>
              <Button onClick={() => setDialog("deliver")} disabled={busy}>
                Record delivery
              </Button>
              <Button variant="outline" onClick={() => setDialog("failed")} disabled={busy}>
                Delivery failed
              </Button>
            </>
          )}
          {o.status === "delivered" && (
            <Button onClick={() => setDialog("upload")} disabled={busy}>
              <FileUp className="mr-1.5 h-4 w-4" /> Upload POD
            </Button>
          )}
          {!["delivered", "cancelled"].includes(o.status) &&
            (o.on_hold ? (
              <Button
                variant="outline"
                onClick={() => run(() => releaseHold(supabase, orderId), "Hold released.")}
                disabled={busy}
              >
                Release hold
              </Button>
            ) : (
              <Button variant="outline" onClick={() => openConfirm("hold")} disabled={busy}>
                Hold
              </Button>
            ))}
          {!["delivered", "cancelled", "dispatched"].includes(o.status) && (
            <Button variant="outline" onClick={() => openConfirm("cancel")} disabled={busy}>
              Cancel
            </Button>
          )}
        </div>
      </div>

      <ErrorBanner message={error} />
      {notice && (
        <p className="rounded-lg border border-border bg-muted/40 p-2.5 text-sm">{notice}</p>
      )}

      {o.status === "new" && checkFailure && (
        <p className="rounded-lg border border-border bg-muted/40 p-2.5 text-sm text-muted-foreground">
          Stock could not be checked{fulfilName ? ` at ${fulfilName}` : ""}:{" "}
          {checkFailure}. Confirming counts it again, so this is worth a retry
          rather than a worry.
        </p>
      )}

      {o.status === "new" && short.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
          <p className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-500">
            <AlertTriangle className="h-4 w-4" /> Not enough stock for {short.length} line
            {short.length === 1 ? "" : "s"}
            {/* Named only when there is somewhere else it could have come
                from. On a one-warehouse organisation the name is noise. */}
            {locations.length > 1 && fulfilName ? ` at ${fulfilName}` : ""}
          </p>
          <ul className="mt-1.5 space-y-0.5 text-sm text-muted-foreground">
            {short.map((s) => (
              <li key={s.order_line_id}>
                {s.product_name}: {s.qty_ordered} ordered, {s.qty_available} available —{" "}
                <span className="text-amber-700 dark:text-amber-500">{s.qty_short} short</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Lines</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Ordered</TableHead>
                  <TableHead className="text-right">Price/unit</TableHead>
                  <TableHead className="text-right">Reserved</TableHead>
                  <TableHead className="text-right">Picked</TableHead>
                  <TableHead className="text-right">Dispatched</TableHead>
                  <TableHead className="text-right">Delivered</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      <div className="font-medium">{l.product_name}</div>
                      {l.brand && (
                        <div className="text-xs text-muted-foreground">{l.brand}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {canPrice ? (
                        <Input
                          type="number"
                          min={1}
                          step="1"
                          className="ml-auto h-8 w-20 text-right"
                          aria-label={`Quantity ordered of ${l.product_name}`}
                          value={qtyDraft[l.id] ?? String(l.qty_ordered)}
                          onChange={(e) =>
                            setQtyDraft((prev) => ({ ...prev, [l.id]: e.target.value }))
                          }
                        />
                      ) : (
                        <span className="tabular-nums">{l.qty_ordered}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {canPrice ? (
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          className="ml-auto h-8 w-24 text-right"
                          aria-label={`Price per unit for ${l.product_name}`}
                          placeholder={suggested(l.product_id) || "—"}
                          value={
                            priceDraft[l.id] ??
                            (l.unit_price == null ? "" : String(l.unit_price))
                          }
                          onChange={(e) =>
                            setPriceDraft((prev) => ({ ...prev, [l.id]: e.target.value }))
                          }
                        />
                      ) : l.unit_price == null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="tabular-nums">{Number(l.unit_price).toFixed(2)}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{l.qty_reserved}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.qty_picked}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.qty_dispatched}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.qty_delivered}
                      {l.qty_returned > 0 && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({l.qty_returned} back)
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={l.line_status === "fulfilled" ? "default" : "outline"}>
                        {l.line_status}
                      </Badge>
                      {/* Only while `new`, where the badge says `pending` for
                          every line and carries nothing. Once anything is
                          reserved this column is the only place the line's own
                          progress is shown, so it keeps the space. */}
                      {canPrice && (
                        <button
                          type="button"
                          onClick={() => removeLine(l.id, l.product_name)}
                          className="ml-2 text-xs text-destructive hover:underline"
                        >
                          Remove
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {canPrice && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 p-2.5">
                <p className="text-sm text-muted-foreground">
                  {unpricedLines > 0 ? (
                    <>
                      <span className="font-medium text-foreground">
                        {unpricedLines} line{unpricedLines === 1 ? " has" : "s have"} no price.
                      </span>{" "}
                      {/* A rep never sets one: customers sit on different
                          pricing tiers and the phone does not know which. The
                          placeholder shows the catalogue price as a starting
                          point, not an answer. */}
                      Set them before confirming — a rep&rsquo;s order arrives unpriced.
                    </>
                  ) : (
                    "Quantities and prices can be changed until this order is confirmed. After that, stock is reserved against it."
                  )}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={savePrices}
                  disabled={
                    pricing ||
                    (Object.keys(priceDraft).length === 0 &&
                      Object.keys(qtyDraft).length === 0)
                  }
                >
                  {pricing ? "Saving…" : "Save changes"}
                </Button>
              </div>
            )}

            {canPrice && (
              <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-border p-2.5">
                <div className="min-w-56 flex-1">
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Add a product the shop asked for
                  </label>
                  <NativeSelect
                    value={addProductId}
                    onChange={(e) => setAddProductId(e.target.value)}
                    aria-label="Product to add"
                  >
                    <option value="">Choose a product…</option>
                    {catalogue
                      .filter((c) => !detail.lines.some((l) => l.product_id === c.id))
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </NativeSelect>
                </div>
                <div className="w-28">
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Units
                  </label>
                  <Input
                    type="number"
                    min={1}
                    step="1"
                    value={addQty}
                    onChange={(e) => setAddQty(e.target.value)}
                    aria-label="Units to add"
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={addLine}
                  disabled={adding || !addProductId || !addQty}
                >
                  {adding ? "Adding…" : "Add to order"}
                </Button>
              </div>
            )}

            {(() => {
              // Priced at the rate frozen onto this order, not the
              // organisation's current one, which may have moved since.
              const t = orderTotals(
                detail.lines.map((l) => ({
                  qty: l.qty_ordered,
                  unitPrice: l.unit_price == null ? 0 : Number(l.unit_price),
                })),
                Number(o.vat_rate ?? 0)
              );
              return (
                <div className="mt-4 flex justify-end">
                  <div className="w-56 space-y-0.5 text-right text-sm">
                    <p className="text-muted-foreground">
                      Subtotal
                      <span className="ml-2 tabular-nums text-foreground">
                        {t.subtotal.toFixed(2)}
                      </span>
                    </p>
                    <p className="text-muted-foreground">
                      VAT {Number(o.vat_rate ?? 0)}%
                      <span className="ml-2 tabular-nums text-foreground">
                        {t.vat.toFixed(2)}
                      </span>
                    </p>
                    <p className="border-t border-border pt-1 font-medium">
                      Total
                      <span className="ml-2 tabular-nums">{t.total.toFixed(2)}</span>
                    </p>
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Order</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <Row label="Source" value={o.source === "rep_app" ? "Rep app" : "Keyed here"} />
              <Row label="Received via" value={o.received_via.replace("_", " ")} />
              {/* Always shown. "No rep" is a fact about the order — a shop
                  that rang the office is nobody's call — and hiding the row
                  makes it look like the screen forgot to load it. */}
              <Row label="Rep" value={detail.repName ?? "No rep"} />
              <Row label="Invoice" value={o.invoice_number ?? "Not yet raised"} />
              {o.contact_name && <Row label="Contact" value={o.contact_name} />}
              {o.contact_phone && <Row label="Phone" value={o.contact_phone} />}
              {o.required_by && <Row label="Required by" value={o.required_by} />}
              {/* Set by confirming, so absent on a new order — there is no
                  answer yet, and naming the default here would look like a
                  decision that has been taken. */}
              {detail.fulfilLocationName && (
                <Row label="Fulfilled from" value={detail.fulfilLocationName} />
              )}
              <Row
                label="POD"
                value={
                  // Every delivery sets this to `outstanding` and filing the
                  // document sets it to `received`; nothing ever chooses
                  // `not_required`, which is only the column default before a
                  // delivery has happened. Printing it raw told the reader a
                  // signature would not be needed, which is the opposite of
                  // the rule.
                  o.pod_status === "received"
                    ? "Received"
                    : o.pod_status === "outstanding"
                      ? "Outstanding"
                      : "Required on delivery"
                }
              />
              {o.hold_reason && <Row label="Hold reason" value={o.hold_reason} />}
              {o.cancel_reason && <Row label="Cancelled" value={o.cancel_reason} />}
              {o.notes && <Row label="Notes" value={o.notes} />}

              {/* The columns `orders` grants an update on, and no others. The
                  store is deliberately not among them: moving an order to a
                  different shop is a different order, and every document
                  downstream points at this one. */}
              {canPrice && !editingDetails && (
                <button
                  type="button"
                  onClick={startEditingDetails}
                  className="pt-1 text-xs text-primary hover:underline"
                >
                  Edit contact, date and notes
                </button>
              )}

              {canPrice && editingDetails && (
                <div className="space-y-2 border-t border-border pt-2">
                  <Input
                    value={detailsDraft.contact_name}
                    onChange={(e) =>
                      setDetailsDraft((d) => ({ ...d, contact_name: e.target.value }))
                    }
                    placeholder="Contact name"
                    aria-label="Contact name"
                  />
                  <Input
                    value={detailsDraft.contact_phone}
                    onChange={(e) =>
                      setDetailsDraft((d) => ({ ...d, contact_phone: e.target.value }))
                    }
                    placeholder="Contact phone"
                    aria-label="Contact phone"
                  />
                  {/* The same window the rep app's picker allows, so the
                      same order cannot take a date from one screen that the
                      other would refuse. `updateOrderDetails` checks it again
                      — this is the courtesy, that is the rule. */}
                  <Input
                    type="date"
                    min={requiredByRange().min}
                    max={requiredByRange().max}
                    value={detailsDraft.required_by}
                    onChange={(e) =>
                      setDetailsDraft((d) => ({ ...d, required_by: e.target.value }))
                    }
                    aria-label="Required by"
                  />
                  <Input
                    value={detailsDraft.notes}
                    onChange={(e) =>
                      setDetailsDraft((d) => ({ ...d, notes: e.target.value }))
                    }
                    placeholder="Notes"
                    aria-label="Notes"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={saveDetails} disabled={savingDetails}>
                      {savingDetails ? "Saving…" : "Save"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditingDetails(false)}
                      disabled={savingDetails}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {detail.dispatches.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Truck className="h-4 w-4" /> Dispatches
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {detail.dispatches.map((d) => (
                  <div key={d.id} className="rounded-md border border-border p-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{d.dispatch_number}</span>
                      <Badge variant="outline">{d.status.replace("_", " ")}</Badge>
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      {[d.driver_name, d.vehicle_registration, d.carrier_name]
                        .filter(Boolean)
                        .join(" · ") || "No carrier recorded"}
                    </p>
                    {/* Whose job it is, which is not the same question as who
                        is driving. A rep given this sees it on their phone;
                        until somebody is given it, nobody does. */}
                    <div className="mt-2 flex items-center gap-2">
                      <label
                        htmlFor={`assign-${d.id}`}
                        className="shrink-0 text-xs text-muted-foreground"
                      >
                        Rep
                      </label>
                      <NativeSelect
                        id={`assign-${d.id}`}
                        className="h-8 text-xs"
                        value={d.assigned_rep_id ?? ""}
                        disabled={busy}
                        onChange={(e) =>
                          run(
                            () =>
                              assignDispatchRep(
                                supabase,
                                d.id,
                                e.target.value || null
                              ),
                            e.target.value
                              ? "The delivery is on that rep's phone now."
                              : "The delivery is nobody's job now."
                          )
                        }
                      >
                        <option value="">Nobody — the warehouse handles it</option>
                        {/* A rep deactivated since the delivery was assigned is
                            not in the list, and a native select with no
                            matching option silently displays the first one —
                            so this would have shown "Nobody" for a delivery
                            that is somebody's. Named, and not selectable
                            again. */}
                        {d.assigned_rep_id &&
                          !reps.some((r) => r.id === d.assigned_rep_id) && (
                            <option value={d.assigned_rep_id} disabled>
                              {d.assigned_rep_name ?? "Unnamed rep"} (no longer
                              active)
                            </option>
                          )}
                        {reps.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.full_name ?? "Unnamed rep"}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                    {d.tracking_reference && (
                      <p className="text-xs text-muted-foreground">
                        Tracking {d.tracking_reference}
                      </p>
                    )}
                    {d.received_by_name && (
                      <p className="text-xs text-muted-foreground">
                        Received by {d.received_by_name}
                      </p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Documents</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {/* The rule this states is already enforced — the orders list
                  derives its stage from `pod_status`, so an order sits in
                  "Delivered — needs POD" and cannot reach "Delivered and
                  fulfilled" until the trigger on `delivery_documents` flips it
                  to `received`. It was enforced silently, which is why it read
                  as missing: the screen never said the delivery was unfinished
                  or what would finish it. */}
              {o.pod_status === "outstanding" && (
                <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-amber-700 dark:text-amber-500">
                  This delivery is not finished. It stays under{" "}
                  <strong>Delivered — needs POD</strong> until a signed proof of
                  delivery is filed here, and only then counts as fulfilled.
                </p>
              )}
              {detail.documents.length === 0 ? (
                <p className="text-muted-foreground">Nothing filed yet.</p>
              ) : (
                detail.documents.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className="block w-full text-left text-primary hover:underline"
                    onClick={async () => {
                      // The tab is opened on the click itself, then pointed at
                      // the signed URL once it arrives. Opening it after the
                      // await loses the user-activation token in Safari and
                      // others, and the click then does nothing at all with
                      // nothing on screen to explain why.
                      //
                      // ⚠️ No `noopener` here, and that is the whole point.
                      // `window.open` returns **null** whenever noopener is
                      // asked for — per spec, the handle is exactly what
                      // noopener withholds. The blank tab still opened, so the
                      // old code left the user staring at `about:blank` while
                      // its fallback `window.open(url)` ran after the await
                      // with the activation token already spent, and was
                      // swallowed by the popup blocker. The reference is
                      // needed to navigate the tab, so take it and sever the
                      // back-link by hand instead.
                      const tab = window.open("", "_blank");
                      if (tab) tab.opener = null;
                      try {
                        const url = await signedDocumentUrl(supabase, d.storage_path);
                        if (tab) tab.location.href = url;
                        // Popup blocked outright: fall back to navigating this
                        // tab, which needs no activation token. Better than a
                        // dead click with nothing on screen.
                        else window.location.href = url;
                      } catch (e) {
                        tab?.close();
                        setError(e instanceof Error ? e.message : String(e));
                      }
                    }}
                  >
                    {d.doc_type.replace("_", " ")} — {d.file_name ?? "document"}
                    {d.signed_by_name && (
                      <span className="text-muted-foreground"> · {d.signed_by_name}</span>
                    )}
                  </button>
                ))
              )}
              {o.status === "delivered" && (
                <Button variant="outline" size="sm" onClick={() => setDialog("upload")}>
                  <FileUp className="mr-1.5 h-4 w-4" /> Upload
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" /> Audit trail
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2 text-sm">
            {detail.events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="tabular-nums text-muted-foreground">
                  {new Date(e.created_at).toLocaleString()}
                </span>
                <span className="font-medium">
                  {e.from_status ? `${e.from_status} → ${e.to_status}` : `created as ${e.to_status}`}
                </span>
                <span className="text-muted-foreground">
                  {e.actor_name ?? "system"}
                  {e.note ? ` — ${e.note}` : ""}
                </span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {/* ------------------------------------------------------- dialogs */}

      <Dialog open={dialog === "confirm"} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm and reserve stock</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {/* Hidden while there is only one place stock can be: nobody should
                be asked to choose between one thing. It appears by itself the
                day a second warehouse is opened. */}
            {locations.length > 1 && (
              <div>
                <Label htmlFor="fulfil-from">Fulfil from</Label>
                <NativeSelect
                  id="fulfil-from"
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
                <p className="mt-1 text-xs text-muted-foreground">
                  The stock comes off this location and the picking list sends the
                  picker there. It cannot be changed once the order is confirmed —
                  the reservation is against this shelf.
                </p>
              </div>
            )}

            {/* Nowhere to fulfil from at all. Falling through to the branches
                below would report everything in stock on the strength of a
                check that never ran — reassuring, and about nothing.

                Empty means the list came back empty, not that no default is
                set: the seeding falls through to the first location when none
                is flagged default. So the instruction is to have a location at
                all, and it names where — "set a default warehouse" is not
                something a clerk can act on when there is no warehouse to
                set. */}
            {fulfilFrom === "" ? (
              <p className="text-sm text-muted-foreground">
                There is no active location to fulfil this order from. A manager
                adds or reactivates one under Warehouse setup → Locations.
              </p>
            ) : checkFailure ? (
              <p className="text-sm text-muted-foreground">
                Stock could not be checked{fulfilName ? ` at ${fulfilName}` : ""}, so
                what follows is unknown rather than fine. Confirming counts it
                properly and will refuse what is not there.
              </p>
            ) : checkingStock ? (
              <p className="text-sm text-muted-foreground">
                Checking stock{fulfilName ? ` at ${fulfilName}` : ""}…
              </p>
            ) : short.length > 0 ? (
              <div className="space-y-1.5">
                <p className="text-sm text-muted-foreground">
                  {short.length} line{short.length === 1 ? " is" : "s are"} short
                  {fulfilName ? ` at ${fulfilName}` : ""}. Choose what should happen
                  {locations.length > 1 ? ", or fulfil from somewhere else" : ""}.
                </p>
                {/* Listed here as well as on the banner behind this dialog,
                    because switching warehouse changes the answer and the
                    clerk is looking at this box when they do it. */}
                <ul className="text-sm text-muted-foreground">
                  {short.map((s) => (
                    <li key={s.order_line_id}>
                      {s.product_name}: {s.qty_available} of {s.qty_ordered} —{" "}
                      <span className="text-amber-700 dark:text-amber-500">
                        {s.qty_short} short
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Everything on this order is in stock{fulfilName ? ` at ${fulfilName}` : ""}.
                Confirming holds it against this order.
              </p>
            )}
            <div>
              <Label htmlFor="shortfall">If there is not enough stock</Label>
              <NativeSelect
                id="shortfall"
                value={shortfall}
                onChange={(e) => setShortfall(e.target.value as ShortfallAction)}
              >
                <option value="reject">Do not confirm — leave the order as new</option>
                <option value="partial">Reserve what there is, flag the short lines</option>
                <option value="backorder">Reserve what there is, mark the rest back-ordered</option>
                <option value="hold">Reserve what there is and put the order on hold</option>
              </NativeSelect>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                run(
                  // Passed explicitly rather than left to the RPC's own
                  // fallback: the clerk is looking at a named warehouse and
                  // the reservation has to be made where they were told it
                  // would be. Empty only when there is no location at all, in
                  // which case `order_confirm` says so plainly.
                  () => confirmOrder(supabase, orderId, shortfall, fulfilFrom || null),
                  fulfilName
                    ? `Order confirmed and stock reserved at ${fulfilName}.`
                    : "Order confirmed and stock reserved."
                )
              }
              disabled={busy}
            >
              {busy ? "Confirming…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "dispatch"} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dispatch this order</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Name a driver, a vehicle, or a courier — at least one.
            </p>
            <div>
              <Label htmlFor="driver">Driver</Label>
              <NativeSelect id="driver" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                <option value="">None</option>
                {carriers.drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.full_name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div>
              <Label htmlFor="vehicle">Vehicle</Label>
              <NativeSelect
                id="vehicle"
                value={vehicleId}
                onChange={(e) => setVehicleId(e.target.value)}
              >
                <option value="">None</option>
                {carriers.vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.registration}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div>
              <Label htmlFor="carrier">Courier</Label>
              <Input
                id="carrier"
                value={carrierName}
                onChange={(e) => setCarrierName(e.target.value)}
                placeholder="If a third party is taking it"
              />
            </div>
            <div>
              <Label htmlFor="tracking">Tracking reference</Label>
              <Input id="tracking" value={tracking} onChange={(e) => setTracking(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="expected">Expected delivery</Label>
              <Input
                id="expected"
                type="date"
                value={expectedOn}
                onChange={(e) => setExpectedOn(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                run(
                  () =>
                    dispatchOrder(supabase, orderId, {
                      driverId,
                      vehicleId,
                      carrierName,
                      trackingReference: tracking,
                      expectedDeliveryOn: expectedOn,
                    }),
                  "Dispatched."
                )
              }
              disabled={busy}
            >
              {busy ? "Dispatching…" : "Dispatch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "deliver"} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record the delivery</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="receivedby">Who took delivery?</Label>
              <Input
                id="receivedby"
                value={receivedBy}
                onChange={(e) => setReceivedBy(e.target.value)}
                placeholder="Name of the person at the store"
              />
            </div>
            <p className="text-sm text-muted-foreground">
              The full consignment is recorded as delivered. Anything the customer would
              not take should be handled as a failed delivery instead.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                run(() => {
                  // Not an assertion. `openDispatch` is derived from the order
                  // on every render, and what is on screen is not proof it is
                  // still in transit by the time the button is pressed.
                  if (!openDispatch) {
                    throw new Error(
                      "This consignment is no longer in transit. Reload the order."
                    );
                  }
                  return markDelivered(supabase, openDispatch.id, receivedBy);
                }, "Delivery recorded. The signed POD is now outstanding.")
              }
              disabled={busy || !receivedBy.trim() || !openDispatch}
            >
              {busy ? "Saving…" : "Record delivery"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "failed"} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>The delivery did not happen</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="failreason">What happened?</Label>
              <Input
                id="failreason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Shop closed, customer refused, vehicle broke down…"
              />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={cancelAfterReturn}
                onChange={(e) => setCancelAfterReturn(e.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                Cancel the order as well.
                <span className="block text-muted-foreground">
                  Leave this unticked to put it back to packed with its stock still
                  reserved, ready to go out again.
                </span>
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                run(
                  () => {
                    if (!openDispatch) {
                      throw new Error(
                        "This consignment is no longer in transit. Reload the order."
                      );
                    }
                    return returnUndelivered(
                      supabase,
                      openDispatch.id,
                      reason,
                      cancelAfterReturn
                    );
                  },
                  cancelAfterReturn
                    ? "Stock returned and the order cancelled."
                    : "Stock returned. The order is packed and ready to go out again."
                )
              }
              disabled={busy || !reason.trim() || !openDispatch}
            >
              {busy ? "Saving…" : "Record it"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialog === "cancel" || dialog === "hold"}
        onOpenChange={(v) => !v && setDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmKind === "cancel" ? "Cancel this order" : "Put this order on hold"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {confirmKind === "cancel"
                ? "Any stock held for this order is released. This cannot be undone."
                : "A hold freezes the order where it is. Nothing moves until it is released."}
            </p>
            <div>
              <Label htmlFor="reason">Reason</Label>
              <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={busy}>
              Back
            </Button>
            <Button
              onClick={() =>
                run(
                  () =>
                    confirmKind === "cancel"
                      ? cancelOrder(supabase, orderId, reason)
                      : holdOrder(supabase, orderId, reason),
                  confirmKind === "cancel" ? "Order cancelled." : "Order held."
                )
              }
              disabled={busy || !reason.trim()}
            >
              {busy ? "Saving…" : confirmKind === "cancel" ? "Cancel the order" : "Hold it"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "upload"} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload a delivery document</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="doctype">Document</Label>
              <NativeSelect
                id="doctype"
                value={docType}
                onChange={(e) => setDocType(e.target.value as typeof docType)}
              >
                <option value="pod">Signed proof of delivery</option>
                <option value="delivery_note">Delivery note</option>
                <option value="delivery_photo">Photo</option>
              </NativeSelect>
            </div>
            {docType === "pod" && (
              <div>
                <Label htmlFor="signedby">Signed by</Label>
                <Input
                  id="signedby"
                  value={signedBy}
                  onChange={(e) => setSignedBy(e.target.value)}
                  placeholder="Name on the signature"
                />
              </div>
            )}
            <div>
              <Label htmlFor="file">File</Label>
              <Input
                id="file"
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                PDF or a photograph, up to 15 MB.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                run(async () => {
                  if (!file) throw new Error("Choose a file first.");
                  if (!orgId) throw new Error("Could not work out your organisation.");
                  await uploadDeliveryDocument(supabase, {
                    orgId,
                    orderId,
                    // A POD belongs to the consignment that actually arrived.
                    // An order that went out, came back and went out again has
                    // more than one dispatch, and `dispatches[0]` could be the
                    // failed or returned one — filing proof of delivery
                    // against a consignment that demonstrably did not arrive
                    // is worse than filing it against nothing. No delivered
                    // dispatch means null, which the column allows.
                    //
                    // This dialog only opens on a delivered order, so there is
                    // no in-transit case to handle here. Uploading a delivery
                    // note before the delivery is a separate change.
                    dispatchId:
                      detail.dispatches.find((d) => d.status === "delivered")?.id ?? null,
                    docType,
                    file,
                    signedByName: signedBy,
                  });
                }, "Document filed.")
              }
              disabled={busy || !file || (docType === "pod" && !signedBy.trim())}
            >
              {busy ? "Uploading…" : "Upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
