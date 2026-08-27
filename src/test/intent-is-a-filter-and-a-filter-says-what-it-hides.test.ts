import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * SIX list exits since routed retrieval landed (recency, ranked, fuzzy,
 * semantic, exact-word, routed). The count is asserted rather than a minimum
 * precisely so that adding an exit FAILS here and forces every disclosure
 * onto it — which is what happened, again, and is why this number keeps
 * moving.
 *
 * FIVE list exits since the simple-config tier landed (recency, ranked,
 * fuzzy, semantic, exact-word). The count is asserted rather than a minimum
 * precisely so that ADDING an exit fails here and forces the author to carry
 * every disclosure onto it — which is what happened.
 *
 * THE BOARD READ INTENT AS TEXT, AND HID MOST OF ITSELF WITHOUT SAYING SO.
 *
 * Three defects, one theme: the searcher's words and the board's filters were
 * not speaking to each other.
 *
 * 1. "work from home" MEASURED at 287 results against 43,929 postings flagged
 *    remote — 0.7% of the inventory. The most common consumer phrasing for
 *    remote work was matched as literal title text while the remote filter,
 *    already indexed and already bound by every path, sat unused.
 *
 * 2. A filter silently discards the rows whose value the board does not know.
 *    Measured against 599,316 open postings: salary is stated on 12.9%, work
 *    mode on 29.9%, experience on 40.4%. Setting a salary floor removes 87% of
 *    the board and nothing on screen says so — the searcher believes they are
 *    looking at the market.
 *
 * 3. The headline published 614,231 against 600,072 rows anyone could actually
 *    page to. A total larger than the set it describes is not a rounding
 *    difference.
 */
const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");

/** The shipped intent table, reconstructed so the tests exercise real entries. */
const ENTRIES = (() => {
  const block = /const INTENT_FILTERS[\s\S]*?\n\];/.exec(FN)?.[0] ?? "";
  return [...block.matchAll(/\{ re: (\/.*?\/i), label: "([^"]+)", patch: (\{[^}]*\}) \}/g)]
    .map((m) => ({ src: m[1], label: m[2], patch: m[3] }));
})();

