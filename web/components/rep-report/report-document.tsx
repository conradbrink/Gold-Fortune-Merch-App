import {
  classifyScore,
  clockTime,
  computeScore,
  durationShort,
  longDate,
  merchandisingCompliance,
  managementSummary,
  money,
  moneyShort,
  percent,
  percentOf100,
  shortDate,
  storesNeedingAttention,
  topStores,
  type MissedVisit,
  type RepReport,
} from "@/lib/rep-report";
import { DailySalesChart, PlannedVsCompletedChart } from "@/components/rep-report/charts";

/**
 * The report itself: two sheets of A4, and nothing that is not on them.
 *
 * A pure component over a `RepReport`. It performs no fetch, holds no state
 * and reads no clock — `generatedAt` is passed in — so the whole document can
 * be rendered against a fixture and looked at, which is how it was checked
 * (there is no signed-in session on this machine).
 *
 * Styling lives in `report-print.css` rather than in Tailwind classes here.
 * The layout has to be right in millimetres on A4 and the same rules have to
 * be adjusted for `@media print`; spreading that across utility strings in the
 * markup would put half of a page-break rule in one file and half in another.
 */

export type ReportMeta = {
  orgName: string;
  repName: string;
  territoryLabel: string;
  /** Inclusive first day. */
  from: Date;
  /** Inclusive last day — the picker's exclusive bound less one. */
  to: Date;
  managerName: string;
  generatedAt: Date;
};

/** Above 18 rows the missed list runs in two columns instead of one. */
const MISSED_TWO_COLUMN_FROM = 19;

