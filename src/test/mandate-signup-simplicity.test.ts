/**
 * TEN FIELDS TO START, OF WHICH THREE DECIDE ANYTHING.
 *
 * A new subscriber met: roles, field, location, countries, salary floor, remote
 * only, posted-within, uncategorised opt-in, picks per morning, review/auto —
 * before the agent would do a thing. Seven of those have a working default, so
 * they were seven decisions charged for nothing at the exact moment somebody is
 * deciding whether the product works at all.
 *
 * WHAT THE PERSON ACTUALLY OWNS: the roles they want and where. Everything else
 * is a refinement of a search that already works. So three fields stay visible —
 * roles, places, countries — and the rest move behind one control.
 *
 * COLLAPSED IS NOT HIDDEN, and that is the line this file defends. A filter you
 * cannot see is the silent-filter failure this codebase has a contract against:
 * the `other` bucket quietly removed 27.6% of the board and the symptom was a
 * thin queue with no explanation anywhere. Any optional filter that is actually
 * set is named on screen whether the section is open or shut.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const panel = readFileSync(
  resolve(__dirname, "../components/account/MorningQueuePanel.tsx"), "utf8");
const code = panel.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

/** The JSX between the roles input and the "More options" control. */
const alwaysVisible = code.slice(
  code.indexOf("placeholder={t(\"morningQueue.qPlaceholder\""),
  code.indexOf("setShowAdvanced((v) => !v)"),
);

describe("what a new subscriber must decide", () => {
  it("keeps roles, places and countries in front of them", () => {
    expect(alwaysVisible).toMatch(/form\.location/);
    expect(alwaysVisible).toMatch(/<CountryPicker/);
  });

  it("moves the optional filters behind one control", () => {
    for (const optional of ["form.salary_min", "form.max_age_days", "form.daily_count", "form.include_uncategorised"]) {
      expect(alwaysVisible, `${optional} should not greet a new subscriber`).not.toContain(optional);
    }
  });

  it("moves the FIELD select back too — 18 options nobody needs to open with", () => {
    // Category is a refinement of a title search, and "Any field" is right for
    // almost everyone. It is also the control that silently cost 27.6% of the
    // board, which is a poor thing to hand someone on their first screen.
    expect(alwaysVisible).not.toContain("CATEGORIES.map");
  });

  it("gates the optional block on the toggle", () => {
    expect(code).toMatch(/\{showAdvanced && \(/);
  });
});

describe("collapsed is not hidden", () => {
  it("names every optional filter that is actually set", () => {
    for (const f of ["form.category", "form.salary_min", "form.remote_only", "form.max_age_days", "form.include_uncategorised"]) {
      expect(code.slice(code.indexOf("const advancedSummary")), `${f} missing from the summary`).toContain(f);
    }
  });

  it("shows that summary precisely when the section is shut", () => {
    expect(code).toMatch(/\{!showAdvanced && advancedSummary\.length > 0 && \(/);
  });

  it("opens itself for someone returning to a tuned mandate", () => {
    expect(code).toMatch(/if \(advancedSummary\.length > 0\) setShowAdvanced\(true\)/);
  });

  it("treats a non-default pick count as worth reporting", () => {
    expect(code).toMatch(/form\.daily_count !== 5/);
  });
});

describe("the one-press start", () => {
  it("computes the values ONCE and passes them to the save", () => {
    // setForm is async. Filling then saving reads the empty closure and writes
    // a blank mandate while the screen shows the proposed roles — active, and
    // searching for nothing.
    expect(code).toMatch(/const next = \{/);
    expect(code).toMatch(/setForm\(next\);\s*await saveMandate\(true, next\)/);
  });

  it("lets saveMandate take an explicit override", () => {
    expect(code).toMatch(/saveMandate = useCallback\(async \(activate: boolean, override\?: Partial<typeof form>\)/);
    expect(code).toMatch(/const f = \{ \.\.\.form, \.\.\.\(override \?\? \{\}\) \}/);
  });

  it("builds the whole row from the merged values, not from form", () => {
    // A half-rewired row is the partial rollout: the fields still reading
    // `form` would save the pre-proposal state and nothing would look wrong.
    // Scoped to saveMandate. saveSearch has its own `const row` that reads
    // `form` correctly — it has no override path, because the one-press start
    // creates a mandate and never a saved search. An unscoped slice catches
    // that one and fails for the right code.
    const fn = code.slice(code.indexOf("const saveMandate = useCallback"));
    const row = fn.slice(fn.indexOf("const row = {"), fn.indexOf("agent_mandates\").upsert"));
    expect(row).toMatch(/q: f\.q\.trim\(\)/);
    expect(row).toMatch(/location: f\.location\.trim\(\)/);
    expect(row).toMatch(/reachPatch\(f\)/);
    expect(row, "a field still reads the stale form").not.toMatch(/:\s*form\./);
  });

  it("reachPatch honours the override too", () => {
    const rp = code.slice(code.indexOf("const reachPatch"), code.indexOf("const saveSearch"));
    expect(rp).toMatch(/const f = src \?\? form/);
    expect(rp).toMatch(/parseCountries\(f\.countries\)/);
    expect(rp).toMatch(/f\.include_uncategorised === true/);
  });

  it("is offered only where there is nothing to overwrite", () => {
    expect(code).toMatch(/\{formIsBlank && !mandate && \(/);
  });

  it("obeys the same prerequisites as Activate", () => {
    // Subscription and a résumé. A one-press path that bypassed either would
    // be a button that fails for the people it exists to help.
    const btn = code.slice(code.indexOf("startFromCv()"), code.indexOf("startFromCv()") + 400);
    expect(btn).toMatch(/agentActive !== true/);
    expect(btn).toMatch(/!resumeReady/);
  });
});
