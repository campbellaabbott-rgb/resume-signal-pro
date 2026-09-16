import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A READER THAT MISSES A FAMILY THE SERVER METERS IS A DARK CHANNEL.
 *
 * agent_adoption_metrics (migration 20260917200000) is the only reader of
 * MCP uptake. It buckets api_usage rows by the ENDPOINT FAMILY the server
 * wrote them under: agent-mcp meters a tool call as the MCP prefix plus the
 * tool name, and the connect plan adds a prompt family and a resource family
 * under their own static prefixes. The reader classifies rows by those
 * prefixes, so a family the server starts emitting that the reader does not
 * name falls into the tool bucket under a leaf like "prompt/find_my_next_role"
 * — counted, but under the wrong noun, and invisible as a family. The
 * funnel once recorded nothing for months while every line of it looked
 * live (project_analytics_visitor_id); this guard exists so a metering
 * change on the server side cannot silently narrow the reader.
 *
 * The families are DERIVED, never typed: the server's are parsed out of
 * agent-mcp/index.ts (every string or template literal that begins with the
 * MCP prefix, AND every builder assembled from the MCP_ENDPOINT_PREFIX
 * constant by concatenation or interpolation — its static tail is the
 * family, a colon-spelled tail included), the plan's are pinned as the
 * minimum the reader must classify even before the server lane lands them.
 * The reader must classify the union, and must classify nothing else. The
 * prompt family is plan-pinned but never emitted: a prompt read is free and
 * unmetered by construction (PLAN item 7), so its columns honestly read
 * zero — the reader classifies it so a server that ever starts metering a
 * prompt is counted under the right noun, not so that anything is expected
 * there today.
 * Likewise the key name the reader splits mints by is read out of the
 * issuer's INSERT, and the search caller it filters by is read out of the
 * shared header module and the server's use of it.
 *
 * Every assertion runs against COMMENT-STRIPPED source (project_guard_literals).
 */
const ROOT = resolve(__dirname, "../..");
const MIG_DIR = resolve(ROOT, "supabase/migrations");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const stripTs = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const stripSql = (s: string) => s.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

const MCP_PREFIX = "/mcp/";
/** The families the plan names (section 6 / item 8): prompt and resource reads under their own prefixes. */
const PLAN_FAMILIES = ["", "prompt/", "resource/"];

