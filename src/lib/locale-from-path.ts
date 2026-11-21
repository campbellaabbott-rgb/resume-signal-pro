/**
 * THE LANGUAGE A PAGE IS WRITTEN IN, READ FROM ITS ADDRESS (SEO audit
 * 2026-11-18, CONTENT-N4).
 *
 * The translated pages (/es/industrias/*, /es/revisar-curriculum and the CV
 * standards pages under /es, /fr, /de, /pt and /nl) print their own words in
 * their own language, while the header, the footer and the skip link spoke
 * the reader's: on /fr/normes-cv/france a reader whose browser says en-US got
 * "Companies hiring" and "Pricing" around French text, 19 to 31% of the
 * page's words in English, and so did the baked file a crawler reads. The
 * header and the footer now take the page's language when its address names
 * one, and the reader's everywhere else.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import type { TFunction } from "i18next";
import { loadLocale } from "@/i18n";

/** The address prefixes whose pages are written in that language. */
export const PATH_LOCALES = ["es", "fr", "de", "pt", "nl"] as const;
export type PathLocale = (typeof PATH_LOCALES)[number];

const PREFIX = new RegExp(`^/(${PATH_LOCALES.join("|")})(?:/|$)`);

/** The language the page at `pathname` is written in, or null for a page in the reader's own. */
export function localeFromPath(pathname: string | null | undefined): PathLocale | null {
  const m = PREFIX.exec(String(pathname ?? ""));
  return m ? (m[1] as PathLocale) : null;
}

/**
 * The `t` the site shell renders with: fixed to the page's language on a
 * translated page (its strings loaded when they are not yet, and the shell
 * re-rendered when they arrive), the reader's everywhere else. `lng` is the
 * language the words come from, for a `lang` attribute; `pageLocale` is null
 * where the shell follows the reader.
 */
export function useSiteShellT(): { t: TFunction; lng: string; pageLocale: PathLocale | null } {
  const { t, i18n } = useTranslation();
  const { pathname } = useLocation();
  const page = localeFromPath(pathname);
  const [, loaded] = useState(0);
  useEffect(() => {
    if (!page || i18n.hasResourceBundle(page, "translation")) return;
    let live = true;
    void loadLocale(page).then(() => { if (live) loaded((n) => n + 1); });
    return () => { live = false; };
  }, [page, i18n]);
  if (!page || page === i18n.language) return { t, lng: i18n.language || "en", pageLocale: page };
  return { t: i18n.getFixedT(page), lng: page, pageLocale: page };
}
