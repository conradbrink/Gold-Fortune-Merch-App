"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/hr/field";
import { createClient } from "@/lib/supabase/client";
import { addAsset } from "@/lib/hr/employees";
import { toLocalDateInput } from "@/lib/date-range";

/**
 * Issue a company asset — a vehicle, a phone, anything else.
 *
 * Vehicles can point at the fleet the warehouse module already manages rather
 * than being retyped, so a registration exists in one place and moving a van
 * between drivers does not create a second record of the same van. A vehicle
 * that is not in that list is still recordable: the label carries the
 * registration, which is better than refusing to record the fact.
 */
export function AssetDialog({
  open,
  onOpenChange,
  orgId,
  userId,
  employeeId,
  employeeName,
  vehicles,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string | null;
  userId: string | null;
  employeeId: string;
  employeeName: string;
  vehicles: { id: string; registration: string; make_model: string | null }[];
  onSaved: () => void;
}) {
  const supabase = createClient();
  const today = toLocalDateInput(new Date());

  const [kind, setKind] = useState("other");
  const [vehicleId, setVehicleId] = useState("");
  const [label, setLabel] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [issuedOn, setIssuedOn] = useState(today);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset when the dialog opens, during render rather than in an effect.
  // This is React's documented "adjusting state when a prop changes" pattern:
  // an effect would paint the previous contents for one frame first, and would
  // trip react-hooks/set-state-in-effect for a real reason rather than a
  // spurious one.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setKind("other");
      setVehicleId("");
      setLabel("");
      setIdentifier("");
      setIssuedOn(today);
      setNotes("");
      setError(null);
    }
  }

  async function save() {
    if (!orgId) {
      setError("Your organisation could not be resolved.");
      return;
    }
    const chosen = vehicles.find((v) => v.id === vehicleId);
    const finalLabel = label.trim() || chosen?.registration || "";
    if (!finalLabel) {
      setError("Give the asset a name or pick a vehicle.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addAsset(supabase, orgId, employeeId, userId, {
        kind,
        vehicle_id: kind === "vehicle" && vehicleId ? vehicleId : null,
        label: finalLabel,
        identifier: identifier.trim() || null,
        issued_on: issuedOn || null,
        returned_on: null,
        notes: notes.trim() || null,
      });
      onSaved();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Issue an asset — {employeeName}</DialogTitle>
          <DialogDescription>
            Returning it later is an update, not a deletion: it happened.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Type">
            <NativeSelect value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="vehicle">Vehicle</option>
              <option value="phone">Company phone</option>
              <option value="other">Other</option>
            </NativeSelect>
          </Field>
          {kind === "vehicle" && (
            <Field label="From the fleet" hint="Or leave unset and type the registration.">
              <NativeSelect
                value={vehicleId}
                onChange={(e) => setVehicleId(e.target.value)}
              >
                <option value="">Not in the fleet list</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.registration}
                    {v.make_model ? ` — ${v.make_model}` : ""}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          <Field label="Name" className={kind === "vehicle" ? "sm:col-span-2" : ""}>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={kind === "phone" ? "Samsung A15" : "B 123 ABC"}
            />
          </Field>
          <Field label="Serial / IMEI / registration">
            <Input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
          </Field>
          <Field label="Issued on">
            <Input
              type="date"
              value={issuedOn}
              onChange={(e) => setIssuedOn(e.target.value)}
            />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Issue asset"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
