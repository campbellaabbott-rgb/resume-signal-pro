import { useLayoutEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { JobCard } from "@/components/jobs/listing/JobCard";
import { CardSkeleton } from "@/components/ui/skeletons";
import { count as fmtCount } from "@/lib/format";
import { HOME_LIST_BOX_PHONE_REM, HOME_LIST_BOX_WIDE_REM, HOME_ROWS_MAX, HOME_ROWS_WINDOW_DAYS } from "@/lib/home/rows";
import type { HomeRowsState } from "@/lib/home/use-home-rows";
import { utcStamp } from "@/lib/home/stamps";
import { HOME_CARD_CONTEXT, homePostingHref, packRows } from "@/lib/home/list-box";

/**
 * 4.2 "ON THE BOARD NOW": the board's newest postings, on the board's own card.
 *
 * The card is JobCard with the board's context and nothing the homepage cannot
 * back: no Check fit, no Save (the board's save handler lives inside Jobs.tsx,
 * review P12), no menu. Each title opens the posting's own page.
 *
 * LAYOUT STABILITY (review P24). The list box has a fixed reserved height
 * (src/lib/home/rows.ts). Skeletons sit inside it and are clipped to it, every
 * row lands in one commit, and rows are packed until the next one would not
 * fit whole; the rest are not shown. The packing runs in a layout effect,
 * before the browser paints, so the box never grows or shrinks on screen. If
 * the list cannot be shown, the box goes and "See all postings" stays.
 */
export interface HomeBoardRowsProps {
  state: HomeRowsState;
  openTotal: number | null;
  asOf: Date | null;
}

export function HomeBoardRows({ state, openTotal, asOf }: HomeBoardRowsProps) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language || "en";
  const stamp = utcStamp(asOf, lng);
  const listRef = useRef<HTMLUListElement>(null);
  const showList = state.status === "loading" || state.status === "ready";

  useLayoutEffect(() => {
    const ul = listRef.current;
    if (!ul || state.status !== "ready") return;
    const pack = () => { packRows(ul); };
    pack();
    window.addEventListener("resize", pack);
    void document.fonts?.ready.then(pack).catch(() => {});
    return () => window.removeEventListener("resize", pack);
  }, [state, lng]);

  return (
    <div className="min-w-0">
      <div className="mb-3">
        <h2 id="home-board" className="text-[clamp(1.25rem,5vw,1.5rem)] font-semibold leading-snug">{t("home.board.title")}</h2>
        <p className="mt-0.5 text-meta text-subtle-foreground">{t("home.board.note", { days: HOME_ROWS_WINDOW_DAYS })}</p>
      </div>

      {showList && (
        <ul
          ref={listRef}
          aria-labelledby="home-board"
          aria-busy={state.status === "loading" || undefined}
          data-home-rows={state.status}
          className={`grid min-h-[var(--home-rows-phone)] content-start gap-2 sm:min-h-[var(--home-rows-wide)] ${
            state.status === "loading" ? "max-h-[var(--home-rows-phone)] overflow-hidden sm:max-h-[var(--home-rows-wide)]" : ""
          }`}
          style={{
            ["--home-rows-phone" as string]: `${HOME_LIST_BOX_PHONE_REM}rem`,
            ["--home-rows-wide" as string]: `${HOME_LIST_BOX_WIDE_REM}rem`,
          }}
        >
          {state.status === "loading"
            ? Array.from({ length: HOME_ROWS_MAX }, (_, i) => (
                <li key={i} aria-hidden="true">
                  <CardSkeleton />
                </li>
              ))
            : state.rows.map((job) => (
                <JobCard key={job.id} job={job} ctx={HOME_CARD_CONTEXT} href={homePostingHref(job)} />
              ))}
        </ul>
      )}
      {state.status === "loading" && <p className="sr-only" role="status">{t("home.board.loading")}</p>}

      <div className="mt-3.5 grid gap-2.5">
        {/* The figure names its date basis here too, the hero's "counted ..." under the same as_of. */}
        <p className="min-h-10 text-sm text-muted-foreground sm:min-h-5" data-home-total="">
          {openTotal !== null && stamp ? (
            <>
              {t("home.board.total", { count: openTotal, formatted: fmtCount(openTotal, { lng }) })}
              {" · "}
              <time dateTime={stamp.iso}>{t("home.hero.counted", { date: stamp.date, time: stamp.time })}</time>
            </>
          ) : null}
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
          <Link
            to="/jobs"
            className="inline-flex min-h-10 w-full items-center justify-center rounded-md border border-border-strong bg-card px-4 py-2 text-center text-sm font-medium text-foreground transition-colors duration-fast hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background coarse:min-h-11 sm:w-auto"
          >
            {t("home.board.seeAll")}
          </Link>
          <p className="text-meta text-muted-foreground">{t("home.board.applyNote")}</p>
        </div>
      </div>
    </div>
  );
}
