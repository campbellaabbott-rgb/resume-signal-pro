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
        <div className="text-center mb-4">
          <h2 id="ats-strip-heading" className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {t("atsCoverage.stripHeading", "Every job here comes straight from these systems")}
          </h2>
          {ready && openTotal !== null && (
            <p className="text-sm text-muted-foreground mt-1">
              {t("atsCoverage.stripSub", "{{total}} open roles, read directly from all {{count}} — never scraped from a search engine.", {
                total: openTotal.toLocaleString(),
                count: ATS_VENDORS.length,
              })}
            </p>
          )}
        </div>

        <ul className="flex flex-wrap justify-center gap-2">
          {order(ATS_VENDORS).map((v) => (
            <VendorPill key={v.key} v={v} count={counts[v.key]} auto={online && v.tier === "auto"} />
          ))}
        </ul>

        {/* The split is a product claim, not decoration — it survives the
            compact layout as a legend rather than being dropped with the
            second card. */}
        {online && (
          <p className="text-center text-xs text-muted-foreground mt-3 flex items-center justify-center gap-1.5">
            <Bot className="w-3.5 h-3.5 text-primary" aria-hidden />
            {t("atsCoverage.stripLegend", "The agent submits these for you. The rest it fills in completely — you press send, because they use a human check we will not bypass.")}
          </p>
        )}

        {asOfLine && <p className="text-center text-xs text-muted-foreground mt-2">{asOfLine}</p>}
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
