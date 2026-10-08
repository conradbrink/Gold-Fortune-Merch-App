import Link from "next/link";
import { Logo } from "@/components/logo";
import { legal, site } from "@/lib/site";

// The frame of the Terms, Privacy and Refunds pages: the logo home, a title,
// the date, and the business's details at the foot (the Electronic
// Communications and Transactions Act asks a website that sells to show them).
export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  const details = [
    site.legalName,
    legal.registrationNumber && `Registration number ${legal.registrationNumber}`,
    legal.address,
    legal.phone && `Phone ${legal.phone}`,
    site.email,
  ].filter(Boolean);

  return (
    <>
      <header className="border-b border-line/70 bg-sand">
        <div className="mx-auto flex h-14 max-w-3xl items-center px-4 sm:h-16 sm:px-6">
          <Link href="/" aria-label={`${site.name} home`}>
            <Logo />
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <h1 className="font-display text-3xl font-bold tracking-tight text-teal-900 sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-muted">Last updated {legal.lastUpdated}</p>
        <div className="legal mt-8 grid gap-4 leading-relaxed text-ink [&_h2]:mt-6 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-teal-900 [&_li]:ml-5 [&_li]:list-disc [&_ul]:grid [&_ul]:gap-1.5 [&_a]:font-semibold [&_a]:text-teal-900 [&_a]:underline">
          {children}
        </div>
        <footer className="mt-12 border-t border-line pt-6 text-sm text-muted">
          <p>{details.join(" · ")}</p>
          <nav aria-label="Legal" className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
            <Link href="/terms" className="hover:text-teal-900">Terms</Link>
            <Link href="/privacy" className="hover:text-teal-900">Privacy</Link>
            <Link href="/refunds" className="hover:text-teal-900">Cancellations and refunds</Link>
          </nav>
        </footer>
      </main>
    </>
  );
}
