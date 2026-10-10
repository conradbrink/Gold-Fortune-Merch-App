import { ProofSlides } from "@/components/proof-slides";
import { proof, site } from "@/lib/site";

// "Real results": what Gold Fortune, one of our clients, got from Tickd, on the main page just under the hero
// and on /founding. The numbers are real, from Tickd's own data (see `proof`
// in lib/site.ts for exactly what is compared). There is no "before Tickd"
// data, so the first two weeks of use are the "before", and the small print
// under the slides says so. The numbers themselves live in the slides.

export function ProofSection({ id, applyHref }: { id?: string; applyHref: string }) {
  return (
    <section id={id} aria-labelledby="proof-title" className="border-y border-line bg-white">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:px-6 sm:py-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-12">
        <div className="grid content-start gap-4">
          <p className="text-sm font-bold uppercase tracking-wide text-teal-700">Real results</p>
          <h2
            id="proof-title"
            className="font-display text-3xl font-bold leading-[1.1] tracking-tight text-balance text-teal-900 sm:text-4xl"
          >
            See what it did for one of our clients.
          </h2>
          <p className="max-w-xl text-lg leading-relaxed text-pretty text-ink">
            Gold Fortune is one of our clients. Their {proof.reps} reps cover {proof.stores} stores. They put the whole sales team on{" "}
            {site.name}, and these are the real numbers from the app.
          </p>
          <p className="max-w-xl text-lg leading-relaxed text-pretty text-ink">
            How? They planned routes the night before. Every visit gets a time, a GPS check-in and photos. No more guessing who went
            where.
          </p>
        </div>
        <ProofSlides applyHref={applyHref} />
      </div>
    </section>
  );
}
