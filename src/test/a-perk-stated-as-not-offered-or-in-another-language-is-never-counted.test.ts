// @vitest-environment node
/**
 * A PERK STATED AS NOT OFFERED, OR IN ANOTHER LANGUAGE, IS NEVER COUNTED
 * (sweep S12-091 and S12-187; supabase/functions/_shared/perks-extract.ts).
 *
 * S12-091: "This temporary position does not include medical, dental, or
 * vision benefits" read dental and vision as offered (Y), and the checkmark
 * would have quoted that very sentence as the evidence: the clause split left
 * "dental" without its verb and the look-back stopped at the comma. A
 * negation that governs the list the hit sits in now makes the posting read
 * N, so the perk is neither counted nor quoted as an offer.
 *
 * S12-187: the English test is per posting, so an English posting with a
 * German benefits block was counted and quoted from the German lines ("30
 * Tage Urlaub im Jahr"), which nothing has measured. A key is now read only
 * from lines written in English.
 *
 * The held-out split (the-perk-reader-keeps-the-precision-it-was-measured-at)
 * re-measured unchanged: 272 of 318, 21 false. The controls below are the
 * shapes the scope must not swallow: a contrast ("we do not offer a pension,
 * but we provide medical"), a sentence that ends before the list, and a pay
 * range's own scope ("the range does not include bonus or equity").
 */
import { describe, expect, it } from "vitest";
import {
  EXTRACTOR_VERSION, PERK_BIT, extract, isEnglishText, isOtherLanguageLine, listNegated, readPosting, type PerkKey,
} from "../../supabase/functions/_shared/perks-extract";

const ABOUT = "About us\nWe build software for logistics companies across the country, and we care about craft, kindness and shipping work that matters to the people who rely on it every single day. We are hiring engineers who will join our team and work with us on the platform that our customers use.";
const bit = (r: ReturnType<typeof readPosting>, k: PerkKey) => ({
  y: ((r.y >> PERK_BIT[k]) & 1) === 1, q: ((r.q >> PERK_BIT[k]) & 1) === 1, n: ((r.n >> PERK_BIT[k]) & 1) === 1, quote: r.quotes[PERK_BIT[k]],
});
const offered = (r: ReturnType<typeof readPosting>, k: PerkKey) => bit(r, k).y || bit(r, k).q;

