// @vitest-environment node
/**
 * NO PERMISSIVE SOURCE IS WITHHELD.
 *
 * WHAT HAPPENED. The legal ledger of 2026-11-16 read the USAJOBS API terms as
 * an open licence, the same reading that puts five other systems on API4's
 * permissive list. Yet /v1 and the connector withhold USAJOBS by owner
 * decision (OD16), as they withhold SmartRecruiters, and the site says so on
 * the data-API page, the pricing facts and the homepage. API4 now adds an
 * opt-in `source_terms=permissive` filter to /v1 and an embed that serves
 * permissive systems only, both built from the permissive list. A system on
 * that list and on a withheld list at once would make the API contradict
 * itself: the permissive filter would ask SQL for rows the same API refuses
 * with 451 on every other path, and the embed (which never passes through
 * /v1's withholding) would hand on rows the owner withheld.
 *
 * THE PROPERTY. The permissive list, in both runtimes, shares no member with
 * any withheld list in use today: NO_REDISTRIBUTION_SOURCES in public-api and
 * in agent-mcp (Deno), and MCP_WITHHELD_SOURCES, WITHHELD_SOURCES (pricing)
 * and HOME_WITHHELD_SOURCES (homepage) on the site. And sourceTermsOf answers
 * "conditional" for every withheld system, in both runtimes.
 *
 * HOW IT IS CHECKED. The Deno lists are read off each function's source with
 * line-leading comments removed (neither index.ts can be imported: they call
 * Deno.serve at load); the site lists are imported. Every list must be
 * non-empty and made only of vendor keys the board carries, or "shares no
 * member" would pass over a list the parser failed to read. The TEETH block
 * hands each check a broken copy.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as denoTerms from "../../supabase/functions/public-api/source-terms";
import * as siteTerms from "../config/source-terms";
import { BOARD_VENDORS } from "../../supabase/functions/_shared/board-domains";
import { MCP_WITHHELD_SOURCES } from "../config/mcp-tools";
import { WITHHELD_SOURCES } from "../components/pricing/plan-facts";
import { HOME_WITHHELD_SOURCES } from "../lib/home/board-figures";

type Terms = {
  PERMISSIVE_SOURCES: readonly string[];
  sourceTermsOf: (source: unknown) => { sourceTerms: string; aiTrain: boolean | null };
};
const RUNTIMES: Array<[string, Terms]> = [
  ["public-api/source-terms.ts", denoTerms],
  ["src/config/source-terms.ts", siteTerms],
];

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const API_PATH = "supabase/functions/public-api/index.ts";
const MCP_PATH = "supabase/functions/agent-mcp/index.ts";

/**
 * Line-leading comments removed: a line that starts with a line comment, and
 * a block comment that opens a line. A marker in the middle of a line is left
 * alone, because there it is usually inside a string or a URL.
 */
function stripLeadingComments(src: string): string {
  return src.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, "").replace(/^[ \t]*\/\/[^\n]*$/gm, "");
}

/** The members of the function's `const NO_REDISTRIBUTION_SOURCES = [...] as const;`. Throws when it is not a literal list. */
function withheldIn(code: string): string[] {
  const found = [...code.matchAll(/const NO_REDISTRIBUTION_SOURCES = \[([^\]]*)\] as const;/g)];
  if (found.length !== 1) {
    throw new Error(`expected one literal NO_REDISTRIBUTION_SOURCES, found ${found.length} -- RE-ANCHOR this guard`);
  }
  return [...found[0][1].matchAll(/"([^"]*)"/g)].map((x) => x[1]);
}

/** Why a withheld list cannot be trusted to have been read: empty, or naming something that is not a vendor key. */
function unreadable(list: readonly string[]): string[] {
  if (list.length === 0) return ["empty"];
  return list.filter((s) => !(BOARD_VENDORS as readonly string[]).includes(s)).map((s) => `not a vendor key: ${s}`);
}

/** Systems on both lists. */
const overlap = (permissive: readonly string[], withheld: readonly string[]): string[] =>
  permissive.filter((s) => withheld.includes(s));

/** Withheld systems a runtime would label permissive. */
const labelledPermissive = (t: Terms, withheld: readonly string[]): string[] =>
  withheld.filter((s) => t.sourceTermsOf(s).sourceTerms !== "conditional");

const WITHHELD: Array<[string, readonly string[]]> = [
  [`${API_PATH} NO_REDISTRIBUTION_SOURCES`, withheldIn(stripLeadingComments(read(API_PATH)))],
  [`${MCP_PATH} NO_REDISTRIBUTION_SOURCES`, withheldIn(stripLeadingComments(read(MCP_PATH)))],
  ["src/config/mcp-tools.ts MCP_WITHHELD_SOURCES", MCP_WITHHELD_SOURCES],
  ["src/components/pricing/plan-facts.ts WITHHELD_SOURCES", WITHHELD_SOURCES],
  ["src/lib/home/board-figures.ts HOME_WITHHELD_SOURCES", HOME_WITHHELD_SOURCES],
];

