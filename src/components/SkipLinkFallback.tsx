import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { installSkipLinkFallback, localiseSkipLink } from "@/lib/skip-link";

const SKIP_KEY = "siteShell.skipToMain";
const ENGLISH = "Skip to main content";

/** index.html's "Skip to main content" works on every page, not only the four
 *  that render #main-content (see installSkipLinkFallback), and speaks the
 *  reader's language once the app knows it (S14X-177). Mounted once in App. */
export function SkipLinkFallback(): null {
  const { t, i18n } = useTranslation();
  useEffect(() => installSkipLinkFallback(), []);

  // The lang is the language the words came from: the reader's once its
  // strings have loaded, English until then (a language loads after the
  // first render, and its arrival re-renders this through languageChanged).
  const lng = i18n?.language || "en";
  const own = i18n?.getResource?.(lng, "translation", SKIP_KEY);
  const lang = typeof own === "string" && own.trim() ? lng : "en";
  const text = t(SKIP_KEY, ENGLISH);
  useEffect(() => {
    localiseSkipLink(document, text, lang);
  }, [text, lang]);
  return null;
}
