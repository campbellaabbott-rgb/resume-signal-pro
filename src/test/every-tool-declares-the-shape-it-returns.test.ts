import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * EVERY TOOL DECLARES THE SHAPE IT RETURNS.
 *
 * The MCP server speaks the one protocol revision that lets a tool declare an
 * outputSchema and lets a client validate structuredContent against it. Six
 * of eleven tools declared one on 2026-09-04; five did not, and a client that
 * had learned to parse the six had to guess at the rest — check_apply_support,
 * request_application, application_status, board_stats, debug_search. The
 * file's own header says a tool that declares a schema MUST return a result
 * that satisfies it, which cuts both ways: a schema with no tool behind it
 * and a tool with no schema are the same gap.
 *
 * Two properties, both read off comment-stripped code and both proven to
 * fail on a broken copy:
 *   1. every entry in the TOOLS registry carries an outputSchema;
 *   2. every key a schema REQUIRES — at the top level, and in every branch of
 *      a declared union — is written by the runner the dispatch hands that
 *      tool to (or by the function that runner returns through), so the
 *      declaration cannot promise a key the code never produces.
 *
 * Nothing here pins a spelling in prose. The parsers are pure functions of a
 * source text so a mutated copy can be handed to them.
 */
const ROOT = resolve(__dirname, "../..");
const MCP_PATH = "supabase/functions/agent-mcp/index.ts";
const RAW = readFileSync(resolve(ROOT, MCP_PATH), "utf8");
// Whole-line comments first (a `//` inside a URL string survives), then
// block comments.
const stripTs = (s: string) => s.replace(/^\s*\/\/[^\n]*/gm, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
const CODE = stripTs(RAW);

// ── parsers ───────────────────────────────────────────────────────────────

/**
 * The balanced bracket text starting at `open` (a `{` or `[`), skipping
 * string literals. Used on schema objects only: those carry plain strings,
 * never nested template literals.
 */
function balanced(src: string, open: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === "\\") { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error("unbalanced bracket");
}

type Tool = { name: string; src: string };

/** The registry's entries, in registration order, each with its own source. */
function toolsOf(code: string): Tool[] {
  const a = code.indexOf("const TOOLS = [");
  if (a < 0) throw new Error("the TOOLS registry was not found — RE-ANCHOR this guard");
  const b = code.indexOf("\n];", a);
  const arr = code.slice(a, b);
  const marks = [...arr.matchAll(/\n    name: "([a-z_]+)",/g)];
  return marks.map((m, i) => ({
    name: m[1],
    src: arr.slice(m.index ?? 0, i + 1 < marks.length ? (marks[i + 1].index ?? arr.length) : arr.length),
  }));
}

/** The tool's declared outputSchema object text, or null when it declares none. */
function outputSchemaOf(tool: Tool): string | null {
  const m = /\boutputSchema: \{/.exec(tool.src);
  if (!m) return null;
  return balanced(tool.src, m.index + m[0].length - 1);
}

const stringsIn = (arrText: string): string[] => [...arrText.matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"/g)].map((x) => x[1]);

/**
 * What the schema requires of the RESULT OBJECT: its own top-level `required`
 * and, for a declared union, each `oneOf` branch's `required`. Nested
 * schemas (a row's required keys) sit deeper than depth one and are not the
 * result object's business.
 */
function requiredKeysOf(schema: string): { top: string[]; branches: string[][] } {
  const top: string[] = [];
  const branches: string[][] = [];
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < schema.length; i++) {
    const ch = schema[i];
    if (quote) {
      if (ch === "\\") { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "{" || ch === "[") { depth++; continue; }
    if (ch === "}" || ch === "]") { depth--; continue; }
    if (depth !== 1) continue;
    if (schema.startsWith("required: [", i)) {
      const arr = balanced(schema, i + "required: ".length);
      top.push(...stringsIn(arr));
      i += "required: ".length + arr.length - 1;
    } else if (schema.startsWith("oneOf: [", i)) {
      const arr = balanced(schema, i + "oneOf: ".length);
      for (const r of arr.matchAll(/required: (\[[^\]]*\])/g)) branches.push(stringsIn(r[1]));
      i += "oneOf: ".length + arr.length - 1;
    }
  }
  return { top, branches };
}

/** The runner the dispatch hands this tool to — a case in callTool's switch, or the one site answered beside it. */
function runnerNameOf(code: string, tool: string): string {
  const a = code.indexOf("switch (name) {");
  const b = code.indexOf("\n    default:", a);
  const sw = code.slice(a, b);
  const inSwitch = new RegExp(`case "${tool}":[\\s\\S]*?await (run[A-Za-z]+)\\(`).exec(sw);
  if (inSwitch) return inSwitch[1];
  const beside = new RegExp(`"${tool}"[\\s\\S]{0,160}?await (run[A-Za-z]+)\\(`).exec(code);
  if (!beside) throw new Error(`no runner is dispatched for ${tool}`);
  return beside[1];
}

/** A top-level function's text, to its own closing brace at column zero. */
function functionText(code: string, fn: string): string {
  const m = new RegExp(`\\n(?:async )?function ${fn}\\(`).exec(code);
  if (!m) throw new Error(`function ${fn} is not declared`);
  const end = code.indexOf("\n}\n", m.index);
  return code.slice(m.index, end < 0 ? code.length : end + 2);
}

/**
 * The runner plus every declared function it returns THROUGH (`return await
 * fn(` / `return fn(`): request_application's runner refuses in its own
 * literal and otherwise returns enqueueApplication's answer, which is where
 * the accepted shape is written.
 */
function runnerAndDelegates(code: string, fn: string): string {
  const own = functionText(code, fn);
  let out = own;
  for (const m of own.matchAll(/return (?:await )?([A-Za-z]+)\(/g)) {
    const callee = m[1];
    if (callee === fn || !new RegExp(`\\n(?:async )?function ${callee}\\(`).test(code)) continue;
    out += "\n" + functionText(code, callee);
  }
  return out;
}

/** Does this key appear as a written property — `key:` or the shorthand `{ key, …}` — in the text? */
const writesKey = (text: string, key: string): boolean =>
  new RegExp(`(?<![\\w.$])${key}\\s*:`).test(text) || new RegExp(`[{,]\\s*${key}\\s*[,}]`).test(text);

/** Every (tool, key) the declared schemas require that the code never writes. */
function undeclaredKeys(code: string): string[] {
  const out: string[] = [];
  for (const t of toolsOf(code)) {
    const schema = outputSchemaOf(t);
    if (!schema) continue;
    const text = runnerAndDelegates(code, runnerNameOf(code, t.name));
    const { top, branches } = requiredKeysOf(schema);
    for (const k of top) if (!writesKey(text, k)) out.push(`${t.name}.${k}`);
    branches.forEach((keys, i) => {
      for (const k of keys) if (!writesKey(text, k)) out.push(`${t.name}.oneOf[${i}].${k}`);
    });
  }
  return out;
}

// ── the properties ────────────────────────────────────────────────────────

describe("every tool declares the shape it returns", () => {
  const tools = toolsOf(CODE);

  it("parses a non-trivial registry (an empty list would pass everything below vacuously)", () => {
    expect(tools.length).toBeGreaterThan(10);
    expect(new Set(tools.map((t) => t.name)).size).toBe(tools.length);
  });

  it("every registered tool carries an outputSchema", () => {
    const missing = tools.filter((t) => outputSchemaOf(t) === null).map((t) => t.name);
    expect(missing, "tools with no declared result shape").toEqual([]);
  });

  it("every schema requires at least one key or declares a union, so no declaration is an empty promise", () => {
    // get_job is the deliberate exception: a dead id answers with what the
    // board knows rather than a card, and its schema says so by requiring
    // nothing. Every other tool has a key it always writes.
    for (const t of tools) {
      if (t.name === "get_job") continue;
      const { top, branches } = requiredKeysOf(outputSchemaOf(t)!);
      expect(top.length + branches.length, `${t.name} declares a schema that requires nothing`).toBeGreaterThan(0);
    }
  });

  it("the five tools that lacked a schema on 2026-09-04 declare one, and each says what its runner returns", () => {
    const expected: Record<string, string[]> = {
      check_apply_support: ["jobId", "agentReady", "vendor", "requirements"],
      request_application: ["accepted"],
      application_status: [],
      board_stats: ["servablePostings", "openCompanyBoards", "openCompanyBoardsBasis", "categories", "freshnessWindowDays"],
      debug_search: ["decision", "outcome"],
    };
    for (const [name, keys] of Object.entries(expected)) {
      const t = tools.find((x) => x.name === name);
      expect(t, `${name} is registered`).toBeTruthy();
      const req = requiredKeysOf(outputSchemaOf(t!)!);
      expect(req.top, `${name} top-level required keys`).toEqual(keys);
    }
    // The two runners that answer a union declare it as one.
    expect(requiredKeysOf(outputSchemaOf(tools.find((x) => x.name === "request_application")!)!).branches.length).toBe(3);
    expect(requiredKeysOf(outputSchemaOf(tools.find((x) => x.name === "application_status")!)!).branches.length).toBe(2);
  });

  it("every key a schema requires is written by the runner the dispatch hands that tool to", () => {
    expect(undeclaredKeys(CODE)).toEqual([]);
  });

  it("the two aliases keep ChatGPT's fixed shapes as required keys", () => {
    const search = requiredKeysOf(outputSchemaOf(tools.find((x) => x.name === "search")!)!);
    const fetch = requiredKeysOf(outputSchemaOf(tools.find((x) => x.name === "fetch")!)!);
    expect(search.top).toEqual(["results"]);
    expect(fetch.top).toEqual(["id", "title", "text", "url", "metadata"]);
    // …and the result items of search are the three ChatGPT reads.
    const items = /results: \{[\s\S]*?items: \{[\s\S]*?required: \[([^\]]*)\]/.exec(outputSchemaOf(tools.find((x) => x.name === "search")!)!);
    expect(stringsIn(items?.[1] ?? "")).toEqual(["id", "title", "url"]);
  });
});

describe("teeth: each property fails on a copy that breaks it", () => {
  it("a tool whose outputSchema is dropped is reported by name", () => {
    const t = toolsOf(CODE).find((x) => x.name === "check_apply_support")!;
    const broken = CODE.replace(t.src, t.src.replace("outputSchema: {", "outputShape: {"));
    expect(broken).not.toBe(CODE);
    const missing = toolsOf(broken).filter((x) => outputSchemaOf(x) === null).map((x) => x.name);
    expect(missing).toEqual(["check_apply_support"]);
  });

  it("a runner that stops writing a required key is reported as tool.key", () => {
    const own = functionText(CODE, "runSearchAlias");
    const broken = CODE.replace(own, own.replace(/\bresults:/, "rows:"));
    expect(broken).not.toBe(CODE);
    expect(undeclaredKeys(broken)).toEqual(["search.results"]);
  });

  it("a union branch whose key the delegate stops writing is reported with its branch", () => {
    const seam = functionText(CODE, "enqueueApplication");
    const broken = CODE.replace(seam, seam.replace(/\bwhatHappensNext:/, "next:"));
    expect(broken).not.toBe(CODE);
    expect(undeclaredKeys(broken)).toEqual(["request_application.oneOf[2].whatHappensNext"]);
  });

  it("the shorthand `{ key, … }` counts as writing the key, and a bare argument does not", () => {
    expect(writesKey("return { id, job: null };", "id")).toBe(true);
    expect(writesKey("return { terms, query, jobs: [] };", "query")).toBe(true);
    expect(writesKey("const out = await detailOf(id, 24_000);", "id")).toBe(false);
    expect(writesKey("const x = a.results;", "results")).toBe(false);
  });

  it("the required-key parser reads the result object's own level and its union, never a row's", () => {
    const schema = `{
      type: "object",
      properties: { rows: { type: "array", items: { type: "object", required: ["inner"] } }, note: { type: "string" } },
      required: ["rows"],
      oneOf: [{ required: ["rows", "note"] }, { required: ["error"] }],
    }`;
    expect(requiredKeysOf(schema)).toEqual({ top: ["rows"], branches: [["rows", "note"], ["error"]] });
  });
});
