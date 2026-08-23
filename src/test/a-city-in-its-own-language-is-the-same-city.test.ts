import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * "COLOGNE" FOUND 119 JOBS. "KÖLN" FOUND 346.
 *
 * Substring matching cannot bridge a translated place name — nothing connects
 * "Munich" to "München" — so a visitor sees whichever spelling their own
 * vocabulary happens to share with the employer's HR system, and never learns
 * the rest exists. The English speller looking for Cologne was seeing 26% of it.
 *
 * MEASURED LIVE 2026-08-22 over fresh, present postings, English form / local:
 *   Bangalore 3,074 / Bengaluru 3,181   Munich   966 / München  757
 *   Warsaw    1,017 / Warszawa    265   Milan    642 / Milano   240
 *   Lisbon      535 / Lisboa      163   Prague   449 / Praha    113
 *   Florence    425 / Firenze      17   Krakow   398 / Kraków   148
 *   Geneva      351 / Genève       48   Brussels 314 / Bruxelles 124
 *   Vienna      294 / Wien        193   Zurich   288 / Zürich   178
 *   Copenhagen  206 / København    39   Cologne  119 / Köln     346
 *   Gothenburg   42 / Göteborg     18
 *
 * THIS ONLY BECAME SAFE TO BUILD TODAY. A metro alias expands to several names,
 * and until 20260823010000 the ranked RPC took a single substring — so the
 * expansion was computed, disclosed to the client, and then thrown away on the
 * path most searches use. Adding entries before that would have widened the
 * browse path and quietly done nothing for anyone who typed a job title.
 */
const FN = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");

/**
 * The alias table as the function sees it, WITH COMMENTS STRIPPED.
 *
 * The stripping is not tidiness. The comment above the table explains why Rome
 * is excluded, and therefore contains the word "Roma" — so an assertion that
 * the table does not mention Roma reads the explanation and fails. That is the
 * sixth time in this repo that prose documenting a rule has been counted as an
 * instance of it, and the second time inside a test written about the trap.
 */
const METRO = (() => {
  const i = FN.indexOf("const METRO_ALIASES");
  const raw = FN.slice(i, FN.indexOf("\n};", i));
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
})();

describe("a city in its own language is the same city", () => {
  it("maps each city both ways, so either spelling reaches both", () => {
    const pairs: Array<[string, string]> = [
      ["munich", "München"], ["cologne", "Köln"], ["vienna", "Wien"],
      ["prague", "Praha"], ["lisbon", "Lisboa"], ["milan", "Milano"],
      ["florence", "Firenze"], ["zurich", "Zürich"], ["geneva", "Genève"],
      ["copenhagen", "København"], ["gothenburg", "Göteborg"],
      ["warsaw", "Warszawa"], ["krakow", "Kraków"], ["brussels", "Bruxelles"],
      ["bangalore", "Bengaluru"],
    ];
    for (const [en, local] of pairs) {
      expect(METRO, `typing "${en}" must also search ${local}`).toContain(local);
      expect(METRO, `"${en}" is missing from the table`).toMatch(new RegExp(`\\b${en}:`));
    }
  });

  it("accepts the local spelling too, and an ASCII fallback where the local has diacritics", () => {
    // Someone in Munich types "München"; someone on a US keyboard types
    // "muenchen". Both are the same search and neither should be the odd one out.
    for (const k of ['"münchen"', "muenchen", '"köln"', "koeln", '"zürich"', "geneve", "kobenhavn", "goteborg", '"kraków"', "cracow"]) {
      expect(METRO, `${k} should be an accepted spelling`).toContain(k);
    }
  });

  it("REFUSES Rome, and that refusal is the point", () => {
    // "%Roma%" looked like the largest win in the whole set — 1,270 hits — and
    // is almost entirely ROMANIA: Bucharest, Cluj-Napoca, Timișoara. Anchored
    // as "Roma," it survives Romania and still collects "Roma, QLD, Australia"
    // and "VIA ROMA," in Talamona, for 70 hits.
    //
    // A location filter that answers "Rome" with Bucharest is worse than one
    // that answers with less. This is the same rule that keeps "LA" from
    // matching "Plain City" — the alias table has always been about which
    // letters are safe, not which cities are big.
    expect(METRO).not.toMatch(/\brome:/);
    expect(METRO).not.toContain("Roma");
  });

  it("refuses alternates that return nothing, rather than pretending to cover them", () => {
    // Bombay and Den Haag are real alternate names and ZERO postings use them.
    // An entry would be dead weight dressed as coverage — the emitter-with-no-
    // reader shape, in a lookup table.
    expect(METRO).not.toContain("Bombay");
    expect(METRO).not.toContain("Den Haag");
  });

  it("keeps the US metros that were already there", () => {
    for (const k of ["nyc:", "sf:", '"bay area":', "la:", "philly:", "atl:", "dfw:", "nola:"]) {
      expect(METRO, `${k} was dropped`).toContain(k);
    }
  });

  it("is useless unless the ranked path can match more than one name", () => {
    // The whole table is expansion, and expansion only reaches the searches
    // that matter if the RPC splits. Pinned here because adding cities without
    // that is the shape of work that looks done and does nothing.
    expect(FN).toMatch(/join\("\|"\)/);
  });
});
