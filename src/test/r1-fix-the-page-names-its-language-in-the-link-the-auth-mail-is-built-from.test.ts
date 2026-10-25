/**
 * R1 FIX (S12-180): THE PAGE NAMES ITS LANGUAGE IN THE LINK THE AUTH MAIL IS
 * BUILT FROM.
 *
 * The auth hook's payload carries no locale, only the redirect the page asked
 * for, so every auth mail went out in English. The sign-in page now names its
 * language in that redirect (&lng=de), and auth-email-hook writes the mail in
 * it (r1-mail-the-hook-prints-the-code-and-a-link-a-scanner-cannot-spend runs
 * the hook end to end). English needs no parameter.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: {}, functions: {} } }));
vi.mock("@/integrations/lovable", () => ({ lovable: { auth: {} } }));

import { confirmRedirect, mailLanguageParam } from "@/contexts/AuthContext";

describe("the language parameter", () => {
  it("names each language the site speaks but English, and folds a region into its base", () => {
    expect(mailLanguageParam("en")).toBe("");
    expect(mailLanguageParam("en-US")).toBe("");
    expect(mailLanguageParam("en-GB")).toBe("&lng=en-GB");
    expect(mailLanguageParam("fr-CA")).toBe("&lng=fr");
    for (const l of ["de", "es", "fr", "hi", "nl", "pt", "tl"]) expect(mailLanguageParam(l)).toBe(`&lng=${l}`);
    expect(mailLanguageParam("xx")).toBe("");
    expect(mailLanguageParam(null)).toBe("");
  });

  it("rides the confirmation link's redirect, after the safe next", async () => {
    const i18next = (await import("i18next")).default;
    const was = i18next.language;
    Object.defineProperty(i18next, "language", { value: "de", configurable: true, writable: true });
    try {
      expect(confirmRedirect("/jobs")).toBe(`${window.location.origin}/auth?mode=confirm&next=%2Fjobs&lng=de`);
      expect(confirmRedirect(null)).toBe(`${window.location.origin}/auth?mode=confirm&lng=de`);
    } finally {
      Object.defineProperty(i18next, "language", { value: was, configurable: true, writable: true });
    }
  });
});
