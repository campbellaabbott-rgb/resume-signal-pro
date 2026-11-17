/**
 * A SINGULAR SKILL IS NOT FOUND IN A PLURAL THAT IS ANOTHER WORD (RC-OI-25).
 *
 * WHAT WAS WRONG. term-presence.ts keeps a reviewed list of plurals that are
 * other words ("securities", "futures", "dynamics", "customs", "dailies",
 * "canvas", "marines" ...), meant to be matched as written, "plural and
 * singular never swapped". Only one direction was refused: "securities" was
 * never read back to "security", but "security" was still read forward to
 * "securities". So a résumé that only mentioned the Securities and Exchange
 * Commission, or securities trading, was credited with the keyword
 * "security", and "future" was found in "futures", "dynamic" in "Microsoft
 * Dynamics", "custom" in "customs". The recheck's third corpus showed it on
 * 10 of 1,818 real postings for "security" alone; the presence test before
 * the plural reader (which never inflected) read all of them right.
 *
 * WHAT HOLDS NOW, in both scanners' copies: a form on that list is never
 * generated from its singular either, so the plural is found only where the
 * term asked for is the plural itself. Ordinary plurals still count both
 * ways.
 */
import { describe, expect, it } from "vitest";
import * as primary from "../../supabase/functions/free-keyword-scan/term-presence";
import * as stream from "../../supabase/functions/free-keyword-scan-stream/term-presence";

const COPIES = [["free-keyword-scan", primary], ["free-keyword-scan-stream", stream]] as const;

const cases: Array<[string, string, boolean]> = [
  // Real posting contexts from the third corpus, and the register's two.
  ["Filed reports with the Securities and Exchange Commission on time.", "security", false],
  ["Traded fixed-income securities for institutional clients.", "security", false],
  ["SEEK is listed on the Australian Securities Exchange and hires analysts for growth.", "security", false],
  ["Managed cash and securities settlement for clients.", "security", false],
  ["Traded futures and options on the desk.", "future", false],
  ["Implemented Microsoft Dynamics 365 for finance.", "dynamic", false],
  ["Cleared goods through customs at the port.", "custom", false],
  ["Reviewed the dailies with the director.", "daily", false],
  ["Painted large works on canvas.", "canva", false],
  ["Served four years in the Marines.", "marine", false],
  // ... the word itself is still found, and the plural where the plural is asked for.
  ["Held a security clearance.", "security", true],
  ["Led security reviews for the platform.", "security", true],
  ["Traded fixed-income securities for institutional clients.", "securities", true],
  ["Traded futures and options on the desk.", "futures", true],
  ["Implemented Microsoft Dynamics 365 for finance.", "dynamics", true],
  ["Cleared goods through customs at the port.", "customs", true],
  // ... and an ordinary plural still counts both ways.
  ["Coordinated product launches", "product launch", true],
  ["Refreshed our strategies", "strategy", true],
  ["Closed new accounts", "account", true],
  ["Owned the security review", "security reviews", true],
];

for (const [name, mod] of COPIES) {
  describe(`${name}: a listed plural is matched only as written, in both directions`, () => {
    for (const [text, term, want] of cases) {
      it(`${term} in ${JSON.stringify(text)} → ${want}`, () => expect(mod.resumeHasTerm(text, term)).toBe(want));
    }
  });
}
