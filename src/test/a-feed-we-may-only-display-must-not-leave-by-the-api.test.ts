// @vitest-environment node
//
// Node, not jsdom: this file compiles the real edge-function source with
// esbuild, and esbuild refuses to run where `new TextEncoder().encode("")` is
// not a real Uint8Array — which is what jsdom's globals hand it. Same reason,
// same docblock, as a-window-of-ours-is-not-a-closure-of-theirs.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { BOARD_VENDORS } from "../../supabase/functions/_shared/board-domains";

/**
 * A FEED WE MAY ONLY DISPLAY MUST NOT LEAVE BY THE API.
 *
 * WHAT THIS GUARDS. The board carries a U.S. federal job adapter whose terms
 * of use permit DISPLAYING the government's results to a person and forbid
 * republishing them as a standalone data feed. resumebooster.work showing a
 * federal role is inside those terms. Handing the same row to /v1 — a feed
 * sold to someone else's code, which may store it, resell it and mirror it —
 * is not, and neither is handing it to an MCP host, which is the same act
 * with a different transport.
 *
 * WHY IT IS A GUARD AND NOT A CODE REVIEW. The gap is ARMED, not open: the
 * adapter skips every visit unless two secrets are set, so the board holds
 * zero federal rows today and every one of these surfaces would begin
 * republishing on the day the owner sets them. A defect that only appears on
 * a future configuration change is exactly the kind no reviewer catches — the
 * board has shipped a missing serving fence five separate times on paths that
 * looked right when they were written.
 *
 * THE PROPERTY, stated once: no public redistribution surface can return a
 * posting row whose source is on the no-redistribution list, and asking for
 * one by name is refused with the reason rather than answered with an empty
 * page. An empty 200 would be this product making a false statement about the
 * world ("there are no federal jobs") in place of a true one about its licence.
 *
 * HOW IT IS CHECKED. Every literal below is read off COMMENT-STRIPPED code,
 * because writing a guard's literal in a comment has passed a dead guard in
 * this repo several times over. And the central claim is not a spelling at
 * all: the shipped filter is extracted from each function's source,
 * transpiled, and RUN over rows, so a guard that pins the right words over
 * dead code fails here too. Every parser is a pure function of a source text,
 * so the teeth block at the bottom can hand each one a broken copy and prove
 * the assertion moves.
 *
 * The two vendor lists are declared separately in the two functions on
 * purpose — neither bundle may import the other's directory — so this file is
 * also the thing holding them together. A shared module under
 * supabase/functions/_shared/ would be better and is the next step; until it
 * exists, the mirror assertion is what stops the second list drifting.
 */

const ROOT = resolve(__dirname, "../..");
const API_PATH = "supabase/functions/public-api/index.ts";
const MCP_PATH = "supabase/functions/agent-mcp/index.ts";

/**
 * Comments removed, strings kept. Stricter than the whole-line idiom used
 * elsewhere here: a TRAILING `//` is cut too, unless the quote characters
 * before it on that line are unbalanced — which is what keeps `https://` and
 * every other URL inside a string literal intact.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => {
      for (let i = 0; i + 1 < line.length; i++) {
        if (line[i] !== "/" || line[i + 1] !== "/") continue;
        const before = line.slice(0, i);
        const even = (ch: string) => (before.split(ch).length - 1) % 2 === 0;
        if (even('"') && even("'") && even("`")) return before;
      }
      return line;
    })
    .join("\n");
}

/**
 * The full text of `const <name> = ...;` — to the semicolon that closes it at
 * bracket depth zero, outside every string. Used to lift the shipped helpers
 * out of a file that cannot be imported (it calls Deno.serve at module load
 * and imports from esm.sh).
 */
function declOf(code: string, name: string): string {
  const start = code.indexOf(`const ${name} =`);
  if (start < 0) throw new Error(`declaration not found: ${name} — RE-ANCHOR this guard`);
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < code.length; i++) {
    const ch = code[i];
    if (quote) {
      if (ch === "\\") { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === ";" && depth === 0) return code.slice(start, i + 1);
  }
  throw new Error(`unterminated declaration: ${name}`);
}

