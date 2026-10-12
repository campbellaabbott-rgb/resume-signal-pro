import { useTranslation } from "react-i18next";
import { Database } from "lucide-react";
import { SERVING_SOURCES, type BoardSource } from "@/config/ats-vendors";
import { useBoardVendorCounts } from "@/hooks/useBoardVendorCounts";

/**
 * The ATS platforms we integrate with, on the front page.
 *
 * NAMES RATHER THAN A PERCENTAGE, still. src/config/ats-vendors.ts explains why
 * a share-of-board figure was refused and that has not changed: sampling the
 * board at different offsets answered 79%, 100% and 0.6% to the same question.
 *
 * What DID change is that each platform now carries its own live open count,
 * which is a different kind of number entirely — measured, not derived, and
 * checkable against the board itself. A name is a claim; a name with a count
 * beside it is evidence. That is the point of putting this on a credibility
 * surface rather than a feature list.
 *
 * The counts come from a 15-minute cached facet computed under the board's FULL
 * serving rule, so a vendor's figure is the number of postings /jobs will
 * actually serve for it. They cannot be computed live — every vendor times out
 * on the request path, which is why this reads a cache and says when it was
 * true.
 *
 * NO NUMBER IS BETTER THAN A WRONG ONE. Until the counts are in hand the
 * platform names render alone, exactly as before. A vendor missing from the
 * facet shows no figure rather than a zero: absence means "not measured or none
 * today", and rendering that as `0` would be asserting something we did not
 * measure. Same rule the whole codebase runs on, and the reason this component
 * degrades in only one direction.
 *
 * NO APPLY SPLIT ANY MORE. This panel used to divide the platforms into "we
 * apply for you" and "filled in, you press send" whenever the apply worker was
 * live. The apply pivot (owner decision 2026-10-11) switched the server-side
 * apply agent off and retired everything it was sold in, so the panel says
 * only what is true of every platform: the postings are read straight from
 * it, and the person applies on the employer's own site. It no longer reads
 * the sender's status at all, so a worker that came back on could not bring
 * the sending claim back with it.
 */

/** Vendor pill: the platform name, and its live count when we have one. */
function VendorPill({ v, count }: { v: BoardSource; count?: number }) {
  return (
    <li className="rounded-lg border bg-background px-3 py-2 flex items-baseline gap-2 min-w-0">
      {/* THE COUNT NEVER CLIPS; THE NAME MAY. A pill is a name plus a measured
          number inside a fixed grid cell, and "SmartRecruiters 75,100" is wider
          than a third of a card: measured on the live page, four pills had
          their number cut off by the card edge — Greenhouse rendered as
          "52,31". A truncated NAME is still a name, a truncated NUMBER is a
          different number, and this panel's whole claim is that the figures
          are checkable. So the label shrinks and ellipses, the number is
          shrink-0, and the full name stays available as a title. */}
      <span className="text-sm font-medium truncate min-w-0" title={v.label}>{v.label}</span>
      {count !== undefined && (
        <span className="text-xs text-muted-foreground tabular-nums flex-shrink-0 ml-auto">
          {count.toLocaleString()}
        </span>
      )}
    </li>
  );
}

