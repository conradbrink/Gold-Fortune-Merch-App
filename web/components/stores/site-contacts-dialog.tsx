"use client";

import { useCallback, useEffect, useState } from "react";
import { Mail, Pencil, Phone, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { lower } from "@/lib/terms";
import { useCompanyConfig, useTerms } from "@/lib/use-company-config";
import { EMPTY_CONTACT, checkContact, type ContactDraft, type SiteContact } from "@/lib/site-contacts";
import { formatPhone } from "@/lib/phone-login";

const ONLY_MANAGERS = "Only a manager can change contacts.";

/**
 * The people at one {site} (Stage 8.2): who to call, and who gets the job
 * reports. Everyone in the company can see them; managers and settings
 * managers can change them (the database decides).
 */
export function SiteContactsDialog({
  site,
  onClose,
}: {
  site: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const t = useTerms();
  const config = useCompanyConfig();
  const orgId = config?.orgId ?? null;
  const [contacts, setContacts] = useState<SiteContact[] | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<ContactDraft>(EMPTY_CONTACT);
  const [errors, setErrors] = useState<Partial<Record<"name" | "email" | "phone" | "role", string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (siteId: string) => {
    const { data, error: e } = await createClient()
      .from("site_contacts")
      .select("id, store_id, name, email, phone, role, receives_reports")
      .eq("store_id", siteId)
      .order("name");
    if (e) return setError(`The contacts could not be loaded (${e.message}).`);
    setContacts((data ?? []) as SiteContact[]);
  }, []);

  useEffect(() => {
    if (!site) return;
    void (async () => {
      setContacts(null);
      setEditing(null);
      setError(null);
      await load(site.id);
    })();
  }, [site, load]);

  function startEdit(c: SiteContact | null) {
    setErrors({});
    setError(null);
    setEditing(c ? c.id : "new");
    setDraft(
      c
        ? { name: c.name, email: c.email ?? "", phone: c.phone ?? "", role: c.role ?? "", receivesReports: c.receives_reports }
        : EMPTY_CONTACT
    );
  }

  async function save() {
    if (!site || !orgId) return;
    const checked = checkContact(draft, config?.settings.country_code);
    if (!checked.ok) return setErrors(checked.errors);
    setBusy(true);
    setError(null);
    const supabase = createClient();
    // An update the database refuses changes no row and says nothing, so the
    // changed rows are asked back and none means it was not allowed.
    const { data: changed, error: e } =
      editing === "new"
        ? await supabase.from("site_contacts").insert({ ...checked.row, org_id: orgId, store_id: site.id }).select("id")
        : await supabase.from("site_contacts").update(checked.row).eq("id", editing!).select("id");
    setBusy(false);
    if (e) return setError(/row-level security/i.test(e.message) ? ONLY_MANAGERS : e.message);
    if (!changed?.length) return setError(ONLY_MANAGERS);
    setEditing(null);
    await load(site.id);
  }

  async function remove(c: SiteContact) {
    if (!site) return;
    setBusy(true);
    const { data: removed, error: e } = await createClient().from("site_contacts").delete().eq("id", c.id).select("id");
    setBusy(false);
    if (e) return setError(e.message);
    if (!removed?.length) return setError(ONLY_MANAGERS);
    await load(site.id);
  }

  const field = (key: keyof ContactDraft, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`contact-${key}`}>{label}</Label>
      <Input
        id={`contact-${key}`}
        value={String(draft[key])}
        aria-invalid={!!errors[key as "name"]}
        aria-describedby={errors[key as "name"] ? `contact-${key}-error` : undefined}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
        {...props}
      />
      {errors[key as "name"] && (
        <p id={`contact-${key}-error`} className="text-xs text-destructive">
          {errors[key as "name"]}
        </p>
      )}
    </div>
  );

  return (
    <Dialog open={!!site} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Contacts at {site?.name}</DialogTitle>
          <DialogDescription className="text-pretty">
            Who to call at this {lower(t.site.one)}, and who gets each finished {lower(t.job.one)}&apos;s report.
          </DialogDescription>
        </DialogHeader>

        {contacts === null ? (
          <div className="h-16 animate-pulse rounded-lg bg-muted/50" />
        ) : contacts.length === 0 && editing === null ? (
          <p className="text-sm text-pretty text-muted-foreground">
            No contacts yet. Add the person who should get the reports for this {lower(t.site.one)}.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {contacts.map((c) => (
              <li key={c.id} className="flex min-h-11 items-start gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block font-medium text-foreground">
                    {c.name}
                    {c.role && <span className="font-normal text-muted-foreground">, {c.role}</span>}
                  </span>
                  {c.email && (
                    <a href={`mailto:${c.email}`} className="flex items-center gap-1.5 truncate text-muted-foreground hover:underline">
                      <Mail className="size-3.5 shrink-0" aria-hidden />
                      {c.email}
                    </a>
                  )}
                  {c.phone && (
                    <a href={`tel:${c.phone}`} className="flex items-center gap-1.5 text-muted-foreground hover:underline">
                      <Phone className="size-3.5 shrink-0" aria-hidden />
                      {formatPhone(c.phone)}
                    </a>
                  )}
                  <span className="block text-xs text-muted-foreground">
                    {c.receives_reports && c.email ? "Gets the reports" : "No reports"}
                  </span>
                </span>
                <Button variant="ghost" size="icon-sm" aria-label={`Edit ${c.name}`} onClick={() => startEdit(c)}>
                  <Pencil className="size-4" aria-hidden />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Remove ${c.name}`} disabled={busy} onClick={() => remove(c)}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {editing !== null ? (
          <form
            className="space-y-3 rounded-lg bg-muted/40 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            {field("name", "Name", { autoComplete: "off" })}
            {field("role", "Role (optional)", { placeholder: "For example: facilities manager" })}
            {field("email", "Email", { type: "email", inputMode: "email" })}
            {field("phone", "Phone (optional)", { type: "tel", inputMode: "tel" })}
            <label className="flex items-center gap-2 text-sm text-foreground">
              <Checkbox
                checked={draft.receivesReports}
                onCheckedChange={(v) => setDraft({ ...draft, receivesReports: v === true })}
              />
              Send them each finished {lower(t.job.one)}&apos;s report
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save contact"}
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="outline" onClick={() => startEdit(null)} disabled={!orgId}>
            Add a contact
          </Button>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
