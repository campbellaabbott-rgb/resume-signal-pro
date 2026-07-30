import { describe, expect, it } from "vitest";
import {
  automationFor,
  automationLabel,
  isFullyAutomatable,
} from "../../supabase/functions/job-board/apply-automation.ts";

// This table is a MEASUREMENT (2026-07-29, 298 real apply URLs), and the risk
// with a measurement written down as code is that it quietly becomes folklore.
// These guards hold the two properties that keep it honest: an unmeasured vendor
// never claims to be automatable, and a thin sample stays visibly thin.
describe("apply automation tiers reflect what was actually measured", () => {
  it("classifies the zero-CAPTCHA vendors as fully automatable", () => {
    for (const v of ["greenhouse", "smartrecruiters", "bamboohr", "workable", "breezy", "recruitee"]) {
      expect(isFullyAutomatable(v), `${v} measured 0 captcha`).toBe(true);
    }
  });

  it("classifies the CAPTCHA vendors as needing one human click", () => {
    // ashby 10/10 and lever 6/6 carried reCAPTCHA on every sampled posting.
    for (const v of ["ashby", "lever", "icims"]) {
      expect(automationFor(v).tier).toBe("click");
      expect(isFullyAutomatable(v)).toBe(false);
    }
  });

  it("does NOT claim Workday is CAPTCHA-free, because that was never measured", () => {
    // Workday renders 0 visible words to a static fetch — its "0%" was an
    // artifact of the instrument, exactly like the count that tracked the page
    // size earlier the same day. Recording it as `auto` would launder a
    // non-measurement into a product promise on 52% of the board.
    const f = automationFor("workday");
    expect(f.tier).toBe("signup");
    expect(f.sampled, "sampled must be 0 — the probe could not see the page").toBe(0);
    expect(isFullyAutomatable("workday")).toBe(false);
    expect(f.note).toMatch(/NOT measured/i);
  });

  it("an unmeasured vendor claims nothing", () => {
    for (const v of ["jobvite", "successfactors", "", "  ", "phenom"]) {
      const f = automationFor(v);
      expect(f.tier).toBe("unknown");
      expect(f.sampled).toBe(0);
      expect(isFullyAutomatable(v)).toBe(false);
    }
  });

  it("survives prototype-reachable keys", () => {
    // Record<string, T> indexing reaches Object.prototype: "constructor" returns
    // a function and `??` does not catch it. Three separate defects in this
    // codebase have had exactly this shape (NAME_FIXES, CATEGORY_ACCENT,
    // VENDOR_MODE), which is why the table is a Map.
    for (const k of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
      const f = automationFor(k);
      expect(f.tier, `${k} must not resolve to a prototype member`).toBe("unknown");
      expect(typeof f.tier).toBe("string");
    }
  });

  it("normalises casing and whitespace like every other vendor lookup", () => {
    expect(automationFor("  GreenHouse ").tier).toBe("auto");
    expect(automationFor("ASHBY").tier).toBe("click");
  });

  it("only Greenhouse claims real published questions", () => {
    // Verified 2026-07-14 and unchanged: Greenhouse is the one vendor exposing a
    // posting's actual application questions publicly. Ashby publishes its
    // posting API but the agent reads real questions only where the fetch is
    // wired; everywhere else the form is inferred and must say so.
    expect(automationFor("greenhouse").realQuestions).toBe(true);
    for (const v of ["smartrecruiters", "bamboohr", "workable", "lever", "workday", "breezy"]) {
      expect(automationFor(v).realQuestions, `${v} must not claim real questions`).toBe(false);
    }
  });

  it("every label states the human step plainly, and unknown admits it", () => {
    expect(automationLabel("greenhouse")).toMatch(/automatically/i);
    expect(automationLabel("workday")).toMatch(/account/i);
    expect(automationLabel("lever")).toMatch(/CAPTCHA/i);
    expect(automationLabel("nope")).toMatch(/haven't measured/i);
  });

  it("thin samples stay visibly thin", () => {
    // personio and pinpoint are 2-posting samples. The tier is a best guess and
    // a caller wanting confidence should be able to see that from the data.
    for (const v of ["personio", "pinpoint"]) {
      expect(automationFor(v).sampled).toBeLessThanOrEqual(2);
      expect(automationFor(v).note).toMatch(/thin sample/i);
    }
    expect(automationFor("greenhouse").sampled).toBeGreaterThanOrEqual(30);
  });
});
