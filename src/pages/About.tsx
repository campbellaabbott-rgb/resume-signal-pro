/**
 * /about — WHO RUNS THIS AND WHAT THE BOARD IS (SEO-011b).
 *
 * App.tsx had no /about route, so the catch-all painted NotFound over the
 * address and a baked /about would have been repainted as a soft 404 for
 * every crawler that runs scripts. The words are the main locale's
 * aboutPage.* keys, which the bake reads from en.json for its own /about,
 * so a reader with or without scripts gets one text.
 *
 * It names no person and no new contact detail: the seller's legal name and
 * address print only once src/config/seller.ts carries them (sellerIdentity),
 * and contact goes through the privacy policy, which already publishes the
 * address for privacy requests. The AI-app line names only Claude, ChatGPT
 * and Claude Code (owner, 2026-09-18).
 */
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { sellerIdentity } from "@/config/seller";
import { SERVED_WINDOW_DAYS } from "@/lib/company/lander-model";

const link = "text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary";

export default function About() {
  const { t } = useTranslation();
  const seller = sellerIdentity();
  const days = SERVED_WINDOW_DAYS;
  return (
    <div className="min-h-screen bg-background">
      <SEO
        title={t("aboutPage.metaTitle", "About Resume Booster — How the Live Job Board Works")}
        description={t("aboutPage.metaDescription", "A free resume scanner and a live job board read straight from employers' own hiring systems: how the board works, how its counts are made, how to reach us.")}
        path="/about"
      />
      <Header />
      <main id="main-content" tabIndex={-1} className="pt-20 pb-20 focus:outline-none">
        <article className="container max-w-3xl space-y-8" data-about="">
          <header>
            <h1 className="text-3xl md:text-4xl font-bold mb-3">{t("aboutPage.h1", "About Resume Booster")}</h1>
            <p className="text-muted-foreground">
              {t("aboutPage.lead", "Resume Booster is two things: a free resume scanner, and a job board of live jobs straight from employers' own hiring systems. You can check how your resume reads against a posting before you apply, then apply on the employer's own site.")}
            </p>
          </header>

          <section>
            <h2 className="text-xl font-bold mb-2">{t("aboutPage.boardTitle", "What the job board is")}</h2>
            <p className="text-muted-foreground">
              {t("aboutPage.boardBody", { days, defaultValue: "The board reads postings from the hiring systems that publish them: an employer's own, a staffing agency's (labeled as one) or the federal government's listing site. Nothing is copied from another job board. A posting stays on the board while its date is inside the last {{days}} days and the system that published it still lists it." })}
            </p>
            <p className="mt-2"><Link to="/jobs" className={link}>{t("jobsPage.h1", "Live job board")}</Link></p>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-2">{t("aboutPage.countsTitle", "How the counts are made")}</h2>
            <p className="text-muted-foreground">
              {t("aboutPage.countsBody", { days, defaultValue: "Every count on this site names the day or the read it comes from. An open role is a posting whose date falls inside the last {{days}} days: the employer's own date, or, for a posting with no date, the day we last saw it in the employer's feed. Counts move as roles open and close, so a page built on one day states that day's figure." })}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("aboutPage.readMore", "Read more:")}{" "}
              <Link to="/ghost-job-index" className={link}>{t("aboutPage.ghostLink", "how fresh our reads are (Ghost Job Index)")}</Link>
              {" · "}
              <Link to="/methodology" className={link}>{t("aboutPage.methodologyLink", "how the resume score works")}</Link>
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-2">{t("aboutPage.notTitle", "Not to be confused with")}</h2>
            <p className="text-muted-foreground">
              {t("aboutPage.notBody", "Resume Booster at resumebooster.work is a separate product from resumebooster.io, ResumeBoostAI and other similarly named sites, and has no connection with them.")}
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-2">{t("aboutPage.aiTitle", "Use it from your AI app")}</h2>
            <p className="text-muted-foreground">
              {t("aboutPage.aiBody", "Claude, ChatGPT and Claude Code can search the board through our connector.")}{" "}
              <Link to="/agents" className={link}>{t("aboutPage.aiLink", "Connect your AI app")}</Link>
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-2">{t("aboutPage.contactTitle", "Contact")}</h2>
            <p className="text-muted-foreground">
              {t("aboutPage.contactBody", "For questions about your data and for privacy requests, the privacy policy says how to reach us.")}{" "}
              <Link to="/privacy" className={link}>{t("aboutPage.privacyLink", "Privacy policy")}</Link>
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
