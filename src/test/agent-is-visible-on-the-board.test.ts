import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE $99/MO PRODUCT WAS INVISIBLE ON THE BIGGEST SURFACE OF THE SITE.
 *
 * Measured on /jobs at 1280x800: the word "agent" appeared exactly twice in the
 * rendered page — once as an unlabelled filter checkbox, once inside a job
 * title ("County Extension Agent - 4-H"). The strings "$99", "Morning Queue"
 * and "free trial" appeared ZERO times. On mobile the word appeared not at all,
 * because the filter row collapses behind a button.
 *
 * It compounded with a second defect: 59 of the 60 default rows were Workday,
 * which the agent cannot drive, so the per-card "Agent can apply" badge never
 * fired on the one screen every visitor sees. Weaving employers into page 1
 * fixed that half; this is the other.
 *
 * WHAT THIS FILE PROTECTS is not the copy but its HONESTY. A pitch on a board
 * whose whole positioning is measured claims has to be countable:
 *
 *   - the number comes from the same predicate as the badges on the cards, so a
 *     sceptic can count the badges and get the same figure
 *   - it renders only when there is at least one; "0 of these" is worse than
 *     silence
 *   - the 6% scope and the CAPTCHA boundary are stated, not buried — a customer
 *     who discovers the limit after paying is a refund and a bad review
 */
const SRC = readFileSync(resolve(__dirname, "../pages/Jobs.tsx"), "utf8");

describe("the apply agent is visible on the board, with countable claims", () => {
  it("counts agent-ready rows with the SAME predicate as the card badge", () => {
    // If the pitch counted differently from the badges, a visitor could count
    // the Sparkles on screen and get a different number from the sentence above
    // them — which on this product is worse than not mentioning it at all.
    const memo = /const agentReadyOnPage = useMemo\(([\s\S]{0,240}?)\);/.exec(SRC)?.[1] ?? "";
    expect(memo, "agentReadyOnPage memo not found").not.toBe("");
    expect(
      memo.includes("isSendableVendor(j.id)"),
      "the pitch count must use isSendableVendor — the same function the " +
        "per-card badge uses",
    ).toBe(true);
  });

  it("says nothing when there is nothing to say", () => {
    // A pitch reading "the agent can apply to 0 of these" advertises the
    // product's limit at the moment of highest doubt.
    expect(SRC).toMatch(/\{agentReadyOnPage > 0 && !agentOnly && \(/);
  });

  it("states the price and the trial", () => {
    // These appeared ZERO times on the board before.
    expect(SRC).toMatch(/\$99\/mo/);
    expect(SRC).toMatch(/7 days free/);
  });

  it("states the scope limit rather than implying whole-board coverage, as a derived figure", () => {
    // The scope sentence names a vendor count and a board share; both are
    // INTERPOLATED from the deployed bundle's own status read (use-agent-reach),
    // never typed — the typed version said "four … 6%" while the list held
    // five and the live share was 8.2%. Judged over comment-stripped source:
    // the previous spelling pins here were satisfied by a comment alone after
    // the copy moved to the hook (project_guard_literals).
    const code = SRC.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    expect(code).toMatch(/\{\{n\}\} hiring systems — about \{\{pct\}\}% of the board/);
    expect(code, "a typed vendor count on the board's pitch").not.toMatch(/\b(?:four|five|six|seven|\d+) hiring systems/);
    expect(code, "a typed board share on the board's pitch").not.toMatch(/about \d+% of the board/);
  });

  it("states the CAPTCHA boundary as a promise, not an omission", () => {
    // It is a permanent product boundary and a differentiator. Leaving it out
    // would let a buyer assume the agent applies everywhere.
    expect(SRC).toMatch(/never on sites that gate applications behind a CAPTCHA/);
    expect(SRC).toMatch(/prepares the application and you send it/);
  });

  it("links to the page where the agent is actually set up", () => {
    // mandates is 0: nobody has ever completed setup. A pitch that does not
    // reach the setup screen cannot change that.
    // Sliced by index, not by a width-capped regex — the first draft used
    // [\s\S]{0,1600} and the block is longer than that, so the assertion
    // failed on correct code. A fixed-width window is a recurring way these
    // guards end up asserting nothing, or the wrong thing.
    const start = SRC.indexOf("{agentReadyOnPage > 0 && !agentOnly && (");
    expect(start, "pitch block not found").toBeGreaterThan(-1);
    const block = SRC.slice(start, SRC.indexOf("agentPitchScope", start));
    expect(block).toMatch(/to="\/agent"/);
  });
});
