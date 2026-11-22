// @vitest-environment node
/**
 * A CUT PRODUCT'S SENTENCE PROMISES NO DAYS NOTHING KEEPS (S14X-143, owner
 * pick B).
 *
 * Every language's cut-product sentence told a past buyer their link keeps
 * working for 90 days, and nothing enforced it: a claim never ages. The
 * promise is dropped instead of enforced: each pastBuyers line says the link
 * keeps working and names no day count, and the whole sentence still reads
 * opening, past buyers, then where the help now lives.
 */
import { describe, expect, it } from "vitest";
import { CUT_LINES, CUT_PRODUCT_IDS, CUT_PRODUCTS, cutSentence, PAST_BUYER_DAYS } from "../../supabase/functions/_shared/product-cuts";

const LANGUAGES = Object.keys(CUT_LINES) as Array<keyof typeof CUT_LINES>;

describe("the past buyers' line", () => {
  it("is there in every language the checkouts answer in", () => {
    expect(LANGUAGES.length).toBeGreaterThanOrEqual(8);
  });

  for (const lng of LANGUAGES) {
    it(`${lng}: names no day count`, () => {
      const line = CUT_LINES[lng].pastBuyers;
      expect(line.trim().length).toBeGreaterThan(10);
      expect(line).not.toMatch(/\d/);
      expect(line).not.toContain(String(PAST_BUYER_DAYS));
    });

    it(`${lng}: every cut product's sentence keeps its three parts, in order`, () => {
      const l = CUT_LINES[lng];
      for (const id of CUT_PRODUCT_IDS) {
        const cut = CUT_PRODUCTS[id];
        expect(cutSentence(id, lng as never)).toBe(`${l.opening(cut.name)} ${l.pastBuyers} ${l[cut.tail]}`);
        expect(cutSentence(id, lng as never)).not.toMatch(/\b90\b/);
      }
    });
  }
});
