/**
 * WHAT THIS GUARDS
 * ----------------
 * Two rules at the sweeps' write sites, and one thing that must not drift.
 *
 * 1. THE RACE GUARD MUST NOT OUTLIVE ITS COLUMN. structured-sweep's update
 *    carried `.is("work_mode", null)` unconditionally. That was harmless while
 *    work_mode was the only field it wrote and is a silent data loss now that
 *    it also writes a country: a row that gained a work mode between the
 *    select and the update matches nothing, and the country in the same patch
 *    is dropped with it. No error, no count, nothing to see — PostgREST
 *    returns success for an update matching zero rows. This is the exact
 *    correction desc-sweep's own salvage block documents a few hundred lines
 *    above, which is how we know the shape is already understood here and was
 *    simply not applied in both places.
 *
 * 2. A DERIVED COLUMN MOVES WITH WHAT IT IS DERIVED FROM. region_code is
 *    computed from (location, country). Writing either without re-deriving it
 *    leaves a subdivision computed from the OLD pair — the same defect this
 *    file already records for `remote` drifting away from work_mode, which
 *    left rows tagged remote that the Remote filter could not find.
 *
 * 3. THE LOCATION IS FILL-ONLY, THE COUNTRY IS NOT. The country is the
 *    employer's structured field and outranks our text inference, so it
 *    replaces. The location, on a multi-site requisition, names ONE site, so
 *    overwriting a real location a seeker can already read would narrow the
 *    posting to a place the employer did not single out. It is written only
 *    where the stored string names nowhere.
 *
 * 4. A SUBDIVISION IS NOT WRITTEN FOR A PLACE THAT IS ONE OF SEVERAL. The
 *    vendor hands us one display location however many sites the requisition
 *    lists, and that site count was computed and thrown away: of 68 unplaced
 *    rows a detail sweep would fill, 60 are multi-site, 23 would gain a
 *    region_code, and 12 of those 23 are contradicted by another site the SAME
 *    requisition names. One live requisition stored as "52 Locations" became
 *    location Ohio, country US, region US-OH while its own payload listed
 *    fifty-one other states. region_code is not decorative —
 *    OntarioEsaDisclosures reads it and the column exists to answer
 *    state-level pay-disclosure questions — and it is written into a series
 *    that outlives the posting, so where the location being stored is one of N
 *    the subdivision is written NULL. Null is recoverable; a wrong subdivision
 *    in a longitudinal series is not.
 *
 * HOW IT ASSERTS: over comment-stripped source, because every one of these
 * rules is also explained in prose directly above the code that implements it,
 * and a guard counting raw occurrences would be satisfied by the explanation.
 * Through codeOf, the one shared stripper — which had to be repaired first.
 * index.ts carries a line comment naming a path that contains a block-comment
 * opener, and codeOf used to strip block comments in a pass over the whole
 * file before it cut line comments, so that opener ran to the next close
 * 16,390 characters later and took four real declarations with it. A guard
 * reading that output inspects a file with a hole in it and cannot tell: it
 * passes against anything. The stripper is fixed rather than sidestepped —
 * pointing this one guard at a second stripper would have left the hole in
 * place for the eleven other files that read through codeOf — and the
 * self-check below names declarations that must survive rather than comparing
 * lengths, because a length comparison is equally true of a stripper that
 * deletes 16KB of real code.
 *
 * WHAT THIS DELIBERATELY DOES NOT REQUIRE, so the next reader does not think
 * it was missed. Rule 1 stops the guard riding an update that writes no work
 * mode. It does NOT split structured-sweep's statement, so on the rows that DO
 * write a work mode a genuine race would still drop that row's country along
 * with it. Splitting the write in two closes that and is the right end state.
 *
 * EXACTLY ONE ASSERTION BLOCKS THE SPLIT, and the first draft of this note
 * named four. The one is in src/test/structured-sweep.test.ts, in the group
 * about what the lane writes: it requires the update call and the race
 * predicate to sit within 120 characters of each other, which two statements
 * cannot. Of the other three, two pin DESC-SWEEP's salvage statement — a
 * different write, not the one being split — and the one in
 * src/test/backfill-cannot-stamp-vacuous.test.ts pins the row-count
 * accumulator expression, which a split write keeps unchanged. A deferral
 * justified by three assertions that do not block it is a deferral nobody can
 * retire, so the blocker is named singly.
 *
 * TEETH: proven to fail by (a) making the race guard unconditional again,
 * (b) making it conditional on something that is not a work mode,
 * (c) deleting the region_code re-derivation, (d) re-deriving the region from
 * the stale values, (e) dropping the isPlacelessLocation condition so the
 * location overwrote unconditionally, and (f) deriving a subdivision for a
 * one-of-N location. Each turned a distinct assertion red. All restored.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { isPlacelessLocation } from "../../supabase/functions/job-board/normalize";

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_RAW = readFileSync(
  join(HERE, "..", "..", "supabase", "functions", "job-board", "index.ts"),
  "utf8",
);
const INDEX = codeOf(INDEX_RAW);

describe("a place write is not dropped by another column's race guard", () => {
  it("never attaches the work-mode race guard to an update that may not write a work mode", () => {
    // The guard must be conditional on the patch actually carrying a work
    // mode. An unconditional `.is("work_mode", null)` chained straight onto an
    // update is the defect.
    // COVERS EVERY WRITE SITE, not just the ones whose variable is spelled
    // "…patch". The first version of this assertion required that name and so
    // skipped the desc-sweep salvage block entirely, whose object is called
    // `salv` — it passed while that block was unexamined. A guard that only
    // inspects the call sites whose names it can guess is not a guard.
    //
    // ANCHORED ON THE GUARD, NOT ON THE UPDATE. The two are not always in one
    // statement — a chain is often built into a variable and awaited on the
    // next line — so a rule that required them adjacent silently matched
    // nothing and the assertion passed by finding no work to do. Every
    // occurrence of the guard is examined, wherever the update it applies to
    // was built.
    //
    // ONLY UPDATES, and the read predicates are found rather than guessed at.
    // `work_mode IS NULL` is also a legitimate SELECT filter — structured-sweep
    // uses one to choose its rows — and an earlier version of this assertion
    // flagged that select as an unguarded update. The update chains are
    // identified by discovering which identifiers are assigned from a
    // `.update(` call, so no identifier name is hard-coded here.
    const updateVars = [...INDEX.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*[^;]*?\.update\(/g)].map((m) => m[1]);
    const isUpdateChunk = (chunk: string) =>
      /\.update\(/.test(chunk) || updateVars.some((v) => new RegExp(`\\b${v}\\s*\\.is\\(`).test(chunk));
    const spans = INDEX.split(";")
      .filter((chunk) => /\.is\(\s*["']work_mode["']\s*,\s*null\s*\)/.test(chunk) && isUpdateChunk(chunk))
      .map((chunk) => ({ 0: chunk.trim() }));
    expect(spans.length, "no work_mode race guard found — has the lane moved?").toBeGreaterThan(0);
    for (const m of spans) {
      const span = m[0];
      // The guard must be reached through a CONDITION, and that condition must
      // be about the work mode. An unconditional `.is("work_mode", null)`
      // chained onto an update that also carries a country is the defect: the
      // country is dropped with no error and no count.
      expect(
        /\?/.test(span),
        `the work_mode race guard rides this update unconditionally: ${span.trim().slice(0, 140)}`,
      ).toBe(true);
      expect(
        /(?:work_mode|wmVendor|workMode)\s*(?:\)\s*)?\?/.test(span),
        `the work_mode race guard is conditional on something other than a work mode: ${span.trim().slice(0, 140)}`,
      ).toBe(true);
    }
  });

  it("re-derives region_code wherever it writes a country or a location", () => {
    // Every place-writing patch in this file must set region_code from the
    // pair it is about to store. Count the place writes and the re-derivations
    // and require they match.
    const countryWrites = [...INDEX.matchAll(/\b(\w*[Pp]atch)\.country\s*=/g)].map((m) => m[1]);
    expect(countryWrites.length, "no country write found — has the lane moved?").toBeGreaterThan(0);
    for (const patchName of new Set(countryWrites)) {
      const re = new RegExp(`\\b${patchName}\\.region_code\\s*=[\\s\\S]{0,120}?detectRegion`);
      expect(re.test(INDEX), `${patchName} writes a country but never re-derives region_code`).toBe(true);
    }
  });

  it("re-derives the region from the values it is about to store, not the stale ones", () => {
    // detectRegion must be handed the patched location/country where present,
    // falling back to the row's. Handing it row.location while writing a new
    // location would store a subdivision for the place we just replaced.
    const calls = [...INDEX.matchAll(/region_code\s*=[\s\S]{0,120}?detectRegion\(([\s\S]{0,220}?)\)\s*;/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThan(0);
    for (const args of calls) {
      expect(/\.location\s*(?:as[^)]*?)?\)?\s*\?\?/.test(args), `region derived without preferring the patched location: ${args}`).toBe(true);
      expect(/\.country\s*(?:as[^)]*?)?\)?\s*\?\?/.test(args), `region derived without preferring the patched country: ${args}`).toBe(true);
    }
  });

  it("writes no subdivision at all when the location it stores is one site of several", () => {
    // THE SITE COUNT HAS TO REACH THE WRITE SITE OR THE RULE CANNOT EXIST. It
    // was parsed, returned and read by nothing, so a requisition listing 52
    // sites was filed at one of them and a US state derived from that one site.
    // Both halves are asserted: the count travels out of the detail fetch, and
    // the derivation is refused when it is non-zero.
    expect(INDEX, "fetchVendorDetail no longer carries the site count out")
      .toMatch(/additionalSites/);
    expect(INDEX, "the site count is never destructured at a write site")
      .toMatch(/additionalSites\s*\}\s*=[\s\S]{0,80}fetchVendorDetail/);
    const calls = [...INDEX.matchAll(/region_code\s*=([\s\S]{0,200}?)detectRegion/g)].map((m) => m[1]);
    expect(calls.length, "no region derivation found — has the lane moved?").toBeGreaterThan(0);
    for (const gate of calls) {
      expect(
        /additionalSites|oneOfMany/.test(gate),
        `a region is derived with no regard for how many sites the requisition names: ${gate.trim().slice(0, 140)}`,
      ).toBe(true);
    }
  });

  it("writes the vendor location only over a string that names nowhere", () => {
    // Every location write must be gated on the stored value being placeless.
    const locWrites = [...INDEX.matchAll(/\b(\w*[Pp]atch)\.location\s*=/g)];
    expect(locWrites.length, "no location write found").toBeGreaterThan(0);
    for (const m of locWrites) {
      const at = m.index ?? 0;
      const line = INDEX.slice(Math.max(0, at - 160), at + 60);
      expect(/isPlacelessLocation\s*\(/.test(line), `a location write is not gated on isPlacelessLocation: ${line.trim().slice(-120)}`).toBe(true);
    }
  });

  it("reads a file with no hole in it, which a length check cannot tell you", () => {
    // The stripper this file used to import removes 16,390 characters of
    // index.ts as one block comment, four real declarations among them,
    // because a line comment in that file names a path containing a block
    // opener. Asserting only that the stripped text is shorter than the raw
    // text passes just as happily either way, so the declarations are named.
    for (const decl of ["BUILD_VERSION", "FRESH_WINDOW_DAYS", "SITEMAP_DAYS", "NAME_SYNC_VERSION"]) {
      expect(
        new RegExp(`^\\s*(?:export\\s+)?const\\s+${decl}\\s*=`, "m").test(INDEX),
        `${decl} did not survive the comment strip — every assertion above is reading a truncated file`,
      ).toBe(true);
    }
    expect(INDEX_RAW).toContain("Returning null here is a measured fact");
    expect(INDEX, "comments are not being stripped at all").not.toContain("Returning null here is a measured fact");
  });

  it("knows which stored strings name nowhere", () => {
    // The gate's own behaviour, over the shapes measured on the live board:
    // 11.0% of Workday rows are an "N Locations" placeholder and 7.4% empty.
    for (const placeless of ["2 Locations", "3 Locations", "2 sites", "10 Locations", "", "   ", null, undefined]) {
      expect(isPlacelessLocation(placeless), `${JSON.stringify(placeless)} names nowhere`).toBe(true);
    }
    // A real place is never overwritten, including ones that merely contain a
    // number or the word.
    for (const real of [
      "USA - CO - Denver",
      "New York City, New York (Madison Ave.)",
      "Beth Israel Deaconess Medical Center",
      "Bangalore, India",
      "2 Rivers, WI",
      "Locations Way, Austin, TX",
      "Remote",
    ]) {
      expect(isPlacelessLocation(real), `${real} is a stored string we must not clobber`).toBe(false);
    }
  });
});
