import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { normalizeLanguageCode, languages } from "./index";

describe("normalizeLanguageCode", () => {
  it("returns an exact match unchanged", () => {
    expect(normalizeLanguageCode("es")).toBe("es");
    expect(normalizeLanguageCode("en-GB")).toBe("en-GB");
  });

  it("falls back to the base language for unsupported regional variants", () => {
    expect(normalizeLanguageCode("es-MX")).toBe("es");
    expect(normalizeLanguageCode("fr-BE")).toBe("fr");
  });

  it("falls back to English for entirely unsupported languages", () => {
    expect(normalizeLanguageCode("ja")).toBe("en");
    expect(normalizeLanguageCode("xx-YY")).toBe("en");
  });

  it("every declared language code normalizes to itself", () => {
    for (const { code } of languages) {
      expect(normalizeLanguageCode(code)).toBe(code);
    }
  });
});

describe("locale files", () => {
  // Regression test for a real bug: en.json (and 7 other locale files) had a
  // duplicate top-level "faq" key and a duplicate "socialProof" key. JSON.parse
  // silently keeps only the last occurrence, so the entire first "faq" block
  // (title, subtitle, all 8 Q&As) was discarded at runtime — the FAQ section
  // rendered raw translation keys like "faq.title" instead of real text, for
  // every language except the one untouched file. JSON.parse on the final object
  // can never catch this (it already hid the duplicate), so this test scans the
  // raw file text instead.
  const localesDir = join(dirname(fileURLToPath(import.meta.url)), "locales");
  const localeFiles = readdirSync(localesDir).filter((f) => f.endsWith(".json"));

  it("found at least one locale file to check", () => {
    expect(localeFiles.length).toBeGreaterThan(0);
  });

  for (const file of localeFiles) {
    it(`${file} has no duplicate top-level keys`, () => {
      const raw = readFileSync(join(localesDir, file), "utf8");
      const topLevelKeyPattern = /^ {2}"([a-zA-Z0-9_]+)":\s*[{[]/gm;
      const counts = new Map<string, number>();
      let match: RegExpExecArray | null;
      while ((match = topLevelKeyPattern.exec(raw))) {
        const key = match[1];
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      const duplicates = [...counts.entries()].filter(([, count]) => count > 1);
      expect(duplicates, `Duplicate top-level keys in ${file} (later occurrence silently overwrites earlier content): ${JSON.stringify(duplicates)}`).toEqual([]);
    });

    it(`${file} is valid, parseable JSON`, () => {
      const raw = readFileSync(join(localesDir, file), "utf8");
      expect(() => JSON.parse(raw)).not.toThrow();
    });
  }

  // Separate regression: every locale should have exactly the same set of leaf
  // keys as en.json. A key present in English but missing elsewhere falls back
  // silently (fallbackLng: 'en'), so it's lower severity than the duplicate-key
  // bug above, but it's still an untranslated string shown to users picking that
  // language — and it's exactly the kind of gap that's invisible unless checked
  // explicitly, since nothing throws or renders a raw key for it.
  function flattenKeys(obj: Record<string, unknown>, prefix = ""): string[] {
    let keys: string[] = [];
    for (const key of Object.keys(obj)) {
      const full = prefix ? `${prefix}.${key}` : key;
      const value = obj[key];
      if (value && typeof value === "object" && !Array.isArray(value)) {
        keys = keys.concat(flattenKeys(value as Record<string, unknown>, full));
      } else {
        keys.push(full);
      }
    }
    return keys;
  }

  const enKeys = new Set(flattenKeys(JSON.parse(readFileSync(join(localesDir, "en.json"), "utf8"))));

  /* A COPY CHANGE THAT LANDS IN ENGLISH BEFORE ITS TRANSLATION, DECLARED
   * RATHER THAN TOLERATED.
   *
   * A change whose ENGLISH half is owned by one workflow and whose seven other
   * locales are written by a later pass leaves this guard red for the length of
   * the window between them — and a guard left red is a guard someone
   * eventually deletes, taking the check for the NEXT missing key with it. So
   * the window is declared here instead, and it is bounded exactly the three
   * ways this repository already bounds the same exemption in
   * explore-claims.test.ts:
   *
   *   1. It is an EXPLICIT LIST of keys, not a prefix or a pattern. A key that
   *      is not on it still fails, in every locale.
   *   2. It is CAPPED. A list that can grow to the size of the gap is not a
   *      bound, it is a mute button.
   *   3. It CANNOT OUTLIVE ITS REASON: once the locale pass lands a key
   *      everywhere (or removes a retired one everywhere), the entry has to
   *      come off or the assertion below goes red. The exemption expires on its
   *      own rather than being remembered.
   *
   * A key on PENDING_TRANSLATION renders its inline English default in the
   * languages that lack it: a true sentence in the wrong language, which is a
   * degradation, not a raw key and not a stale claim. A key on RETIRED_PENDING
   * is the opposite direction — deleted from en.json, still orphaned in the
   * other files, called by nothing, so it renders nowhere.
   *
   * ── 2026-09-09, the /explore field rows — WINDOW CLOSED ──────────────────
   * The grid became a list of rows with a bar on each (new copy for the bar's
   * scale and for the point where the cumulative count passes half), and the
   * clause describing the uncategorised bucket changed MEANING: it said those
   * were "the roles whose field we could not read from the title", which blames
   * the employer's title for a coverage gap in OUR OWN rule set — categorize()
   * returns "other" when no regex of ours matched, and that vocabulary is
   * frozen at v9 by design. Every affected sentence took a NEW key, because a
   * locale VALUE beats an inline English default and editing one in place would
   * have left seven languages making the claim the page stopped making.
   *
   * That window is CLOSED: all fourteen new keys landed in all nine locales and
   * all nine retired keys came out of all nine, so both lists are empty and the
   * parity check below is back at full strength — no key is exempt. The lists
   * stay declared, empty, because the mechanism is the part worth keeping: the
   * next English-first change declares its window here instead of leaving this
   * file red, and the assertion above is what forces it back to empty again.
   *
   * ── 2026-09-09, "Actively hiring" is back and the department box is gone ──
   * CLOSED. The hiring filter's label went back to "Actively hiring" by owner
   * decision with its measure unchanged (takedowns we watched over 90 days, not
   * hires, not yet new postings), so every string that carries the label or
   * states its basis took a NEW key — a locale VALUE beats an inline default,
   * and editing the takedown* values in place would have left seven languages
   * naming a control that no longer exists. The nine new keys (hiringFilter2,
   * hiringFilterTip2, chipHiring2, hiringBadge2, hiringBadgeTip2, hiringBasis2,
   * hiringSetAside2, savedWithoutHiringFilter2, departmentChip2) landed in all
   * nine locales, and the eleven retired keys (the takedown* family,
   * hhBadgeTipObserved, the three department-box keys) came out of all nine, in
   * the same change — so both lists are empty and no key is exempt.
   */
  /* ── 2026-09-10, the locale-capable pass ──────────────────────────────────
   * CLOSED. Seven new keys, each minted because a sentence's MEANING changed
   * or a number gained a basis:
   *   jobsPage.vendorTip2         the vendor tooltip now says what the number
   *                               beside each source is (vendorTip retired)
   *   jobsPage.vendorCountsBasis  the basis line on the vendor control, {{when}}
   *   jobsPage.discWorkMode2      same words, the number under it is now the
   *                               postings that state NO mode (discWorkMode
   *                               retired — it counted stated hybrid/on-site
   *                               rows as "don't say")
   *   jobsPage.coverageEmploymentType  the eleventh coverage clause, {{pct}}
   *   jobsPage.filterName.employmentType  the filter's name for the ignored-
   *                               filters warning
   *   jobsPage.hiddenByViews      what Saved / Hide viewed / Hide applied took
   *                               off the page, {{count}} {{views}}
   *   boardHero.rankCta2          the hero's second CTA says what happens
   *                               (a résumé drop) instead of promising a rank
   * The translations landed in all nine locales in the same change (the
   * window this file opened for them expired the moment they did — the
   * assertion below flagged every key, which is the mechanism working), and
   * the four retired keys (vendorTip, discWorkMode, welcomeFillers — called by
   * nothing since the welcome panel reuses hiringFilter2 — and rankCta, which
   * was never in a locale file) came out of all nine. Both lists are empty. */
  const PENDING_TRANSLATION: string[] = [];
  const RETIRED_PENDING: string[] = [];
  const PARITY_EXEMPTION_CAP = 40;

  it("the translation window is bounded and cannot outlive its reason", () => {
    expect(PENDING_TRANSLATION.length + RETIRED_PENDING.length,
      `the parity exemption has grown past ${PARITY_EXEMPTION_CAP} keys — run the locale pass instead of widening this`)
      .toBeLessThanOrEqual(PARITY_EXEMPTION_CAP);
    // English is the source of every inline default: a key exempted from the
    // OTHER locales must still exist here, or the exemption would be hiding a
    // key that exists nowhere at all.
    for (const k of PENDING_TRANSLATION) {
      expect(enKeys.has(k), `${k} is exempted from translation but is not in en.json either`).toBe(true);
    }
    for (const k of RETIRED_PENDING) {
      expect(enKeys.has(k), `${k} is listed as retired but is still in en.json`).toBe(false);
    }
    // …and once the pass has landed, the entry has to come off.
    const others = localeFiles.filter((f) => f !== "en.json");
    const landed = PENDING_TRANSLATION.filter((k) => others.every((f) =>
      new Set(flattenKeys(JSON.parse(readFileSync(join(localesDir, f), "utf8")))).has(k)));
    expect(landed, `translated everywhere now — remove from PENDING_TRANSLATION: ${landed.join(", ")}`).toEqual([]);
    const cleared = RETIRED_PENDING.filter((k) => others.every((f) =>
      !new Set(flattenKeys(JSON.parse(readFileSync(join(localesDir, f), "utf8")))).has(k)));
    expect(cleared, `removed everywhere now — remove from RETIRED_PENDING: ${cleared.join(", ")}`).toEqual([]);
  });

  for (const file of localeFiles) {
    if (file === "en.json") continue;

    it(`${file} has the same translation keys as en.json (no missing, no extra)`, () => {
      const keys = new Set(flattenKeys(JSON.parse(readFileSync(join(localesDir, file), "utf8"))));
      const missing = [...enKeys].filter((k) => !keys.has(k) && !PENDING_TRANSLATION.includes(k));
      const extra = [...keys].filter((k) => !enKeys.has(k) && !RETIRED_PENDING.includes(k));
      expect(missing, `${file} is missing keys present in en.json (will silently fall back to English text)`).toEqual([]);
      expect(extra, `${file} has keys not present in en.json (likely a typo, or en.json itself is missing this key)`).toEqual([]);
    });
  }
});

// Changelog strings live OUTSIDE the eagerly-bundled locale files (2026-07-26:
// they were 81KB of a 270KB en.json that every visitor downloaded on every
// route, for a page almost nobody opens). They still have to stay in lockstep
// across languages, and every id in src/data/changelog.ts must have copy — a
// missing entry renders the raw key to a user.
describe("changelog string files (lazy-loaded, still must be complete)", () => {
  const clDir = join(dirname(fileURLToPath(import.meta.url)), "changelog");
  const clFiles = readdirSync(clDir).filter((f) => f.endsWith(".json"));
  const enCl = JSON.parse(readFileSync(join(clDir, "en.json"), "utf8")) as { changelogEntries: Record<string, { title: string; description: string }> };

  it("ships one file per shipped locale", () => {
    expect(clFiles.length).toBeGreaterThanOrEqual(9);
    expect(clFiles).toContain("en.json");
  });

  it("every locale has the same entry ids as English", () => {
    const enIds = Object.keys(enCl.changelogEntries).sort();
    for (const file of clFiles) {
      const d = JSON.parse(readFileSync(join(clDir, file), "utf8")) as typeof enCl;
      expect({ file, ids: Object.keys(d.changelogEntries).sort() }).toEqual({ file, ids: enIds });
    }
  });

  it("every entry has a non-empty title and description in every locale", () => {
    for (const file of clFiles) {
      const d = JSON.parse(readFileSync(join(clDir, file), "utf8")) as typeof enCl;
      for (const [id, e] of Object.entries(d.changelogEntries)) {
        expect({ file, id, ok: !!e.title?.trim() && !!e.description?.trim() }).toEqual({ file, id, ok: true });
      }
    }
  });

  it("no changelog copy is left behind in the main locale bundle", () => {
    const localesDir2 = join(dirname(fileURLToPath(import.meta.url)), "locales");
    for (const file of readdirSync(localesDir2).filter((f) => f.endsWith(".json"))) {
      const d = JSON.parse(readFileSync(join(localesDir2, file), "utf8")) as Record<string, unknown>;
      expect({ file, hasChangelog: "changelogEntries" in d }).toEqual({ file, hasChangelog: false });
    }
  });
});
