import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { markDeadForRobots, clearDeadForRobots } from "@/lib/seo-robots";
import { supersedeBakedTitleAndShareTags } from "@/components/seo/baked-head";
import { SITE_NAME } from "@/components/RouteDefaultHead";

// THE 404 PAGE SPEAKS THE READER'S LANGUAGE AND OFFERS A WAY ON (NB-43,
// NB-44). Its one link was English in every language, it offered nowhere
// else to go, it kept the previous page's tab title, and it logged a console
// error for every mistyped address, which is not an error of ours. The link
// reads the main locale's notFound.returnHome, the board and pricing sit
// beside it, and the tab says the page was not found.
const NotFound = () => {
  const { t } = useTranslation();

  // The hosting serves HTTP 200 for every path (static SPA fallback), so this
  // page — the one that MEANS 404 — was indexable and canonical-less: a soft
  // 404 by definition. noindex is the only correct signal a static SPA can
  // send for it. Cleared on unmount so client-side navigation to a real route
  // never carries the flag along.
  useEffect(() => {
    markDeadForRobots();
    return clearDeadForRobots;
  }, []);

  // The shell's homepage title gives way to this page's.
  useEffect(() => {
    supersedeBakedTitleAndShareTags();
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
      <Helmet>
        <title>{`${t("siteShell.notFound.title")} — ${SITE_NAME}`}</title>
      </Helmet>
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">{t('notFound.code')}</h1>
        <p className="mb-4 text-xl text-muted-foreground">{t('notFound.message')}</p>
        <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          <Link to="/" className="text-primary underline hover:text-primary/90">
            {t('notFound.returnHome')}
          </Link>
          <Link to="/jobs" className="text-primary underline hover:text-primary/90">
            {t('siteShell.notFound.jobs')}
          </Link>
          <Link to="/pricing" className="text-primary underline hover:text-primary/90">
            {t('siteShell.notFound.pricing')}
          </Link>
        </p>
      </div>
    </div>
  );
};

export default NotFound;
