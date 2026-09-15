import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { MCP_TOOLS } from "../config/mcp-tools";

/**
 * THE BARS AN AGENT IS TOLD ARE THE BARS THE VERDICT USES.
 *
 * The MCP server's employer_growth tool describes, in a sentence an agent will
 * repeat to a person, what "grew" measured against: how many roles a board had
 * to serve at the window's start, how many more it had to add, by what share,
 * over how many days, on a board tracked how long. Those numbers live in a
 * Deno file. The verdict itself is computed by a Postgres function whose bars
 * live in a CTE in a migration. Nothing connects the two runtimes — not tsc,
 * not vitest, not the deno gate — so the sentence would stay true until the
 * day someone re-calibrated the migration, and then it would be a false claim
 * about a named employer, in the agent's mouth, with no check able to see it.
 * The repo has recorded this shape five times (the "no subscriptions" copy,
 * the "four hiring systems" pitch, the six-tools page): a mirror constant plus
 * a test that READS THE OTHER RUNTIME'S SOURCE is the only fix that survives.
 *
 * The same file carries the site's second moat tool, employer_hiring_record,
 * whose description promises never to call a takedown a hire and never to sum
 * one board with another; those are pinned here too, to the words the site's
 * own locale file uses for the same half of the same ledger.
 *
 * Everything below is a PROPERTY read off comment-stripped code, and every
 * property has a teeth case that hands the routine a broken copy and requires
 * it to fail. A literal written in a comment cannot satisfy any of it.
 */
