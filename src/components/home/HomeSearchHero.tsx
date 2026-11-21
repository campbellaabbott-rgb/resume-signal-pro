import { useLayoutEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import "@/i18n/home-strings";
import { MapPin, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { count as fmtCount } from "@/lib/format";
import { utcStamp } from "@/lib/home/stamps";
import { searchHref, TRY_CHIPS } from "@/lib/home/search";
import { HOME_H1_CLASS, HOME_SUB_CLASS } from "@/lib/home/hero-classes";
import { bakedField, claimBakedField } from "@/lib/keep-prerendered-page";

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

/** The baked form's two fields (scripts/prerender-seo.mjs writes the same ids). */
const HOME_FIELD_IDS = { q: "home-q", location: "home-location" } as const;

/**
 * WHAT WAS TYPED BEFORE THE APP LOADED STAYS TYPED (PERFORMANCE-M1). The baked
 * form is a working search from the first paint, and the fields used to start
 * empty when React swapped the page in, about three seconds later on a phone,
 * taking the reader's words and their focus. Each field starts from the baked
 * field's value (src/lib/keep-prerendered-page.ts bakedField), and the focus
 * and caret come back to the field that had them: at once while the baked
 * field is still on screen, or, once it has gone, only while nothing else has
 * taken the focus since.
 */
function useCarriedFocus(fields: Array<[string, RefObject<HTMLInputElement>]>) {
  useLayoutEffect(() => {
    const doc = fields[0]?.[1].current?.ownerDocument;
    for (const [id, ref] of fields) {
      const baked = bakedField(id);
      claimBakedField(id);
      const input = ref.current;
      if (!baked?.focused || !input || !doc) continue;
      const active = doc.activeElement;
      if (!baked.live && active && active !== doc.body) continue;
      input.focus({ preventScroll: true });
      if (baked.selection) {
        try { input.setSelectionRange(baked.selection[0], baked.selection[1]); } catch { /* a field type with no caret */ }
      }
    }
    // Once, on the first commit: the baked fields are offered once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function HomeSearchHero({ openTotal, asOf }: HomeSearchHeroProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [q, setQ] = useState(() => bakedField(HOME_FIELD_IDS.q)?.value ?? "");
  const [location, setLocation] = useState(() => bakedField(HOME_FIELD_IDS.location)?.value ?? "");
  const qRef = useRef<HTMLInputElement>(null);
  const locationRef = useRef<HTMLInputElement>(null);
  useCarriedFocus([[HOME_FIELD_IDS.q, qRef], [HOME_FIELD_IDS.location, locationRef]]);
  const lng = i18n.language || "en";
  const stamp = openTotal !== null ? utcStamp(asOf, lng) : null;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    navigate(searchHref(q, location, t("home.hero.remoteWord")));
  };

  return (
    <section aria-labelledby="home-h1" className="pt-5 lg:pt-10">
      <div className="container">
        <h1 id="home-h1" className={HOME_H1_CLASS}>
          {t("home.hero.title")}
        </h1>
        <p className={HOME_SUB_CLASS}>{t("home.hero.sub")}</p>

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
                ref={qRef}
                id={HOME_FIELD_IDS.q}
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
                ref={locationRef}
                id={HOME_FIELD_IDS.location}
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
