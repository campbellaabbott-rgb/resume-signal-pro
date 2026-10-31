import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * THE FIRST RENDER WAITS FOR THE READER'S MAIN LOCALE.
 *
 * The homepage's and the pricing page's strings are string shards
 * (src/i18n/shards/home, src/i18n/shards/pricing): English rides in the
 * bundle with en.json, and every other language's shards land in the same
 * Promise.all as that language's main file (src/i18n/index.ts loadLocale).
 * Until a German main locale lands, t() falls back to English, so a page that
 * rendered at once would show an English frame and then swap into German
 * (CLS 0.18 at 375 px, measured on the homepage). Both pages render their
 * content only once this is true, and keep it mounted from then on
 * (useStickyReady), so a later language change never drops the reader's
 * focus.
 */

/** How long to wait for a main locale that may never load. */
export const MAIN_WAIT_MS = 6000;

/** True once the reader's main locale (and with it every shard) has landed, or after MAIN_WAIT_MS. */
export function useLocaleReady(): boolean {
  const { i18n } = useTranslation();
  const lng = i18n.language || "en";
  const has = () => lng === "en" || i18n.hasResourceBundle(lng, "translation");
  const [late, setLate] = useState<string | null>(null);
  useEffect(() => {
    if (lng === "en" || i18n.hasResourceBundle(lng, "translation")) return;
    const timer = setTimeout(() => setLate(lng), MAIN_WAIT_MS);
    const onAdded = (l: string) => {
      if (l === lng) setLate(lng);
    };
    i18n.store.on("added", onAdded);
    // A bundle that landed between the render and this effect fired no event we heard.
    if (i18n.hasResourceBundle(lng, "translation")) setLate(lng);
    return () => {
      clearTimeout(timer);
      i18n.store.off("added", onAdded);
    };
  }, [lng, i18n]);
  return has() || late === lng;
}
