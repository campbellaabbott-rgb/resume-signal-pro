/**
 * SEO CHECK 2026-11-15, F28 (TPL-07): A POSTING PAGE NAMES ITS LANGUAGE ONLY
 * WHEN THE TEXT SAYS SO CLEARLY.
 *
 * /jobs/posting/smartrecruiters/JYSK/744000157667379 is a Czech JYSK posting
 * (a sales assistant in Olomouc) and its page said <html lang="pt">. The
 * language reader counted each listed language's common words and named the
 * leader once it had twelve hits and twice the runner-up. Czech was on no
 * list, and its prepositions are spelled like two Portuguese words, so the
 * Portuguese count was 15 (one word 13 times) and nothing else scored: a lead
 * of one shared word read as Portuguese. The same rule called Norwegian,
 * Swedish and Danish postings French (their "et" and "du"), and Polish and
 * Slovak ones Portuguese.
 *
 * The rule now (src/components/jobs/posting-page.ts, postingLanguage):
 *   - a lead counts only when it is spread over at least five different words
 *     of that language's list, so one or two words another language also uses
 *     never name a language;
 *   - Czech, Slovak, Polish, Danish, Norwegian and Swedish have lists of their
 *     own, made of words the other lists do not share, so those postings are
 *     read as themselves where the text is clear (and French's list no longer
 *     counts the two words it shared with Danish and Norwegian);
 *   - anything else answers null, and the page keeps the site's own language.
 *
 * CORPUS FIRST: the reader is a heuristic that has failed a recheck before
 * (SEO-034 served every page lang="en"; then an all-Chinese page), so the fix
 * is judged on src/test/fixtures/posting-language-corpus-2026-11-15.json: 463
 * real postings, labelled, in 21 languages (our own sitemap's posting pages,
 * and public SmartRecruiters postings for JYSK and BoschGroup in 17 countries),
 * with the old rule's answer on each. The fix may never be worse than the old
 * rule on any case, and may never name a language a text is not written in.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { postingLanguage } from "@/components/jobs/posting-page";

type Case = { id: string; truth: string; mainAnswer: string | null; text: string };
const CORPUS = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/posting-language-corpus-2026-11-15.json"), "utf8"),
) as { about: string; cases: Case[] };
const CASES = CORPUS.cases;

/**
 * 2 = right, 1 = no answer (the page keeps the site's English: safe), 0 =
 * a language the text is not written in. On an English text no answer is right.
 */
const grade = (answer: string | null, truth: string): 0 | 1 | 2 =>
  truth === "en" ? (answer === null || answer === "en" ? 2 : 0) : answer === truth ? 2 : answer === null ? 1 : 0;
const byId = (suffix: string): Case => {
  const c = CASES.find((x) => x.id.endsWith(suffix));
  if (!c) throw new Error(`no corpus case ends with ${suffix}`);
  return c;
};

describe("the recheck input: the Czech JYSK posting", () => {
  const c = byId("/jobs/posting/smartrecruiters/JYSK/744000157667379");
  it("was read as Portuguese by the old rule", () => {
    expect(c.truth).toBe("cs");
    expect(c.mainAnswer).toBe("pt");
  });
  it("is read as Czech, never Portuguese", () => {
    expect(postingLanguage(c.text)).not.toBe("pt");
    expect(postingLanguage(c.text)).toBe("cs");
  });
});

describe("a lead made of one or two shared words is no lead", () => {
  it("a Norwegian posting the old rule called French is not French", () => {
    const c = byId("smartrecruiters:JYSK:no:744000161396539");
    expect(c.mainAnswer).toBe("fr");
    expect(postingLanguage(c.text)).not.toBe("fr");
    expect([null, "no"]).toContain(postingLanguage(c.text));
  });
  it("a Romanian posting is named nothing: one Romanian word spelled like a Slovak one leads Slovak, and that is not enough", () => {
    const c = byId("smartrecruiters:JYSK:ro:744000160615629");
    expect(postingLanguage(c.text)).toBeNull();
  });
  it("a Polish posting the old rule called Portuguese is Polish or nothing", () => {
    const wrongBefore = CASES.filter((x) => x.truth === "pl" && x.mainAnswer === "pt");
    expect(wrongBefore.length).toBeGreaterThan(0);
    for (const c of wrongBefore) expect([null, "pl"], c.id).toContain(postingLanguage(c.text));
  });
});

/**
 * A RUNNER-UP MADE OF ONE OR TWO WORDS DOES NOT BLOCK A LEAD EITHER (review of
 * 2026-11-15). The five-word floor applied only to the leader, so a French
 * posting whose Dutch count was two words French also writes ("en", 16 times
 * in Groupe MIRADOR's "Analyste en planification financière") was refused for
 * a lead under two to one, and fell back to the site's English: 25 French
 * postings the old rule read as French answered null, several written in
 * French alone. The leader is compared only with a runner-up that reaches the
 * same floor.
 */
describe("a runner-up made of one or two shared words does not block a lead", () => {
  it.each(["lever:gorh:733aee27-ff1c-4015-8ecc-cb740f2186c8", "lever:gorh:507f0229-bfaf-465c-b982-900f5c0d9850"])(
    "Groupe MIRADOR's French posting %s is read as French",
    (id) => {
      const c = byId(id);
      expect(c.truth).toBe("fr");
      expect(postingLanguage(c.text)).toBe("fr");
    },
  );
});

describe("the labelled corpus", () => {
  it("is at least 300 real postings, in more than the seven languages the old lists knew", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(300);
    const langs = new Set(CASES.map((c) => c.truth));
    for (const l of ["cs", "sk", "pl", "da", "no", "sv", "fi", "hu", "ro", "hr", "sl"]) expect(langs.has(l), l).toBe(true);
  });

  it("is never answered worse than the old rule answered it, on any case", () => {
    const worse = CASES.map((c) => ({ c, now: postingLanguage(c.text) }))
      .filter(({ c, now }) => grade(now, c.truth) < grade(c.mainAnswer, c.truth))
      .map(({ c, now }) => `${c.id}: ${c.truth}, was ${c.mainAnswer}, now ${now}`);
    expect(worse).toEqual([]);
  });

  it("never names a language a posting is not written in", () => {
    const wrong = CASES.map((c) => ({ c, now: postingLanguage(c.text) }))
      .filter(({ c, now }) => grade(now, c.truth) === 0)
      .map(({ c, now }) => `${c.id}: written in ${c.truth}, named ${now}`);
    expect(wrong).toEqual([]);
  });

  it("reads Czech, Slovak, Polish, Swedish, Danish and Norwegian postings as themselves where the old rule could not", () => {
    for (const lang of ["cs", "sk", "pl", "sv", "da", "no"]) {
      const right = CASES.filter((c) => c.truth === lang && postingLanguage(c.text) === lang);
      expect(right.length, lang).toBeGreaterThan(0);
    }
  });

  it("names nothing for a language it has no list for (Finnish, Hungarian, Croatian, Slovenian, Romanian)", () => {
    for (const c of CASES.filter((x) => ["fi", "hu", "hr", "sl", "ro"].includes(x.truth))) {
      expect(postingLanguage(c.text), c.id).toBeNull();
    }
  });
});
