/**
 * WHAT THIS GUARDS
 * ----------------
 * A Workday apply URL carries a path slug that looks like a location:
 * `/job/USA---CO---Denver/`. It names a place for roughly 91% of our unplaced
 * Workday rows, which makes it the most tempting wrong answer in this lane.
 *
 * READ THROUGH A GAZETTEER IT IS 14.4% WRONG (measured in the sweep that
 * produced this build, against 2,236 sampled Workday rows we already place):
 * "Beth Israel Deaconess Medical Center" resolves to Israel or Hungary,
 * "Poland Remote" to the United States, "Ireland" to the United States. The
 * slug is also only the PRIMARY site of a multi-site requisition, so even a
 * correct read is a claim about one of several places, not a fact about the
 * posting.
 *
 * The employer answers the same question directly, in a payload these sweeps
 * already download, at zero extra cost. There is no reason to guess at a URL,
 * and this guard exists so nobody re-derives the temptation later — it is the
 * single highest-yield bad idea in this area of the code.
 *
 * THE ONE PERMITTED READ, which this guard does not forbid: the bare US state
 * / CA province CODE branch (4.5% and 2.9% error). It is not used today. If it
 * is ever added it must disclose that it names the primary site of a
 * multi-site requisition — and this guard will still hold, because it forbids
 * feeding the slug to the country and city vocabularies, not parsing a code
 * out of it.
 *
 * HOW IT ASSERTS
 * --------------
 * Over COMMENT-STRIPPED source. The docblocks in index.ts and normalize.ts
 * necessarily discuss applyUrl and detectCountry in prose — that is how this
 * codebase records why a thing is not done — and a guard counting raw
 * occurrences would be satisfied by its own explanation. That failure has
 * shipped here seven times.
 *
 * WITH codeOf, THE SHARED STRIPPER, AND IT HAD TO BE REPAIRED BEFORE THIS
 * GUARD COULD TRUST IT. codeOf used to strip block comments in one pass over
 * the whole file and line comments in a second. index.ts contains a line
 * comment naming a shared-module path whose wildcard follows a slash — a
 * block-comment opener to a block-first pass, which therefore ran from there
 * to the next terminator 16,390 characters later and took four real
 * declarations with it (SITEMAP_DAYS, BUILD_VERSION, NAME_SYNC_VERSION,
 * FRESH_WINDOW_DAYS). A guard reading that output inspects a file with a hole
 * in it and cannot tell — it passes against anything.
 *
 * The first fix for that was to point this guard at the catalog module's
 * stripTsComments instead. That is the wrong repair and it is the one this
 * repository has already made four times: it leaves the defect in the shared
 * helper for the next eleven files that call it, and grows a second stripper
 * beside it. codeOf is now a single left-to-right, string-aware scan and is
 * the only stripper here; its own guard is
 * src/test/a-stripper-that-loses-real-code-passes-every-guard-that-reads-it.test.ts.
 *
 * TEETH: proven to fail by adding `const slug = detectCountry(applyUrl)` to
 * the Workday branch of fetchVendorDetail — the first assertion reports the
 * call. Also proven to fail when that same line is written inside a comment
 * instead and the stripper is bypassed. Restored both times.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { codeOf } from "./helpers/strip-comments";

const HERE = dirname(fileURLToPath(import.meta.url));
const FN = join(HERE, "..", "..", "supabase", "functions", "job-board");

const INDEX_RAW = readFileSync(join(FN, "index.ts"), "utf8");
const NORMALIZE_RAW = readFileSync(join(FN, "normalize.ts"), "utf8");
const INDEX = codeOf(INDEX_RAW);
const NORMALIZE = codeOf(NORMALIZE_RAW);

/** The place vocabularies. Handing any of them an apply URL is the defect. */
const PLACE_READERS = ["detectCountry", "detectPlace", "cityCountry", "detectRegion"];
/** The identifiers an apply URL travels under in this function. */
const URL_HOLDERS = ["applyUrl", "apply_url", "row.apply_url", "cxs"];

describe("the apply url slug is not read as a place", () => {
  it("never hands a url-bearing identifier to a place vocabulary", () => {
    const offences: string[] = [];
    for (const reader of PLACE_READERS) {
      // Match the call and its first argument, whatever whitespace is used.
      const re = new RegExp(`\\b${reader}\\s*\\(([^),]*)`, "g");
      for (const src of [INDEX, NORMALIZE]) {
        for (const m of src.matchAll(re)) {
          const arg = m[1];
          for (const holder of URL_HOLDERS) {
            if (new RegExp(`\\b${holder}\\b`).test(arg)) offences.push(`${reader}(${arg.trim()})`);
          }
        }
      }
    }
    expect(offences, "an apply url was passed to a place vocabulary").toEqual([]);
  });

  it("never builds a place out of a de-slugged url path", () => {
    // The gazetteer shape: turn `USA---CO---Denver` back into text and look it
    // up. Forbidden outright — this is the 14.4%-wrong route.
    const deslug = /\.(?:replace|replaceAll)\s*\(\s*\/[^/]*-{2,}[^/]*\/[a-z]*\s*,/g;
    for (const [name, src] of [["index.ts", INDEX], ["normalize.ts", NORMALIZE]] as const) {
      const hits = [...src.matchAll(deslug)].map((m) => m[0]);
      expect(hits, `${name} de-slugs a url path`).toEqual([]);
    }
  });

  it("reads the workday place from the payload, not from the url", () => {
    // The positive half: the reader that IS used must be the payload one, or
    // the two assertions above are satisfied by there being no reader at all.
    expect(INDEX).toContain("workdayDetailPlace");
    // And it is handed the parsed response, not a string.
    expect(/workdayDetailPlace\s*\(\s*j\s*\)/.test(INDEX)).toBe(true);
  });

  it("asserts over stripped source, so prose explaining the rule cannot satisfy it", () => {
    // The files DO discuss these identifiers in comments, and if the stripper
    // ever stopped removing them the assertions above would start reading the
    // explanation instead of the code.
    expect(INDEX).not.toContain("14.4%");
    expect(NORMALIZE).not.toContain("14.4%");
  });

  it("strips comments WITHOUT swallowing code, which a length check cannot tell you", () => {
    // A LENGTH COMPARISON IS NOT A SELF-CHECK. The previous version of this
    // block asserted only that the stripped file was shorter than the raw one,
    // which is true of a stripper that deletes 16KB of real code as well as of
    // one that works. The stripper that shipped here did exactly that on
    // index.ts: a `/*` inside a `//` comment opened a block comment that the
    // block-first pass ran to the next `*/`, taking four declarations out of
    // the file the guard was inspecting. So the self-check names declarations
    // that must survive.
    for (const decl of ["BUILD_VERSION", "FRESH_WINDOW_DAYS", "SITEMAP_DAYS", "NAME_SYNC_VERSION"]) {
      expect(
        new RegExp(`^\\s*(?:export\\s+)?const\\s+${decl}\\s*=`, "m").test(INDEX),
        `${decl} did not survive the comment strip — this guard is reading a file with a hole in it`,
      ).toBe(true);
    }
    // And the strip really did remove comments, or the assertions above are
    // reading prose. Both phrases are comment text in their own file today.
    expect(INDEX_RAW).toContain("Returning null here is a measured fact");
    expect(INDEX).not.toContain("Returning null here is a measured fact");
    expect(NORMALIZE_RAW).toContain("NOTHING HERE READS THE APPLY URL");
    expect(NORMALIZE).not.toContain("NOTHING HERE READS THE APPLY URL");
  });
});
