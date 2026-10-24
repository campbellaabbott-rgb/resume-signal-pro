/**
 * /about — WHO RUNS THIS AND WHAT THE BOARD IS (SEO-011b).
 *
 * App.tsx had no /about route, so the catch-all painted NotFound over the
 * address and the baked /about (scripts/prerender-seo.mjs, SEO-011a) would
 * have been repainted as a soft 404 for every crawler that runs scripts.
 *
 * The page says what the baked page says, sentence for sentence, from the
 * main locale's aboutPage.* keys: the same title and description (and, on a
 * load from the baked file, the baked head itself, preferBakedHead), the same
 * lead, the same two sections and the same links. Its board count is the
 * live one, dated to the day it was read; the bake's is its own build's,
 * dated to its build. One clause of the baked board paragraph is left out on
 * purpose: that this site never submits an application, which is not true
 * while the server-side apply agent is live (d823aae4 took the same claim off
 * the homepage); the bake drops it too (hand-off).
 *
 * It names no person, legal name or postal address: those print only once
 * src/config/seller.ts carries them (sellerIdentity). The contact line is
 * the privacy address the privacy policy already publishes.
 */
import { Link } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { sellerIdentity } from "@/config/seller";
import { SERVING_SOURCE_LIST } from "@/config/ats-vendors";
import { useBoardTotals } from "@/hooks/use-board-totals";
import { PRIVACY_EMAIL } from "@/lib/resume-retention";
import { SERVED_WINDOW_DAYS } from "@/lib/company/lander-model";

const link = "text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary";

/** The day a live count was read, as the bake dates its own: YYYY-MM-DD. */
const today = () => new Date().toISOString().slice(0, 10);

export default function About() {
  const { t, i18n } = useTranslation();
  const seller = sellerIdentity();
  const totals = useBoardTotals();
  const days = SERVED_WINDOW_DAYS;
  const fmt = (n: number) => n.toLocaleString(i18n.language || "en-US");

  const boardLead = totals && totals.feeds
    ? t("aboutPage.boardCounted", {
      open: fmt(totals.jobs),
      boards: fmt(totals.feeds),
      asOf: t("aboutPage.asOf", { date: today(), defaultValue: "as of {{date}}" }),
      defaultValue: "{{open}} open postings from {{boards}} company job boards with roles open ({{asOf}}), each read from employers' own hiring systems, not copied from other job boards; a staffing agency's board and a federal listing site, where the board carries one, are labelled as what they are.",
    })
    : t("aboutPage.boardUncounted", "Open postings, each read from employers' own hiring systems, not copied from other job boards; a staffing agency's board and a federal listing site, where the board carries one, are labelled as what they are.");

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title={t("aboutPage.metaTitle", "About Resume Booster — a Live Job Board and a Free Resume Scan")}
        description={t("aboutPage.metaDescription", "Who runs resumebooster.work, what its job board is and how its counts are made, each figure dated.")}
        path="/about"
        preferBakedHead
      />
      <Header />
      <main id="main-content" tabIndex={-1} className="pt-20 pb-20 focus:outline-none">
        <article className="container max-w-3xl" data-about="">
          <nav aria-label={t("aboutPage.breadcrumbLabel", "Breadcrumb")} className="text-sm text-muted-foreground mb-4">
            <Link to="/" className="hover:text-foreground">{t("aboutPage.breadcrumbHome", "Home")}</Link> /{" "}
            <span className="text-foreground">{t("aboutPage.breadcrumbHere", "About")}</span>
          </nav>
          <h1 className="text-3xl md:text-4xl font-bold mb-3">{t("aboutPage.h1", "About Resume Booster")}</h1>
          <p className="text-muted-foreground mb-6">
            {t("aboutPage.lead", "Resume Booster, at resumebooster.work, is two things: a live job board of openings read from employers' own hiring systems, not copied from other job boards, and a free resume scanner that shows how an applicant-tracking system reads your file. It is an independent site, not affiliated with any employer or hiring system it reads, and not the same product as resumebooster.io or ResumeBoostAI.")}
          </p>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-2">{t("aboutPage.boardTitle", "What the board is")}</h2>
            {/* min-h: the counted sentence replaces the uncounted one in place. */}
            <p className="text-sm text-muted-foreground min-h-[5rem]" data-about-board="">
              {boardLead}{" "}
              {t("aboutPage.boardRest", { sources: SERVING_SOURCE_LIST, defaultValue: "The boards come from {{sources}}. A company job board is one employer's board on one hiring system, and one employer can run several, so the board count is not a count of employers. Applying always happens on the employer's own site." })}
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-2">{t("aboutPage.countsTitle", "How the counts are made")}</h2>
            <p className="text-sm text-muted-foreground">
              <Trans
                i18nKey="aboutPage.countsBody"
                values={{ days }}
                defaults="An open role is a posting the employer's own feed still serves whose date falls inside the last {{days}} days: the employer's own date, or for a posting with no date, the day we last saw it in the feed. Every count on this site says the day it was taken; a count printed on a page built from a saved reading says so. The feeds are re-read in a rotation, the largest boards most often, and how far behind the rotation runs is published on the <ghost>Ghost Job Index</ghost> as a measurement, not a promise. A posting coming down is logged as a takedown and never called a hire: a hire, a withdrawal and a cancelled requisition look the same from a feed. The scoring behind the resume scan is on the <method>methodology page</method>."
                components={{ ghost: <Link to="/ghost-job-index" className={link} />, method: <Link to="/methodology" className={link} /> }}
              />
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-2">{t("aboutPage.nextTitle", "Where to go next")}</h2>
            <p className="text-sm text-muted-foreground" data-about-next="">
              {([
                ["/jobs", t("aboutPage.nextBoard", "The live board")],
                ["/companies", t("aboutPage.nextCompanies", "Companies with a page of their own")],
                ["/ghost-job-index", t("aboutPage.nextGhost", "Ghost Job Index")],
                ["/data-api", t("aboutPage.nextData", "Hiring Data & API")],
                ["/agents", t("aboutPage.nextAgents", "Connect your own AI")],
                ["/trust", t("aboutPage.nextTrust", "Trust & privacy")],
                ["/changelog", t("aboutPage.nextChangelog", "Changelog")],
              ] as const).map(([to, label], i) => (
                <span key={to}>
                  {i > 0 && " · "}
                  <Link to={to} className={link}>{label}</Link>
                </span>
              ))}
            </p>
            <p className="text-sm text-muted-foreground mt-3">
              {t("aboutPage.privacyLine", "Privacy and data questions:")}{" "}
              <a href={`mailto:${PRIVACY_EMAIL}`} className={link}>{PRIVACY_EMAIL}</a>.
            </p>
            {seller && (
              <p className="mt-2 text-sm text-muted-foreground" data-about-seller="">
                {t("aboutPage.seller", { name: seller.legalName, address: seller.postalAddress, defaultValue: "Seller: {{name}}, {{address}}" })}
              </p>
            )}
          </section>
        </article>
      </main>
      <Footer />
    </div>
  );
}
