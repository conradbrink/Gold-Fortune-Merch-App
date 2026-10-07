import { ProductBrand } from "@/components/product-brand";

/**
 * The panel behind every whole-page failure: the error boundary, the global
 * boundary and 404.
 *
 * Deliberately styled with plain Tailwind and no `@/components/ui` imports.
 * `global-error.tsx` renders when the root layout itself has failed, and
 * anything this panel pulls in is code that has to survive that failure —
 * a button component that throws would replace the error page with a blank
 * screen, which is the one outcome an error page exists to prevent.
 */
export function ServiceMessage({
  title,
  detail,
  digest,
  children,
}: {
  title: string;
  detail: string;
  digest?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary/40 px-4">
      <div className="w-full max-w-md space-y-6 text-center">
        {/* The product, not the company: an error page cannot count on knowing
            who is signed in, and the global boundary renders with nothing
            loaded at all. */}
        <ProductBrand priority />

        <div className="space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground">{detail}</p>
          {children}
          {/*
            The digest is Next's own id for the server-side error. The message
            itself is withheld in production on purpose — it can name tables and
            columns — but without some handle, somebody reporting a fault has
            nothing to quote and the log cannot be found.
          */}
          {digest ? (
            <p className="font-mono text-xs text-muted-foreground">
              Reference: {digest}
            </p>
          ) : null}
        </div>

        <p className="text-xs text-muted-foreground">
          If this keeps happening, contact your manager.
        </p>
      </div>
    </div>
  );
}