export function AtsCoverage({
  className = "",
  variant = "full",
}: {
  className?: string;
  /**
   * `strip` is the top-of-page version: all fifteen platforms in one flowing
   * row, immediately, before anything asks the visitor for a file. It carries
   * the same counts and the same as-of line — it is a narrower LAYOUT, not a
   * weaker claim.
   */
  variant?: "full" | "strip";
}) {
  const { t } = useTranslation();
  const { counts, openTotal, asOf, ready } = useBoardVendorCounts();

  // Biggest first once we can measure — the ordering itself is informative, and
  // a reader scanning for a platform they recognise finds the large ones first.
  // Falls back to the config's deliberate order while counts are unknown.
  const order = <T extends BoardSource>(list: readonly T[]): readonly T[] =>
    ready
      ? [...list].sort((a, b) => (counts[b.key] ?? -1) - (counts[a.key] ?? -1))
      : list;
  // THE STRIP NAMES EVERY SOURCE THE BOARD SERVES, NOT ONLY THE MEASURED ONES.
  // It rendered ATS_VENDORS (fifteen) under "every job here comes straight from
  // these systems" while the board served nineteen: Paylocity, UKG, ADP and
  // JazzHR — about 100,000 postings, one in eight — came from systems the panel
  // did not show, and "read directly from all 15" undercounted what we read
  // from. The config's own rule (UNMEASURED_ATS_SOURCES docblock) says a
  // "where these jobs come from" that omits a source is false by omission;
  // this list is that rule applied. Dormant sources (serving: false, USAJOBS
  // while its secrets are unset) are not here, because their absence is the
  // point.
  const stripSources = order(SERVING_SOURCES);

  // Counts are of a live, churning table. Saying when they were true is the
  // difference between a measurement and a decoration.
  const asOfLine = ready && asOf
    ? t("atsCoverage.asOf", "Live counts of currently open roles, measured {{time}}.", {
        time: asOf.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }),
      })
    : null;

  if (variant === "strip") {
    return (
      <section className={className} aria-labelledby="ats-strip-heading">
        {/* Same ruled-label pattern the page already uses to separate the board
            from the toolkit — this belongs to the hero, so it borrows the
            hero's vocabulary instead of introducing a second one. */}
        <div className="flex items-center gap-3 mb-4">
          <div className="h-px flex-1 bg-border/60" />
          <h2
            id="ats-strip-heading"
            className="text-[11px] sm:text-xs font-medium uppercase tracking-wider text-muted-foreground text-center"
          >
            {t("atsCoverage.stripHeading", "Every job here comes straight from these systems")}
          </h2>
          <div className="h-px flex-1 bg-border/60" />
        </div>

        {/* Pills echo the field chips below: same radius, border and card wash,
            so the row reads as one family rather than a pasted-in widget. The
            NUMBER carries the weight — muted name, solid foreground count —
            which is the same treatment as the hero's own live totals. */}
        {/* SIZED DOWN ON SMALL SCREENS, NOT TRIMMED. At the desktop size this
            row is eight lines and 557px tall on a 375px phone — an entire
            screen of hero given to one list. The fix is smaller pills, never a
            shorter list: "all {{count}}" is the claim, and quietly showing ten on
            mobile would make the sentence underneath it false. */}
        <ul className="flex flex-wrap justify-center gap-1 sm:gap-2">
          {stripSources.map((v) => {
            const n = counts[v.key];
            return (
              <li
                key={v.key}
                className="inline-flex items-center gap-1 sm:gap-1.5 px-2 py-1 sm:px-3 sm:py-1.5 rounded-full border border-border bg-card/60 hover:border-primary/40 transition-colors"
              >
                <span className="text-xs sm:text-sm text-muted-foreground whitespace-nowrap">{v.label}</span>
                {n !== undefined && (
                  <span className="text-xs sm:text-sm font-bold text-foreground tabular-nums">
                    {n.toLocaleString()}
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        <div className="mt-4 text-center">
          {/* NO TOTAL HERE, DELIBERATELY — the hero states one four lines above.
              Measured after the migration applied: the hero's headline read
              595,687 live openings while this facet's openTotal read 596,759.
              Both are honest; they are computed by different paths at different
              refresh moments and drift by a thousand or so. But two numbers for
              the same quantity, on the same screen, a thousand apart, is a
              reader's reason to distrust both — and a visitor cannot know they
              are separate measurements.

              The hero owns the total. This row owns the breakdown. The claim
              that mattered in this sentence was never the figure anyway. The
              FULL variant keeps its total: it renders far down the page with no
              competing number beside it. */}
          <p className="text-xs sm:text-sm text-muted-foreground">
            {t("atsCoverage.stripSub", "Read directly from all {{count}} — never scraped from a search engine.", {
              count: stripSources.length,
            })}
          </p>

          {asOfLine && <p className="mt-1.5 text-[11px] text-muted-foreground/70">{asOfLine}</p>}
        </div>
      </section>
    );
  }

  // ONE group: every platform the board serves, and what is true of all of
  // them. The count of pills equals the count the sentence above quotes.
  const groups = [
    {
      key: "all",
      Icon: Database,
      title: t("atsCoverage.readTitle", "Read straight from the employer's own system"),
      blurb: t("atsCoverage.readBlurb", "Every posting on the board comes from one of these systems, and you apply on the employer's own site. We never submit an application for you."),
      vendors: order(SERVING_SOURCES),
    },
  ];

  return (
    <section className={className} aria-labelledby="ats-coverage-heading">
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 rounded-full border bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground mb-4">
          <Database className="w-3.5 h-3.5 text-primary" />
          {t("atsCoverage.eyebrow", "Where our jobs come from")}
        </div>

        <h2 id="ats-coverage-heading" className="text-2xl md:text-3xl font-bold mb-2">
          {t("atsCoverage.heading", "Built for the systems employers actually use")}
        </h2>

        {/* The sentence only quotes a total once one has been measured. */}
        <p className="text-muted-foreground max-w-2xl mx-auto">
          {ready && openTotal !== null
            ? t("atsCoverage.subCounted", "{{total}} open roles, read straight from the {{count}} applicant tracking systems below — not scraped from a search engine.", {
                total: openTotal.toLocaleString(),
                count: SERVING_SOURCES.length,
              })
            : t("atsCoverage.sub", "We read jobs straight from {{count}} applicant tracking systems — not scraped from a search engine.", {
                count: SERVING_SOURCES.length,
              })}
        </p>
      </div>

      <div>
        {groups.map(({ key, Icon, title, blurb, vendors }) => (
          <div key={key} className="rounded-xl border bg-card p-5">
            <div className="flex items-center gap-2 mb-1">
              <Icon className="w-4 h-4 text-primary flex-shrink-0" />
              <h3 className="font-semibold">{title}</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">{blurb}</p>
            <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {vendors.map((v) => (
                <VendorPill key={v.key} v={v} count={counts[v.key]} />
              ))}
            </ul>
          </div>
        ))}
      </div>

      {asOfLine && <p className="text-center text-xs text-muted-foreground mt-4">{asOfLine}</p>}
    </section>
  );
}
