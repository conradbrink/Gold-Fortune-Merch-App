"use client";

import { useEffect, useMemo, useState } from "react";
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
  createEmployee,
  updateEmployee,
  suggestEmployeeNumber,
  type EmployeeInput,
  type EmployeeRow,
  type ProfileOption,
} from "@/lib/hr/employees";
import {
  EMPLOYMENT_STATUS_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  type Department,
  type ReviewTemplate,
} from "@/lib/hr/types";

/**
 * Create or edit an employee.
 *
 * The field that decides everything else is **Linked account**. An employee row
 * points at a `profiles` row rather than duplicating it, and that link is what
 * makes their workday sessions become attendance, their manager's approvals
 * reach them, and their own self-service page find them. The dropdown shows
 * accounts that are already taken, greyed out — "Jerry is already EMP-004" is
 * the answer to the question the user was about to ask, and a name silently
 * missing from a list is not.
 *
 * Leaving it unset is a legitimate choice, not an omission: a cleaner or a
 * driver who never touches the app is a real employee, and the alternative
 * would be creating a fake login so the record could exist.
 */
export function EmployeeDialog({
  open,
  onOpenChange,
  employee,
  orgId,
  departments,
  territories,
  reviewTemplates,
  managers,
  profiles,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null creates. */
  employee: EmployeeRow | null;
  orgId: string | null;
  departments: Department[];
  territories: { id: string; name: string }[];
  reviewTemplates: ReviewTemplate[];
  managers: EmployeeRow[];
  profiles: ProfileOption[];
  onSaved: () => void;
}) {
  const supabase = createClient();
  const [form, setForm] = useState<EmployeeInput>(() => blank());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset when the dialog opens, during render rather than in an effect. This
  // is React's documented "adjusting state when a prop changes" pattern: an
  // effect would paint the previous employee's details for one frame first.
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const openKey = open ? employee?.id ?? "new" : null;
  if (openKey !== openedFor) {
    setOpenedFor(openKey);
    if (open) {
      setForm(employee ? fromRow(employee) : blank());
      setError(null);
    }
  }

  // The number, on the other hand, comes off the network and so does belong in
  // an effect. A suggestion, not a reservation: two people creating an employee
  // at the same moment get the same number, and the second is told to change it
  // by the unique index rather than by a lock nobody would understand.
  useEffect(() => {
    if (!open || employee) return;
    void suggestEmployeeNumber(supabase)
      .then((n) =>
        // Guarded, because the user may have typed one while this was in
        // flight, and their number beats ours.
        setForm((f) => (f.employee_number ? f : { ...f, employee_number: n }))
      )
      .catch(() => {
        /* An unfilled suggestion is a blank field, not a failure. */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, employee]);

  const set = <K extends keyof EmployeeInput>(key: K, value: EmployeeInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  /** Managers exclude the person being edited: nobody reports to themselves. */
  const managerOptions = useMemo(
    () => managers.filter((m) => m.id !== employee?.id),
    [managers, employee?.id]
  );

  /**
   * The scorecard this person inherits, read off the department currently
   * chosen in the form rather than off the saved record — changing the
   * department dropdown should immediately change what "their department's"
   * means underneath it.
   */
  const departmentTemplate = useMemo(() => {
    const dept = departments.find((d) => d.id === form.department_id);
    if (!dept?.review_template_id) return null;
    return reviewTemplates.find((t) => t.id === dept.review_template_id) ?? null;
  }, [departments, reviewTemplates, form.department_id]);

  const takenBy = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of profiles) if (p.linked) map.set(p.id, p.full_name ?? p.email ?? "another record");
    return map;
  }, [profiles]);

  async function save() {
    if (!form.first_name.trim() || !form.last_name.trim()) {
      setError("A first name and a last name are required.");
      return;
    }
    if (!form.employee_number.trim()) {
      setError("An employee number is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload: EmployeeInput = {
        ...form,
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        employee_number: form.employee_number.trim(),
      };
      if (employee) {
        await updateEmployee(supabase, employee.id, payload);
      } else {
        if (!orgId) throw new Error("Your organisation could not be resolved.");
        await createEmployee(supabase, orgId, payload);
      }
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
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {employee ? `Edit ${employee.full_name ?? "employee"}` : "Add an employee"}
          </DialogTitle>
          <DialogDescription>
            Salary and bank details are edited separately, on the employee&rsquo;s
            Overview tab.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <FormSection
            title="Personal"
            description="What HR needs to reach this person and identify them on paper."
          >
            <Field label="Employee ID">
              <Input
                value={form.employee_number}
                onChange={(e) => set("employee_number", e.target.value)}
                placeholder="EMP-001"
              />
            </Field>
            <Field
              label="Linked account"
              hint="Leave unset for someone who does not sign in. Attendance and self-service need this link."
            >
              <NativeSelect
                value={form.profile_id ?? ""}
                onChange={(e) => set("profile_id", e.target.value || null)}
              >
                <option value="">No account</option>
                {profiles.map((p) => {
                  const taken = takenBy.get(p.id);
                  const isOwn = p.id === employee?.profile_id;
                  return (
                    <option key={p.id} value={p.id} disabled={Boolean(taken) && !isOwn}>
                      {(p.full_name ?? p.email ?? p.id) +
                        (taken && !isOwn ? ` — already ${taken}` : ` (${p.role})`)}
                    </option>
                  );
                })}
              </NativeSelect>
            </Field>
            <Field label="First name">
              <Input
                value={form.first_name}
                onChange={(e) => set("first_name", e.target.value)}
              />
            </Field>
            <Field label="Last name">
              <Input
                value={form.last_name}
                onChange={(e) => set("last_name", e.target.value)}
              />
            </Field>
            <Field label="Phone">
              <Input
                value={form.phone ?? ""}
                onChange={(e) => set("phone", e.target.value || null)}
              />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={form.email ?? ""}
                onChange={(e) => set("email", e.target.value || null)}
              />
            </Field>
            <Field label="Date of birth">
              <Input
                type="date"
                value={form.date_of_birth ?? ""}
                onChange={(e) => set("date_of_birth", e.target.value || null)}
              />
            </Field>
            <Field label="ID / passport number">
              <Input
                value={form.national_id ?? ""}
                onChange={(e) => set("national_id", e.target.value || null)}
              />
            </Field>
            <Field label="Residential address" className="sm:col-span-2">
              <Textarea
                rows={2}
                value={form.address ?? ""}
                onChange={(e) => set("address", e.target.value || null)}
              />
            </Field>
            <Field label="Emergency contact name">
              <Input
                value={form.emergency_contact_name ?? ""}
                onChange={(e) => set("emergency_contact_name", e.target.value || null)}
              />
            </Field>
            <Field label="Emergency contact number">
              <Input
                value={form.emergency_contact_phone ?? ""}
                onChange={(e) => set("emergency_contact_phone", e.target.value || null)}
              />
            </Field>
          </FormSection>

          <FormSection title="Employment">
            <Field label="Position">
              <Input
                value={form.position ?? ""}
                onChange={(e) => set("position", e.target.value || null)}
                placeholder="Merchandiser"
              />
            </Field>
            <Field label="Department">
              <NativeSelect
                value={form.department_id ?? ""}
                onChange={(e) => set("department_id", e.target.value || null)}
              >
                <option value="">Unassigned</option>
                {departments
                  .filter((d) => d.active || d.id === form.department_id)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </NativeSelect>
            </Field>
            <Field
              label="Manager"
              hint="Decides who may approve their leave and see their HR record."
            >
              <NativeSelect
                value={form.manager_id ?? ""}
                onChange={(e) => set("manager_id", e.target.value || null)}
              >
                <option value="">No manager</option>
                {managerOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.full_name ?? m.employee_number}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Territory">
              <NativeSelect
                value={form.territory_id ?? ""}
                onChange={(e) => set("territory_id", e.target.value || null)}
              >
                <option value="">Unassigned</option>
                {territories.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field
              label="Review scorecard"
              hint={
                departmentTemplate
                  ? `Their department uses ${departmentTemplate.name}. Change this only for somebody whose job spans two.`
                  : "Their department has no scorecard, so one must be set here before they can be reviewed."
              }
            >
              <NativeSelect
                value={form.review_template_id ?? ""}
                onChange={(e) =>
                  set("review_template_id", e.target.value || null)
                }
              >
                <option value="">
                  {departmentTemplate
                    ? `Their department’s (${departmentTemplate.name})`
                    : "Their department’s — none set"}
                </option>
                {reviewTemplates
                  .filter((t) => t.active || t.id === form.review_template_id)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.active ? "" : " (retired)"}
                    </option>
                  ))}
              </NativeSelect>
            </Field>
            <Field label="Employment status">
              <NativeSelect
                value={form.employment_status}
                onChange={(e) => set("employment_status", e.target.value)}
              >
                {Object.entries(EMPLOYMENT_STATUS_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Employment type">
              <NativeSelect
                value={form.employment_type}
                onChange={(e) => set("employment_type", e.target.value)}
              >
                {Object.entries(EMPLOYMENT_TYPE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field
              label="Start date"
              hint="Attendance is only reported from this date onwards."
            >
              <Input
                type="date"
                value={form.start_date ?? ""}
                onChange={(e) => set("start_date", e.target.value || null)}
              />
            </Field>
            <Field label="Probation ends">
              <Input
                type="date"
                value={form.probation_end_date ?? ""}
                onChange={(e) => set("probation_end_date", e.target.value || null)}
              />
            </Field>
            <Field label="Contract start">
              <Input
                type="date"
                value={form.contract_start_date ?? ""}
                onChange={(e) => set("contract_start_date", e.target.value || null)}
              />
            </Field>
            <Field
              label="Contract end"
              hint="Tracked for expiry alongside documents."
            >
              <Input
                type="date"
                value={form.contract_end_date ?? ""}
                onChange={(e) => set("contract_end_date", e.target.value || null)}
              />
            </Field>
            <Field label="Left on" hint="The last day of employment, if it has ended.">
              <Input
                type="date"
                value={form.end_date ?? ""}
                onChange={(e) => set("end_date", e.target.value || null)}
              />
            </Field>
            <Field
              label="Weekly hours"
              hint="For the record. Nothing calculates pay from it yet."
            >
              <Input
                type="number"
                step="0.5"
                min="0"
                value={form.weekly_hours ?? ""}
                onChange={(e) =>
                  set("weekly_hours", e.target.value === "" ? null : Number(e.target.value))
                }
              />
            </Field>
            <Field
              label="Working day starts"
              hint="Leave blank to use the organisation's standard hours."
            >
              <Input
                type="time"
                value={form.work_start_time ?? ""}
                onChange={(e) => set("work_start_time", e.target.value || null)}
              />
            </Field>
            <Field label="Working day ends">
              <Input
                type="time"
                value={form.work_end_time ?? ""}
                onChange={(e) => set("work_end_time", e.target.value || null)}
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
            {busy ? "Saving…" : employee ? "Save changes" : "Add employee"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function blank(): EmployeeInput {
  return {
    employee_number: "",
    first_name: "",
    last_name: "",
    profile_id: null,
    phone: null,
    email: null,
    date_of_birth: null,
    national_id: null,
    address: null,
    emergency_contact_name: null,
    emergency_contact_phone: null,
    position: null,
    department_id: null,
    review_template_id: null,
    manager_id: null,
    territory_id: null,
    employment_status: "active",
    employment_type: "permanent",
    start_date: null,
    probation_end_date: null,
    contract_start_date: null,
    contract_end_date: null,
    end_date: null,
    work_start_time: null,
    work_end_time: null,
    weekly_hours: null,
    notes: null,
  };
}

function fromRow(e: EmployeeRow): EmployeeInput {
  return {
    employee_number: e.employee_number,
    first_name: e.first_name,
    last_name: e.last_name,
    profile_id: e.profile_id,
    phone: e.phone,
    email: e.email,
    date_of_birth: e.date_of_birth,
    national_id: e.national_id,
    address: e.address,
    emergency_contact_name: e.emergency_contact_name,
    emergency_contact_phone: e.emergency_contact_phone,
    position: e.position,
    department_id: e.department_id,
    review_template_id: e.review_template_id,
    manager_id: e.manager_id,
    territory_id: e.territory_id,
    employment_status: e.employment_status,
    employment_type: e.employment_type,
    start_date: e.start_date,
    probation_end_date: e.probation_end_date,
    contract_start_date: e.contract_start_date,
    contract_end_date: e.contract_end_date,
    end_date: e.end_date,
    // `time` comes back as HH:MM:SS and <input type="time"> wants HH:MM.
    // Handing it the seconds makes Chrome render an empty box, which reads as
    // "this person has no hours set" when they do.
    work_start_time: e.work_start_time?.slice(0, 5) ?? null,
    work_end_time: e.work_end_time?.slice(0, 5) ?? null,
    weekly_hours: e.weekly_hours,
    notes: e.notes,
  };
}
