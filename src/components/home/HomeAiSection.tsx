import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { XCircle } from "lucide-react";
import { Chip } from "@/components/ui/chip";
import { count as fmtCount, date as fmtDate } from "@/lib/format";
import { aiReach } from "@/lib/home/board-figures";
import { andList, utcStamp } from "@/lib/home/stamps";

/**
 * 4.4 "USE IT FROM YOUR AI". Seeker-facing copy names Claude, ChatGPT and
 * Claude Code, and no other host. The small print says how much of the board
 * the connector can search: openTotal less the systems it never hands on,
 * from the same read and under the same date as every other count.
 *
 * The illustration is drawn from a real row on the day the mockup was made
 * and says so; it prints that row's date, never an age that would go stale.
 */
const ILLUSTRATION_DAY = "2026-10-17";
const ILLUSTRATION_POSTED_DAY = "2026-10-16";

const buttonClass =
  "inline-flex min-h-10 items-center justify-center rounded-md border border-border-strong bg-card px-4 py-2 text-center text-sm font-medium text-foreground transition-colors duration-fast hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background coarse:min-h-11";

export function HomeAiSection({ counts, openTotal, asOf }: { counts: Record<string, number>; openTotal: number | null; asOf: Date | null }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language || "en";
  const reach = aiReach(counts, openTotal);
  const stamp = utcStamp(asOf, lng);

  return (
    <section aria-labelledby="home-ai" className="border-t border-border py-8 sm:py-10 lg:py-16">
      <div className="container grid gap-6 lg:grid-cols-2 lg:items-start lg:gap-14">
        <div className="min-w-0">
          <h2 id="home-ai" className="text-[clamp(1.25rem,5vw,1.875rem)] font-semibold leading-tight md:text-3xl">{t("home.ai.title")}</h2>
          <p className="mt-2.5 max-w-[62ch] text-muted-foreground">{t("home.ai.lede")}</p>
          <div className="mt-[18px] rounded-lg border border-border-strong px-4 py-3.5">
            <h3 className="text-sm font-semibold">{t("home.ai.neverTitle")}</h3>
            <ul className="mt-2 grid gap-2">
              {[1, 2, 3].map((n) => (
                <li key={n} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                  <XCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    <b className="font-semibold text-foreground">{t(`home.ai.never${n}Lead`)}</b> {t(`home.ai.never${n}`)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <Link to="/agents#claude" className={buttonClass}>{t("home.ai.claude")}</Link>
            <Link to="/agents#chatgpt" className={buttonClass}>{t("home.ai.chatgpt")}</Link>
            <Link to="/agents#claude-code" className="link inline-flex min-h-6 items-center text-sm">{t("home.ai.claudeCode")}</Link>
          </div>
          {/* Reserved: two lines on a phone, so the line landing moves nothing. */}
          <p className="mt-3 min-h-[3.375rem] text-meta text-muted-foreground sm:min-h-[2.25rem]" data-home-reach="">
            {reach && stamp && openTotal !== null ? (
              <time dateTime={stamp.iso}>
                {t("home.ai.reach", {
                  searchable: fmtCount(reach.searchable, { lng }),
                  total: fmtCount(openTotal, { lng }),
                  names: andList(reach.names, lng),
                  withheld: fmtCount(reach.withheld, { lng }),
                  date: stamp.date,
                  time: stamp.time,
                })}
              </time>
            ) : null}
          </p>
        </div>
        <figure aria-label={t("home.ai.figureLabel")} className="hidden overflow-hidden rounded-lg border border-border bg-card lg:block">
          <figcaption className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5 text-xs text-subtle-foreground">
            <Chip variant="outline">{t("home.ai.figureChip")}</Chip>
            <span>{t("home.ai.figureCaption", { date: fmtDate(ILLUSTRATION_DAY, { lng }) })}</span>
          </figcaption>
          <p className="px-4 py-3.5 text-sm text-muted-foreground">
            <b className="font-medium text-foreground">{t("home.ai.figureYou")}</b> {t("home.ai.figureAsk")}
          </p>
          <p className="mx-4 rounded-md border border-border-strong px-2.5 py-2 font-mono text-xs text-muted-foreground">Resume Booster · search_jobs</p>
          <div className="grid gap-2 px-4 pb-1 pt-3">
            <div className="border-l-2 border-border-strong pl-2.5 text-meta text-muted-foreground">
              <b className="block text-sm font-medium text-foreground">Senior Director, Oncology Clinical Intelligence &amp; Evidence</b>
              AstraZeneca · Cambridge, MA · Workday · {t("home.ai.figurePosted", { date: fmtDate(ILLUSTRATION_POSTED_DAY, { lng }) })}
            </div>
          </div>
          <p className="px-4 py-3.5 text-sm">{t("home.ai.figureReply")}</p>
        </figure>
      </div>
    </section>
  );
}
