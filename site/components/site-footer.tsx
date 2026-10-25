import { Logo } from "@/components/logo";
import { site } from "@/lib/site";

// The footer of the main page and /founding: contact, "Sign in" for customers,
// and the legal pages.
export function SiteFooter() {
  return (
    <footer className="bg-teal-950 text-teal-100">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
        <Logo inverted />
        <div className="grid gap-2 text-sm md:justify-items-end">
          <p>
            {site.tagline} ·{" "}
            <a href={`mailto:${site.email}`} className="py-1 hover:text-sand">
              {site.email}
            </a>
          </p>
          <p>
            Already using {site.name}?{" "}
            <a href={`${site.appUrl}/login`} className="py-1 font-semibold underline underline-offset-4 hover:text-sand">
              Sign in
            </a>
          </p>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-1">
            <a href="/terms" className="py-1 hover:text-sand">Terms</a>
            <a href="/privacy" className="py-1 hover:text-sand">Privacy</a>
            <a href="/refunds" className="py-1 hover:text-sand">Cancellations and refunds</a>
          </nav>
          <p className="text-xs text-teal-100/70">
            © {new Date().getFullYear()} {site.legalName}
          </p>
        </div>
      </div>
    </footer>
  );
}
