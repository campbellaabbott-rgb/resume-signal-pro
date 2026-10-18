import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { count as fmtCount } from "@/lib/format";
import { ALL_FIELDS_PATH, fieldPath, homeFields } from "@/lib/home/fields";
import { minutesText, utcStamp } from "@/lib/home/stamps";
import type { BoardFreshness } from "@/lib/home/use-board-freshness";
import { HomeDetails } from "./HomeDetails";

/**
 * THE RAIL: "The board today" and the field links.
 *
 * (a) How many job boards carry an open posting, and how recently they were
 *     read, from get_freshness_stats with its computed_at. The basis says
 *     that the largest boards are read in parts (review P3).
 * (b) The 24-hour "new · gone" flow figure is REMOVED (owner decision D11):
 *     intake is our first sighting, and set beside closures it overstates
 *     growth (measured 5.8x; the board shrank on the day the mockup said it
 *     grew). Nothing here reads get_board_flow.
 *
 * Field links come from the board's category list (src/lib/home/fields.ts).
 * From 1024px they are a card; under it, a disclosure whose links stay in the
 * DOM.
 */
export function HomeBoardRail({ freshness }: { freshness: BoardFreshness | null }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language || "en";
  const stamp = freshness ? utcStamp(freshness.computedAt, lng) : null;

  const links = (
    <ul className="flex flex-wrap gap-2 pb-1.5 pt-1 lg:p-0">
      {homeFields().map((slug) => (
        <li key={slug}>
          <Link
            to={fieldPath(slug)}
            className="inline-flex min-h-8 items-center rounded-md border border-border-strong px-2.5 py-1 text-meta text-foreground transition-colors duration-fast hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background coarse:min-h-11"
          >
            {t(`jobsPage.categories.${slug}`)}
          </Link>
        </li>
      ))}
      <li>
        <Link
          to={ALL_FIELDS_PATH}
          className="inline-flex min-h-8 items-center rounded-md border border-border-strong px-2.5 py-1 text-meta text-foreground transition-colors duration-fast hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background coarse:min-h-11"
        >
          {t("home.rail.allFields")}
        </Link>
      </li>
    </ul>
  );

  return (
    <aside aria-labelledby="home-rail" className="grid content-start gap-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 id="home-rail" className="mb-2.5 text-sm font-semibold text-muted-foreground">{t("home.rail.title")}</h2>
        {/* Reserved: the figure lands without moving the field links. */}
        <div className="min-h-[6.75rem]" data-home-freshness="">
          {freshness && stamp ? (
            <div className="min-w-0" data-stat="">
              <p className="text-xl font-semibold text-foreground">{fmtCount(freshness.boards, { lng })}</p>
              <p className="text-sm text-muted-foreground">{t("home.rail.boards", { count: freshness.boards })}</p>
              <p className="mt-0.5 text-xs text-subtle-foreground">
                <time dateTime={stamp.iso}>
                  {t("home.rail.readBasis", { p50: minutesText(freshness.p50Min, lng), p95: minutesText(freshness.p95Min, lng), time: stamp.time })}
                </time>
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <HomeDetails
        openFrom={1024}
        summary={t("home.rail.fieldsTitle")}
        className="lg:rounded-lg lg:border lg:border-border lg:bg-card lg:p-4"
        summaryClassName="lg:hidden"
        data-testid="home-fields"
      >
        {/* The summary names the block under 1024px; from there this heading does (one of the two is ever shown). */}
        <h2 className="mb-2.5 hidden text-sm font-semibold text-muted-foreground lg:block">{t("home.rail.fieldsTitle")}</h2>
        {links}
      </HomeDetails>
    </aside>
  );
}
