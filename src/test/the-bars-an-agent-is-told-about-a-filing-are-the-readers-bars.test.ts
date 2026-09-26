import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE BARS AN AGENT IS TOLD ABOUT A FILING ARE THE READER'S BARS.
 *
 * agent-mcp 2026-09-04.8 hands every employer_hiring_record row a
 * layoff_filing — the newest layoff filing a SECURITY DEFINER reader joined
 * to that board — and tells the agent, in a basis sentence and one sentence
 * of the tool's description, how far back a filing may date, how many
 * workers a state notice must state, and how often each source is read.
 * Those four facts are decided elsewhere: two in the reader's own bar CTE
 * (a migration), two in the cron rows that feed it (another migration), and
 * all four are mirrored for the site's copy in src/config/layoffs.ts. Nothing
 * connects a Deno template literal to a Postgres CTE or a cron string — not
 * tsc, not vitest, not the deno gate — so the sentence would stay true until
 * the day someone widened the window or moved the warn job, and then it
 * would be a false claim about a named employer's filing, in the agent's
 * mouth. The repo's rule for that shape is a mirror constant plus a test that
 * READS THE OTHER RUNTIME'S SOURCE.
 *
 * The same file pins what the field IS: the reader's columns and the
 * object's fields, name for name; null for a token nothing qualified on,
 * never an omitted key; and the record's own judgement (record /
 * unknown_reason) computed without reading the filing at all.
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

const MIGRATIONS = readdirSync(resolve(ROOT, "supabase/migrations")).filter((n) => n.endsWith(".sql")).sort();

/** The newest migration whose CODE (comments stripped) defines the function; prose about it in a later file cannot claim it. */
function newestDefining(fnName: string): string {
  const files = MIGRATIONS.filter((n) => new RegExp(`FUNCTION public\\.${fnName}\\s*\\(`).test(stripSql(read(`supabase/migrations/${n}`))));
  const file = files[files.length - 1];
  if (!file) throw new Error(`no migration defines ${fnName}`);
  return `supabase/migrations/${file}`;
}

/** The newest migration whose CODE schedules the named cron job. */
function newestScheduling(jobName: string): string {
  const files = MIGRATIONS.filter((n) => new RegExp(`cron\\.schedule\\(\\s*'${jobName}'`).test(stripSql(read(`supabase/migrations/${n}`))));
  const file = files[files.length - 1];
  if (!file) throw new Error(`no migration schedules ${jobName}`);
  return `supabase/migrations/${file}`;
}

const MCP_PATH = "supabase/functions/agent-mcp/index.ts";
const CONFIG_PATH = "src/config/layoffs.ts";
const READER_MIG = newestDefining("get_employer_layoff_filings");
const WRITER_MIG = newestDefining("refresh_layoff_partition");
const CRON_MIG = newestScheduling("layoff-edgar-atom");
const MCP_RAW = read(MCP_PATH);
const READER_RAW = read(READER_MIG);
const WRITER_RAW = read(WRITER_MIG);
const CRON_RAW = read(CRON_MIG);

// ── the parsers, each a pure function of one source text ───────────────────

