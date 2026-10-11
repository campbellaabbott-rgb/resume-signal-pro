import { useEffect } from "react";
import i18n from "@/i18n";

/**
 * Keep <html lang> on the language a page is WRITTEN in (register L4-15).
 *
 * The bake writes lang="de" on /de/lebenslauf-standards/* (and the fr, pt, nl,
 * es CV pages and /es/industrias/*), but src/i18n/index.ts sets
 * documentElement.lang to the visitor's UI language at load, so once the app
 * ran, German text was announced to screen readers as English and the DOM
 * contradicted the page's own hreflang. A page with fixed-language content
 * calls this; leaving it hands the attribute back to the UI language.
 */
export function useDocumentLang(lang: string | null | undefined): void {
  useEffect(() => {
    if (!lang || typeof document === "undefined") return;
    const el = document.documentElement;
    el.lang = lang;
    return () => {
      el.lang = i18n.language || "en";
    };
  }, [lang]);
}
