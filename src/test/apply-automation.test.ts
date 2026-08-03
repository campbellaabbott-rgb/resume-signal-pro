/**
 * THIS SUITE USED TO PIN A FILE NOBODY DEPLOYED.
 *
 * There were two copies of the automation table: `_shared/apply-automation.ts`,
 * which all four edge functions import, and `job-board/apply-automation.ts`,
 * which nothing imported except this test. They had drifted — breezy,
 * teamtailor and pinpoint said `realQuestions: false` in the orphan and `true`
 * in the deployed one, and the orphan was missing three exports outright
 * (`realQuestionVendors`, `SENDABLE_VENDORS`, `isSendableVendor`).
 *
 * So the guard below labelled "only Greenhouse claims real published questions"
 * was green while the shipped table named five vendors. A test pinned to a dead
 * file is worse than no test: it reports on a state of the world that stopped
 * existing, and it does it in the confident voice of a passing suite.
 *
 * The orphan is deleted and this imports what deploys. `one-fact-table` at the
 * bottom is what stops the fork coming back.
 */
import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  automationFor,
  automationLabel,
  isFullyAutomatable,
  realQuestionVendors,
} from "../../supabase/functions/_shared/apply-automation.ts";

// This table is a MEASUREMENT (2026-07-29, 298 real apply URLs), and the risk
// with a measurement written down as code is that it quietly becomes folklore.
// These guards hold the two properties that keep it honest: an unmeasured vendor
// never claims to be automatable, and a thin sample stays visibly thin.
describe("apply automation tiers reflect what was actually measured", () => {
  it("classifies the measured zero-CAPTCHA vendors as fully automatable", () => {
    // 674 pages, redirects followed, 2026-07-30.
    for (const v of ["workday", "smartrecruiters", "breezy", "oracle", "teamtailor"]) {
      expect(isFullyAutomatable(v), `${v} measured 0 captcha`).toBe(true);
    }
  });

  // THE CORRECTION THAT MATTERS MOST. A first sample reported 0% captcha for
  // these four and shipped them as `auto`. A clean re-run measures 91-100%.
  // Had that stayed, the agent would have pointed unattended sending at exactly
  // the vendors it must avoid — and on Greenhouse the rejection is silent, so
  // nothing would have looked wrong.
  it("never marks a CAPTCHA vendor automatable, however an old sample read", () => {
    for (const v of ["greenhouse", "bamboohr", "workable", "rippling", "recruitee"]) {
      expect(isFullyAutomatable(v), `${v} measures 87-100% captcha`).toBe(false);
      expect(automationFor(v).sampled, `${v} must carry its sample size`).toBeGreaterThanOrEqual(30);
    }
  });

  it("keeps Greenhouse out of auto because its protection is INVISIBLE", () => {
    // 94% load recaptcha/enterprise.js with no sitekey and no widget: no
    // challenge is shown, the session is scored, and a low score is rejected
    // silently. Frictionless for a real browser, unreliable for a server one.
    const f = automationFor("greenhouse");
    expect(f.tier).toBe("click");
    expect(f.note).toMatch(/invisible|enterprise/i);
  });

  it("classifies the CAPTCHA vendors as needing one human click", () => {
    // ashby 60/60 and lever 57/57 carried reCAPTCHA on every sampled posting.
    for (const v of ["ashby", "lever", "icims"]) {
      expect(automationFor(v).tier).toBe("click");
      expect(isFullyAutomatable(v)).toBe(false);
    }
  });

  it("now carries a REAL Workday measurement instead of a non-measurement", () => {
    // The first table recorded workday sampled:0 because a static fetch saw a JS
    // shell. Re-measured properly it is 0/60 captcha — the largest clean vendor
    // on the board — but it still needs a per-tenant candidate account, which the
    // note has to keep saying.
    const f = automationFor("workday");
    expect(f.sampled).toBeGreaterThanOrEqual(60);
    expect(f.tier).toBe("auto");
    expect(f.note).toMatch(/account/i);
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
    expect(automationFor("  WorkDay ").tier).toBe("auto");
    expect(automationFor("ASHBY").tier).toBe("click");
  });

  it("claims real questions for exactly the vendors with a reader wired", () => {
    // The flag means one thing: job-board's `application-questions` action has a
    // branch that reads THIS vendor's real form. It is not about CAPTCHA — the
    // agent can read Greenhouse's and Ashby's questions and still cannot submit
    // to either. Six as of 2026-08-03; recruitee's reader shipped with the other
    // five and its flag was left false for three days.
    expect(realQuestionVendors()).toEqual(
      ["ashby", "breezy", "greenhouse", "pinpoint", "recruitee", "teamtailor"],
    );
    for (const v of ["smartrecruiters", "bamboohr", "workable", "lever", "workday", "icims", "oracle", "rippling"]) {
      expect(automationFor(v).realQuestions, `${v} must not claim real questions`).toBe(false);
    }
  });

  it("every label states the human step plainly, and unknown admits it", () => {
    expect(automationLabel("smartrecruiters")).toMatch(/automatically/i);
    expect(automationLabel("greenhouse")).toMatch(/CAPTCHA/i);
    expect(automationLabel("lever")).toMatch(/CAPTCHA/i);
    expect(automationLabel("nope")).toMatch(/haven't measured/i);
  });

  it("there is exactly ONE automation table in the tree", () => {
    // The defect this suite was blind to for as long as it existed. A second
    // copy does not announce itself: both files compile, both look authoritative,
    // and the tests go green against whichever one they happen to import. The
    // only durable fix is that a second copy cannot appear without failing here.
    const root = resolve(__dirname, "../../supabase/functions");
    const found: string[] = [];
    for (const dir of readdirSync(root, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      for (const f of readdirSync(resolve(root, dir.name))) {
        if (f === "apply-automation.ts") found.push(`${dir.name}/${f}`);
      }
    }
    expect(found, "a fork of the automation table is back — delete it and import _shared")
      .toEqual(["_shared/apply-automation.ts"]);
  });

  it("thin samples stay visibly thin", () => {
    // personio and pinpoint are single-digit samples. The tier is a best guess and
    // a caller wanting confidence should be able to see that from the data.
    for (const v of ["personio", "pinpoint"]) {
      expect(automationFor(v).sampled).toBeLessThanOrEqual(7);
      expect(automationFor(v).note).toMatch(/thin sample/i);
    }
    expect(automationFor("workday").sampled).toBeGreaterThanOrEqual(60);
  });
});
