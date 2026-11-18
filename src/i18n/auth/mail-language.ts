/**
 * THE LANGUAGE THE AUTH MAIL IS WRITTEN IN (S12-180). The mail is built by the
 * auth hook from the auth server's payload, which carries no locale, only the
 * link the page asked for. So the page names its language in that link, and
 * the hook reads it back from the redirect. English needs no parameter.
 *
 * Its own module (re-exported by src/contexts/AuthContext.tsx), so the account
 * page's security card can name the language in its mail too (S14X-236)
 * without reaching into the auth context's exports.
 */
import i18next from "i18next";
import { DEFAULT_AFTER_AUTH, safeNextPath } from "@/lib/auth-fragment";

export const MAIL_LANGUAGES: readonly string[] = ["en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"];
export function mailLanguageParam(lng: string | null | undefined = i18next.language): string {
  const want = String(lng ?? "");
  const code = MAIL_LANGUAGES.includes(want) ? want : MAIL_LANGUAGES.includes(want.split("-")[0]) ? want.split("-")[0] : null;
  return code ? `&lng=${encodeURIComponent(code)}` : "";
}

/** Where an emailed confirmation or sign-in link lands: the confirm step, which acts only on a press. */
export function confirmRedirect(next?: string | null): string {
  const safe = safeNextPath(next);
  const tail = safe === DEFAULT_AFTER_AUTH ? "" : `&next=${encodeURIComponent(safe)}`;
  return `${window.location.origin}/auth?mode=confirm${tail}${mailLanguageParam()}`;
}
