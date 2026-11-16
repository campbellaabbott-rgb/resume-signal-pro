import { useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { matchPath, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { bakedHeadFor, supersedeBakedTitleAndShareTags } from "@/components/seo/baked-head";
import { ownedByReact } from "@/lib/prerendered-head";

/**
 * A TITLE FOR EVERY PAGE THAT WRITES NONE OF ITS OWN (NB-43).
 *
 * Twelve routes render no <SEO>: sign-in, the account, the payment results
 * (the Full Analysis page, /success, writes its own), the employer shortlist, the affiliate pages, the agent page and the owner's
 * dashboards. After a client-side move to one of them the tab kept the last
 * page's title (or, loaded directly, the homepage's from the fallback shell),
 * and the private ones carried the shell's "index, follow".
 *
 * This is mounted once inside the router. On those routes it writes a title
 * in the reader's language and, for a private page, noindex; on every other
 * route it writes nothing. A page's own title always wins: React puts the
 * newest <title> first, and a page mounts after this does.
 *
 * On the document load of a page the bake wrote (/affiliates, /agent,
 * /shortlist), an English reader keeps the bake's own title, as
 * <SEO preferBakedHead> does; any other reader gets this one.
 *
 * The 404 page writes its own title (src/pages/NotFound.tsx).
 */
export const SITE_NAME = "Resume Booster";

export interface DefaultHead {
  /** A react-router path pattern, matched to the end. */
  path: string;
  /** siteShell.titles.<key> */
  key: string;
  /** A private page: told to no search engine. */
  noIndex: boolean;
}

export const DEFAULT_HEADS: readonly DefaultHead[] = [
  { path: "/auth", key: "auth", noIndex: true },
  { path: "/account", key: "account", noIndex: true },
  { path: "/agent", key: "agent", noIndex: false },
  { path: "/shortlist", key: "shortlist", noIndex: true },
  { path: "/product-success", key: "productSuccess", noIndex: true },
  { path: "/payment-failed", key: "paymentFailed", noIndex: true },
  { path: "/affiliates", key: "affiliates", noIndex: false },
  { path: "/r/:code", key: "affiliateRedirect", noIndex: true },
  { path: "/analytics", key: "analytics", noIndex: true },
  { path: "/errors", key: "errors", noIndex: true },
  { path: "/health-check", key: "healthCheck", noIndex: true },
  { path: "/scan-metrics", key: "scanMetrics", noIndex: true },
];

/** The default head for a path, or null when the route's page writes its own. */
export function defaultHeadFor(pathname: string): DefaultHead | null {
  return DEFAULT_HEADS.find((h) => matchPath({ path: h.path, end: true }, pathname)) ?? null;
}

/** The bake's own title is still in the head, written before React ran. */
const bakedTitleInHead = (): boolean =>
  typeof document !== "undefined" && [...document.head.querySelectorAll("title")].some((n) => !ownedByReact(n));

export function RouteDefaultHead() {
  const { pathname } = useLocation();
  const { t, i18n } = useTranslation();
  const head = defaultHeadFor(pathname);
  const lang = String(i18n?.language || i18n?.resolvedLanguage || "en").toLowerCase();
  const readsBakedLanguage = lang === "en" || lang.startsWith("en-");
  const keepBaked = !!head && readsBakedLanguage && !!bakedHeadFor(pathname)?.title && bakedTitleInHead();
  const writes = !!head && !keepBaked;

  // Once this title is in the head, the shell's or the bake's beside it goes.
  useEffect(() => {
    if (writes) supersedeBakedTitleAndShareTags();
  }, [writes, pathname, lang]);

  if (!head || !writes) return null;
  return (
    <Helmet>
      <title>{`${t(`siteShell.titles.${head.key}`)} — ${SITE_NAME}`}</title>
      {head.noIndex && <meta name="robots" content="noindex,nofollow" />}
    </Helmet>
  );
}