describe("intent becomes a filter, and a filter says what it hides", () => {
  it("parsed the shipped table — otherwise every assertion below is vacuous", () => {
    expect(ENTRIES.length, "INTENT_FILTERS did not parse").toBeGreaterThan(8);
  });

  it("maps the phrasing that was returning 0.7% of the inventory", () => {
    // ONE SPELLING OF "REMOTE", AND IT IS workMode. These used to patch
    // {remote: true}. filters.ts resolves `remote: body.remote === true &&
    // !workMode`, so the mode is the field that wins, and it is also strictly
    // wider: measured 2026-08-27, work_mode='remote' is 43,773 servable rows
    // where remote=true is 40,325, and remote=true with work_mode NULL is ZERO.
    // The boolean was a partial denormalisation of the mode and binding it
    // silently withheld 3,504 postings the board itself calls remote.
    const remotes = ENTRIES.filter((e) => e.patch.includes('workMode: "remote"')).map((e) => e.label);
    expect(remotes, "work from home must reach the work-mode filter").toContain("work from home");
    for (const l of ["wfh", "telecommute", "home based"]) {
      expect(remotes, `${l} is the same intent`).toContain(l);
    }
    expect(
      ENTRIES.filter((e) => e.patch.includes("remote: true")),
      "no entry may bind the narrower boolean — two spellings of remote is the drift that makes counts disagree",
    ).toEqual([]);
  });

  it("lifts the bare work-mode words too, and the 2.7% residue is measured not assumed", () => {
    // THIS TEST USED TO ASSERT THE OPPOSITE. It banned the bare word "remote"
    // on the theory that a searcher might mean a job title ("Remote Support
    // Technician") and that lifting it would discard "the 70% of the board with
    // no work_mode recorded". The 70% describes work_mode being NULL; the lift
    // patches a work-mode EQUALITY, so that figure never applied. Counted live
    // on 2026-08-27 over the servable board, the real ambiguity is:
    //
    //   titles containing "remote"  6,119, of which NOT work_mode=remote   168  (2.7%)
    //   titles containing "hybrid"  2,093, of which NOT work_mode=hybrid    41  (2.0%)
    //   titles containing "onsite"  1,790, of which NOT work_mode=onsite    69  (3.9%)
    //
    // while the ban itself was costing far more than it saved — exact title-tier
    // counts, word in the query vs word lifted to the filter: "remote python"
    // 3 -> 200, "remote data analyst" 8 -> 197, "remote nurse" 162 -> 415,
    // "remote accountant" 238 -> 242. Never fewer, and up to 66x more.
    const byLabel = (l: string) => ENTRIES.find((e) => e.label === l);
    for (const [label, mode] of [["remote", "remote"], ["hybrid", "hybrid"], ["onsite", "onsite"]]) {
      const e = byLabel(label);
      expect(e, `the bare word "${label}" must be lifted`).toBeDefined();
      expect(e!.patch, `"${label}" must bind work_mode=${mode}`).toContain(`workMode: "${mode}"`);
    }

    // ORDER IS LOAD-BEARING: a bare word must never shred a longer phrase above
    // it. "remote only" and every multi-word remote phrase must be matched
    // before /\bremote(?:ly)?\b/ gets a chance to eat the word.
    const idx = (l: string) => ENTRIES.findIndex((e) => e.label === l);
    for (const phrase of ["work from home", "wfh", "telecommute", "home based", "remote only"]) {
      expect(idx(phrase), `"${phrase}" must precede the bare word "remote"`).toBeLessThan(idx("remote"));
    }

    // WHAT MAKES THE LIFT HONEST IS THE DISCLOSURE, NOT THE ODDS. A searcher who
    // did mean the literal title text has to be able to see what happened; at
    // 2.7% a SILENT lift would still be the wrong trade.
    expect(byLabel("remote")!.label, "the lift must carry a renderable label").toBe("remote");
    expect(FN).toContain("function intentDisclosure");
  });

  it("cannot let one work-mode word silently overwrite another", () => {
    // q="remote hybrid analyst" matches two rules that write the SAME key. A
    // plain Object.assign would let "hybrid" replace "remote" while the
    // disclosure named both — the response asserting two filters it never
    // applied. First rule wins; the loser's words stay in the query and come
    // back as droppedTerms.
    expect(
      /const clash = Object\.keys\(p\)\.find\(\(k\) => k in patch && patch\[k\] !== p\[k\]\);/.test(FN)
        && /if \(clash\) continue;/.test(FN),
      "a second rule writing an already-lifted key must be skipped, not applied",
    ).toBe(true);
    // A rule that merely RESTATES a lift already made still has its words
    // stripped — leaving them re-imposes the literal match — but must not be
    // named twice in the disclosure.
    expect(
      /const restates = Object\.keys\(p\)\.every\(\(k\) => k in patch && patch\[k\] === p\[k\]\);/.test(FN),
      "a restating rule must strip its words without duplicating the disclosure label",
    ).toBe(true);
    expect(/if \(!restates\) labels\.push\(label\);/.test(FN)).toBe(true);
  });

  it("removes the lifted phrase from the query", () => {
    // Leaving it in re-imposes the literal-text match the lift exists to
    // escape: "work from home nurse" must search for "nurse" among remote
    // roles, not for the whole string.
    expect(/residual = residual\.replace\(re, " "\)/.test(FN)).toBe(true);
    expect(/q: intentLift\.residualQ/.test(FN)).toBe(true);
  });

  it("never overrides a filter the caller set themselves — BY ANY OF ITS NAMES", () => {
    // Someone who set remote=false and typed "work from home" has contradicted
    // themselves, and the explicit control is the one they can see and change.
    //
    // This used to pin the literal `body[k]` check, and passed while the guard
    // was HALF BUILT. The patch sets `remote`, so it only ever looked at
    // body.remote — but filters.ts resolves `remote: body.remote === true &&
    // !workMode`, so workMode is the field that actually wins. A caller sending
    // workMode=onsite with q="work from home nurse" got the phrase stripped from
    // the query AND the injected remote:true discarded downstream, returning
    // 2,205 rows byte-identical to q="nurse"+onsite while the payload claimed
    // intentFilters ["work from home"]. The words were deleted from the search,
    // the filter was thrown away, and the response asserted both had applied.
    //
    // So the property is "no field that speaks for this patch was set", not
    // "the patch's own key was set".
    expect(FN).toMatch(/const INTENT_CONFLICTS: Record<string, string\[\]> = \{/);
    expect(
      /INTENT_CONFLICTS\[k\] \?\? \[k\]\)\.some\(\(f\) => body\[f\] !== undefined && body\[f\] !== null\)/.test(FN),
      "the skip guard must consult every field that speaks for the patched one",
    ).toBe(true);
    // workMode wins over remote in filters.ts, so it must appear here.
    expect(FN).toMatch(/remote: \["remote", "workMode"\]/);
    // postedAfter and maxAgeDays are one question asked two ways.
    expect(FN).toMatch(/maxAgeDays: \["maxAgeDays", "postedAfter"\]/);
    // Every patch key any INTENT_FILTERS entry sets must have an entry, or the
    // next phrase added silently reverts to the half-built behaviour.
    const entries = [...FN.matchAll(/patch: \{ (\w+):/g)].map((m) => m[1]);
    expect(entries.length, "no INTENT_FILTERS patches found").toBeGreaterThan(0);
    const conflicts = FN.slice(FN.indexOf("const INTENT_CONFLICTS"), FN.indexOf("};", FN.indexOf("const INTENT_CONFLICTS")));
    for (const k of new Set(entries)) {
      expect(conflicts, `INTENT_CONFLICTS has no entry for patch key "${k}"`).toContain(`${k}:`);
    }
  });

  it("ACTUALLY APPLIES the lift — the sibling feature lost exactly this and stayed green", () => {
    // The employer route shipped with its body-rewrite accidentally deleted and
    // all eight of its tests passed, because they checked that the intent was
    // COMPUTED and DISCLOSED, never that it was APPLIED. The same hole is
    // possible here and is closed by name.
    expect(
      /if \(intentLift\) \{\s*\n\s*body = \{ \.\.\.body, \.\.\.intentLift\.patch, q: intentLift\.residualQ \};/.test(FN),
      "the intent lift must REWRITE the request — otherwise 'work from home' is still 287 " +
        "results while the response claims a remote filter was applied",
    ).toBe(true);
  });

  it("runs once, before the single filter derivation, and is disclosed everywhere", () => {
    const liftAt = FN.indexOf("const intentLift = liftIntentFilters");
    const normAt = FN.indexOf("const { applied, ignored: ignoredFilters");
    expect(liftAt, "intent lift not found").toBeGreaterThan(-1);
    expect(liftAt < normAt, "the lift must precede the filter derivation").toBe(true);
    expect((FN.match(/\.\.\.intentDisclosure\(intentLift\)/g) ?? []).length,
      "a rewritten search must be disclosed on all EIGHT list paths").toBe(8);
  });

  it("reports coverage only for filters that are actually on", () => {
    const H = /function coverageDisclosure\([\s\S]*?\n\}/.exec(FN)?.[0] ?? "";
    expect(H, "coverageDisclosure missing").not.toBe("");
    for (const f of ["salaryFloor", "workMode", "experience"]) {
      expect(H, `${f} coverage must be gated on the filter being applied`).toContain(`applied.${f}`);
    }
    // No cache, no number. An invented fraction is worse than none, because a
    // number on screen gets believed.
    expect(/if \(!cov\) return \{\};/.test(H), "absent coverage must yield nothing, not a guess").toBe(true);
    expect((FN.match(/\.\.\.coverageDisclosure\(applied, meta\)/g) ?? []).length).toBe(8);
  });

  it("counts coverage once per ingest pass, never per request", () => {
    // Four exact counts on a 600k table is nothing once a pass and unaffordable
    // on every search.
    const blk = /const coverage = await \(async \(\) => \{[\s\S]*?\n    \}\)\(\);/.exec(FN)?.[0] ?? "";
    expect(blk, "coverage is not computed in the refresh pass").not.toBe("");
    expect(blk).toContain('head: true');
    expect(/catch \{ return undefined; \}/.test(blk), "a counting failure must leave coverage absent").toBe(true);
  });

  it("publishes the servable count as the headline, degrading to null not zero", () => {
    expect(/const safeMetaTotal = openTotal \?\?/.test(FN)).toBe(true);
    expect(/return Number\.isFinite\(n\) && n > 0 \? n : null;/.test(FN),
      "a missing or NaN open count must become null, never a zero").toBe(true);
  });
});
