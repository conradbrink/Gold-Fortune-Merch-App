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
import { Field, FormSection } from "@/components/hr/field";
import { createClient } from "@/lib/supabase/client";
import {
  saveCompensation,
  type CompensationInput,
} from "@/lib/hr/employees";
import type { Compensation } from "@/lib/hr/types";

/**
 * Pay, bank and tax details — the seam payroll will attach to.
 *
 * **Nothing in this dialog calculates anything.** No tax, no net pay, no
 * deductions arithmetic, no Botswana compliance logic. Section 13 asks for the
 * data model and explicitly not the calculations, and a "monthly net" field
 * showing a number this system had guessed would be worse than no field at all.
 *
 * These values live in `hr_employee_compensation`, a separate table from the
 * employee, and that is the whole reason a line manager can open somebody's
 * record and not see their salary: RLS is row-level, so the only way to hide a
 * column is to put it in a different row.
 *
 * Every change lands in `security_events` with the before and after, written by
 * a trigger rather than by this code.
 */
export function CompensationDialog({
  open,
  onOpenChange,
  employeeId,
  employeeName,
  orgId,
  userId,
  existing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeId: string;
  employeeName: string;
  orgId: string | null;
  userId: string | null;
  existing: Compensation | null;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const [form, setForm] = useState<CompensationInput>(() => blank());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset when the dialog opens, during render rather than in an effect.
  // This is React's documented "adjusting state when a prop changes" pattern:
  // an effect would paint the previous contents for one frame first, and would
  // trip react-hooks/set-state-in-effect for a real reason rather than a
  // spurious one.
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const openKey = open ? existing?.employee_id ?? "new" : null;
  if (openKey !== openedFor) {
    setOpenedFor(openKey);
    if (open) {
      setForm(existing ? fromRow(existing) : blank());
      setError(null);
    }
  }

  const set = <K extends keyof CompensationInput>(
    key: K,
    value: CompensationInput[K]
  ) => setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    if (!orgId) {
      setError("Your organisation could not be resolved.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveCompensation(supabase, orgId, employeeId, userId, form);
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
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Pay details — {employeeName}</DialogTitle>
          <DialogDescription>
            Recorded for payroll later. Nothing here is calculated, and no
            payslip is produced yet. Every change is written to the audit trail.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <FormSection title="Pay">
            <Field label="Currency">
              <Input
                value={form.currency}
                onChange={(e) => set("currency", e.target.value.toUpperCase())}
                maxLength={5}
              />
            </Field>
            <Field label="Basic salary">
              <Input
                type="number"
                step="0.01"
                min="0"
                value={form.basic_salary ?? ""}
                onChange={(e) =>
                  set(
                    "basic_salary",
                    e.target.value === "" ? null : Number(e.target.value)
                  )
                }
              />
            </Field>
            <Field label="Pay frequency">
              <NativeSelect
                value={form.pay_frequency}
                onChange={(e) => set("pay_frequency", e.target.value)}
              >
                <option value="monthly">Monthly</option>
                <option value="fortnightly">Fortnightly</option>
                <option value="weekly">Weekly</option>
                <option value="daily">Daily</option>
                <option value="hourly">Hourly</option>
              </NativeSelect>
            </Field>
            <Field label="Effective from">
              <Input
                type="date"
                value={form.effective_from ?? ""}
                onChange={(e) => set("effective_from", e.target.value || null)}
              />
            </Field>
            <Field
              label="Commission structure"
              className="sm:col-span-2"
              hint="Free text for now. Commission is not computed anywhere."
            >
              <Textarea
                rows={2}
                value={form.commission_structure ?? ""}
                onChange={(e) => set("commission_structure", e.target.value || null)}
              />
            </Field>
            <Field label="Overtime rate">
              <Input
                type="number"
                step="0.01"
                min="0"
                value={form.overtime_rate ?? ""}
                onChange={(e) =>
                  set(
                    "overtime_rate",
                    e.target.value === "" ? null : Number(e.target.value)
                  )
                }
              />
            </Field>
            <Field label="Payroll status">
              <NativeSelect
                value={form.payroll_status}
                onChange={(e) => set("payroll_status", e.target.value)}
              >
                <option value="not_configured">Not configured</option>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
                <option value="excluded">Excluded</option>
              </NativeSelect>
            </Field>
            <Field label="Bonus notes" className="sm:col-span-2">
              <Textarea
                rows={2}
                value={form.bonus_note ?? ""}
                onChange={(e) => set("bonus_note", e.target.value || null)}
              />
            </Field>
          </FormSection>

          <FormSection
            title="Bank and tax"
            description="Held for payroll. Visible to HR and to the employee themselves."
          >
            <Field label="Bank">
              <Input
                value={form.bank_name ?? ""}
                onChange={(e) => set("bank_name", e.target.value || null)}
              />
            </Field>
            <Field label="Branch code">
              <Input
                value={form.bank_branch_code ?? ""}
                onChange={(e) => set("bank_branch_code", e.target.value || null)}
              />
            </Field>
            <Field label="Account name">
              <Input
                value={form.bank_account_name ?? ""}
                onChange={(e) => set("bank_account_name", e.target.value || null)}
              />
            </Field>
            <Field label="Account number">
              <Input
                value={form.bank_account_number ?? ""}
                onChange={(e) => set("bank_account_number", e.target.value || null)}
              />
            </Field>
            <Field label="Tax number">
              <Input
                value={form.tax_number ?? ""}
                onChange={(e) => set("tax_number", e.target.value || null)}
              />
            </Field>
            <Field label="Tax status">
              <Input
                value={form.tax_status ?? ""}
                onChange={(e) => set("tax_status", e.target.value || null)}
              />
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <Textarea
                rows={2}
                value={form.notes ?? ""}
                onChange={(e) => set("notes", e.target.value || null)}
              />
            </Field>
          </FormSection>
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
            {busy ? "Saving…" : "Save pay details"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function blank(): CompensationInput {
  return {
    currency: "BWP",
    basic_salary: null,
    pay_frequency: "monthly",
    commission_structure: null,
    overtime_rate: null,
    bonus_note: null,
    bank_name: null,
    bank_branch_code: null,
    bank_account_name: null,
    bank_account_number: null,
    tax_number: null,
    tax_status: null,
    payroll_status: "not_configured",
    effective_from: null,
    notes: null,
  };
}

function fromRow(c: Compensation): CompensationInput {
  return {
    currency: c.currency,
    basic_salary: c.basic_salary,
    pay_frequency: c.pay_frequency,
    commission_structure: c.commission_structure,
    overtime_rate: c.overtime_rate,
    bonus_note: c.bonus_note,
    bank_name: c.bank_name,
    bank_branch_code: c.bank_branch_code,
    bank_account_name: c.bank_account_name,
    bank_account_number: c.bank_account_number,
    tax_number: c.tax_number,
    tax_status: c.tax_status,
    payroll_status: c.payroll_status,
    effective_from: c.effective_from,
    notes: c.notes,
  };
}