const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
// Whole-line comments first, so a `//` inside a URL string survives; then
// block comments.
const stripTs = (s: string) => s.replace(/^\s*\/\/[^\n]*/gm, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
const stripSql = (s: string) => s.replace(/--[^\n]*/g, " ");

/**
 * The newest migration that defines a function — earlier ones are superseded,
 * and get_company_hiring_health has been redefined in eighteen files already.
 * A guard pinned to a file name would stay green against a superseded body the
 * day a nineteenth landed; resolving the file is what keeps the mirror honest.
 * Comment lines are stripped before the name is looked for, so prose about a
 * function in a later migration cannot claim it.
 */
function newestDefining(fnName: string): string {
  const files = readdirSync(resolve(ROOT, "supabase/migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort()
    .filter((n) => new RegExp(`FUNCTION public\\.${fnName}\\s*\\(`).test(stripSql(read(`supabase/migrations/${n}`))));
  const file = files[files.length - 1];
  if (!file) throw new Error(`no migration defines ${fnName}`);
  return `supabase/migrations/${file}`;
}
const GROWTH_MIG = newestDefining("get_company_growth");
const HEALTH_MIG = newestDefining("get_company_hiring_health");
const MCP_RAW = read("supabase/functions/agent-mcp/index.ts");
const GROWTH_RAW = read(GROWTH_MIG);
const HEALTH_RAW = read(HEALTH_MIG);
const EN = JSON.parse(read("src/i18n/locales/en.json")) as Record<string, Record<string, string>>;

// ── the parsers, each a pure function of one source text ───────────────────

/** The bar CTE of get_company_growth: `<value> AS <name>` pairs, numbers coerced. */
function barsOfMigration(sql: string): Record<string, number> {
  const code = stripSql(sql);
  const m = /\bk AS \(\s*SELECT([\s\S]*?)\)\s*,/.exec(code);
  if (!m) throw new Error("the migration's bar CTE was not found — RE-ANCHOR this guard");
  const out: Record<string, number> = {};
  for (const pair of m[1].matchAll(/([\d.]+)(?:::numeric)?\s+AS\s+([a-z_]+)/g)) out[pair[2]] = Number(pair[1]);
  return out;
}

/** The reasons the migration's CASE can hand back, in the order it tests them. */
function reasonsOfMigration(sql: string): string[] {
  const code = stripSql(sql);
  const start = code.indexOf("judged AS (");
  const end = code.indexOf("END AS reason", start);
  if (start < 0 || end < 0) throw new Error("the migration's reason CASE was not found — RE-ANCHOR this guard");
  return [...code.slice(start, end).matchAll(/THEN '([a-z_]+)'/g)].map((x) => x[1]);
}

/** The server's mirror of the bars, read off code only. */
function barsOfServer(ts: string): Record<string, number> {
  const m = /const GROWTH_BARS = \{([\s\S]*?)\} as const;/.exec(stripTs(ts));
  if (!m) throw new Error("the server's GROWTH_BARS constant is missing");
  const out: Record<string, number> = {};
  for (const pair of m[1].matchAll(/([A-Za-z]+): ([\d.]+),/g)) out[pair[1]] = Number(pair[2]);
  return out;
}

function reasonsOfServer(ts: string): string[] {
  const m = /const GROWTH_UNKNOWN_REASONS = \[([\s\S]*?)\] as const;/.exec(stripTs(ts));
  if (!m) throw new Error("the server's GROWTH_UNKNOWN_REASONS constant is missing");
  return [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
}

/** camelCase mirror key → the migration's snake_case bar name. */
const BAR_NAMES: Record<string, string> = {
  windowDays: "window_days",
  minBaselineServed: "min_baseline_served",
  minNetAdd: "min_net_add",
  minRate: "min_rate",
  minTenureDays: "min_tenure_days",
};

/** THE PROPERTY: the mirror equals the migration, bar for bar and reason for reason. */
function assertMirror(sql: string, ts: string): void {
  const mig = barsOfMigration(sql);
  const srv = barsOfServer(ts);
  for (const [camel, snake] of Object.entries(BAR_NAMES)) {
    if (!(snake in mig)) throw new Error(`the migration's bar CTE no longer names ${snake}`);
    if (!(camel in srv)) throw new Error(`the server's GROWTH_BARS no longer names ${camel}`);
    if (srv[camel] !== mig[snake]) throw new Error(`${camel}: the server says ${srv[camel]}, the migration says ${mig[snake]}`);
  }
  const migReasons = reasonsOfMigration(sql);
  const srvReasons = reasonsOfServer(ts);
  if (migReasons.length === 0) throw new Error("the migration's CASE has no arms — the parser matched nothing");
  const a = [...migReasons].sort().join(",");
  const b = [...srvReasons].sort().join(",");
  if (a !== b) throw new Error(`reason vocabulary differs — migration: ${a}; server: ${b}`);
}

// ── the server's tool blocks and runners, for the copy-side properties ─────
const MCP = stripTs(MCP_RAW);
const between = (src: string, from: string, to: string) => {
  const a = src.indexOf(from);
  expect(a, `anchor "${from}" present`).toBeGreaterThanOrEqual(0);
  const b = src.indexOf(to, a + 1);
  expect(b, `anchor "${to}" after "${from}"`).toBeGreaterThan(a);
  return src.slice(a, b);
};
const TOOLS_SRC = between(MCP, "const TOOLS = [", "\n];");
const toolBlock = (name: string) => {
  const marks = [...TOOLS_SRC.matchAll(/\n    name: "([a-z_]+)",/g)];
  const i = marks.findIndex((m) => m[1] === name);
  expect(i, `server registers ${name}`).toBeGreaterThanOrEqual(0);
  const start = marks[i].index ?? 0;
  const end = i + 1 < marks.length ? (marks[i + 1].index ?? TOOLS_SRC.length) : TOOLS_SRC.length;
  return TOOLS_SRC.slice(start, end);
};
const GROWTH_TOOL = toolBlock("employer_growth");
const RECORD_TOOL = toolBlock("employer_hiring_record");
const RUNNERS = between(MCP, "function employerTokensArg(", "async function runCheckApplySupport(");
const GROWTH_RUNNER = between(RUNNERS, "async function runEmployerGrowth(", "\n}\n");
const RECORD_RUNNER = between(RUNNERS, "async function runEmployerHiringRecord(", "\n}\n");
const CONSTANTS = between(MCP, "const EMPLOYER_TOKENS_MAX", "const TOOLS = [");

describe("the bars an agent is told are the bars the verdict uses", () => {
  it("both sides parse non-trivially (an empty match would agree with anything)", () => {
    expect(Object.keys(barsOfMigration(GROWTH_RAW)).length).toBeGreaterThanOrEqual(5);
    expect(Object.keys(barsOfServer(MCP_RAW))).toEqual(Object.keys(BAR_NAMES));
    expect(reasonsOfMigration(GROWTH_RAW).length).toBeGreaterThan(5);
    expect(reasonsOfServer(MCP_RAW).length).toBe(reasonsOfMigration(GROWTH_RAW).length);
  });

  it("the server's mirror equals the migration's bar CTE and its reason vocabulary", () => {
    assertMirror(GROWTH_RAW, MCP_RAW);
  });

  it("TEETH: a migration whose net bar moves to 3 fails the mirror", () => {
    const mutated = GROWTH_RAW.replace(/(\d+)(\s+AS min_net_add)/, (_m, n, tail) => `${Number(n) - 1}${tail}`);
    expect(mutated, "the mutation must have changed something").not.toBe(GROWTH_RAW);
    expect(() => assertMirror(mutated, MCP_RAW)).toThrow(/minNetAdd/);
  });

  it("TEETH: a server copy with minNetAdd one lower fails, and the other four bars each fail alone", () => {
    for (const camel of Object.keys(BAR_NAMES)) {
      const re = new RegExp(`(${camel}: )([\\d.]+),`);
      const mutated = MCP_RAW.replace(re, (_m, head, n) => `${head}${Number(n) + 1},`);
      expect(mutated, `${camel} must be present to mutate`).not.toBe(MCP_RAW);
      expect(() => assertMirror(GROWTH_RAW, mutated), camel).toThrow(new RegExp(camel));
    }
  });

  it("TEETH: a bar that survives only in a comment does not count", () => {
    // Delete the constant and leave a comment spelling every number it held.
    const gone = MCP_RAW.replace(/const GROWTH_BARS = \{[\s\S]*?\} as const;/, "// GROWTH_BARS = { windowDays: 7, minBaselineServed: 10, minNetAdd: 4, minRate: 0.25, minTenureDays: 21 }");
    expect(gone).not.toBe(MCP_RAW);
    expect(() => assertMirror(GROWTH_RAW, gone)).toThrow(/GROWTH_BARS constant is missing/);
  });

  it("TEETH: a reason the migration can hand back that the server does not name fails, and an invented one fails", () => {
    const dropped = MCP_RAW.replace(/"pool_replaced", /, "");
    expect(dropped).not.toBe(MCP_RAW);
    expect(() => assertMirror(GROWTH_RAW, dropped)).toThrow(/reason vocabulary differs/);
    const invented = MCP_RAW.replace(/"ledger_gap",/, '"ledger_gap", "not_hiring",');
    expect(invented).not.toBe(MCP_RAW);
    expect(() => assertMirror(GROWTH_RAW, invented)).toThrow(/reason vocabulary differs/);
    const migDropped = GROWTH_RAW.replace(/\s*WHEN c\.removed_departures >= c\.baseline_served\s+THEN 'pool_replaced'/, "");
    expect(migDropped).not.toBe(GROWTH_RAW);
    expect(() => assertMirror(migDropped, MCP_RAW)).toThrow(/reason vocabulary differs/);
  });

  it("the description names every bar from the constant, and types no number before 'roles'", () => {
    for (const camel of Object.keys(BAR_NAMES)) {
      expect(GROWTH_TOOL, `the description must interpolate GROWTH_BARS.${camel}`).toMatch(new RegExp(`\\$\\{(?:Math\\.round\\()?GROWTH_BARS\\.${camel}`));
    }
    // "at least 4 more roles" typed by hand is the claim that goes false.
    expect(/\b\d+\s+(?:more\s+)?roles\b/.exec(GROWTH_TOOL)?.[0], "a typed number before 'roles'").toBeUndefined();
    expect(/\b\d+%/.exec(GROWTH_TOOL)?.[0], "a typed percentage").toBeUndefined();
    // The reason enum in the schema is spread from the same constant the
    // migration is pinned to, and the tool declares that schema.
    expect(CONSTANTS).toMatch(/unknown_reason: \{\s*type: \["string", "null"\], enum: \[\.\.\.GROWTH_UNKNOWN_REASONS, null\]/);
    expect(GROWTH_TOOL).toMatch(/items: GROWTH_ROW_SCHEMA/);
    expect(GROWTH_TOOL).toMatch(/outputSchema: \{/);
    // The bars an answer carries are the same constant, name for name.
    for (const [camel, snake] of Object.entries(BAR_NAMES)) {
      expect(GROWTH_RUNNER, `bars.${snake} must be read off the constant`).toMatch(new RegExp(`${snake}: GROWTH_BARS\\.${camel},`));
    }
  });

  it("no runner re-judges a row: the verdict and its reason pass through untouched", () => {
    expect(GROWTH_RUNNER).toMatch(/verdict: r\.verdict,/);
    expect(GROWTH_RUNNER).toMatch(/unknown_reason: r\.unknown_reason \?\? null/);
    // No comparison against a bar, no verdict literal, no read of net or rate.
    expect(RUNNERS).not.toMatch(/[<>]=?\s*GROWTH_BARS|GROWTH_BARS\.\w+\s*[<>]=?/);
    expect(RUNNERS).not.toMatch(/"grew"|"no-growth"/);
    expect(RUNNERS).not.toMatch(/\br\.(?:net|rate)\b/);
    // And the RPC is the source: one service-client call per tool, by name.
    expect(GROWTH_RUNNER).toMatch(/client\.rpc\("get_company_growth", \{ p_tokens: tokens \}\)/);
    expect(RECORD_RUNNER).toMatch(/client\.rpc\("get_company_hiring_health", \{ p_tokens: tokens \}\)/);
  });

  it("TEETH: a runner that re-derived the verdict from the bars would fail", () => {
    const rederived = RUNNERS.replace(
      "verdict: r.verdict,",
      "verdict: Number(r.net) >= GROWTH_BARS.minNetAdd && Number(r.rate) >= GROWTH_BARS.minRate ? \"grew\" : \"no-growth\",",
    );
    expect(rederived).not.toBe(RUNNERS);
    expect(rederived).toMatch(/[<>]=?\s*GROWTH_BARS|GROWTH_BARS\.\w+\s*[<>]=?/);
    expect(rederived).toMatch(/"grew"|"no-growth"/);
    expect(rederived).toMatch(/\br\.(?:net|rate)\b/);
  });
});

describe("the hiring record says what it is and is not, in the site's own words", () => {
  const health = stripSql(between(HEALTH_RAW, "FUNCTION public.get_company_hiring_health(p_tokens text[])", "GRANT EXECUTE ON FUNCTION public.get_company_hiring_health"));
  const returns = /RETURNS TABLE\(([^)]*)\)/.exec(health)![1];
  const rpcColumns = [...returns.matchAll(/(\w+)\s+(?:text|integer|numeric)/g)].map((m) => m[1]);
  const windowFromName = Number(/closed_(\d+)d/.exec(returns)![1]);

  it("the migrations the mirror is read from are resolved, and a re-anchor is a visible diff here", () => {
    // Resolved by scanning, asserted by name: when a newer migration redefines
    // either RPC this line changes in the same commit, or the guard says so.
    expect(GROWTH_MIG).toBe("supabase/migrations/20260909227000_a_board_that_grew_is_a_rate_with_gates_not_a_count.sql");
    expect(HEALTH_MIG).toBe("supabase/migrations/20260909201000_the_same_late_date_in_thirteen_more_places.sql");
  });

  it("the window is the RPC's own, and the column names are built from it rather than typed", () => {
    expect(rpcColumns.length).toBeGreaterThanOrEqual(8);
    const srv = Number(/const HIRING_RECORD_WINDOW_DAYS = (\d+);/.exec(CONSTANTS)![1]);
    expect(srv, "the server's window differs from the RPC's column names").toBe(windowFromName);
    // Every interval the RPC's closed CTE counts over is the same window.
    const closedCte = between(health, "closed AS (", "ver AS (");
    for (const m of closedCte.matchAll(/interval '(\d+) days'/g)) expect(Number(m[1])).toBe(windowFromName);
    expect(CONSTANTS).toMatch(/\[`closed_\$\{HIRING_RECORD_WINDOW_DAYS\}d`\]/);
    expect(RECORD_RUNNER).toMatch(/const closedCol = `closed_\$\{HIRING_RECORD_WINDOW_DAYS\}d`/);
  });

  it("every column the RPC returns is described in the row schema, under the RPC's own name", () => {
    const schema = between(CONSTANTS, "const HIRING_RECORD_ROW_SCHEMA = {", "const GROWTH_ROW_SCHEMA");
    for (const col of rpcColumns) {
      const key = col.replace(/_\d+d$/, `_\${HIRING_RECORD_WINDOW_DAYS}d`);
      const re = /\$\{/.test(key) ? new RegExp(`\\[\`${key.replace(/[$]/g, "\\$").replace(/[{}]/g, (c) => `\\${c}`)}\`\\]: \\{`) : new RegExp(`\\n    ${key}: \\{`);
      expect(schema, `column ${col} is returned by the RPC and must be described`).toMatch(re);
    }
    // The growth RPC's columns likewise, every one.
    const growthReturns = /RETURNS TABLE \(([\s\S]*?)\)\s*LANGUAGE sql/.exec(stripSql(GROWTH_RAW))![1];
    const growthCols = [...growthReturns.matchAll(/^\s*(\w+)\s+(?:text|int|date|numeric|boolean)/gm)].map((m) => m[1]);
    expect(growthCols.length).toBeGreaterThanOrEqual(20);
    const gschema = CONSTANTS.slice(CONSTANTS.indexOf("const GROWTH_ROW_SCHEMA = {"));
    expect(gschema.length).toBeGreaterThan(100);
    for (const col of growthCols) expect(gschema, `growth column ${col}`).toMatch(new RegExp(`\\n    ${col}: \\{`));
  });

  it("copies the site's IS-NOT sentence for the takedown half, and never says hired", () => {
    const basis3 = EN.jobsPage.hiringBasis3;
    const tip3 = EN.jobsPage.hiringBadgeTip3;
    expect(basis3, "the locale key the copy is taken from").toBeTruthy();
    expect(tip3).toBeTruthy();
    const isNot = "A takedown is not a hire";
    const identical = "a filled role, a cancelled one and a withdrawn one look identical from here";
    expect(basis3).toContain(isNot);
    expect(tip3).toContain(identical);
    const basisConst = between(CONSTANTS, "const HIRING_RECORD_BASIS =", "const HIRING_RECORD_UNKNOWN");
    for (const [where, text] of [["HIRING_RECORD_BASIS", basisConst], ["employer_hiring_record description", RECORD_TOOL]] as const) {
      expect(text, `${where} must carry the site's sentence`).toContain(isNot);
      expect(text, `${where} must carry the site's sentence`).toContain(identical);
      expect(text, `${where} must say one board, never summed`).toMatch(/never summed across an employer's boards/);
      expect(text, `${where} must refuse the headcount reading`).toMatch(/never a headcount/);
    }
    // The word that turns a takedown into a claim about a person.
    for (const [where, text] of [["tool blocks", RECORD_TOOL + GROWTH_TOOL], ["constants", CONSTANTS], ["runners", RUNNERS]] as const) {
      expect(/\bhired\b/i.exec(text)?.[0], `${where} say "hired"`).toBeUndefined();
    }
    for (const t of MCP_TOOLS.filter((x) => x.name === "employer_hiring_record" || x.name === "employer_growth")) {
      expect(/\bhired\b/i.exec(t.body)?.[0], `${t.name} mirror body says "hired"`).toBeUndefined();
      expect(t.body, `${t.name} mirror body must say per board`).toMatch(/board/);
    }
    // Per row, not only at the top: every row carries the basis.
    expect(RECORD_RUNNER).toMatch(/basis: HIRING_RECORD_BASIS,/);
  });

  it("what it says about a big board's silence is the site's current sentence, not a stale claim about the instrument", () => {
    // Since absence_basis 'lap' exists, a board bigger than one visit can read
    // DOES log closures after a provable full pass, and the health RPC admits
    // them — so "logs no closures by design" is false in the agent's mouth.
    // The sentence the site shows for the same silence is read off the locale
    // file, not retyped here.
    const site = EN.jobsPage.hhNoClosureRecord;
    expect(site).toBeTruthy();
    const fragment = /no closure is observable to us until[^.;]*?after it/.exec(site)?.[0];
    expect(fragment, "the site's own sentence about a big board's silence").toBeTruthy();
    expect(fragment!.length).toBeGreaterThan(40);
    const unknown = between(CONSTANTS, "const HIRING_RECORD_UNKNOWN = {", "} as const;");
    for (const [where, text] of [["employer_hiring_record description", RECORD_TOOL], ["HIRING_RECORD_UNKNOWN", unknown], ["runner comments", between(MCP_RAW, "async function runEmployerHiringRecord(", "async function runEmployerGrowth(")]] as const) {
      expect(text, `${where} still says a big board logs nothing by design`).not.toMatch(/no closures by design/);
    }
    for (const [where, text] of [["employer_hiring_record description", RECORD_TOOL], ["HIRING_RECORD_UNKNOWN", unknown]] as const) {
      expect(text.replace(/"\s*\+\s*"/g, ""), `${where} must carry the site's sentence`).toContain(fragment!);
    }
  });

  it("the basis claims no read-quality gate the RPC's closed CTE does not apply", () => {
    // "on days we read it in full" qualifies the GROWTH half in the locale
    // file (a per-day read-quality gate the growth RPC applies); the closed
    // CTE filters on superseded / suspect / dark-batch / lap_backfill only.
    const closedCte = between(health, "closed AS (", "ver AS (");
    expect(closedCte).not.toMatch(/board_state|state\s*=\s*'ok'/);
    const basisConst = between(CONSTANTS, "const HIRING_RECORD_BASIS =", "const HIRING_RECORD_UNKNOWN");
    expect(basisConst).not.toMatch(/read it in full/);
    expect(basisConst).toMatch(/lap_backfill|full lap|provable full/);
  });

  it("TEETH: a copy that brings the stale sentence back, and one that borrows the growth half's gate, are both caught", () => {
    const fragment = /no closure is observable to us until[^.;]*?after it/.exec(EN.jobsPage.hhNoClosureRecord)![0];
    const joined = RECORD_TOOL.replace(/"\s*\+\s*"/g, "");
    expect(joined).toContain(fragment);
    const stale = joined.replace(fragment, "a feed bigger than one visit can read logs no closures by design");
    expect(stale).not.toBe(joined);
    expect(stale).toMatch(/no closures by design/);
    expect(stale).not.toContain(fragment);
    const basisConst = between(CONSTANTS, "const HIRING_RECORD_BASIS =", "const HIRING_RECORD_UNKNOWN");
    const borrowed = basisConst.replace("on a board read to the end", "on days we read it in full");
    expect(borrowed).not.toBe(basisConst);
    expect(borrowed).toMatch(/read it in full/);
  });

  it("an unknown record is a row with a reason, never an omission and never a verdict", () => {
    // Rows are built by walking the ASKED tokens, so nothing asked can vanish.
    expect(RECORD_RUNNER).toMatch(/const employers = tokens\.map\(/);
    expect(GROWTH_RUNNER).toMatch(/const employers = tokens\.map\(/);
    // A row the RPC did not answer is a fault, thrown — not filled with a zero.
    expect(RECORD_RUNNER).toMatch(/if \(!r\) throw new Error/);
    expect(GROWTH_RUNNER).toMatch(/if \(!r\) throw new Error/);
    // unknown is one of two states and carries a reason from a named vocabulary.
    expect(RECORD_RUNNER).toMatch(/record: unknownReason \? "unknown" : "observed",/);
    expect(CONSTANTS).toMatch(/enum: \["observed", "unknown"\]/);
    expect(CONSTANTS).toMatch(/enum: \[\.\.\.Object\.keys\(HIRING_RECORD_UNKNOWN\), null\]/);
    const unknown = between(CONSTANTS, "const HIRING_RECORD_UNKNOWN = {", "} as const;");
    const reasons = [...unknown.matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]);
    expect(reasons).toEqual(["no_record", "no_closures_observed"]);
    // No closure observed is the windowed-tenant signature, and the note says
    // the two cannot be told apart — the same rule Jobs.tsx's verdict applies.
    expect(unknown).toMatch(/cannot be told[\s\S]*apart from here/);
    expect(unknown).not.toMatch(/not hiring/);
  });

  it("the cap is one constant, declared on both schemas, refused above it in band", () => {
    const cap = Number(/const EMPLOYER_TOKENS_MAX = (\d+);/.exec(CONSTANTS)![1]);
    expect(cap).toBe(20);
    expect(RECORD_TOOL).toMatch(/maxItems: EMPLOYER_TOKENS_MAX/);
    expect(GROWTH_TOOL).toMatch(/maxItems: EMPLOYER_TOKENS_MAX/);
    expect(RUNNERS).toMatch(/if \(tokens\.length > EMPLOYER_TOKENS_MAX\) \{\s*throw new ToolArgumentError\(/);
    expect(RUNNERS).toMatch(/if \(!tokens\.length\) \{\s*throw new ToolArgumentError\(/);
    // The dispatcher turns that class into an in-band tool error with a fix,
    // not the generic "internal error, try again shortly".
    expect(MCP).toMatch(/if \(e instanceof ToolArgumentError\) \{[\s\S]*?toolErr\(e\.message, e\.fix\)/);
    // And the refused call was still metered: the class is caught inside the
    // try that follows the key check, never before it.
    const keyCheck = MCP.indexOf("p_endpoint: `/mcp/${toolName}`");
    const caught = MCP.indexOf("if (e instanceof ToolArgumentError)");
    expect(caught).toBeGreaterThan(keyCheck);
  });

  it("both tools are read-only translations of anon-granted definer aggregates — the ledger itself is never read here", () => {
    expect(RECORD_TOOL).toMatch(/annotations: READS_THE_BOARD/);
    expect(GROWTH_TOOL).toMatch(/annotations: READS_THE_BOARD/);
    expect(RECORD_TOOL).toMatch(/outputSchema: \{/);
    // Dispatched through the service client like every other tool.
    expect(MCP).toMatch(/case "employer_hiring_record": return toolOk\(await runEmployerHiringRecord\(client, args\)\);/);
    expect(MCP).toMatch(/case "employer_growth": return toolOk\(await runEmployerGrowth\(client, args\)\);/);
    // The moat leaves only through SECURITY DEFINER aggregates that already
    // exist: no direct read of either ledger table anywhere in the server.
    for (const table of ["job_board_closures", "job_board_company_snapshots", "job_board_company_flow", "job_board_board_state"]) {
      expect(MCP, `${table} read directly`).not.toMatch(new RegExp(`from\\("${table}"\\)`));
    }
    // Each RPC is granted to anon in its own migration, so the service-client
    // call raises no privilege the site's own browser calls do not have.
    expect(stripSql(HEALTH_RAW)).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_company_hiring_health\(text\[\]\) TO anon/);
    expect(stripSql(GROWTH_RAW)).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_company_growth\(text\[\]\) TO anon/);
    expect(health).toMatch(/SECURITY DEFINER/);
    // The growth description names the two things the memory forbids as absent.
    expect(GROWTH_TOOL).toMatch(/never ranks employers/);
    expect(GROWTH_TOOL).toMatch(/never a no/);
  });
});