describe("the permissive list and the withheld lists never meet", () => {
  it("every withheld list was read: non-empty and made of vendor keys the board carries", () => {
    for (const [where, list] of WITHHELD) expect(unreadable(list), where).toEqual([]);
  });

  it("no permissive system, in either runtime, is on any withheld list", () => {
    for (const [runtime, t] of RUNTIMES) {
      expect(t.PERMISSIVE_SOURCES.length, runtime).toBeGreaterThan(0);
      for (const [where, list] of WITHHELD) expect(overlap(t.PERMISSIVE_SOURCES, list), `${runtime} vs ${where}`).toEqual([]);
    }
  });

  it("every withheld system's rows would be labelled conditional, in both runtimes", () => {
    for (const [runtime, t] of RUNTIMES) {
      for (const [where, list] of WITHHELD) expect(labelledPermissive(t, list), `${runtime} vs ${where}`).toEqual([]);
    }
  });

  it("a system on every withheld list is labelled conditional, whatever its terms read as", () => {
    // Positive control on real members: the systems every list agrees on
    // (USAJOBS, read as open, among them) exist and are labelled conditional,
    // so the checks above are not passing over an empty case.
    const both = WITHHELD.map(([, list]) => list).reduce((a, b) => a.filter((s) => b.includes(s)));
    expect(both.length).toBeGreaterThan(0);
    for (const [, t] of RUNTIMES) for (const s of both) expect(t.sourceTermsOf(s).sourceTerms, s).toBe("conditional");
  });
});

describe("TEETH: each check fails when a withheld system turns permissive", () => {
  it("notices a permissive list that gains a withheld system", () => {
    const grown = [...denoTerms.PERMISSIVE_SOURCES, MCP_WITHHELD_SOURCES[0]];
    expect(overlap(grown, MCP_WITHHELD_SOURCES)).toEqual([MCP_WITHHELD_SOURCES[0]]);
  });

  it("notices a withheld list that gains a permissive system", () => {
    const api = stripLeadingComments(read(API_PATH));
    const widened = api.replace(
      /const NO_REDISTRIBUTION_SOURCES = \[([^\]]*)\] as const;/,
      `const NO_REDISTRIBUTION_SOURCES = [$1, "${denoTerms.PERMISSIVE_SOURCES[0]}"] as const;`,
    );
    expect(widened, "the mutation did not apply -- RE-ANCHOR this tooth").not.toBe(api);
    expect(overlap(denoTerms.PERMISSIVE_SOURCES, withheldIn(widened))).toEqual([denoTerms.PERMISSIVE_SOURCES[0]]);
  });

  it("notices a runtime that labels a withheld system permissive", () => {
    const leaky: Terms = {
      PERMISSIVE_SOURCES: siteTerms.PERMISSIVE_SOURCES,
      sourceTermsOf: (s) => ({ sourceTerms: "permissive", aiTrain: siteTerms.sourceTermsOf(s).aiTrain }),
    };
    expect(labelledPermissive(leaky, MCP_WITHHELD_SOURCES)).toEqual([...MCP_WITHHELD_SOURCES]);
  });

  it("refuses an empty or unreadable withheld list instead of passing over it", () => {
    expect(unreadable([])).toEqual(["empty"]);
    expect(unreadable(["usajob"])).toEqual(["not a vendor key: usajob"]);
    const api = stripLeadingComments(read(MCP_PATH));
    const computed = api.replace(/const NO_REDISTRIBUTION_SOURCES = \[[^\]]*\] as const;/, "const NO_REDISTRIBUTION_SOURCES = readList();");
    expect(computed, "the mutation did not apply -- RE-ANCHOR this tooth").not.toBe(api);
    expect(() => withheldIn(computed)).toThrow(/RE-ANCHOR/);
  });

  it("does not read a withheld list out of a comment", () => {
    const raw = read(MCP_PATH);
    const real = /const NO_REDISTRIBUTION_SOURCES = \[[^\]]*\] as const;/;
    const proseOnly = `// const NO_REDISTRIBUTION_SOURCES = ["greenhouse"] as const;\n${raw.replace(real, "const NO_REDISTRIBUTION_SOURCES = readList();")}`;
    expect(proseOnly).not.toBe(raw);
    expect(() => withheldIn(stripLeadingComments(proseOnly))).toThrow(/RE-ANCHOR/);
    const blockOnly = `/*\n const NO_REDISTRIBUTION_SOURCES = ["greenhouse"] as const;\n*/\n${raw.replace(real, "const NO_REDISTRIBUTION_SOURCES = readList();")}`;
    expect(() => withheldIn(stripLeadingComments(blockOnly))).toThrow(/RE-ANCHOR/);
  });
});
