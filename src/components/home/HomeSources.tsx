import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import { count as fmtCount } from "@/lib/format";
import { sourcesTable, type SourceRow } from "@/lib/home/board-figures";
import { utcStamp } from "@/lib/home/stamps";
import { BOARD_FRESH_WINDOW_DAYS } from "@/components/jobs/posting-page";
import { HomeDetails } from "./HomeDetails";

/**
 * 4.5 WHERE THE JOBS COME FROM. The table is the same read as the count in
 * the hero (get_board_vendor_counts, one as_of), so its caption may say "the
 * same count as above" only when its rows add up to openTotal. "{n} more
 * systems ({sum})" is computed, never typed (review P28). Both disclosures
 * keep their rows in the DOM.
 */
function Rows({ rows, federalNote }: { rows: SourceRow[]; federalNote?: string }) {
  const { i18n } = useTranslation();
  const lng = i18n.language || "en";
  return (
    <>
      {rows.map((r) => (
        <tr key={r.source}>
          <th scope="row" className="border-t border-border py-2.5 text-left text-sm font-normal">
            {r.name}
            {federalNote && r.source === "usajobs" ? <small className="block text-xs text-subtle-foreground">{federalNote}</small> : null}
          </th>
          <td className="border-t border-border py-2.5 text-right text-sm">{fmtCount(r.total, { lng })}</td>
        </tr>
      ))}
    </>
  );
}

function Head() {
  const { t } = useTranslation();
  return (
    <thead>
      <tr>
        <th scope="col" className="pb-2.5 text-left text-meta font-medium text-muted-foreground">{t("home.sources.colSystem")}</th>
        <th scope="col" className="pb-2.5 text-right text-meta font-medium text-muted-foreground">{t("home.sources.colCount")}</th>
      </tr>
    </thead>
  );
}

export function HomeSources({ counts, openTotal, asOf }: { counts: Record<string, number>; openTotal: number | null; asOf: Date | null }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language || "en";
  const table = sourcesTable(counts);
  const stamp = utcStamp(asOf, lng);
  const federalNote = t("home.sources.federalNote");

  return (
    <section aria-labelledby="home-sources" className="border-t border-border py-8 sm:py-10 lg:py-16">
      <div className="container grid gap-6 lg:grid-cols-2 lg:items-start lg:gap-14">
        <div className="min-w-0">
          <h2 id="home-sources" className="text-[clamp(1.25rem,5vw,1.875rem)] font-semibold leading-tight md:text-3xl">{t("home.sources.title")}</h2>
          <p className="mt-2.5 max-w-[62ch] text-muted-foreground">{t("home.sources.lede", { freshDays: BOARD_FRESH_WINDOW_DAYS })}</p>
          <div className="mt-5">
            <Link to="/methodology" className="link inline-flex min-h-6 items-center">{t("home.sources.method")}</Link>
          </div>
        </div>
        {table && stamp && (
          <HomeDetails openFrom={1024} summary={t("home.sources.summary")} className="min-w-0" summaryClassName="border-y border-border" data-testid="home-sources-table">
            <table className="mt-2 w-full border-collapse lg:mt-0">
              <caption className="caption-bottom pt-2.5 text-left text-xs text-subtle-foreground">
                <time dateTime={stamp.iso}>
                  {t(openTotal !== null && table.sum === openTotal ? "home.sources.caption" : "home.sources.captionSum", {
                    date: stamp.date,
                    time: stamp.time,
                    total: fmtCount(openTotal !== null && table.sum === openTotal ? openTotal : table.sum, { lng }),
                  })}
                </time>
              </caption>
              <Head />
              <tbody>
                <Rows rows={[...table.top, ...(table.federal ? [table.federal] : [])]} federalNote={federalNote} />
              </tbody>
            </table>
            {table.more.length > 0 && (
              <details className="group/more mt-1 border-t border-border">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&::-webkit-details-marker]:hidden">
                  <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 transition-transform duration-base group-open/more:rotate-180" />
                  <span className="underline decoration-primary/50 underline-offset-2">
                    {t("home.sources.more", { count: table.more.length, formatted: fmtCount(table.more.length, { lng }), sum: fmtCount(table.moreSum, { lng }) })}
                  </span>
                </summary>
                <table className="w-full border-collapse">
                  <Head />
                  <tbody>
                    <Rows rows={table.more} />
                  </tbody>
                </table>
              </details>
            )}
          </HomeDetails>
        )}
      </div>
    </section>
  );
}
