// @vitest-environment node
/**
 * NB-11, THE PROPOSED WORDING (the owner's choice of 2026-11-15): the Pro card
 * stops calling the writing tools Pro's, since a free account has one of each
 * a day by design.
 *
 * The card's badge read "Writing tools" in every language. It now names the
 * plan, "Pro", in all nine (a product name, the same in every language). The
 * card's other lines take new keys in the payments lane's strings, and the
 * last test reads the card for its member line: it FAILS on this branch until
 * the payments lane's card is merged under it, so the badge and the lines
 * beside it change in one merge.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const LNGS = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
const badge = (l: string): unknown => JSON.parse(readFileSync(resolve(ROOT, `src/i18n/locales/${l}.json`), "utf8"))?.proPlan?.badge;

describe("the Pro card's badge names the plan, not the writing tools", () => {
  it("reads 'Pro' in all nine languages", () => {
    for (const l of LNGS) expect(badge(l), l).toBe("Pro");
  });

  it("the card's member line counts the writing packages instead of saying the tools are unlocked", () => {
    const card = readFileSync(resolve(ROOT, "src/components/ProSubscriptionCard.tsx"), "utf8");
    expect(card, "the payments lane's card must merge first").toMatch(/t\(\s*"payments\.pro\.activeMemberPackages"/);
    expect(card).not.toMatch(/t\(\s*"proPlan\.activeMember"/);
  });
});
