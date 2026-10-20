import { ProofSlides } from "@/components/proof-slides";
import { proof } from "@/lib/site";

// "Real results": what Gold Fortune, a distributor with 3 reps, got from Tickd, on the main page under "What do you need to start?"
// and on /founding. The numbers are real, from Tickd's own data (see `proof`
// in lib/site.ts for exactly what is compared). There is no "before Tickd"
// data, so the first two weeks of use are the "before". The owner asked for
// the heading and the slides only (10 Oct 2026): no intro, no small print.
// Gold Fortune is the owner's own family business, so the heading says what it
// is (a distributor), never "one of our clients" (19 Oct 2026).

export function ProofSection({ id, applyHref }: { id?: string; applyHref: string }) {
  return (
    <section id={id} aria-labelledby="proof-title" className="border-y border-line bg-white">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:px-6 sm:py-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-12">
        <div className="grid content-start gap-4">
          <p className="text-center text-sm font-bold uppercase tracking-wide text-teal-700">Real results</p>
          <h2
            id="proof-title"
            className="text-center font-display text-3xl font-bold leading-[1.1] tracking-tight text-balance text-teal-900 sm:text-4xl"
          >
            See what it did for a distributor with {proof.reps} reps.
          </h2>
        </div>
        <ProofSlides applyHref={applyHref} />
      </div>
    </section>
  );
}
