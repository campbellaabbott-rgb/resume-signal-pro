import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { MapPin, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { count as fmtCount } from "@/lib/format";
import { utcStamp } from "@/lib/home/stamps";
import { searchHref, TRY_CHIPS } from "@/lib/home/search";

/**
 * 4.1 THE SEARCH IS THE HERO. One filled button on the page: "Search jobs".
 * The form is a real GET to /jobs (q, location; mode=remote for "Remote"), so
 * it works before the app has loaded; with the app it navigates in place.
 * Under the try chips, the page's one open-postings figure with the moment it
 * was counted (D1), then the door to the free scan at /resume-checker.
 */
export interface HomeSearchHeroProps {
  openTotal: number | null;
  asOf: Date | null;
}

export function HomeSearchHero({ openTotal, asOf }: HomeSearchHeroProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [location, setLocation] = useState("");
  const lng = i18n.language || "en";
  const stamp = openTotal !== null ? utcStamp(asOf, lng) : null;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    navigate(searchHref(q, location, t("home.hero.remoteWord")));
  };

  return (
    <section aria-labelledby="home-h1" className="pt-5 lg:pt-10">
      <div className="container">
        <h1 id="home-h1" className="min-h-[3lh] text-[clamp(1.5rem,6vw,2.25rem)] font-semibold leading-tight tracking-tight md:min-h-0 md:text-4xl md:leading-[2.75rem]">
          {t("home.hero.title")}
        </h1>
        <p className="mt-2 max-w-[62ch] text-base text-muted-foreground md:text-lg">{t("home.hero.sub")}</p>

        <form
          action="/jobs"
          method="get"
          role="search"
          aria-label={t("home.hero.formLabel")}
          onSubmit={submit}
          className="mt-3.5 grid max-w-[980px] gap-2 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_auto] md:items-end md:gap-2.5"
        >
          <div className="min-w-0">
            <label htmlFor="home-q" className="mb-1 block text-meta font-medium text-muted-foreground">{t("home.hero.qLabel")}</label>
            <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
              <input
                id="home-q"
                name="q"
                type="search"
                autoComplete="off"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("home.hero.qPlaceholder")}
                className="h-11 w-full rounded-md border border-input bg-background pl-10 pr-3 text-base text-foreground placeholder:text-subtle-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              />
            </div>
          </div>
          <div className="min-w-0">
            <label htmlFor="home-location" className="mb-1 block text-meta font-medium text-muted-foreground">{t("home.hero.locationLabel")}</label>
            <div className="relative">
              <MapPin aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
              <input
                id="home-location"
                name="location"
                type="text"
                autoComplete="off"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder={t("home.hero.locationPlaceholder")}
                className="h-11 w-full rounded-md border border-input bg-background pl-10 pr-3 text-base text-foreground placeholder:text-subtle-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              />
            </div>
          </div>
          <Button type="submit" size="lg" wrap className="h-auto min-h-11 w-full justify-center text-center md:w-auto">
            {t("home.hero.submit")}
          </Button>
        </form>

        <div className="mt-2.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{t("home.hero.tryLabel")}</span>
          {TRY_CHIPS.map((c) => (
            <Link
              key={c.key}
              to={c.to}
              className={`inline-flex h-9 items-center rounded-md border border-border-strong bg-card px-3 text-sm font-medium text-foreground transition-colors duration-fast hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background coarse:h-11 ${c.optional ? "max-[479px]:hidden" : ""}`}
            >
              {t(`home.hero.try.${c.key}`)}
            </Link>
          ))}
        </div>

        {/* The line keeps its height while the count is in flight, so the
            scan link and the board below it never move when it lands. */}
        <p className="mt-3 min-h-[2.25rem] text-meta text-subtle-foreground sm:min-h-[1.125rem]" data-home-count="">
          {openTotal !== null && stamp ? (
            <>
              <strong className="font-medium text-foreground">
                {t("home.hero.count", { count: openTotal, formatted: fmtCount(openTotal, { lng }) })}
              </strong>
              {" · "}
              <time dateTime={stamp.iso}>{t("home.hero.counted", { date: stamp.date, time: stamp.time })}</time>
            </>
          ) : null}
        </p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {t("home.hero.scanLead")}{" "}
          <Link to="/resume-checker#upload" className="link">{t("home.hero.scanLink")}</Link>
        </p>
      </div>
    </section>
  );
}
