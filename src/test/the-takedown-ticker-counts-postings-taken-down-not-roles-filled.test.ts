// @vitest-environment node
/**
 * NB-47, THE OWNER'S NOUN (2026-11-15): "postings taken down in the last 24
 * hours".
 *
 * The /jobs ticker counted takedowns as "roles filled or closed", in every
 * language, while the About page says the site never claims a posting was
 * filled: a takedown is all the board sees. The ticker now says postings
 * taken down, in all nine languages, with the count placeholder and the
 * 24-hour window it had.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const LNGS = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
type Lng = (typeof LNGS)[number];
const ticker = (l: Lng): string => JSON.parse(readFileSync(resolve(ROOT, `src/i18n/locales/${l}.json`), "utf8"))?.jobsPage?.takedownsLast24h ?? "";

// "Filled" and "closed", as each language said them.
const FILLED_OR_CLOSED: Record<Lng, RegExp> = {
  en: /filled|closed|roles/i, "en-GB": /filled|closed|roles/i, de: /besetzt|geschlossen/i, es: /cubiert|cerrad/i,
  fr: /pourvu|fermé/i, hi: /भरी|बंद/, nl: /vervuld|gesloten/i, pt: /preenchid|fechad/i, tl: /napunan|nagsara/i,
};

describe("the takedown ticker counts postings taken down, not roles filled", () => {
  it("says no 'filled' and no 'closed' in any language, and keeps the count and the 24 hours", () => {
    for (const l of LNGS) {
      const v = ticker(l);
      expect(v, l).not.toMatch(FILLED_OR_CLOSED[l]);
      expect(v, `${l} keeps the count placeholder`).toContain("{{n}}");
      expect(v, `${l} names the window`).toContain("24");
    }
  });

  it("reads, in English, as the owner worded it", () => {
    expect(ticker("en")).toBe("{{n}} postings taken down in the last 24 hours");
    expect(ticker("en-GB")).toBe("{{n}} postings taken down in the last 24 hours");
  });
});
