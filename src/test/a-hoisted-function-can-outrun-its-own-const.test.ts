import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * RANKED SEARCH WAS DOWN IN PRODUCTION AND NOTHING SAID SO.
 *
 * Measured live on .19: no response to any query carried `ranked: true`.
 * Every typed search — "nurse", "welder", "engineer", "c++", filtered,
 * sorted — was being served by the recency/ILIKE fallback.
 *
 * The mechanism is a temporal-dead-zone read that TYPE-CHECKS CLEAN.
 * `facetHead` is a function DECLARATION, so it hoists and the ranked return
 * can name it ~300 lines before its source position; tsc and the deno gate
 * both accept that. But it closes over `const FACET_COMPANY_LIMIT`, which was
 * declared down beside the recency path. Calling the hoisted function before
 * that `const` initialises throws ReferenceError, and the ranked path's
 * `catch { /* fall through to recency path *\/ }` swallowed it whole.
 *
 * What made it visible: a query matching nothing in the TITLE tier but plenty
 * in the description tier served an EMPTY page. q="forklift certified" —
 * 741 description matches in the RPC, 0 rows on the board. Also measured:
 * "elderly bathe" 115 -> 0, "night shift forklift certified" 108 -> 0.
 *
 * It hid so long because the failure is INVERTED. Queries with zero ranked
 * rows never reach the bad call — the rescue ladder returns first — so typo
 * rescue ("nurrse") kept working perfectly while every ordinary search was
 * silently degraded.
 */
const FN = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"),
  "utf8",
);
// Comments stripped — this fix ADDS comments naming every identifier asserted
// below. Whole-line only, for the URL-truncation reason the sibling files give.
const CODE = FN.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").map((l) => (/^\s*\/\//.test(l) ? "" : l)).join("\n");

describe("a hoisted function can outrun its own const", () => {
  it("FACET_COMPANY_LIMIT is initialised before the first facetHead call", () => {
    const declared = CODE.indexOf("const FACET_COMPANY_LIMIT =");
    const firstCall = CODE.indexOf("facetHead(");
    expect(declared, "FACET_COMPANY_LIMIT is gone").toBeGreaterThan(-1);
    expect(firstCall, "facetHead is never called").toBeGreaterThan(-1);
    // The declaration must precede every call site, not merely exist. A
    // hoisted callee with a TDZ const behind it is the whole bug.
    expect(
      declared,
      "facetHead is called before FACET_COMPANY_LIMIT initialises — ranked search will ReferenceError into the recency fallback",
    ).toBeLessThan(firstCall);
  });

  it("the function declaration itself also precedes its calls", () => {
    const declared = CODE.indexOf("function facetHead(");
    const firstCall = CODE.indexOf("facetHead(", declared === -1 ? 0 : declared + 1);
    expect(declared).toBeGreaterThan(-1);
    expect(declared, "facetHead is defined after it is used").toBeLessThan(firstCall);
  });

  it("the ranked path still marks its own responses", () => {
    // `ranked: true` is the only field that distinguishes a ranked answer from
    // the recency fallback. Without it the outage is unobservable from outside,
    // which is exactly how it survived.
    expect(CODE).toMatch(/ranked: true,/);
  });

  it("a ranked-path failure is never silent again", () => {
    // The fallback is correct and stays. The silence is what has to go.
    expect(CODE, "the ranked catch swallows its error without a word")
      .not.toMatch(/\} catch \{ \/\* fall through to recency path \*\/ \}/);
    expect(CODE).toMatch(/console\.error\(`\[JOB-BOARD\] ranked path failed, serving recency instead/);
    expect(CODE, "the fallback is not reportable without shell access to logs")
      .toMatch(/\.\.\.\(rankedFellBack \? \{ rankedFellBack \} : \{\}\)/);
  });

  it("no OTHER binding the facet helper closes over sits below it", () => {
    // Generalised guard for the same class: every enclosing-scope binding
    // facetHead reads must be initialised before the helper is CALLED, whether
    // it arrives as a plain const or out of a destructure.
    const body = CODE.slice(CODE.indexOf("function facetHead("));
    const src = body.slice(0, body.indexOf("\n  }"));
    const firstCall = CODE.indexOf("facetHead(");
    const declIndex = (name: string) => {
      const direct = [`const ${name} =`, `const ${name}:`]
        .map((pat) => CODE.indexOf(pat)).filter((i) => i > -1);
      // `const { applied, ignored: … } = …` — a destructure is still a const
      // binding with a temporal dead zone.
      const destructured = new RegExp(`const \\{[^}]*\\b${name}\\b[^}]*\\}\\s*=`).exec(CODE);
      const all = [...direct, ...(destructured ? [destructured.index] : [])];
      return all.length ? Math.min(...all) : -1;
    };
    let checked = 0;
    for (const name of ["FACET_COMPANY_LIMIT", "applied"]) {
      if (!src.includes(name)) continue;
      const decl = declIndex(name);
      expect(decl, `${name} is closed over by facetHead but never declared`).toBeGreaterThan(-1);
      expect(decl, `${name} initialises after facetHead is called — same TDZ trap`).toBeLessThan(firstCall);
      checked++;
    }
    // A guard that resolved nothing would pass vacuously.
    expect(checked, "the guard checked no bindings at all").toBeGreaterThanOrEqual(2);
  });
});