describe("S12-091: a negation that governs a list makes every item in it N", () => {
  it("temp boilerplate: dental and vision are stated as not included, and never quoted as offered", () => {
    const r = readPosting("Temporary Warehouse Associate", `${ABOUT}\nAbout the role\nThis is a temporary assignment of 12 weeks.\nPlease note: this temporary position does not include medical, dental, or vision benefits, and is not eligible for paid time off.\nWhat we offer\nWeekly pay and a 401(k) plan with a company match.`);
    for (const k of ["dental", "vision"] as PerkKey[]) {
      expect(offered(r, k), `${k} read as offered`).toBe(false);
      expect(bit(r, k).n, `${k} is stated as not offered`).toBe(true);
    }
    expect(offered(r, "retire"), "the offered 401(k) in the next sentence is untouched").toBe(true);
  });

  it("'not eligible for health, dental or vision insurance' is N, not a hedge", () => {
    const r = readPosting("Seasonal Associate", `${ABOUT}\nBenefits\nSeasonal associates are not eligible for health, dental or vision insurance.\nEmployee discount on all products`);
    expect(offered(r, "dental")).toBe(false);
    expect(offered(r, "vision")).toBe(false);
    expect(bit(r, "dental").n).toBe(true);
  });

  it("the scope itself: a cue before with list text between, and a cue after", () => {
    const s1 = "This role does not include medical, dental, or vision benefits.";
    expect(listNegated(s1, s1.indexOf("dental"), 6)).toBe(true);
    const s2 = "Medical, dental and vision benefits are not offered for this contract role.";
    expect(listNegated(s2, 0, 7)).toBe(true);
    const s3 = "No medical, dental or vision coverage is provided.";
    expect(listNegated(s3, s3.indexOf("vision"), 6)).toBe(true);
  });

  it("controls: a contrast, a sentence end and a pay range's scope are not denials", () => {
    const contrast = readPosting("Engineer", `${ABOUT}\nWhat we offer\nWe do not offer a pension, but we provide medical, dental and vision insurance.`);
    for (const k of ["health", "dental", "vision"] as PerkKey[]) expect(offered(contrast, k), k).toBe(true);
    const ended = "Comprehensive group benefits with no waiting period. Take advantage of coverage for health, vision, dental, and more for you and your family!";
    expect(listNegated(ended, ended.indexOf("dental"), 6), "the negation ended with its sentence").toBe(false);
    const range = "The range represents base salary only, and does not include company bonus, incentive for sales roles, equity or benefits, as applicable.";
    expect(listNegated(range, range.indexOf("equity"), 6), "the range's scope, not a denial of equity").toBe(false);
    const plain = readPosting("Engineer", `${ABOUT}\nWhat we offer\nComprehensive medical, dental and vision insurance for you and your family`);
    expect(offered(plain, "dental")).toBe(true);
    expect(bit(plain, "dental").quote).toBe("Comprehensive medical, dental and vision insurance for you and your family");
  });

  it("the extractor reads N for the list, so the aggregate keeps N only where nothing positive is stated", () => {
    const e = extract("Temporary Associate", `${ABOUT}\nBenefits\nThis temporary role does not include dental or vision.\nWe offer dental insurance after conversion to a permanent role.`);
    expect(e.perks.dental, "a positive statement elsewhere still wins").not.toBe("N");
    expect(e.perks.vision).toBe("N");
  });
});

describe("S12-187: each quote's own language", () => {
  const MIXED = `${ABOUT}\nWhat we offer in the US\nPrivate health insurance for you and your family\nBenefits in Germany\n30 Tage Urlaub im Jahr\nBetriebliche Altersvorsorge mit Arbeitgeberzuschuss\nKrankenzusatzversicherung für dich`;

  it("an English posting with a German block: the German lines are neither counted nor quoted", () => {
    expect(isEnglishText(MIXED), "the posting as a whole reads as English").toBe(true);
    const e = extract("Software Engineer", MIXED);
    expect(e.perks.pto, "positive control: the extractor reads the German leave line").toBeTruthy();
    expect(e.perks.retire, "and the German pension line").toBeTruthy();
    const r = readPosting("Software Engineer", MIXED);
    expect(offered(r, "pto")).toBe(false);
    expect(bit(r, "pto").quote).toBeNull();
    expect(offered(r, "retire")).toBe(false);
    expect(bit(r, "retire").quote).toBeNull();
    expect(offered(r, "health"), "the English line still counts").toBe(true);
    expect(bit(r, "health").quote).toBe("Private health insurance for you and your family");
  });

  it("the line test: another language's words or script, and nothing on a bare English line", () => {
    expect(isOtherLanguageLine("30 Tage Urlaub im Jahr")).toBe(true);
    expect(isOtherLanguageLine("Betriebliche Altersvorsorge mit Arbeitgeberzuschuss")).toBe(true);
    expect(isOtherLanguageLine("Mutuelle d'entreprise et prévoyance")).toBe(true);
    expect(isOtherLanguageLine("健康保险和带薪休假")).toBe(true);
    expect(isOtherLanguageLine("Dental insurance")).toBe(false);
    expect(isOtherLanguageLine("Comprehensive medical, dental and vision insurance for you and your family")).toBe(false);
    expect(isOtherLanguageLine("25 days annual leave plus bank holidays")).toBe(false);
  });

  it("the extractor version moved, so every stored read is read again", () => {
    expect(EXTRACTOR_VERSION).toBeGreaterThanOrEqual(2);
  });
});
