/**
 * THE SIGN-IN STRINGS, LOADED ONLY WHERE SIGN-IN RENDERS.
 *
 * The auth.* strings live in their own small file per language
 * (src/i18n/auth/<lng>.json), outside the main locale files, and are merged
 * into the 'translation' namespace when /auth (or the signed-in-as prompt)
 * mounts. Every call site passes its English text as the default, so the page
 * reads correctly before a bundle arrives, offline, or if one fails to load.
 *
 * i18next is imported from the package itself: it is the same instance the
 * app initialises in src/i18n/index.ts, without pulling that module's locale
 * files into this one's importers.
 */
import { useEffect, useState } from "react";
import i18n from "i18next";
import { useTranslation } from "react-i18next";

type Loader = () => Promise<{ default: Record<string, unknown> }>;

export const AUTH_STRING_LOADERS: Record<string, Loader> = {
  en: () => import("./en.json"),
  "en-GB": () => import("./en-GB.json"),
  de: () => import("./de.json"),
  es: () => import("./es.json"),
  fr: () => import("./fr.json"),
  "fr-CA": () => import("./fr.json"),
  hi: () => import("./hi.json"),
  nl: () => import("./nl.json"),
  pt: () => import("./pt.json"),
  tl: () => import("./tl.json"),
};

const loaded = new Set<string>();

/** Merge the auth strings for a language (and English) into i18next. Never throws. */
export async function loadAuthStrings(lng?: string | null): Promise<void> {
  const want = lng || i18n.language || "en";
  const base = want.split("-")[0];
  const codes = [AUTH_STRING_LOADERS[want] ? want : base, "en"];
  for (const code of codes) {
    if (!code || loaded.has(code)) continue;
    const loader = AUTH_STRING_LOADERS[code];
    if (!loader) continue;
    try {
      const mod = await loader();
      i18n.addResourceBundle(code, "translation", mod.default, true, true);
      loaded.add(code);
    } catch {
      /* the English defaults at each call site still render */
    }
  }
}

/**
 * Load the auth strings for the reader's language and re-render once they
 * are in (react-i18next does not re-render on an added bundle by itself).
 */
export function useAuthStrings(): boolean {
  const [ready, setReady] = useState(false);
  const { i18n: instance } = useTranslation();
  const lng = instance.language;
  useEffect(() => {
    let live = true;
    void loadAuthStrings(lng).then(() => { if (live) setReady(true); });
    return () => { live = false; };
  }, [lng]);
  return ready;
}
