import Link from "next/link";
import { LogoMark } from "@/components/logo";
import { site } from "@/lib/site";

// Copy: ~/Downloads/site-copy-final-v7.md, "Small places".
export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="grid justify-items-center gap-5 text-center">
        <LogoMark className="size-14" />
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-teal-900 sm:text-4xl">
          This page didn&apos;t get {site.name}.
        </h1>
        <Link
          href="/"
          className="rounded-full bg-amber-500 px-6 py-3.5 font-semibold text-teal-950 transition hover:bg-amber-400"
        >
          Back home
        </Link>
      </div>
    </main>
  );
}