/** A function's bar CTE `k AS (SELECT <value> AS <name>, …)`: numbers only, coerced. */
function barsOfMigration(sql: string, fnName: string): Record<string, number> {
  const code = stripSql(sql);
  const at = code.search(new RegExp(`FUNCTION public\\.${fnName}\\s*\\(`));
  if (at < 0) throw new Error(`${fnName} is not defined in the text handed in`);
  const m = /\bk AS \(\s*SELECT([\s\S]*?)\)\s*,/.exec(code.slice(at));
  if (!m) throw new Error(`the bar CTE of ${fnName} was not found — RE-ANCHOR this guard`);
  const out: Record<string, number> = {};
  for (const pair of m[1].matchAll(/(?<![\w'])([\d.]+)(?:::numeric)?\s+AS\s+([a-z_0-9]+)/g)) out[pair[2]] = Number(pair[1]);
  return out;
}

/** The cron expression a migration schedules under a job name. */
function scheduleOf(sql: string, jobName: string): string {
  const m = new RegExp(`cron\\.schedule\\(\\s*'${jobName}',\\s*'([^']+)'`).exec(stripSql(sql));
  if (!m) throw new Error(`${jobName} is not scheduled in the text handed in`);
  return m[1].trim();
}

/**
 * What a five-field cron expression means in the one word the copy uses.
 * "hourly": one fixed minute, every hour of every day. "nightly": one fixed
 * minute and hour, every day. Anything else is spelled out so a mismatch
 * names the schedule rather than a guess at it.
 */
function cadenceOf(schedule: string): string {
  const f = schedule.split(/\s+/);
  if (f.length !== 5) return `unreadable:${schedule}`;
  const fixed = (x: string) => /^\d+$/.test(x);
  const every = (x: string) => x === "*";
  if (fixed(f[0]) && every(f[1]) && every(f[2]) && every(f[3]) && every(f[4])) return "hourly";
  if (fixed(f[0]) && fixed(f[1]) && every(f[2]) && every(f[3]) && every(f[4])) return "nightly";
  return `other:${schedule}`;
}

/** The server's mirror, read off code only: numbers coerced, strings kept. */
function barsOfServer(ts: string): Record<string, number | string> {
  const m = /const LAYOFF_BARS = \{([\s\S]*?)\} as const;/.exec(stripTs(ts));
  if (!m) throw new Error("the server's LAYOFF_BARS constant is missing");
  const out: Record<string, number | string> = {};
  for (const pair of m[1].matchAll(/([A-Za-z]+): (?:"([^"]*)"|([\d.]+)),/g)) out[pair[1]] = pair[2] !== undefined ? pair[2] : Number(pair[3]);
  return out;
}

/** The site's mirror (src/config/layoffs.ts), read off code only. */
function barsOfConfig(ts: string): Record<string, number | string> {
  const code = stripTs(ts);
  const num = (name: string): number => {
    const m = new RegExp(`\\b${name}\\s*=\\s*([\\d.]+)`).exec(code);
    if (!m) throw new Error(`${CONFIG_PATH} no longer spells ${name} as a number literal`);
    return Number(m[1]);
  };
  const cadence = /\bLAYOFF_READ_CADENCE\s*=\s*\{([^}]*)\}/.exec(code);
  if (!cadence) throw new Error(`${CONFIG_PATH} no longer spells LAYOFF_READ_CADENCE as an object literal`);
  const word = (key: string): string => {
    const m = new RegExp(`\\b${key}\\s*:\\s*"([^"]*)"`).exec(cadence[1]);
    if (!m) throw new Error(`LAYOFF_READ_CADENCE no longer names ${key}`);
    return m[1];
  };
  return {
    displayMaxAgeDays: num("LAYOFF_DISPLAY_MAX_AGE_DAYS"),
    warnMinWorkers: num("LAYOFF_WARN_MIN_WORKERS"),
    cadenceEdgar: word("edgar"),
    cadenceWarn: word("warn"),
  };
}

const BAR_NAMES = ["displayMaxAgeDays", "warnMinWorkers", "cadenceEdgar", "cadenceWarn"] as const;

/** THE PROPERTY: the server's mirror equals the reader's CTE, the writer's worker bar and the cron rows. */
function assertMirror(readerSql: string, writerSql: string, cronSql: string, ts: string): void {
  const srv = barsOfServer(ts);
  for (const name of BAR_NAMES) if (!(name in srv)) throw new Error(`the server's LAYOFF_BARS no longer names ${name}`);
  const reader = barsOfMigration(readerSql, "get_employer_layoff_filings");
  const writer = barsOfMigration(writerSql, "refresh_layoff_partition");
  for (const snake of ["layoff_display_max_age_days", "layoff_warn_min_workers"]) {
    if (!(snake in reader)) throw new Error(`the reader's bar CTE no longer names ${snake}`);
  }
  if (!("layoff_warn_min_workers" in writer)) throw new Error("the partition writer's bar CTE no longer names layoff_warn_min_workers");
  if (srv.displayMaxAgeDays !== reader.layoff_display_max_age_days) {
    throw new Error(`displayMaxAgeDays: the server says ${srv.displayMaxAgeDays}, the reader says ${reader.layoff_display_max_age_days}`);
  }
  if (srv.warnMinWorkers !== reader.layoff_warn_min_workers) {
    throw new Error(`warnMinWorkers: the server says ${srv.warnMinWorkers}, the reader says ${reader.layoff_warn_min_workers}`);
  }
  if (srv.warnMinWorkers !== writer.layoff_warn_min_workers) {
    throw new Error(`warnMinWorkers: the server says ${srv.warnMinWorkers}, the partition writer says ${writer.layoff_warn_min_workers}`);
  }
  const edgar = cadenceOf(scheduleOf(cronSql, "layoff-edgar-atom"));
  const warn = cadenceOf(scheduleOf(cronSql, "layoff-warn"));
  if (srv.cadenceEdgar !== edgar) throw new Error(`cadenceEdgar: the server says ${srv.cadenceEdgar}, the cron row is ${edgar}`);
  if (srv.cadenceWarn !== warn) throw new Error(`cadenceWarn: the server says ${srv.cadenceWarn}, the cron row is ${warn}`);
}

/** THE SECOND PROPERTY: the server's mirror equals the site's, bar for bar. */
function assertConfigMirror(configTs: string, ts: string): void {
  const srv = barsOfServer(ts);
  const cfg = barsOfConfig(configTs);
  for (const name of BAR_NAMES) {
    if (srv[name] !== cfg[name]) throw new Error(`${name}: the server says ${srv[name]}, ${CONFIG_PATH} says ${cfg[name]}`);
  }
}

// ── the server's blocks, for the copy- and shape-side properties ───────────
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
const RECORD_TOOL = toolBlock("employer_hiring_record");
const GROWTH_TOOL = toolBlock("employer_growth");
const CONSTANTS = between(MCP, "const EMPLOYER_TOKENS_MAX", "const TOOLS = [");
const LAYOFF_CONSTANTS = between(CONSTANTS, "const LAYOFF_BARS = {", "const HIRING_RECORD_ROW_SCHEMA = {");
const FILING_BASIS = between(LAYOFF_CONSTANTS, "const LAYOFF_FILING_BASIS =", "const LAYOFF_FILING_SCHEMA = {");
const FILING_SCHEMA = between(LAYOFF_CONSTANTS, "const LAYOFF_FILING_SCHEMA = {", "\n};");
const ROW_SCHEMA = between(CONSTANTS, "const HIRING_RECORD_ROW_SCHEMA = {", "const GROWTH_ROW_SCHEMA");
const RUNNERS = between(MCP, "function employerTokensArg(", "async function runCheckApplySupport(");
const RECORD_RUNNER = between(RUNNERS, "async function runEmployerHiringRecord(", "\n}\n");
const GROWTH_RUNNER = between(RUNNERS, "async function runEmployerGrowth(", "\n}\n");
const FILINGS_READER = between(RUNNERS, "async function employerLayoffFilings(", "\n}\n");
const FILING_MAPPER = between(RUNNERS, "function layoffFilingOf(", "\n}\n");

/** The one sentence of the record tool's description that names the field. */
function filingSentenceOf(toolSrc: string): string {
  const at = toolSrc.indexOf("layoff_filing");
  expect(at, "the description names layoff_filing").toBeGreaterThanOrEqual(0);
  const start = toolSrc.lastIndexOf(". ", at);
  const end = toolSrc.indexOf(". ", at);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(at);
  return toolSrc.slice(start + 2, end + 1);
}

/** The reader's lf_ columns with the prefix dropped, less the token the row is keyed by. */
function fieldsOfReader(sql: string): string[] {
  const code = stripSql(sql);
  const m = /RETURNS TABLE \(([\s\S]*?)\)\s*LANGUAGE sql/.exec(code);
  if (!m) throw new Error("the reader's RETURNS TABLE was not found — RE-ANCHOR this guard");
  return [...m[1].matchAll(/^\s*lf_(\w+)\s+(?:text|int|date|numeric|timestamptz)/gm)].map((x) => x[1]).filter((f) => f !== "company_token");
}

/** The fields the server's filing schema declares, and the ones it requires. */
function fieldsOfSchema(schemaSrc: string): { declared: string[]; required: string[] } {
  const props = between(schemaSrc, "properties: {", "\n  },");
  const declared = [...props.matchAll(/\n    (\w+): \{/g)].map((x) => x[1]);
  const req = /required: \[([^\]]*)\]/.exec(schemaSrc);
  const required = req ? [...req[1].matchAll(/"(\w+)"/g)].map((x) => x[1]) : [];
  return { declared, required };
}

/** `<field>: …r.lf_<column>` pairs the mapper writes, as [field, column]. */
function fieldsOfMapper(mapperSrc: string): Array<[string, string]> {
  return [...mapperSrc.matchAll(/\n    (\w+): [^\n]*?\br\.lf_(\w+)\b/g)].map((x) => [x[1], x[2]]);
}

const BANNED = /\b(?:ghost|fake|real|quality|legit|live|real time|now)\b/i;

/**
 * THE ACCESSORY PROPERTY: the runner awaits the filing reader as the first
 * statement of a try whose catch neither rethrows nor stays silent -- it
 * writes the fault into layoff_read -- so a reader that cannot answer (the
 * migration not yet applied, a statement timeout, a transient fault) never
 * fails a call api_key_check has already metered. Read off code only.
 */
function assertReaderIsAccessory(runnerSrc: string): void {
  const call = runnerSrc.indexOf("await employerLayoffFilings(client, tokens)");
  if (call < 0) throw new Error("the runner no longer reads the filings through employerLayoffFilings");
  const tryAt = runnerSrc.lastIndexOf("try {", call);
  if (tryAt < 0 || runnerSrc.slice(tryAt, call).includes("}")) throw new Error("the filing read is awaited outside a try: a reader fault fails the metered record call");
  const catchAt = runnerSrc.indexOf("} catch (", call);
  if (catchAt < 0) throw new Error("the try around the filing read has no catch");
  const catchEnd = runnerSrc.indexOf("\n  }", catchAt);
  const catchBody = runnerSrc.slice(catchAt, catchEnd);
  if (/\bthrow\b/.test(catchBody)) throw new Error("the catch rethrows: a reader fault still fails the metered record call");
  if (!/layoffRead = `unread: /.test(catchBody)) throw new Error("the catch does not name the fault in layoff_read");
}

// ── the properties ─────────────────────────────────────────────────────────

describe("the bars an agent is told about a filing are the reader's bars", () => {
  it("every side parses non-trivially (an empty match would agree with anything)", () => {
    expect(Object.keys(barsOfServer(MCP_RAW))).toEqual([...BAR_NAMES]);
    expect(Object.keys(barsOfMigration(READER_RAW, "get_employer_layoff_filings"))).toEqual(["layoff_display_max_age_days", "layoff_warn_min_workers"]);
    expect(Object.keys(barsOfMigration(WRITER_RAW, "refresh_layoff_partition")).length).toBeGreaterThanOrEqual(5);
    expect(scheduleOf(CRON_RAW, "layoff-edgar-atom").split(/\s+/).length).toBe(5);
    expect(scheduleOf(CRON_RAW, "layoff-warn").split(/\s+/).length).toBe(5);
    // The cadence reader is not vacuous: each word comes from one shape only.
    expect(cadenceOf("17 * * * *")).toBe("hourly");
    expect(cadenceOf("40 3 * * *")).toBe("nightly");
    expect(cadenceOf("20 4 1 * *")).toBe("other:20 4 1 * *");
    expect(cadenceOf("*/15 * * * *")).toBe("other:*/15 * * * *");
  });

  it("the migrations the mirror is read from are resolved, and a re-anchor is a visible diff here", () => {
    expect(READER_MIG).toBe("supabase/migrations/20260918100500_a_row_is_an_answer_and_no_row_is_never_no_filing.sql");
    // RE-ANCHORED 2026-09-25. refresh_layoff_partition was re-issued to give its
    // day-30 gate the positive control the other two copies of that gate got the
    // same day; this assertion exists so that move is a visible diff rather than
    // a silent follow of newestDefining. The bars this file mirrors -- the worker
    // bar and the lookback -- are unchanged in it.
    expect(WRITER_MIG).toBe("supabase/migrations/20260925164237_the_third_day_thirty_chain_on_one_page_gets_the_same_control.sql");
    expect(CRON_MIG).toBe("supabase/migrations/20260918101000_the_cadence_the_copy_names_is_the_schedule_in_this_file.sql");
  });

  it("the server's mirror equals the reader's bar CTE, the writer's worker bar and the two cron rows", () => {
    assertMirror(READER_RAW, WRITER_RAW, CRON_RAW, MCP_RAW);
  });

  // Lane D writes src/config/layoffs.ts; until it exists there is nothing to
  // compare, and this case says so by its name rather than passing on an
  // absent file. The teeth below run the same routine on a synthetic copy
  // whether or not the file exists.
  it.skipIf(!existsSync(resolve(ROOT, CONFIG_PATH)))(`the server's mirror equals ${CONFIG_PATH}, bar for bar`, () => {
    assertConfigMirror(read(CONFIG_PATH), MCP_RAW);
  });

  it("TEETH: a reader whose display window moves fails the mirror by name", () => {
    const mutated = READER_RAW.replace(/(\d+)(\s+AS layoff_display_max_age_days)/, (_m, n, tail) => `${Number(n) + 30}${tail}`);
    expect(mutated).not.toBe(READER_RAW);
    expect(() => assertMirror(mutated, WRITER_RAW, CRON_RAW, MCP_RAW)).toThrow(/displayMaxAgeDays/);
  });

  it("TEETH: a partition writer whose worker bar drifts from the reader's fails by name", () => {
    const mutated = WRITER_RAW.replace(/(\d+)(\s+AS layoff_warn_min_workers)/, (_m, n, tail) => `${Number(n) - 1}${tail}`);
    expect(mutated).not.toBe(WRITER_RAW);
    expect(() => assertMirror(READER_RAW, mutated, CRON_RAW, MCP_RAW)).toThrow(/warnMinWorkers.*partition writer/);
  });

  it("TEETH: a cron row moved from hourly to nightly, or from nightly to monthly, fails by name", () => {
    const edgar = CRON_RAW.replace(/(cron\.schedule\(\s*'layoff-edgar-atom',\s*)'[^']+'/, "$1'40 3 * * *'");
    expect(edgar).not.toBe(CRON_RAW);
    expect(() => assertMirror(READER_RAW, WRITER_RAW, edgar, MCP_RAW)).toThrow(/cadenceEdgar: the server says hourly, the cron row is nightly/);
    const warn = CRON_RAW.replace(/(cron\.schedule\(\s*'layoff-warn',\s*)'[^']+'/, "$1'40 3 1 * *'");
    expect(warn).not.toBe(CRON_RAW);
    expect(() => assertMirror(READER_RAW, WRITER_RAW, warn, MCP_RAW)).toThrow(/cadenceWarn: the server says nightly, the cron row is other:40 3 1 \* \*/);
  });

  it("TEETH: a server copy with each bar moved alone fails on that bar", () => {
    for (const name of ["displayMaxAgeDays", "warnMinWorkers"]) {
      const mutated = MCP_RAW.replace(new RegExp(`(${name}: )([\\d.]+),`), (_m, head, n) => `${head}${Number(n) + 1},`);
      expect(mutated, `${name} must be present to mutate`).not.toBe(MCP_RAW);
      expect(() => assertMirror(READER_RAW, WRITER_RAW, CRON_RAW, mutated), name).toThrow(new RegExp(name));
    }
    const edgar = MCP_RAW.replace(/cadenceEdgar: "hourly",/, 'cadenceEdgar: "daily",');
    expect(edgar).not.toBe(MCP_RAW);
    expect(() => assertMirror(READER_RAW, WRITER_RAW, CRON_RAW, edgar)).toThrow(/cadenceEdgar/);
    const warn = MCP_RAW.replace(/cadenceWarn: "nightly",/, 'cadenceWarn: "hourly",');
    expect(warn).not.toBe(MCP_RAW);
    expect(() => assertMirror(READER_RAW, WRITER_RAW, CRON_RAW, warn)).toThrow(/cadenceWarn/);
  });

  it("TEETH: a bar that survives only in a comment does not count", () => {
    const gone = MCP_RAW.replace(/const LAYOFF_BARS = \{[\s\S]*?\} as const;/, '// LAYOFF_BARS = { displayMaxAgeDays: 90, warnMinWorkers: 50, cadenceEdgar: "hourly", cadenceWarn: "nightly" }');
    expect(gone).not.toBe(MCP_RAW);
    expect(() => assertMirror(READER_RAW, WRITER_RAW, CRON_RAW, gone)).toThrow(/LAYOFF_BARS constant is missing/);
    const reader = READER_RAW.replace(/(\s+)(\d+)(\s+AS layoff_display_max_age_days)/, (_m, ws, n, tail) => `${ws}-- ${n}${tail}\n${ws}${Number(n) * 2}${tail}`);
    expect(reader).not.toBe(READER_RAW);
    expect(() => assertMirror(reader, WRITER_RAW, CRON_RAW, MCP_RAW)).toThrow(/displayMaxAgeDays/);
  });

  it("TEETH: the site's mirror is read the same way — a drifted copy fails by name, and a comment-only copy is missing", () => {
    const agrees =
      'export const LAYOFF_DISPLAY_MAX_AGE_DAYS = 90;\nexport const LAYOFF_WARN_MIN_WORKERS = 50;\n' +
      'export const LAYOFF_READ_CADENCE = { edgar: "hourly", warn: "nightly" } as const;\n';
    expect(() => assertConfigMirror(agrees, MCP_RAW)).not.toThrow();
    expect(() => assertConfigMirror(agrees.replace("= 50", "= 49"), MCP_RAW)).toThrow(/warnMinWorkers: the server says 50, src\/config\/layoffs\.ts says 49/);
    expect(() => assertConfigMirror(agrees.replace('warn: "nightly"', 'warn: "hourly"'), MCP_RAW)).toThrow(/cadenceWarn/);
    expect(() => assertConfigMirror(agrees.replace(/export const LAYOFF_DISPLAY_MAX_AGE_DAYS = 90;/, "// LAYOFF_DISPLAY_MAX_AGE_DAYS = 90"), MCP_RAW)).toThrow(/no longer spells LAYOFF_DISPLAY_MAX_AGE_DAYS/);
  });

  it("the basis and the description interpolate every bar from the constant, and type no number before days or workers", () => {
    for (const name of BAR_NAMES) {
      expect(FILING_BASIS, `LAYOFF_FILING_BASIS must interpolate LAYOFF_BARS.${name}`).toMatch(new RegExp(`\\$\\{LAYOFF_BARS\\.${name}\\}`));
    }
    for (const name of ["displayMaxAgeDays", "cadenceEdgar", "cadenceWarn"]) {
      expect(RECORD_TOOL, `the description must interpolate LAYOFF_BARS.${name}`).toMatch(new RegExp(`\\$\\{LAYOFF_BARS\\.${name}\\}`));
    }
    for (const [where, text] of [["LAYOFF_FILING_BASIS", FILING_BASIS], ["employer_hiring_record description", RECORD_TOOL]] as const) {
      expect(/\b\d+\s+(?:days|workers)\b/.exec(text)?.[0], `${where} types a number before days/workers`).toBeUndefined();
      expect(/\b(?:hourly|nightly|daily|weekly)\b/.exec(text)?.[0], `${where} types a cadence word`).toBeUndefined();
    }
    // The runner hands the basis through, from the same constant.
    expect(RECORD_RUNNER).toMatch(/layoff_basis: LAYOFF_FILING_BASIS/);
  });

  it("a filing is printed as a filing: the basis says what it is and is not, and no banned noun sits near it", () => {
    for (const must of [
      "A filing is a fact about the employer on one date",
      "no part of record, unknown_reason, or any verdict",
      "An 8-K amendment never appears",
      "without a curated or exact multi-token employer match never appears",
    ]) expect(FILING_BASIS.replace(/`\s*\+\s*`/g, ""), `the basis must say: ${must}`).toContain(must);
    const sentence = filingSentenceOf(RECORD_TOOL);
    expect(sentence).toMatch(/verbatim/);
    expect(sentence).toMatch(/link/);
    for (const [where, text] of [["the layoff constants", LAYOFF_CONSTANTS], ["the description's filing sentence", sentence]] as const) {
      expect(BANNED.exec(text)?.[0], `${where} carry a banned noun`).toBeUndefined();
      expect(/\bhired\b/i.exec(text)?.[0], `${where} say hired`).toBeUndefined();
    }
  });
});

describe("the field is the reader's row, null when nothing qualified, and no part of the record's judgement", () => {
  it("the reader's lf_ columns and the schema's fields are the same set, every one required, and the mapper writes each from its column", () => {
    const columns = fieldsOfReader(READER_RAW);
    expect(columns.length).toBeGreaterThanOrEqual(15);
    const { declared, required } = fieldsOfSchema(FILING_SCHEMA);
    expect([...declared].sort()).toEqual([...columns].sort());
    expect([...required].sort()).toEqual([...columns].sort());
    expect(FILING_SCHEMA).toMatch(/type: \["object", "null"\]/);
    expect(FILING_SCHEMA).toMatch(/additionalProperties: false/);
    const mapped = fieldsOfMapper(FILING_MAPPER);
    expect(mapped.map(([f]) => f).sort()).toEqual([...columns].sort());
    for (const [field, column] of mapped) expect(column, `${field} must be read from r.lf_${field}`).toBe(field);
  });

  it("the row schema declares the field and requires it; the response schema requires the basis; both are written", () => {
    expect(ROW_SCHEMA).toMatch(/\n    layoff_filing: LAYOFF_FILING_SCHEMA,/);
    expect(/required: \[([^\]]*)\]/.exec(ROW_SCHEMA)?.[1]).toMatch(/"layoff_filing"/);
    const out = between(RECORD_TOOL, "outputSchema: {", "\n    },");
    expect(out).toMatch(/layoff_basis: \{ type: "string"/);
    expect(/required: \[([^\]]*)\]/.exec(out)?.[1]).toMatch(/"layoff_basis"/);
    expect(RECORD_RUNNER).toMatch(/layoff_filing: filings\.get\(tok\) \?\? null,/);
    expect(RECORD_RUNNER).toMatch(/filings = await employerLayoffFilings\(client, tokens\);/);
    expect(out).toMatch(/layoff_read: \{ type: "string"/);
    expect(/required: \[([^\]]*)\]/.exec(out)?.[1]).toMatch(/"layoff_read"/);
  });

  it("the filing read is an accessory: a reader that throws leaves the metered record call alive, with layoff_filing null and layoff_read naming the fault", () => {
    assertReaderIsAccessory(RECORD_RUNNER);
    expect(RECORD_RUNNER).toMatch(/layoff_read: layoffRead/);
    // The basis tells the agent what a null means on such a call.
    expect(FILING_BASIS.replace(/`\s*\+\s*`/g, "")).toMatch(/layoff_read on the response is not "ok"/);
  });

  it("TEETH: the unconditional await the runner used to carry fails the accessory property, and so does a catch that rethrows", () => {
    const bare = RECORD_RUNNER.replace(/let filings = new Map[\s\S]*?\n  \}\n/, "  const filings = await employerLayoffFilings(client, tokens);\n");
    expect(bare).not.toBe(RECORD_RUNNER);
    expect(bare).toMatch(/const filings = await employerLayoffFilings\(client, tokens\);/);
    expect(() => assertReaderIsAccessory(bare)).toThrow(/outside a try/);
    const rethrow = RECORD_RUNNER.replace(/\} catch \(e\) \{/, "} catch (e) {\n    throw e;");
    expect(rethrow).not.toBe(RECORD_RUNNER);
    expect(() => assertReaderIsAccessory(rethrow)).toThrow(/rethrows/);
    const silent = RECORD_RUNNER.replace(/layoffRead = `unread: [^\n]*\n/, "");
    expect(silent).not.toBe(RECORD_RUNNER);
    expect(() => assertReaderIsAccessory(silent)).toThrow(/name the fault/);
  });

  it("one more RPC on the same tokens, and null only when the reader answered NULL — an unanswered token is thrown, never filled", () => {
    expect(FILINGS_READER).toMatch(/client\.rpc\("get_employer_layoff_filings", \{ p_tokens: tokens \}\)/);
    expect(FILINGS_READER).toMatch(/throw new Error\(`get_employer_layoff_filings answered no row for \$\{tok\}`\)/);
    expect(FILING_MAPPER).toMatch(/if \(r\.lf_source == null\) return null;/);
    // Nothing is re-derived: the mapper reads r.lf_ columns and compares none of them to a bar.
    expect(RUNNERS).not.toMatch(/[<>]=?\s*LAYOFF_BARS|LAYOFF_BARS\.\w+\s*[<>]=?/);
    expect(FILING_MAPPER).not.toMatch(/LAYOFF_BARS/);
  });

  it("record and unknown_reason are computed without reading the filing, and employer_growth carries none of it", () => {
    const judgement = between(RECORD_RUNNER, "const nothingAtAll", "unknown_reason: unknownReason,");
    expect(judgement.length).toBeGreaterThan(100);
    expect(/layoff|filing|lf_/i.exec(judgement)?.[0], "the record's judgement reads the filing").toBeUndefined();
    for (const [where, text] of [["runEmployerGrowth", GROWTH_RUNNER], ["employer_growth tool block", GROWTH_TOOL], ["GROWTH_ROW_SCHEMA", CONSTANTS.slice(CONSTANTS.indexOf("const GROWTH_ROW_SCHEMA = {"))]] as const) {
      expect(/layoff/i.exec(text)?.[0], `${where} carries the filing`).toBeUndefined();
    }
  });

  it("TEETH: a mapper that drops a field, or reads one from the wrong column, is caught", () => {
    const dropped = FILING_MAPPER.replace(/\n    more_n: [^\n]*/, "");
    expect(dropped).not.toBe(FILING_MAPPER);
    expect(fieldsOfMapper(dropped).map(([f]) => f)).not.toContain("more_n");
    const crossed = FILING_MAPPER.replace(/\n    headcount: num\(r\.lf_headcount\)/, "\n    headcount: num(r.lf_workers)");
    expect(crossed).not.toBe(FILING_MAPPER);
    expect(fieldsOfMapper(crossed).find(([f]) => f === "headcount")?.[1]).toBe("workers");
  });

  it("TEETH: a schema that stops declaring a column, and a reader that returns one more, are both caught", () => {
    const schemaLess = FILING_SCHEMA.replace(/\n    more_n: \{[^\n]*\n/, "\n");
    expect(schemaLess).not.toBe(FILING_SCHEMA);
    expect(fieldsOfSchema(schemaLess).declared).not.toContain("more_n");
    const readerMore = READER_RAW.replace(/(\n\s*lf_more_n\s+int\n)/, "\n  lf_verdict        text,$1");
    expect(readerMore).not.toBe(READER_RAW);
    expect(fieldsOfReader(readerMore)).toContain("verdict");
    expect([...fieldsOfSchema(FILING_SCHEMA).declared].sort()).not.toEqual([...fieldsOfReader(readerMore)].sort());
  });

  it("TEETH: a runner that folded the filing into the reason would fail the judgement property", () => {
    const folded = RECORD_RUNNER.replace(
      'const unknownReason = nothingAtAll ? "no_record"',
      'const unknownReason = filings.get(tok) ? "no_record" : nothingAtAll ? "no_record"',
    );
    expect(folded).not.toBe(RECORD_RUNNER);
    const judgement = between(folded, "const nothingAtAll", "unknown_reason: unknownReason,");
    expect(/layoff|filing|lf_/i.exec(judgement)?.[0]).toBeDefined();
  });
});
