import { setCompanyClosed } from "@/app/platform/actions";

/**
 * Close a company, or reopen a closed one: the foot of its Control Centre
 * page. Closing is reversible and nothing is deleted. `setCompanyClosed`
 * checks the operator again, refuses their own company, and the database does
 * the rest with its audit row (platform_set_company_closed).
 */
export function ClosePanel({ orgId, name, closed }: { orgId: string; name: string; closed: boolean }) {
  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      {closed ? (
        <>
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-foreground">Reopen this company</h2>
            <p className="text-sm text-muted-foreground">
              Its people can sign in again straight away, with everything as it was. Its scheduled emails and
              reports start again, and its billing status goes back to what it was before it was closed.
            </p>
          </div>
          <form action={setCompanyClosed}>
            <input type="hidden" name="orgId" value={orgId} />
            <input type="hidden" name="close" value="false" />
            <button
              type="submit"
              className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm text-primary-foreground hover:bg-primary/90"
            >
              Reopen company
            </button>
          </form>
        </>
      ) : (
        <>
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-foreground">Close this company</h2>
            <p className="text-sm text-muted-foreground">
              Its people lose access to the dashboard and the app straight away. Nothing more is sent for it,
              including emails waiting to go out. It is left out of the Control Centre&apos;s
              numbers. Nothing is deleted: you can reopen it here at any time.
            </p>
          </div>
          <form action={setCompanyClosed} className="space-y-3">
            <input type="hidden" name="orgId" value={orgId} />
            <input type="hidden" name="close" value="true" />
            <div className="space-y-1">
              <label htmlFor="close-reason" className="block text-sm text-muted-foreground">
                Reason (optional, only you see it)
              </label>
              <input
                id="close-reason"
                name="reason"
                maxLength={500}
                className="h-8 w-full max-w-md rounded-md border border-border bg-transparent px-2 text-sm"
              />
            </div>
            <label className="flex items-start gap-2 text-sm text-foreground">
              <input type="checkbox" name="confirm" required className="mt-0.5" />
              <span>I understand that {name}&apos;s people will lose access until it is reopened.</span>
            </label>
            <button
              type="submit"
              className="inline-flex h-8 items-center rounded-md bg-destructive px-3 text-sm text-white hover:bg-destructive/90"
            >
              Close company
            </button>
          </form>
        </>
      )}
    </section>
  );
}
