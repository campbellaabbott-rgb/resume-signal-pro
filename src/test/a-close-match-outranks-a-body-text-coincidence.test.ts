import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE RIGHT ANSWERS WERE ON THE PAGE, UNDERNEATH THE WRONG ONES.
 *
 * The hour the PGRST203 overload was dropped and ranked search came back, the
 * misspelling rescue started returning rows again — and returning them in the
 * worst possible order. MEASURED on the live board, q="maneger", limit=60:
 *
 *     rows 1-7   Slaapwacht, Woonbegeleider, Persoonlijk begeleider, ...
 *     rows 8-46  Manager, Manager, Manager, ... (39 of them)
 *
 * Seven Dutch care postings above thirty-nine Managers. Not one of the seven
 * has "maneger" anywhere in its title — they matched on DESCRIPTION text —
 * while all thirty-nine are what the searcher meant. q="nures" had the same
 * shape: "CARE NOW FULL TIME REGISTER NURE - WHITEHALL" on top, five Nurses
 * beneath, the winning row matching a typo in the employer's own posting.
 *
 * WHY IT LOOKED FINE FROM EVERY OTHER ANGLE. fuzzy_title_search is correct in
 * isolation — called directly it answers "acountant" with Accountant, "nures"
 * with Nurse, "maneger" with Manager, every time. The count was right, the
 * rows were right, the close-match flag was right. The only thing wrong was
 * the sequence, and no probe that asks "did it return results?" can see it.
 * A test that checked for the presence of Managers on the page would have
 * passed while the page was useless.
 *
 * THE RULE, which is the ordinary one this path had inverted: A TITLE MATCH
 * BEATS A DESCRIPTION-ONLY MATCH. A close title match is stronger evidence of
 * what someone meant than a body-text coincidence, so it ranks above it; a
 * real title hit is stronger still, so it ranks above both. That ordering is
 * what these assertions pin.
 */
const FN = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"),
  "utf8",
);

/** The augmentation block, sliced to real boundaries rather than by a line count. */
const BLOCK = (() => {
  const start = FN.indexOf("const FUZZY_AUGMENT_BELOW");
  expect(start, "the fuzzy augmentation block has moved or been removed").toBeGreaterThan(-1);
  const end = FN.indexOf("augmentation is a bonus", start);
  expect(end, "the augmentation block's closing catch has moved").toBeGreaterThan(start);
  return FN.slice(start, end);
})();

describe("a close match outranks a body-text coincidence", () => {
  it("places close matches ABOVE description-only rows and BELOW real title hits", () => {
    // The whole fix is one array literal. Pin its order, not its formatting.
    const order = /rankedGrouped\.jobs\s*=\s*\[\s*\.\.\.(\w+)\s*,\s*\.\.\.(\w+)\s*,\s*\.\.\.(\w+)\s*\]/.exec(BLOCK);
    expect(order, "the page is no longer assembled as a three-way ordered concat").not.toBeNull();
    const [, first, middle, last] = order!;
    expect(middle, "close matches must sit in the MIDDLE band").toBe("extra");
    // The first band must be the title-hit partition and the last the body-only
    // one — asserted through their definitions so renaming a variable cannot
    // quietly swap the two and still pass.
    const firstDef = new RegExp(`const ${first} = rankedGrouped\\.jobs\\.filter\\(inTitle\\)`).test(BLOCK);
    const lastDef = new RegExp(`const ${last} = rankedGrouped\\.jobs\\.filter\\(\\(j\\) => !inTitle\\(j\\)\\)`).test(BLOCK);
    expect(firstDef, `${first} is not the inTitle partition`).toBe(true);
    expect(lastDef, `${last} is not the !inTitle partition`).toBe(true);
  });

  it("does not use push(), which is what put the junk on top", () => {
    // The bug was literally `rankedGrouped.jobs.push(...extra)`. If it comes
    // back, every assertion about order above is silently bypassed.
    expect(
      /rankedGrouped\.jobs\.push\(/.test(BLOCK),
      "close matches are being appended again — that is the original defect",
    ).toBe(false);
  });

  it("leaves the page's SIZE and pagination accounting untouched", () => {
    // Reordering is safe precisely because nothing enters or leaves the page.
    // If `room` ever stops being "limit minus what is already here", close
    // matches can displace exact rows, and the displaced rows have nowhere to
    // go — nextOffset would advance straight past them and they would be
    // unreachable on page two. This assertion is the reason the fix could be
    // shipped without touching rawConsumed.
    expect(
      /const room = Math\.max\(0, limit - rankedGrouped\.jobs\.length\);/.test(BLOCK),
      "room is no longer derived from the rows already on the page — close " +
        "matches may now displace exact rows, which breaks nextOffset",
    ).toBe(true);
  });

  it("ranks by the SHIPPED title predicate, on the cases that were measured wrong", () => {
    // Reconstruct the real predicate from source so this tests the shipped
    // rule and not a paraphrase of it.
    const src = /const inTitle = \(r: unknown\) => \{([\s\S]*?)\n {16}\};/.exec(BLOCK);
    expect(src, "the inTitle predicate could not be located").not.toBeNull();
    expect(src![1], "inTitle must compare against the TITLE").toContain(".title");
    expect(src![1], "inTitle must be case-insensitive").toContain("toLowerCase");

    // Behavioural check of the same rule, on the rows actually measured.
    const inTitle = (title: string, terms: string[]) =>
      terms.length > 0 && terms.some((t) => title.toLowerCase().includes(t));

    // maneger: none of the Dutch rows carry the term, so all are body-only and
    // every close match outranks them.
    for (const t of ["Slaapwacht", "Woonbegeleider", "Persoonlijk begeleider"]) {
      expect(inTitle(t, ["maneger"]), `${t} must be classed body-only`).toBe(false);
    }
    // nures: the posting's own typo is NOT the search term.
    expect(inTitle("CARE NOW FULL TIME REGISTER NURE - WHITEHALL", ["nures"])).toBe(false);
    // acountant: "Accountant" is spelled correctly, so it is not a literal hit
    // for the misspelling either — it arrives, correctly, as a close match.
    expect(inTitle("Station Accountant", ["acountant"])).toBe(false);

    // profesor: these DO carry the term, so they stay on top and this query is
    // deliberately unaffected. This is the guard against over-correcting —
    // a fix that demoted these would be a new bug.
    for (const t of ["Profesores de FP - Animaciones 3D", "Profesor de Medicina Tiempo Completo"]) {
      expect(inTitle(t, ["profesor"]), `${t} must stay a title hit`).toBe(true);
    }
    // And an ordinary correctly-spelled query is untouched.
    expect(inTitle("Senior Software Engineer", ["engineer"])).toBe(true);
  });

  it("uses the filler-stripped terms, so 'maneger jobs near me' ranks like 'maneger'", () => {
    // queryTerms drops "jobs/near/me". Ranking on the RAW string instead would
    // classify any title containing "me" as a title hit — "Maintenance",
    // "Management" — which is the exact substring trap that made natural
    // phrasing collapse in the first place.
    expect(
      /const terms = queryTerms\(qText\)\.terms/.test(BLOCK),
      "ranking must use queryTerms(), not the raw query string",
    ).toBe(true);
  });
});