/** The members of a `const NAME = [...] as const;` string array. */
function listOf(code: string, name: string): string[] {
  const decl = declOf(code, name);
  return [...decl.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * The shipped exclusion helpers, transpiled and executed. This is the part
 * that cannot be satisfied by a comment or by dead code: the functions under
 * test are the ones the edge function actually ships.
 */
function shippedFilter(code: string, extra: string[] = []) {
  const names = ["NO_REDISTRIBUTION_SOURCES", "isNoRedistributionSource", "withoutNoRedistribution", ...extra];
  const ts = names.map((n) => declOf(code, n)).join("\n");
  const js = transformSync(ts, { loader: "ts" }).code;
  return new Function(`${js}\nreturn { ${names.join(", ")} };`)() as {
    NO_REDISTRIBUTION_SOURCES: readonly string[];
    isNoRedistributionSource: (v: unknown) => boolean;
    withoutNoRedistribution: <T extends Record<string, unknown>>(rows: T[]) => T[];
    vendorOfId?: (id: unknown) => string;
  };
}

/**
 * Every place the MCP server asks the board for one posting, and whether the
 * function it sits in checked the id's vendor FIRST.
 *
 * COUNTED, NOT ENUMERATED, and that is the whole repair. The previous shape of
 * this guard named the runners it knew about — detailOf, runCheckJobsOpen,
 * runSearchAlias, runFetchAlias, searchBody — and check_apply_support, a tool
 * any free minted key reaches, was not among them. It asked the board for the
 * posting directly and handed back its apply URL for ANY id: strictly more
 * than the liveness tool that was closed beside it, under a guard that was
 * green. A list of surfaces is a list of the ones somebody remembered.
 *
 * The enclosing function is found by walking BACK to the nearest top-level
 * declaration, so a new reader is inside the count the moment it is written.
 */
function detailCallSites(code: string): { total: number; unguarded: string[] } {
  const CHECK = "isNoRedistributionSource(vendorOfId(";
  const unguarded: string[] = [];
  const hits = [...code.matchAll(/board\(\{\s*action:\s*"detail"/g)];
  for (const m of hits) {
    const at = m.index ?? 0;
    const decl = [...code.slice(0, at).matchAll(/\n(?:export )?(?:async )?function (\w+)\(/g)].pop();
    const from = decl?.index ?? 0;
    const name = decl?.[1] ?? "(top level)";
    if (!code.slice(from, at).includes(CHECK)) unguarded.push(name);
  }
  return { total: hits.length, unguarded };
}

/**
 * check_apply_support's shipped runner, lifted and executed with a board that
 * answers every id. Same technique shippedFilter uses, for the same reason: a
 * spelling assertion over this function passed while it leaked.
 */
function shippedApplySupport(code: string) {
  const decls = ["NO_REDISTRIBUTION_SOURCES", "isNoRedistributionSource", "vendorOfId", "NO_REDISTRIBUTION_REASON", "SITE_JOB_URL"]
    .map((n) => declOf(code, n)).join("\n");
  const ts = [
    decls,
    'const SENDABLE_VENDORS: string[] = ["greenhouse", "lever"];',
    "let boardCalls = 0;",
    'const board = async (_b: unknown): Promise<Record<string, unknown>> => { boardCalls += 1; return { job: { applyUrl: "https://federal.example/apply/912345" } }; };',
    'const applyRequirements = (): string[] => ["an account-linked key"];',
    fnBody(code, "async function runCheckApplySupport("),
    "const boardCallCount = () => boardCalls;",
  ].join("\n");
  const js = transformSync(ts, { loader: "ts" }).code;
  return new Function(`${js}\nreturn { runCheckApplySupport, boardCallCount };`)() as {
    runCheckApplySupport: (client: unknown, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
    boardCallCount: () => number;
  };
}

/** Direct corpus reads in /v1 — the row shapes a caller can be handed. */
const directReadSites = (code: string) =>
  (code.match(/from\("job_board_(?:postings|closures)"\)/g) ?? []).length;

/** Those same reads with the exclusion bound in SQL. */
const sqlExclusions = (code: string) =>
  (code.match(/\.not\("source", "in", NO_REDISTRIBUTION_IN\)/g) ?? []).length;

/**
 * Every place a board `list` answer is unpacked into rows. A site is GUARDED
 * when the filter call appears in the text immediately before it, which is
 * the only shape either file uses.
 */
function jobListSites(code: string): { total: number; unguarded: number } {
  const hits = [...code.matchAll(/Array\.isArray\(\w+\.jobs\)/g)];
  let unguarded = 0;
  for (const m of hits) {
    const at = m.index ?? 0;
    if (!code.slice(Math.max(0, at - 240), at).includes("withoutNoRedistribution(")) unguarded++;
  }
  return { total: hits.length, unguarded };
}

const RAW_API = readFileSync(resolve(ROOT, API_PATH), "utf8");
const RAW_MCP = readFileSync(resolve(ROOT, MCP_PATH), "utf8");
const API = stripComments(RAW_API);
const MCP = stripComments(RAW_MCP);

/** The vendor code this whole file exists for. Named HERE, in the test, so the
 *  guard specifies the boundary rather than reading it back off the code it is
 *  checking — two files that both dropped it would otherwise still agree. */
const FEDERAL = "usajobs";

describe("a feed we may only display must not leave by the API", () => {
  it("both redistribution surfaces declare the same closed list of sources", () => {
    const api = listOf(API, "NO_REDISTRIBUTION_SOURCES");
    const mcp = listOf(MCP, "NO_REDISTRIBUTION_SOURCES");
    expect(api.length, "the list is empty — every assertion below would be vacuous").toBeGreaterThan(0);
    expect(mcp, "the MCP server's list has drifted from the public API's").toEqual(api);
    expect(api, "the federal feed is the source this boundary exists for").toContain(FEDERAL);
  });

  it("every source on the list is a vendor the board actually carries", () => {
    // A typo here is the quietest possible way to turn the whole boundary
    // into a no-op: every filter still runs, matches nothing, and ships.
    for (const s of listOf(API, "NO_REDISTRIBUTION_SOURCES")) {
      expect(BOARD_VENDORS as readonly string[], `${s} is not a vendor code the board serves`).toContain(s);
    }
  });

  it("every direct posting and closure read in /v1 binds the exclusion in SQL", () => {
    // COUNTED AGAINST THE READ SITES, not against a floor. "At least one
    // exclusion exists" passes just as happily with a fourth read path that
    // has none — which is exactly how this file's freshness fences came to be
    // counted in pairs after /v1/jobs/{id} shipped with one of the two.
    const sites = directReadSites(API);
    expect(sites, "no corpus reads found — RE-ANCHOR this guard").toBeGreaterThanOrEqual(2);
    expect(sqlExclusions(API), `${sites} corpus reads but only ${sqlExclusions(API)} exclude the restricted sources`)
      .toBe(sites);
  });

  it("every proxied row list in both surfaces is filtered before it is returned", () => {
    // job-board has a vendor-INCLUSION filter and no exclusion, so the three
    // proxying paths (engine=ranked, POST /v1/fit, and every MCP search) can
    // only drop the rows on the way back out. Each unpacking site is checked,
    // rather than trusting that the one someone remembered covers them all.
    for (const [name, code] of [["public-api", API], ["agent-mcp", MCP]] as const) {
      const { total, unguarded } = jobListSites(code);
      expect(total, `${name}: no board row lists found — RE-ANCHOR this guard`).toBeGreaterThan(0);
      expect(unguarded, `${name}: ${unguarded} of ${total} board row lists are returned unfiltered`).toBe(0);
    }
  });

  it("the shipped filter, run over rows, drops the sources it names", () => {
    // THE ASSERTION A DEAD GUARD CANNOT PASS. The code below is lifted out of
    // each function verbatim and executed; nothing here reads a spelling.
    const rows = [
      { id: "greenhouse:acme:1", source: "greenhouse" },
      { id: `${FEDERAL}:${FEDERAL}:2`, source: FEDERAL },
      { id: "lever:acme:3", source: "lever" },
      // Case and whitespace are the shapes a vendor string arrives in when it
      // has been round-tripped through a query string or a tool argument.
      { id: "x:y:4", source: ` ${FEDERAL.toUpperCase()} ` },
      { id: "z:w:5", source: null },
    ];
    for (const [name, code] of [["public-api", API], ["agent-mcp", MCP]] as const) {
      const f = shippedFilter(code);
      const kept = f.withoutNoRedistribution(rows);
      expect(kept.map((r) => r.id), `${name}: a restricted row survived the filter`)
        .toEqual(["greenhouse:acme:1", "lever:acme:3", "z:w:5"]);
      expect(f.isNoRedistributionSource(FEDERAL), `${name}: the predicate does not recognise its own list`).toBe(true);
      expect(f.isNoRedistributionSource("greenhouse"), `${name}: the predicate excludes a vendor it must serve`).toBe(false);
    }
  });

  it("asking for an excluded source by name is refused, never answered with an empty page", () => {
    // 451 is the status whose entire meaning is a legal restriction. An empty
    // 200 here would be the API stating that the board carries no federal
    // roles, which is a claim about the world and not about our licence.
    expect(API, "the source filter does not test the restricted list at all")
      .toMatch(/asked\.filter\(isNoRedistributionSource\)/);
    expect(API, "the refusal is not a 451 naming its own code")
      .toMatch(/fail\(451, "source_not_redistributable"/);
    // The MCP server has no status codes; its equivalent is the in-band
    // argument error, which reaches the agent with a fix it can apply.
    const searchBody = fnBody(MCP, "function searchBody(args: Record<string, unknown>)");
    expect(searchBody, "the vendor argument is not checked against the restricted list")
      .toMatch(/isNoRedistributionSource/);
    expect(searchBody, "a restricted vendor argument does not raise an argument error")
      .toMatch(/throw new ToolArgumentError\(/);
    // AND THE OTHER DOOR INTO THE SAME POPULATION. Every row of the restricted
    // feed carries ONE employer token and it is the source's own name, so
    // `companies` (and ?company_token= in /v1) reaches exactly what `vendor`
    // refuses. The rows are dropped either way, so what leaked was not data —
    // it was the empty answer, which says "this employer has no openings"
    // when the true sentence is about a licence. Both arguments, counted.
    expect((searchBody.match(/isNoRedistributionSource/g) ?? []).length,
      "only one of the two arguments that reach the restricted feed is checked").toBeGreaterThanOrEqual(2);
    expect(searchBody, "the employer-token argument is not checked at all").toMatch(/companies\.filter\(isNoRedistributionSource\)/);
    expect(API, "/v1 refuses the restricted source by ?source= but not by the token that names it")
      .toMatch(/f\.param === "source" \|\| f\.param === "company_token"/);
  });

  it("a detail lookup refuses a restricted id before it asks the board", () => {
    // The detail tools are the leak search alone cannot close: an agent that
    // holds an id from the website would otherwise fetch the whole row by it.
    // Refused BEFORE the board call, and as its own reason — "no such job"
    // would be a false statement about a posting that exists.
    const body = fnBody(MCP, "async function detailOf(");
    const guardAt = body.indexOf("isNoRedistributionSource(vendorOfId(id))");
    const boardAt = body.indexOf("await board(");
    expect(guardAt, "detailOf does not check the id's vendor at all").toBeGreaterThan(-1);
    expect(boardAt, "detailOf no longer calls the board — RE-ANCHOR this guard").toBeGreaterThan(-1);
    expect(guardAt, "the restricted check runs after the board has already been asked").toBeLessThan(boardAt);
    expect(body, "a restricted id is folded into notFound instead of naming the reason")
      .toMatch(/reason: "restricted"/);
  });

  it("the liveness tool holds restricted ids out before it applies its cap", () => {
    // A boolean per id is thinner than a row, but walked over a list of ids
    // taken off the website it rebuilds a live/dead federal feed one column at
    // a time. Held out BEFORE the slice, or a restricted id silently consumes
    // one of the slots a checkable id needed.
    const body = fnBody(MCP, "async function runCheckJobsOpen(");
    const heldOut = body.indexOf("isNoRedistributionSource(vendorOfId(id))");
    const capped = body.indexOf("slice(0, CHECK_JOBS_OPEN_MAX)");
    expect(heldOut, "the liveness tool checks no id against the restricted list").toBeGreaterThan(-1);
    expect(capped, "the liveness cap moved — RE-ANCHOR this guard").toBeGreaterThan(-1);
    expect(heldOut, "restricted ids are held out only after the cap has already spent slots on them")
      .toBeLessThan(capped);
    expect(body, "held-out ids are dropped silently instead of being named back")
      .toMatch(/restricted, restrictedNote: NO_REDISTRIBUTION_REASON/);
  });

  it("every place the server asks the board for one posting checks the id's vendor first", () => {
    // THE ASSERTION THAT IS NOT A LIST. Counted against the call sites, like
    // the SQL exclusions in /v1 above: "the detail path is guarded" passes
    // just as happily with a second reader that is not.
    const { total, unguarded } = detailCallSites(MCP);
    expect(total, "no detail reads found in the MCP server — RE-ANCHOR this guard").toBeGreaterThanOrEqual(2);
    expect(unguarded, `${unguarded.length} of ${total} detail reads run without checking the id's vendor: ${unguarded.join(", ")}`)
      .toEqual([]);
  });

  it("the apply-support tool refuses a restricted id and never reaches the board for it", async () => {
    // EXECUTED. This tool returns the posting's apply URL plus confirmation
    // that the id is live, which is more than the liveness tool hands back —
    // and it sat outside the boundary while eight siblings were inside it.
    const f = shippedApplySupport(MCP);
    const out = await f.runCheckApplySupport(null, { id: `${FEDERAL}:${FEDERAL}:912345` });
    expect(out.applyUrl, "the restricted posting's apply URL left by the apply-support tool").toBeUndefined();
    expect(out.restricted, "the refusal does not name itself as one").toBe(true);
    expect(String(out.note ?? ""), "the refusal states no reason").toMatch(/redistribut/i);
    expect(f.boardCallCount(), "the board was asked about a restricted id before the refusal").toBe(0);

    // The control, so the refusal cannot be "this tool answers nothing".
    const ok = await f.runCheckApplySupport(null, { id: "greenhouse:acme:1" });
    expect(ok.applyUrl).toBe("https://federal.example/apply/912345");
    expect(ok.agentReady).toBe(true);
    expect(f.boardCallCount()).toBe(1);
  });

  it("the two aliases inherit the filter instead of reading the board again", () => {
    // search/fetch are the names ChatGPT's research connector calls. They are
    // wrappers, and they must stay wrappers: a second reader here would be a
    // redistribution path with none of the checks above on it.
    const search = fnBody(MCP, "async function runSearchAlias(");
    const fetchAlias = fnBody(MCP, "async function runFetchAlias(");
    expect(search, "the search alias no longer goes through the filtered runner").toMatch(/await runSearchJobs\(/);
    expect(search, "the search alias reads the board directly").not.toMatch(/await board\(/);
    expect(fetchAlias, "the fetch alias no longer goes through the filtered runner").toMatch(/await runGetJob\(/);
    expect(fetchAlias, "the fetch alias reads the board directly").not.toMatch(/await board\(/);
  });

  it("an id's vendor is read the way the board writes it", () => {
    // Executed, not asserted about: the id-prefix reader is what the detail
    // refusal stands on, so a change to id shapes has to fail here.
    const f = shippedFilter(MCP, ["vendorOfId"]);
    expect(f.vendorOfId!(`${FEDERAL}:${FEDERAL}:912345`)).toBe(FEDERAL);
    expect(f.vendorOfId!("greenhouse:acme:1")).toBe("greenhouse");
    expect(f.vendorOfId!("")).toBe("");
    expect(f.isNoRedistributionSource(f.vendorOfId!(`${FEDERAL}:x:1`))).toBe(true);
    expect(f.isNoRedistributionSource(f.vendorOfId!("lever:x:1"))).toBe(false);
  });

  it("the restriction is stated on the surfaces whose numbers still count it", () => {
    // /v1/stats and the employer directory publish the BOARD's population,
    // which includes rows /v1/jobs can no longer return. Under this repo's
    // own rule a published number names its basis, so the gap between them is
    // named rather than left for a customer to find by subtraction.
    expect(API, "/v1 does not document the restriction where a consumer looks first")
      .toMatch(/excludedSources: \[\.\.\.NO_REDISTRIBUTION_SOURCES\]/);
    expect(API, "/v1/stats publishes counts over a wider population without saying so")
      .toMatch(/notRedistributed: \{/);
    expect((API.match(/NO_REDISTRIBUTION_REASON/g) ?? []).length,
      "the reason is stated in fewer places than the paths that apply it")
      .toBeGreaterThanOrEqual(5);
  });
});

/**
 * One top-level function's body: from its declaration to the first brace that
 * closes at column zero. Anchored on the declaration alone — an end anchor
 * naming the NEXT declaration silently runs to the end of the file when that
 * neighbour moves, which is how a "this function does not call the board"
 * assertion reads the whole server and fails for the wrong reason.
 */
function fnBody(code: string, decl: string): string {
  const a = code.indexOf(decl);
  if (a < 0) throw new Error(`anchor not found: ${decl} — RE-ANCHOR this guard`);
  const b = code.indexOf("\n}\n", a);
  if (b < 0) throw new Error(`unterminated function at: ${decl}`);
  return code.slice(a, b + 3);
}

/**
 * TEETH. Each parser above is a pure function of a source text, so each one
 * is handed a copy with the property broken and must report the break. This
 * is the half that keeps the guard from becoming a spelling check: if any
 * assertion could pass over damaged code, it fails here instead.
 */
describe("the guard above fails when the boundary is broken", () => {
  it("notices when one surface's list drifts from the other's", () => {
    const drifted = MCP.replace(/const NO_REDISTRIBUTION_SOURCES = \["[^"]+"\]/, 'const NO_REDISTRIBUTION_SOURCES = ["nope"]');
    expect(listOf(drifted, "NO_REDISTRIBUTION_SOURCES")).not.toEqual(listOf(API, "NO_REDISTRIBUTION_SOURCES"));
  });

  it("notices an emptied list", () => {
    const emptied = API.replace(/const NO_REDISTRIBUTION_SOURCES = \[[^\]]*\]/, "const NO_REDISTRIBUTION_SOURCES = []");
    expect(listOf(emptied, "NO_REDISTRIBUTION_SOURCES")).toEqual([]);
    // And the executed filter then keeps the row it exists to drop.
    const f = shippedFilter(emptied);
    expect(f.withoutNoRedistribution([{ id: "a", source: FEDERAL }])).toHaveLength(1);
  });

  it("notices a filter turned into a pass-through", () => {
    const neutered = API.replace(
      /const withoutNoRedistribution = [\s\S]*?rows\.filter\(\(r\) => !isNoRedistributionSource\(r\.source\)\);/,
      "const withoutNoRedistribution = <T extends Record<string, unknown>>(rows: T[]): T[] => rows;",
    );
    expect(neutered, "the mutation did not apply — RE-ANCHOR this tooth").not.toBe(API);
    const f = shippedFilter(neutered);
    expect(f.withoutNoRedistribution([{ id: "a", source: FEDERAL }])).toHaveLength(1);
  });

  it("notices one corpus read that lost its SQL exclusion", () => {
    const dropped = API.replace('.not("source", "in", NO_REDISTRIBUTION_IN)', "");
    expect(sqlExclusions(dropped)).toBeLessThan(directReadSites(dropped));
  });

  it("notices a proxied row list returned unfiltered", () => {
    const unwrapped = API.replace(
      /withoutNoRedistribution\(\s*\(Array\.isArray\(r\.jobs\) \? r\.jobs : \[\]\) as Array<Record<string, unknown>>,\s*\)/,
      "(Array.isArray(r.jobs) ? r.jobs : []) as Array<Record<string, unknown>>",
    );
    expect(unwrapped, "the mutation did not apply — RE-ANCHOR this tooth").not.toBe(API);
    expect(jobListSites(unwrapped).unguarded).toBeGreaterThan(0);
  });

  it("notices restricted ids held out only after the cap", () => {
    const late = MCP
      .replace("const restricted = sent.filter((id) => isNoRedistributionSource(vendorOfId(id)));", "const restricted: string[] = [];")
      .replace("const asked = sent.filter((id) => !isNoRedistributionSource(vendorOfId(id)));", "const asked = sent;");
    const body = fnBody(late, "async function runCheckJobsOpen(");
    expect(body, "the mutation did not apply — RE-ANCHOR this tooth").not.toContain("isNoRedistributionSource(vendorOfId(id))");
  });

  it("notices a detail reader that never checks the id's vendor", () => {
    // The apply-support tool exactly as it shipped before this change: a
    // board detail call with no restriction check above it anywhere in the
    // function. The site counter must name it.
    const unguarded = MCP.replace(
      /  if \(isNoRedistributionSource\(vendorOfId\(id\)\)\) \{\n    return \{\n      jobId: id,[\s\S]*?\n  \}\n/,
      "",
    );
    expect(unguarded, "the mutation did not apply — RE-ANCHOR this tooth").not.toBe(MCP);
    const after = detailCallSites(unguarded);
    expect(after.unguarded, "a detail reader with no check went unreported").toContain("runCheckApplySupport");
    expect(detailCallSites(MCP).unguarded).toEqual([]);
  });

  it("notices an apply-support tool that hands a restricted id its apply URL", async () => {
    const unguarded = MCP.replace(
      /  if \(isNoRedistributionSource\(vendorOfId\(id\)\)\) \{\n    return \{\n      jobId: id,[\s\S]*?\n  \}\n/,
      "",
    );
    expect(unguarded, "the mutation did not apply — RE-ANCHOR this tooth").not.toBe(MCP);
    const f = shippedApplySupport(unguarded);
    const out = await f.runCheckApplySupport(null, { id: `${FEDERAL}:${FEDERAL}:912345` });
    expect(out.applyUrl, "the pre-fix runner should hand back the restricted apply URL").toBe("https://federal.example/apply/912345");
    expect(f.boardCallCount()).toBe(1);
  });

  it("notices a detail check moved below the board call", () => {
    const moved = MCP.replace(
      "if (isNoRedistributionSource(vendorOfId(id))) return { ok: false, id, reason: \"restricted\" };",
      "",
    );
    const body = fnBody(moved, "async function detailOf(");
    expect(body.indexOf("isNoRedistributionSource(vendorOfId(id))")).toBe(-1);
  });

  it("does not read a literal out of a comment", () => {
    // The failure this repo has shipped several times: a guard counting a
    // literal across a whole file, satisfied by the sentence explaining it.
    const commented = "const NO_REDISTRIBUTION_SOURCES = []; // was [\"usajobs\"]\n";
    expect(listOf(stripComments(commented), "NO_REDISTRIBUTION_SOURCES")).toEqual([]);
    // And a URL inside a string survives the same stripper.
    expect(stripComments('const u = "https://developer.usajobs.gov"; // note\n').trim())
      .toBe('const u = "https://developer.usajobs.gov";');
  });
});
