import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { markDeadForRobots, clearDeadForRobots } from "@/lib/seo-robots";

const NotFound = () => {
  const { t } = useTranslation();
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  // The hosting serves HTTP 200 for every path (static SPA fallback), so this
  // page — the one that MEANS 404 — was indexable and canonical-less: a soft
  // 404 by definition. noindex is the only correct signal a static SPA can
  // send for it. Cleared on unmount so client-side navigation to a real route
  // never carries the flag along.
  useEffect(() => {
    markDeadForRobots();
    return clearDeadForRobots;
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">{t('notFound.code')}</h1>
        <p className="mb-4 text-xl text-muted-foreground">{t('notFound.message')}</p>
        <a href="/" className="text-primary underline hover:text-primary/90">
          Return to Home
        </a>
      </div>
    </div>
  );
};

export default NotFound;