export function RepPerformanceReport({
  report,
  meta,
}: {
  report: RepReport;
  meta: ReportMeta;
}) {
  const { summary, days, missed, stores } = report;
  const score = computeScore(summary, stores);
  const merch = merchandisingCompliance(summary);
  const top = topStores(stores);
  const attention = storesNeedingAttention(stores, missed);

  const completionRate =
    summary.plannedVisits > 0 ? summary.completedPlanned / summary.plannedVisits : null;
  const salesPerVisit =
    summary.completedVisits > 0 ? summary.salesNet / summary.completedVisits : null;
  /**
   * Missed on the day and never gone back to.
   *
   * The number that matters. A flat "79 missed" counts a store the rep
   * returned to on Thursday the same as one nobody has seen since — and on the
   * live data about half of every missed visit is the first kind.
   */
  const neverReturned = missed.filter((m) => m.visitedAt === null).length;
  const plannedStores = stores.filter((s) => s.planned > 0).length;
  const coveredStores = stores.filter((s) => s.planned > 0 && s.completed > 0).length;

  return (
    <article className="rr">
      {/* ------------------------------------------------------------------ */}
      {/* PAGE 1 — PERFORMANCE SUMMARY                                        */}
      {/* ------------------------------------------------------------------ */}
      <section className="rr-sheet">
        <Header meta={meta} />

        <section className="rr-block">
          <h2 className="rr-h2">Performance scorecard</h2>
          <div className="rr-kpis">
            <Kpi
              label="Sales generated"
              value={money(summary.salesNet)}
              note={
                summary.salesOrders > 0
                  ? `${summary.salesOrders} delivered order${summary.salesOrders === 1 ? "" : "s"}`
                  : "No sales recorded during this period"
              }
            />
            <Kpi
              label="Sales vs target"
              value="Target not set"
              muted
              note={`Actual ${money(summary.salesNet)} · no target is held in the database`}
            />
            <Kpi
              label="Visit completion"
              value={percent(completionRate)}
              note={
                summary.plannedVisits > 0
                  ? `${summary.completedPlanned} of ${summary.plannedVisits} planned visits`
                  : "No planned visits during this period"
              }
            />
            {/* "Store visits", not "Stores visited", and "Visits missed",
                not "Stores missed". Both figures count planned *visits* — one
                store contributes several over a month — so the store wording
                asked a question the number underneath did not answer, and the
                first card contradicted its own note. The values are the ones
                the report is specified to show; only the labels changed. */}
            <Kpi
              label="Store visits"
              value={`${summary.completedPlanned} / ${summary.plannedVisits}`}
              note={
                plannedStores > 0
                  ? `Completed / planned · ${coveredStores} of ${plannedStores} stores reached`
                  : "Completed / planned store visits"
              }
            />
            <Kpi
              label="Visits missed"
              value={String(summary.missedVisits)}
              emphasis={summary.missedVisits > 0 ? "warn" : undefined}
              note={
                summary.missedVisits > 0
                  ? `${neverReturned} never returned to · ${summary.missedVisits - neverReturned} caught up later`
                  : "Planned visits not completed"
              }
            />
            <Kpi
              label="Sales per visit"
              value={money(salesPerVisit)}
              note={
                summary.completedVisits > 0
                  ? `Over ${summary.completedVisits} completed visits`
                  : "No completed visits to divide by"
              }
            />
            <Kpi
              label="Zero-sales visits"
              value={String(summary.zeroSalesVisits)}
              note={
                summary.completedVisits > 0
                  ? `Of ${summary.completedVisits} completed visits; ${summary.visitsWithOrder} took an order`
                  : "No completed visits"
              }
            />
            <Kpi
              label="Overall rep score"
              value={score.score === null ? "Not scored" : `${score.score} / 100`}
              note={score.band}
              emphasis="score"
            />
          </div>
        </section>

        <section className="rr-block rr-score">
          <div className="rr-score-figure">
            <div className="rr-score-number">
              {score.score === null ? "—" : score.score}
              <span className="rr-score-outof">/ 100</span>
            </div>
            <div className="rr-score-band">{score.band}</div>
            <p className="rr-score-scale">
              90–100 Excellent · 80–89 Good · 70–79 Needs Improvement · below 70 Poor
            </p>
          </div>

          <div className="rr-score-breakdown">
            <h2 className="rr-h2">Score breakdown</h2>
            <table className="rr-table rr-table-tight">
              <thead>
                <tr>
                  <th>Component</th>
                  <th className="rr-num">Weight</th>
                  <th className="rr-num">Applied</th>
                  <th className="rr-num">Result</th>
                  <th>Measured from</th>
                </tr>
              </thead>
              <tbody>
                {score.components.map((c) => (
                  <tr key={c.key} className={c.value === null ? "rr-row-muted" : undefined}>
                    <td>{c.label}</td>
                    <td className="rr-num">{c.weight}%</td>
                    <td className="rr-num">
                      {c.value === null ? "excluded" : `${c.effectiveWeight.toFixed(1)}%`}
                    </td>
                    <td className="rr-num">{percentOf100(c.value)}</td>
                    <td className="rr-basis">{c.basis}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {score.reweighted && (
              <p className="rr-footnote">
                A component the database cannot measure is excluded and its weight shared
                across the rest in proportion, rather than counted as nil.
              </p>
            )}
          </div>
        </section>

        <section className="rr-block">
          <h2 className="rr-h2">
            Planned visits vs completed visits
            <span className="rr-h2-note">
              outline = planned · solid = completed · gold baseline = nothing completed
            </span>
          </h2>
          <PlannedVsCompletedChart days={days} />
        </section>

        <section className="rr-block">
          <h2 className="rr-h2">
            Sales generated per day
            <span className="rr-h2-note">delivered orders, excluding VAT, in Pula</span>
          </h2>
          <DailySalesChart days={days} />
        </section>

        <section className="rr-block">
          {/* "Average" is said once, in the heading, rather than four times in
              labels narrow enough that the word wraps each cell onto a second
              line and pushes the strip past the foot of the page. */}
          <h2 className="rr-h2">
            Attendance &amp; working activity
            <span className="rr-h2-note">
              daily averages across {summary.daysWorked} day
              {summary.daysWorked === 1 ? "" : "s"} of field activity
            </span>
          </h2>
          <div className="rr-strip">
            <Cell label="Workday start" value={clockTime(summary.avgWorkdayStartSeconds)} />
            <Cell label="First check-in" value={clockTime(summary.avgFirstCheckinSeconds)} />
            <Cell label="Last check-out" value={clockTime(summary.avgLastCheckoutSeconds)} />
            <Cell label="Visit duration" value={durationShort(summary.avgVisitSeconds)} />
            <Cell
              label="GPS compliance"
              value={percent(summary.gpsVerifiedRate)}
              note={
                summary.gpsChecked > 0
                  ? `${summary.gpsChecked} check-ins with a fix`
                  : "No location fix recorded"
              }
            />
            <Cell
              label="Days worked"
              value={String(summary.daysWorked)}
              note="Days with field activity"
            />
          </div>
        </section>

        <Footer meta={meta} section="1 · Performance summary" />
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* PAGE 2 — STORE EXECUTION                                            */}
      {/* ------------------------------------------------------------------ */}
      <section className="rr-sheet">
        <div className="rr-runhead">
          <span>{meta.orgName} · Rep Performance Report</span>
          <span>
            {meta.repName} · {longDate(meta.from)} – {longDate(meta.to)}
          </span>
        </div>

        <MissedStores missed={missed} />

        <div className="rr-two">
          <section className="rr-block">
            <h2 className="rr-h2">Store performance summary</h2>
            <table className="rr-table rr-table-kv">
              <tbody>
                <Row label="Stores assigned" value={String(summary.storesAssigned)} />
                <Row label="Planned visits" value={String(summary.plannedVisits)} />
                <Row label="Completed visits (planned)" value={String(summary.completedPlanned)} />
                <Row label="Missed visits" value={String(summary.missedVisits)} />
                <Row
                  label="Unplanned visits completed"
                  value={String(summary.unplannedVisits)}
                />
                <Row label="Stores generating sales" value={String(summary.storesWithSales)} />
                <Row label="Zero-sales visits" value={String(summary.zeroSalesVisits)} />
                <Row
                  label="New stores visited (prospects)"
                  value={String(summary.prospectsVisited)}
                />
                <Row label="New stores converted" value={String(summary.prospectsConverted)} />
              </tbody>
            </table>
          </section>

          <section className="rr-block">
            <h2 className="rr-h2">Merchandising execution</h2>
            <div className="rr-headline">
              <span className="rr-headline-value">{percentOf100(merch)}</span>
              <span className="rr-headline-label">
                Overall merchandising compliance
                {summary.audits > 0 ? ` · ${summary.audits} audits` : ""}
              </span>
            </div>
            <table className="rr-table rr-table-kv">
              <tbody>
                <Row label="Product availability" value={percentOf100(summary.availabilityPct)} />
                <Row label="Planogram compliance" value={percentOf100(summary.planogramPct)} />
                <Row label="Pricing compliance" value={percentOf100(summary.pricePct)} />
                <Row
                  label="Photo / data completion"
                  value={percent(summary.photoVisitRate)}
                />
                <Row label="Correct facings" value="Not tracked" muted />
              </tbody>
            </table>
            {/* Why two of the brief's four supporting metrics are absent,
                said on the page rather than left to be discovered. The stock
                sentence is conditional: another organisation's form may well
                ask the damaged-or-expired question, and the footnote must not
                claim otherwise on their report. */}
            <p className="rr-footnote">
              The audit counts facings
              {summary.avgFacings !== null ? ` (average ${summary.avgFacings})` : ""} but
              records no correct-facings target, so compliance against one cannot be
              calculated.
              {summary.conditionPct === null
                ? " Stock condition was not asked on any form answered in this period."
                : ` Stock condition: ${percentOf100(summary.conditionPct)} of checks found no damaged or expired stock.`}
            </p>
          </section>
        </div>

        <div className="rr-two">
          <section className="rr-block">
            <h2 className="rr-h2">Top stores by sales</h2>
            {top.length === 0 ? (
              <p className="rr-empty">No sales recorded during this period.</p>
            ) : (
              <ol className="rr-ranked">
                {top.map((s) => (
                  <li key={s.storeId}>
                    <span className="rr-ranked-name">{s.storeName}</span>
                    <span className="rr-ranked-value">{money(s.salesNet)}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="rr-block">
            <h2 className="rr-h2">Stores requiring attention</h2>
            {attention.length === 0 ? (
              <p className="rr-empty">
                No store met an attention rule during this period.
              </p>
            ) : (
              <ul className="rr-attention">
                {attention.map((a) => (
                  <li key={a.storeId}>
                    <span className="rr-attention-name">{a.storeName}</span>
                    <span className="rr-attention-reason">{a.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="rr-block rr-summary">
          <h2 className="rr-h2">Management summary</h2>
          <div className="rr-verdict">
            <span className="rr-verdict-score">
              {score.score === null ? "Not scored" : `${score.score} / 100`}
            </span>
            <span className="rr-verdict-band">{classifyScore(score.score)}</span>
          </div>
          <p className="rr-prose">{managementSummary(summary, score, missed)}</p>
        </section>

        <section className="rr-block rr-comments">
          <h2 className="rr-h2">Manager comments</h2>
          <div className="rr-lines" />
          <div className="rr-sign">
            <div>
              <span className="rr-sign-label">Manager</span>
              <span className="rr-sign-rule" />
            </div>
            <div>
              <span className="rr-sign-label">Date</span>
              <span className="rr-sign-rule" />
            </div>
          </div>
        </section>

        <Footer meta={meta} section="2 · Store execution" />
      </section>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function Header({ meta }: { meta: ReportMeta }) {
  return (
    <header className="rr-head">
      <div className="rr-head-top">
        <div>
          <div className="rr-wordmark">{meta.orgName}</div>
          <h1 className="rr-title">Rep Performance Report</h1>
        </div>
        <div className="rr-head-generated">
          <span>Generated</span>
          <strong>{longDate(meta.generatedAt)}</strong>
        </div>
      </div>
      <dl className="rr-meta">
        <div>
          <dt>Representative</dt>
          <dd>{meta.repName}</dd>
        </div>
        <div>
          <dt>Territory</dt>
          <dd>{meta.territoryLabel}</dd>
        </div>
        <div>
          <dt>Reporting period</dt>
          <dd>
            {longDate(meta.from)} – {longDate(meta.to)}
          </dd>
        </div>
        <div>
          <dt>Manager</dt>
          <dd>{meta.managerName}</dd>
        </div>
      </dl>
    </header>
  );
}

/**
 * The section name, not a page count.
 *
 * It read "Page 1 of 2", which is a promise the report cannot always keep: a
 * rep who missed seventy-nine planned visits has a missed-store list longer
 * than the sheet, and truncating it is the one thing that section must never
 * do. Naming the section is true however many sheets it takes.
 */
function Footer({ meta, section }: { meta: ReportMeta; section: string }) {
  return (
    <footer className="rr-foot">
      <span>
        {meta.orgName} · {meta.repName} · {longDate(meta.from)} – {longDate(meta.to)}
      </span>
      <span>{section}</span>
    </footer>
  );
}

function Kpi({
  label,
  value,
  note,
  muted,
  emphasis,
}: {
  label: string;
  value: string;
  note?: string;
  muted?: boolean;
  emphasis?: "warn" | "score";
}) {
  const classes = ["rr-kpi"];
  if (emphasis) classes.push(`rr-kpi-${emphasis}`);
  return (
    <div className={classes.join(" ")}>
      <div className="rr-kpi-label">{label}</div>
      <div className={muted ? "rr-kpi-value rr-kpi-value-muted" : "rr-kpi-value"}>{value}</div>
      {note && <div className="rr-kpi-note">{note}</div>}
    </div>
  );
}

function Cell({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rr-cell">
      <div className="rr-cell-label">{label}</div>
      <div className="rr-cell-value">{value}</div>
      {note && <div className="rr-cell-note">{note}</div>}
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <tr className={muted ? "rr-row-muted" : undefined}>
      <th scope="row">{label}</th>
      <td className="rr-num">{value}</td>
    </tr>
  );
}

/**
 * Every missed visit, and never a subset of them.
 *
 * The brief is explicit that this list is not truncated, and on the live data
 * one rep missed 79 planned visits in six weeks — a single-column table of
 * that would be a page and a half on its own and push the rest of page two
 * onto a third sheet. Above `MISSED_TWO_COLUMN_FROM` rows the list therefore
 * runs in two columns of the same compact table, which roughly doubles what
 * fits before the page turns; the sort is preserved down the first column and
 * then down the second, so "read the top of the left column first" is still
 * the right instruction.
 *
 * When the list is long enough to run past the sheet it is allowed to: the
 * alternative is hiding planned work that was not done, which is the one thing
 * this section exists to prevent.
 */
function MissedStores({ missed }: { missed: MissedVisit[] }) {
  if (missed.length === 0) {
    return (
      <section className="rr-block">
        <h2 className="rr-h2">Stores missed</h2>
        <p className="rr-good">No planned store visits were missed during this period.</p>
      </section>
    );
  }

  const neverReturned = missed.filter((m) => m.visitedAt === null).length;
  const twoColumn = missed.length >= MISSED_TWO_COLUMN_FROM;
  const half = Math.ceil(missed.length / 2);
  const columns = twoColumn ? [missed.slice(0, half), missed.slice(half)] : [missed];

  return (
    <section className="rr-block">
      <h2 className="rr-h2">
        Stores missed
        <span className="rr-h2-note">
          {missed.length} planned visit{missed.length === 1 ? "" : "s"} not completed on the
          day · <strong>{neverReturned} never returned to</strong>, listed first ·
          every one is shown
        </span>
      </h2>
      <div className={twoColumn ? "rr-missed rr-missed-split" : "rr-missed"}>
        {columns.map((rows, i) => (
          <table key={i} className="rr-table rr-table-dense">
            <thead>
              <tr>
                <th>Store</th>
                <th>Planned</th>
                <th>Went back</th>
                <th>Reason</th>
                <th className="rr-num">Prev. sales</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.routeId}>
                  {/* The store name alone, and no town: this table is the one
                      place where a second line per row costs a page. */}
                  <td className="rr-store">{m.storeName}</td>
                  <td>{shortDate(m.plannedDate)}</td>
                  {/* The column that changes what this table means. "Never"
                      is the finding; a date is a store that was served late.
                      It replaces "Last visit" — the last visit *before* the
                      planned day answers a question nobody was asking once
                      this one is on the page. */}
                  <td className={m.visitedAt ? undefined : "rr-never"}>
                    {m.visitedAt ? shortDate(m.visitedAt) : "Never"}
                  </td>
                  <td className={m.reason ? undefined : "rr-row-muted"}>
                    {m.reason ?? "Reason not recorded"}
                  </td>
                  <td className="rr-num">
                    {m.previousSales === null ? "—" : moneyShort(m.previousSales)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
    </section>
  );
}
