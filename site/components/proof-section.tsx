import { proof, site } from "@/lib/site";

// "Real results": the Gold Fortune test, on the main page just under the hero
// and on /founding under "What Tickd does for you". The words are the owner's
// (~/Downloads/founding-10-proof-and-video.md, section 1). Figures in
// [brackets] are placeholders until the owner sends the real ones; they show
// on the page as they are.

function Pair({
  label,
  before,
  after,
  beforeN,
  afterN,
}: {
  label: string;
  before: string;
  after: string;
  beforeN: number;
  afterN: number;
}) {
  const top = Math.max(beforeN, afterN);
  const bar = (n: number) => `${Math.round((n / top) * 100)}%`;
  return (
    <div className="grid gap-3">
      <p className="font-display text-lg font-bold text-teal-900">{label}</p>
      <div className="grid h-40 grid-cols-2 items-end gap-4 border-b border-line">
        {[
          ["Before", before, beforeN, "bg-teal-900/25"],
          ["After 2 months", after, afterN, "bg-amber-500"],
        ].map(([when, text, n, colour]) => (
          <div key={when as string} className="flex h-full flex-col justify-end gap-1.5">
            <span className="font-display text-xl font-extrabold text-teal-900">{text}</span>
            <span className={`w-full rounded-t-lg ${colour}`} style={{ height: bar(n as number) }} />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4 text-sm font-medium text-muted">
        <span>Before</span>
        <span>After 2 months</span>
      </div>
    </div>
  );
}

export function ProofSection({ id }: { id?: string }) {
  return (
    <section id={id} aria-labelledby="proof-title" className="border-y border-line bg-white">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 sm:py-16 lg:grid-cols-[1fr_0.9fr] lg:items-center lg:gap-14">
        <div className="grid content-start gap-5">
          <p className="text-sm font-bold uppercase tracking-wide text-teal-700">Real results</p>
          <h2
            id="proof-title"
            className="font-display text-3xl font-bold leading-[1.1] tracking-tight text-balance text-teal-900 sm:text-[2.75rem]"
          >
            We tested it on our own team first.
          </h2>
          <p className="max-w-2xl text-lg leading-relaxed text-pretty text-ink">
            Gold Fortune is our distribution company in Botswana. Our reps visit {proof.stores} stores.{" "}
            <span className="font-semibold text-amber-700">[CONFIRM: say &ldquo;our&rdquo; only if it is your company.]</span>
          </p>
          <p className="max-w-2xl text-lg leading-relaxed text-pretty text-ink">
            We put the whole sales team on {site.name} for two months.
          </p>
          <ul className="grid gap-2 text-lg leading-snug text-ink">
            <li>
              <strong>Store visits a week:</strong> {proof.visits.before} → {proof.visits.after}. <strong>Nearly 2x.</strong>
            </li>
            <li>
              <strong>Monthly sales:</strong> up <strong>1.5x.</strong>
            </li>
          </ul>
          <p className="max-w-2xl text-lg leading-relaxed text-pretty text-ink">
            How? We planned routes the night before. Every visit had a time, a photo and an order. No more guessing who went where.
          </p>
        </div>
        <figure className="grid gap-4 rounded-2xl bg-mint p-5 ring-1 ring-line sm:p-6">
          <div className="grid gap-6 sm:grid-cols-2">
            <Pair label="Store visits a week" {...proof.visits} />
            <Pair label="Monthly sales" {...proof.sales} />
          </div>
          <figcaption className="text-sm leading-relaxed text-muted">
            Gold Fortune, {proof.months} 2026, same team of {proof.reps} reps. Your results depend on your team and how you use it.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
