import { useTranslation } from "react-i18next";
import { Bot, MousePointerClick, Database } from "lucide-react";
import { ATS_VENDORS, AUTO_VENDORS, CLICK_VENDORS, type AtsVendor } from "@/config/ats-vendors";
import { useAgentSender } from "@/hooks/useAgentSender";
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
 * The auto-apply split only appears when a worker is live. Otherwise every
 * platform is shown as prepared-for-one-click, which is what is true then.
 */

/** Vendor pill: the platform name, and its live count when we have one. */
function VendorPill({ v, count, auto = false }: { v: AtsVendor; count?: number; auto?: boolean }) {
  return (
    <li className="rounded-lg border bg-background px-3 py-2 flex items-baseline gap-2">
      {auto && <Bot className="w-3.5 h-3.5 text-primary self-center flex-shrink-0" aria-hidden />}
      <span className="text-sm font-medium">{v.label}</span>
      {count !== undefined && (
        <span className="text-xs text-muted-foreground tabular-nums">
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
   * weaker claim. The auto/click split survives as an icon plus a legend
   * rather than two cards, because two cards at the top of the page push the
   * scanner below the fold and that split is the one thing here we must not
   * quietly drop.
   */
  variant?: "full" | "strip";
}) {
  const { t } = useTranslation();
  const { online } = useAgentSender();
  const { counts, openTotal, asOf, ready } = useBoardVendorCounts();

  // Biggest first once we can measure — the ordering itself is informative, and
  // a reader scanning for a platform they recognise finds the large ones first.
  // Falls back to the config's deliberate order while counts are unknown.
  const order = (list: readonly AtsVendor[]) =>
    ready
      ? [...list].sort((a, b) => (counts[b.key] ?? -1) - (counts[a.key] ?? -1))
      : list;

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
            shorter list: "all fifteen" is the claim, and quietly showing ten on
            mobile would make the sentence underneath it false. */}
        <ul className="flex flex-wrap justify-center gap-1 sm:gap-2">
          {order(ATS_VENDORS).map((v) => {
            const n = counts[v.key];
            return (
              <li
                key={v.key}
                className="inline-flex items-center gap-1 sm:gap-1.5 px-2 py-1 sm:px-3 sm:py-1.5 rounded-full border border-border bg-card/60 hover:border-primary/40 transition-colors"
              >
                {online && v.tier === "auto" && (
                  <Bot className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-success shrink-0" aria-hidden />
                )}
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
              count: ATS_VENDORS.length,
            })}
          </p>

          {/* The split is a product claim, not decoration — it survives the
              compact layout as a legend rather than being dropped with the
              second card.

              FLEX ON THE ROW, TEXT IN ITS OWN SPAN. Written first as an
              inline-flex `p` with the sentence as a bare flex CHILD, which made
              the icon a flex item in its own right: it broke onto a line of its
              own, centred above the text, and read as a stray glyph. The icon
              needs to sit beside the paragraph, not inside its wrap. */}
          {online && (
            <p className="mt-1.5 flex items-start justify-center gap-1.5 max-w-xl mx-auto text-xs text-muted-foreground">
              <Bot className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" aria-hidden />
              <span className="text-left sm:text-center">
                {t("atsCoverage.stripLegend", "The agent submits these for you. The rest it fills in completely — you press send, because they use a human check we will not bypass.")}
              </span>
            </p>
          )}

          {asOfLine && <p className="mt-1.5 text-[11px] text-muted-foreground/70">{asOfLine}</p>}
        </div>
      </section>
    );
  }

  const groups = online
    ? [
        {
          key: "auto",
          Icon: Bot,
          title: t("atsCoverage.autoTitle", "We apply for you"),
          blurb: t("atsCoverage.autoBlurb", "The agent completes and submits the application itself."),
          vendors: order(AUTO_VENDORS),
        },
        {
          key: "click",
          Icon: MousePointerClick,
          title: t("atsCoverage.clickTitle", "Filled in, you press send"),
          blurb: t("atsCoverage.clickBlurb", "These use a CAPTCHA or a human check. We never solve or bypass one, so your application arrives ready and you send it."),
          vendors: order(CLICK_VENDORS),
        },
      ]
    : [
        {
          key: "all",
          Icon: MousePointerClick,
          title: t("atsCoverage.allTitle", "Applications prepared for you"),
          blurb: t("atsCoverage.allBlurb", "We pull jobs directly from these systems and prepare your application for each one."),
          vendors: order(ATS_VENDORS),
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
                count: ATS_VENDORS.length,
              })
            : t("atsCoverage.sub", "We read jobs straight from {{count}} applicant tracking systems — not scraped from a search engine.", {
                count: ATS_VENDORS.length,
              })}
        </p>
      </div>

      <div className={online ? "grid md:grid-cols-2 gap-6" : ""}>
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