/** The name of the server's prefix constant; a builder may spell the prefix through it instead of as a literal. */
const PREFIX_CONST = "MCP_ENDPOINT_PREFIX";
const TAIL = "[A-Za-z0-9_/:-]*";
const ESC_PREFIX = MCP_PREFIX.replace(/\//g, "\\/");

/**
 * Every static family tail the server writes after the MCP prefix — inside
 * a string or template literal, or appended to the prefix constant by `+`
 * or by `${…}` interpolation. A tail that ends in a separator (slash or
 * colon) IS the family; a tail that names a full endpoint still belongs to
 * the family of its longest separator-terminated prefix.
 */
function serverFamilies(tsSource: string): string[] {
  const out = new Set<string>();
  const forms = [
    new RegExp(`["'\`]${ESC_PREFIX}(${TAIL})`, "g"),
    new RegExp(`\\b${PREFIX_CONST}\\s*\\+\\s*["'\`](${TAIL})`, "g"),
    new RegExp(`\\$\\{${PREFIX_CONST}\\}(${TAIL})`, "g"),
  ];
  for (const re of forms) {
    for (const m of tsSource.matchAll(re)) {
      const tail = m[1];
      const cut = Math.max(tail.lastIndexOf("/"), tail.lastIndexOf(":"));
      out.add(cut < 0 ? "" : tail.slice(0, cut + 1));
    }
  }
  return [...out].sort();
}

/** Every family the reader classifies: each LIKE pattern under the prefix. */
function readerFamilies(body: string): string[] {
  const out = new Set<string>();
  const re = new RegExp(`LIKE '${ESC_PREFIX}(${TAIL})%'`, "g");
  for (const m of body.matchAll(re)) out.add(m[1]);
  return [...out].sort();
}

/**
 * Every p_endpoint the server hands api_key_check, as written: each must be
 * the tool builder or one of the named family builders, so no endpoint can
 * reach the meter through a spelling the family parser does not read.
 */
function meterArguments(tsSource: string): string[] {
  return [...tsSource.matchAll(/p_endpoint:\s*((?:`[^`]*`|"[^"]*"|'[^']*'|[^,}`"'\n])+)/g)].map((m) => m[1].trim());
}

/** Families the reader is missing, and families it names that nobody emits or planned. */
function familyGaps(body: string, server: string[]): { missing: string[]; unexplained: string[]; unextracted: string[]; afterElse: string[] } {
  const required = [...new Set([...server, ...PLAN_FAMILIES])].sort();
  const reader = readerFamilies(body);
  const missing = required.filter((f) => !reader.includes(f));
  const unexplained = reader.filter((f) => !required.includes(f));
  // A non-tool family must also have its leaf extracted (length of its own
  // prefix), and must be classified BEFORE the tool fallback, or the tool
  // bucket swallows it.
  const elseAt = body.indexOf("ELSE 'tool'");
  const unextracted = reader.filter((f) => f !== "" && !body.includes(`length('${MCP_PREFIX}${f}')`));
  const afterElse = reader.filter((f) => f !== "" && !(elseAt > 0 && body.indexOf(`LIKE '${MCP_PREFIX}${f}%'`) < elseAt));
  return { missing, unexplained, unextracted, afterElse };
}

function newestDefining(fnName: string): string {
  const files = readdirSync(MIG_DIR).filter((n) => n.endsWith(".sql")).sort()
    .filter((n) => new RegExp(`FUNCTION public\\.${fnName}\\s*\\(`).test(readFileSync(resolve(MIG_DIR, n), "utf8")));
  expect(files.length, `no migration defines ${fnName}`).toBeGreaterThan(0);
  return readFileSync(resolve(MIG_DIR, files[files.length - 1]), "utf8");
}
function bodyOf(sql: string, fn: string): string {
  const defAt = sql.indexOf(`FUNCTION public.${fn}(`);
  const after = sql.slice(defAt);
  const start = after.indexOf("AS $$");
  const end = after.indexOf("$$;", start + 5);
  return stripSql(after.slice(start + 5, end));
}

const MCP = stripTs(read("supabase/functions/agent-mcp/index.ts"));
const READER = bodyOf(newestDefining("agent_adoption_metrics"), "agent_adoption_metrics");

describe("the adoption reader classifies every endpoint family the server meters", () => {
  it("the server meters at least the tool family under the MCP prefix, through api_key_check", () => {
    const fams = serverFamilies(MCP);
    expect(fams, "no MCP-prefixed endpoint builder found in agent-mcp — the metering moved").toContain("");
    // The builder is handed to api_key_check as p_endpoint: that is the row the reader reads.
    expect(MCP).toMatch(/p_endpoint:\s*`\/mcp\/\$\{toolName\}`/);
    // And that is the ONLY argument the meter ever receives (a read's family
    // endpoint arrives through toolName, built by a named family builder
    // whose literal the parser reads), so no spelling can bypass the parser.
    const args = meterArguments(MCP);
    expect(args.length).toBeGreaterThan(0);
    expect(args.filter((a) => a !== "`/mcp/${toolName}`"), "a p_endpoint spelled outside the tool builder").toEqual([]);
    // The family parser sees the prefix constant's spellings as well as literals.
    expect(MCP).toMatch(/const MCP_ENDPOINT_PREFIX = "\/mcp\/";/);
  });

  it("the reader names every family the server emits and every family the plan pins, and no other", () => {
    const g = familyGaps(READER, serverFamilies(MCP));
    expect(g.missing, "family the server meters (or the plan names) that the reader does not classify").toEqual([]);
    expect(g.unexplained, "family the reader classifies that the server never emits and the plan never named").toEqual([]);
    expect(g.unextracted, "family whose leaf is not extracted by its own prefix length").toEqual([]);
    expect(g.afterElse, "family classified after the tool fallback (the tool bucket would swallow it)").toEqual([]);
    expect(readerFamilies(READER)).toEqual(PLAN_FAMILIES.slice().sort());
  });

  it("each family has a total and a detail column, and the family names are the leaf under the prefix", () => {
    const outs = /RETURNS TABLE \(([\s\S]*?)\)\s*\nLANGUAGE/.exec(newestDefining("agent_adoption_metrics"))?.[1] ?? "";
    for (const f of readerFamilies(READER)) {
      const noun = f === "" ? "tool" : f.replace(/\/$/, "");
      expect(outs, `mcp_${noun}_calls_total column`).toMatch(new RegExp(`\\bmcp_${noun}_calls_total bigint`));
      expect(outs, `mcp_${noun}_usage column`).toMatch(new RegExp(`\\bmcp_${noun}_usage jsonb`));
      expect(READER, `the ${noun} family is joined by its own name`).toMatch(new RegExp(`\\.fam = '${noun}'`));
    }
  });

  it("splits mints by the exact name the agent-key issuer writes, read from the issuer's INSERT", () => {
    const issuer = bodyOf(newestDefining("api_key_issue_agent"), "api_key_issue_agent");
    const ins = /INSERT INTO public\.api_keys \(([^)]*)\)\s*VALUES \(([^)]*)\)/.exec(issuer);
    expect(ins, "the issuer's INSERT into api_keys").toBeTruthy();
    const cols = ins![1].split(",").map((c) => c.trim());
    const vals = ins![2].split(",").map((v) => v.trim());
    const nameAt = cols.indexOf("name");
    expect(nameAt, "the issuer stamps a name").toBeGreaterThanOrEqual(0);
    const literal = /^'([^']+)'$/.exec(vals[nameAt])?.[1];
    expect(literal, "the issuer's name is a literal, not a parameter").toBeTruthy();
    expect(READER).toContain(`ak.name = '${literal}'`);
    expect(READER).toContain(`ak.name IS DISTINCT FROM '${literal}'`);
  });

  it("filters searches by the caller value agent-mcp sends in the shared header", () => {
    const shared = stripTs(read("supabase/functions/_shared/search-caller.ts"));
    const callers = /SEARCH_CALLERS = \[([^\]]*)\]/.exec(shared)?.[1] ?? "";
    const sent = /searchCallerHeader\("([a-z]+)"\)/.exec(MCP)?.[1];
    expect(sent, "agent-mcp names itself in the search-caller header").toBeTruthy();
    expect(callers, "and that value is one of the closed set").toContain(`"${sent}"`);
    expect(READER).toContain(`e.caller = '${sent}'`);
  });

  it("teeth: a family the server starts emitting is reported by name, and a dropped branch is reported", () => {
    const mutatedServer = MCP + "\nconst x = `/mcp/session/${toolName}`;\n";
    const g = familyGaps(READER, serverFamilies(mutatedServer));
    expect(g.missing).toEqual(["session/"]);

    // A builder assembled from the prefix CONSTANT — by concatenation, by
    // interpolation, with a colon separator — is seen the same way a
    // literal is, so a family renamed that way cannot hide from the reader.
    const concat = MCP + '\nconst RESOURCE_ENDPOINT2 = (name: string) => MCP_ENDPOINT_PREFIX + "resource:" + name;\n';
    expect(familyGaps(READER, serverFamilies(concat)).missing).toEqual(["resource:"]);
    const interp = MCP + "\nconst RESOURCE_ENDPOINT3 = (name: string) => `${MCP_ENDPOINT_PREFIX}resource:${name}`;\n";
    expect(familyGaps(READER, serverFamilies(interp)).missing).toEqual(["resource:"]);
    const colonLiteral = MCP + "\nconst RESOURCE_ENDPOINT4 = (name: string) => `/mcp/resource:${name}`;\n";
    expect(familyGaps(READER, serverFamilies(colonLiteral)).missing).toEqual(["resource:"]);
    // A p_endpoint spelled outside the tool builder is reported as such.
    const bypass = MCP.replace("p_endpoint: `/mcp/${toolName}`", 'p_endpoint: "/mcp/" + toolName');
    expect(bypass).not.toBe(MCP);
    expect(meterArguments(bypass).filter((a) => a !== "`/mcp/${toolName}`")).toEqual(['"/mcp/" + toolName']);

    const dropped = READER.replace(/\s*WHEN u\.endpoint LIKE '\/mcp\/resource\/%' THEN 'resource'/, "");
    expect(dropped).not.toBe(READER);
    // The classifier no longer names the family, though the leaf line still does:
    const g2 = familyGaps(dropped.replace(/WHEN u\.endpoint LIKE '\/mcp\/resource\/%' THEN substr[^\n]*\n/, ""), serverFamilies(MCP));
    expect(g2.missing).toEqual(["resource/"]);

    // A family classified only after the tool fallback, with no leaf
    // extraction and no emitter, is reported on all three counts.
    const late = READER + "\n  WHEN u.endpoint LIKE '/mcp/late/%' THEN 'late'\n";
    const g3 = familyGaps(late, serverFamilies(MCP));
    expect(g3.afterElse).toEqual(["late/"]);
    expect(g3.unextracted).toEqual(["late/"]);
    expect(g3.unexplained).toEqual(["late/"]);
  });
});
