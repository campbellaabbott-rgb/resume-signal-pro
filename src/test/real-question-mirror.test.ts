/**
 * THREE PLACES BELIEVED DIFFERENT THINGS ABOUT THE SAME FACT.
 *
 * "Which vendors publish their real application questions" was written down
 * independently in three files on 2026-08-03, and no two agreed:
 *
 *   _shared/apply-automation.ts   ashby breezy greenhouse pinpoint teamtailor
 *   ApplicationAnswers.tsx        ashby greenhouse recruitee
 *   job-board/apply-automation.ts ashby greenhouse            (an orphaned fork)
 *
 * All three were true when written. None was true on the day they were read.
 * The orphan is deleted; the remaining two cannot be merged into one import
 * because the table is written for Deno and the component is the browser
 * bundle — the same constraint that produced SENDABLE_VENDORS' mirror test, and
 * this follows that pattern deliberately.
 *
 * WHAT DRIFT COSTS HERE, and it is quiet in both directions. A vendor MISSING
 * from the component means the kit never asks for the real form and silently
 * falls back to inferred questions — correctly labelled as inferred, so nothing
 * looks broken; the candidate just gets a guess where the employer's actual
 * questions were one call away. A vendor listed with no reader behind it means
 * a fetch that always returns `unsupported`, which costs a round trip on every
 * kit for that vendor and yields nothing.
 *
 * Neither shows up as an error. That is exactly why it needs a test.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { realQuestionVendors } from "../../supabase/functions/_shared/apply-automation.ts";
import { REAL_QUESTION_PREFIXES, stripLabelMarkup } from "../components/apply/ApplicationAnswers";
import { cleanQuestionLabel } from "../../supabase/functions/_shared/application-questions.ts";

describe("the kit's vendor list mirrors the deployed automation table", () => {
  it("lists exactly the vendors with a question reader", () => {
    const fromTable = realQuestionVendors().map((v) => `${v}:`).sort();
    expect([...REAL_QUESTION_PREFIXES].sort()).toEqual(fromTable);
  });

  it("every prefix is a vendor prefix, not a bare name", () => {
    // Matched with startsWith against posting ids like `recruitee:acme:123`.
    // A bare "recruitee" would also match "recruiteex:" if one ever existed.
    for (const p of REAL_QUESTION_PREFIXES) {
      expect(p, `${p} is missing its colon`).toMatch(/^[a-z0-9-]+:$/);
    }
  });
});

describe("the kit strips label markup the same way the backend does", () => {
  // Live Recruitee labels arrive as HTML. If the two implementations diverge,
  // the candidate reads one string in the kit and the classifier judges another.
  const CASES = [
    `<p>Please confirm you've read our <a href="https://x/p.pdf" target="_blank">Privacy Notice</a>.</p>`,
    `<p>Ik heb de <a href="https://x/privacy" rel="noopener">privacy statement</a> gelezen en ga akkoord.</p>`,
    "Describe a bug involving &lt;p&gt; tags &amp; nesting",
    "<p>Line one</p><p>Line two</p>",
    "Plain question with no markup at all",
    "  leading and trailing   whitespace  ",
    "<div>Mixed<br/>break</div>",
    "&nbsp;&nbsp;entity only&nbsp;",
    "",
  ];

  it("agrees on every live-shaped label", () => {
    for (const c of CASES) {
      expect(stripLabelMarkup(c), `diverged on: ${c.slice(0, 50)}`).toBe(cleanQuestionLabel(c));
    }
  });

  it("agrees on junk input too", () => {
    for (const junk of [null, undefined, 42, "<<<>>>"]) {
      expect(stripLabelMarkup(junk)).toBe(cleanQuestionLabel(junk));
    }
  });

  it("the component actually applies it to harvested labels", () => {
    // The function existing and the function being called are different facts.
    const src = readFileSync(
      resolve(__dirname, "../components/apply/ApplicationAnswers.tsx"), "utf8");
    expect(src, "harvested labels are no longer stripped before display")
      .toMatch(/label: stripLabelMarkup\(x\.label\)/);
  });
});
