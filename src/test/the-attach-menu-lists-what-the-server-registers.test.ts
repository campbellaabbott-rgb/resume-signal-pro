import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  MCP_JOB_RESOURCE_PREFIX, MCP_KEYED_CAPS, MCP_PROMPTS, MCP_RESOURCES, MCP_TOOL_NAMES,
} from "../config/mcp-tools";
import { bearerChallenge, unauthorized } from "../../supabase/functions/agent-mcp/oauth";

/**
 * THE ATTACH MENU LISTS WHAT THE SERVER REGISTERS.
 *
 * agent-mcp 2026-09-04.7 declares prompts and resources beside its tools.
 * The page that describes them renders from a mirror in src/config, and a
 * mirror is exactly the thing that goes stale when the other runtime moves
 * — the /agents page once said "six tools" for a server registering eleven.
 * This file reads the Deno source and fails on drift in name, order, count,
 * title, URI, mime type and gate, the way the-page-says-six does for tools.
 *
 * Four more properties ride along, each one a way the new surface could
 * quietly go wrong:
 *   - a prompt, the guide and the head of initialize.instructions reach a
 *     tool's name ONLY through tool(), which throws on a name the registry
 *     lacks — so no body can spell a tool the server does not have;
 *   - listing is free, and so is a prompt: prompts/list, resources/list and
 *     prompts/get are answered before the credential is read and touch no
 *     meter and no challenge, for every caller;
 *   - a credentialed resource read is metered under its own endpoint family,
 *     and the winning api_key_check exempts exactly those families from
 *     starting a pass (a look at the guide must not start a paid clock);
 *   - a resource read whose runner fails answers a JSON-RPC error in the
 *     read's shape on both tiers — never a bare 500, never a tool result;
 *   - the mirror's caps are the server's (rows per keyed page, ids per
 *     check_jobs_open), and every copy of each cap reads the one constant;
 *   - the in-band sign-in hedge carries the SAME challenge string the HTTP
 *     challenge sends, sits only in the tools/call gate, and only for a
 *     caller whose _meta carries the OpenAI marker.
 *
 * Everything is a property read off comment-stripped code; the parsers are
 * pure functions of a source text so a mutated copy can be handed to them.
 */
const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const stripTs = (s: string) => s.replace(/^\s*\/\/[^\n]*/gm, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
const stripSql = (s: string) => s.replace(/--[^\n]*/g, " ");
const MCP_RAW = read("supabase/functions/agent-mcp/index.ts");
const MCP = stripTs(MCP_RAW);
const MIG_DIR = resolve(ROOT, "supabase/migrations");

const between = (src: string, from: string, to: string): string => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(`anchor "${from}" is gone — RE-ANCHOR this guard`);
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(`anchor "${to}" after "${from}" is gone — RE-ANCHOR this guard`);
  return src.slice(a, b);
};

// ── parsers ─────────────────────────────────────────────────────────────────

/** The tool names the server registers. */
const toolNamesOf = (code: string): string[] =>
  [...between(code, "const TOOLS = [", "\n];").matchAll(/\n    name: "([a-z_]+)",/g)].map((m) => m[1]);

type PromptReg = { name: string; title: string; src: string };
/** The prompts the server registers, in registration order, each with its own source. */
function promptsOf(code: string): PromptReg[] {
  const arr = between(code, "const PROMPTS: readonly Prompt[] = [", "\n];");
  const marks = [...arr.matchAll(/\n    name: "([a-z_]+)",\n    title: "([^"]+)",/g)];
  return marks.map((m, i) => ({
    name: m[1],
    title: m[2],
    src: arr.slice(m.index ?? 0, i + 1 < marks.length ? (marks[i + 1].index ?? arr.length) : arr.length),
  }));
}

type ResourceReg = { uri: string; name: string; title: string; mimeType: string; keyed: boolean };
/** The static resources the server registers: the URI constants resolved, the fields read off each entry. */
function resourcesOf(code: string): ResourceReg[] {
  const scheme = /const RESOURCE_SCHEME = "([^"]+)";/.exec(code)?.[1];
  if (!scheme) throw new Error("RESOURCE_SCHEME is gone — RE-ANCHOR this guard");
  const uris = new Map<string, string>();
  for (const m of code.matchAll(/const ([A-Z_]+_URI) = `\$\{RESOURCE_SCHEME\}([^`]+)`;/g)) uris.set(m[1], scheme + m[2]);
  const arr = between(code, "const RESOURCES: readonly Resource[] = [", "\n];");
  const out: ResourceReg[] = [];
  for (const m of arr.matchAll(/uri: ([A-Z_]+_URI), name: "([^"]+)", title: "([^"]+)", mimeType: "([^"]+)", keyed: (true|false),/g)) {
    const uri = uris.get(m[1]);
    if (!uri) throw new Error(`${m[1]} is not a declared URI constant`);
    out.push({ uri, name: m[2], title: m[3], mimeType: m[4], keyed: m[5] === "true" });
  }
  return out;
}

/** Every name handed to tool(), in source order. */
const toolCallsOf = (code: string): string[] => [...code.matchAll(/\btool\("([a-z_]+)"\)/g)].map((m) => m[1]);

/**
 * Registered tool names typed into a text as bare words — with every tool()
 * call and every `${…}` interpolation removed first. A field path such as
 * `features.fit_resume` is not a typed name (the dot before it says so), and
 * the two aliases whose names are ordinary English words (search, fetch —
 * the only registered names without an underscore) are not judged: "search
 * the board" is a sentence, not a list.
 */
function typedToolNames(text: string, names: readonly string[]): string[] {
  const bare = text.replace(/\$\{[^}]*\}/g, " ");
  return names.filter((n) => n.includes("_")).filter((n) => new RegExp(`(?<![A-Za-z_.])${n}(?![A-Za-z_])`).test(bare));
}

/** The dispatcher's two listing handlers: from the first to the templates listing after them. */
const listingsOf = (code: string): string => between(code, 'if (method === "prompts/list")', 'if (method === "resources/templates/list")');

/** The families the server meters a credentialed read under: every /mcp/<family>/ literal. */
const serverFamiliesOf = (code: string): string[] =>
  [...new Set([...code.matchAll(/["'`]\/mcp\/([A-Za-z0-9_-]+)\//g)].map((m) => m[1]))].sort();

/** The families the winning api_key_check exempts from activation. */
function exemptFamiliesOf(sql: string): string[] {
  const clause = between(sql, "p_endpoint <> '/mcp/key_status'", "THEN");
  return [...clause.matchAll(/p_endpoint NOT LIKE '\/mcp\/([A-Za-z0-9_-]+)\/%'/g)].map((m) => m[1]).sort();
}

function winningDefinition(fn: string): string {
  const hits = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort()
    .filter((f) => readFileSync(resolve(MIG_DIR, f), "utf8").includes(`FUNCTION public.${fn}(`));
  if (!hits.length) throw new Error(`no migration defines ${fn}`);
  return stripSql(readFileSync(resolve(MIG_DIR, hits[hits.length - 1]), "utf8"));
}

/** Every site that answers the in-band challenge, with the guard text of the nearest enclosing `if (`. */
function hedgeSitesOf(code: string): { guard: string; inside: boolean }[] {
  const sites: { guard: string; inside: boolean }[] = [];
  for (const m of code.matchAll(/inBandChallenge\(toolName\)/g)) {
    const at = m.index!;
    const guardStart = code.lastIndexOf("if (", at);
    const guard = guardStart < 0 ? "" : code.slice(guardStart, at);
    const depth = (guard.match(/\{/g) ?? []).length - (guard.match(/\}/g) ?? []).length;
    sites.push({ guard, inside: guardStart >= 0 && depth > 0 });
  }
  return sites;
}

/**
 * The instructions as written: instructionsFor's body (wave 4: one function
 * of the caller's edition, served by initialize). Its rendered length in
 * every edition is measured on the text the real handler serves, in
 * the-connector-lists-only-what-its-caller-can-call.test.ts.
 */
const instructionsSourceOf = (code: string): string => between(code, "function instructionsFor(edition: Edition): string {", "\n}\n");
const numberConstOf = (code: string, name: string): number => {
  const m = new RegExp(`const ${name} = (\\d+);`).exec(code);
  if (!m) throw new Error(`${name} is gone — RE-ANCHOR this guard`);
  return Number(m[1]);
};

const TOOL_NAMES = toolNamesOf(MCP);
const SERVER_PROMPTS = promptsOf(MCP);
const SERVER_RESOURCES = resourcesOf(MCP);

// ── the mirrors ─────────────────────────────────────────────────────────────

describe("the mirrors name exactly the prompts and resources the server registers", () => {
  it("the parsers read non-trivial registries (an empty list would pass every comparison vacuously)", () => {
    expect(SERVER_PROMPTS.length).toBeGreaterThan(1);
    expect(SERVER_RESOURCES.length).toBeGreaterThan(1);
    expect(TOOL_NAMES.length).toBeGreaterThan(5);
  });

  it("prompts: same names, same order, same titles", () => {
    expect(MCP_PROMPTS.map((p) => p.name)).toEqual(SERVER_PROMPTS.map((p) => p.name));
    expect(MCP_PROMPTS.map((p) => p.title)).toEqual(SERVER_PROMPTS.map((p) => p.title));
    expect(new Set(SERVER_PROMPTS.map((p) => p.name)).size).toBe(SERVER_PROMPTS.length);
  });

  it("resources: same URIs, names, titles, mime types and gates, in order", () => {
    expect(MCP_RESOURCES.map(({ uri, name, title, mimeType, keyed }) => ({ uri, name, title, mimeType, keyed }))).toEqual(SERVER_RESOURCES);
    expect(SERVER_RESOURCES.some((r) => r.keyed) && SERVER_RESOURCES.some((r) => !r.keyed), "both gates are represented").toBe(true);
  });

  it("the job resource-link prefix is the server's", () => {
    const scheme = /const RESOURCE_SCHEME = "([^"]+)";/.exec(MCP)?.[1];
    const tail = /const JOB_URI_PREFIX = `\$\{RESOURCE_SCHEME\}([^`]+)`;/.exec(MCP)?.[1];
    expect(scheme && tail && scheme + tail).toBe(MCP_JOB_RESOURCE_PREFIX);
    // Wave 4 (spec D2 §2.1): results carry no resource_link blocks — a model
    // pays for every block, and the card's siteUrl names the posting. A job
    // URI a client built still resolves through the fetch alias's runner on
    // both tiers.
    expect(MCP).not.toMatch(/resource_link|withCardLinks/);
    expect(MCP).toMatch(/case "job": return contentsOf\(read\.uri, "application\/json", await runFetchAlias\(\{ id: read\.id \}, ctx\)\)/);
    expect(MCP).toMatch(/answerUnkeyed\(client, req, id, tool\("fetch"\), \{ id: read\.id \}, params\)/);
  });

  it("the mirrors spell no count and no price", () => {
    const spelled = /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:prompts|resources|tools)\b/i;
    for (const p of MCP_PROMPTS) {
      expect(spelled.exec(p.body)?.[0], `${p.name} body spells a count`).toBeUndefined();
      expect(/\$\s?\d/.exec(p.body)?.[0], `${p.name} body spells a price`).toBeUndefined();
    }
    for (const r of MCP_RESOURCES) expect(spelled.exec(r.body)?.[0], `${r.name} body spells a count`).toBeUndefined();
  });

  it("every tool a mirror body names is a tool the server registers (a rename on the server is reported here, not on the page)", () => {
    // A registered name is an underscore word; every underscore word in a
    // body that LOOKS like a tool name must be one the server has. search
    // and fetch are English words and not judged, as on the server side.
    const looksLikeTool = /\b[a-z]+_[a-z_]+\b/g;
    for (const entry of [...MCP_PROMPTS, ...MCP_RESOURCES]) {
      const named = [...entry.body.matchAll(looksLikeTool)].map((m) => m[0]);
      expect(named.filter((n) => !TOOL_NAMES.includes(n)), `${entry.name} body names an unregistered tool`).toEqual([]);
    }
    // The check is not vacuous: at least one body does name a tool.
    expect([...MCP_PROMPTS, ...MCP_RESOURCES].some((e) => looksLikeTool.test(e.body))).toBe(true);
  });

  it("the mirror's keyed caps are the server's, and every copy of each cap on the server reads its constant", () => {
    expect(numberConstOf(MCP, "KEYED_SEARCH_LIMIT")).toBe(MCP_KEYED_CAPS.searchRows);
    expect(numberConstOf(MCP, "CHECK_JOBS_OPEN_MAX")).toBe(MCP_KEYED_CAPS.checkJobsOpenIds);
    // The runner clamps to the constant, the schema declares it, the notes name it.
    expect(MCP).toMatch(/Math\.min\(KEYED_SEARCH_LIMIT, Number\(args\.limit/);
    expect(MCP).toMatch(/Rows per page: \$\{ANON_SEARCH_LIMIT\} with no key, up to \$\{KEYED_SEARCH_LIMIT\} with one\./);
    // A keyed check reads CHECK_JOBS_OPEN_MAX; a keyless one the allowance's own figure.
    expect(MCP).toMatch(/const cap = ctx\.keyless \? ANON_ALLOWANCE\.checkJobsOpenIds : CHECK_JOBS_OPEN_MAX;/);
    expect(MCP).toMatch(/asked\.slice\(0, cap\)/);
    expect(MCP).toMatch(/asked\.slice\(cap\)/);
    expect(MCP).toMatch(/maxItems: CHECK_JOBS_OPEN_MAX/);
    // No copy of either figure survives as a typed number beside a row/id
    // noun or in the id-list clamp (the minute window's 60 is a different
    // quantity and says "requests"; a log line's slice(0, 200) is a string
    // truncation, not the cap).
    expect(MCP.match(/\b60 rows\b|1-60\b|\b200 ids\b|\bup to 200\b|asked\.slice\(0, 200\)|asked\.slice\(200\)|maxItems: 200/g) ?? []).toEqual([]);
    // The mirror's own body reads the constant rather than typing the figure.
    const mirror = stripTs(read("src/config/mcp-tools.ts"));
    expect(mirror).toMatch(/Up to \$\{MCP_KEYED_CAPS\.checkJobsOpenIds\} ids per call/);
    expect(mirror.match(/\b200 ids\b/g) ?? []).toEqual([]);
  });
});

// ── every named tool is a registered tool ───────────────────────────────────

describe("a prompt, the guide and the instructions reach a tool's name only through the registry", () => {
  it("tool() throws on a name the registry lacks, and every name handed to it is registered", () => {
    expect(MCP).toMatch(/const tool = \(name: string\): string => \{\s*if \(!TOOLS\.some\(\(t\) => t\.name === name\)\) throw new Error/);
    const calls = toolCallsOf(MCP);
    expect(calls.length).toBeGreaterThan(10);
    expect(calls.filter((n) => !TOOL_NAMES.includes(n)), "names handed to tool() that the registry lacks").toEqual([]);
  });

  it("no prompt description or body types a registered tool name as a bare word", () => {
    for (const p of SERVER_PROMPTS) {
      // A prompt's own name may be its tool's (apply_myself is both); its
      // registration line is a name, not prose, and is the one line skipped.
      const prose = p.src.replace(/^\n    name: "[a-z_]+",/, "");
      expect(typedToolNames(prose, TOOL_NAMES), `${p.name} types a tool name instead of reading it off the registry`).toEqual([]);
      expect(p.src, `${p.name} must reach at least one tool through tool()`).toMatch(/\btool\("/);
    }
  });

  it("every prompt body is a function of its arguments and the registry, and names a gate never a price", () => {
    for (const p of SERVER_PROMPTS) {
      expect(p.src).toMatch(/\n    body: \((?:a|)\) =>/);
      expect(p.src).not.toMatch(/\$\s?\d|\b\d+ ?(?:USD|dollars)\b/i);
      expect(p.src).not.toMatch(/PASS_PRICE|priceUsd|PASS_PRICE_CENTS/);
    }
    // The CV prompt searches, then verifies the shortlist; since wave 4 both
    // steps are keyless, so it never stops for a key, and it takes NO CV
    // argument (the CV stays in the person's chat; spec §3.8).
    const cv = SERVER_PROMPTS.find((p) => p.name === "find_roles_for_my_cv")!;
    expect(cv.src.indexOf('tool("search_jobs")')).toBeLessThan(cv.src.indexOf('tool("check_jobs_open")'));
    expect(cv.src).not.toMatch(/needs a key|sign-in|and stop\./);
    expect(cv.src).toMatch(/limit = \$\{ANON_SEARCH_LIMIT\}/);
    expect(cv.src).not.toMatch(/resume_text|\bCV:/);
    expect(cv.src).toMatch(/never send CV text to any tool/);
    // A prompt that needs a key says so in its registration, and is listed only to a credential.
    for (const p of SERVER_PROMPTS) {
      const keyedTools = /tool\("(?:key_status|fit_resume|debug_search)"\)/.test(p.src);
      expect(/\n    keyed: true,/.test(p.src), `${p.name}: keyed flag vs keyed tools`).toBe(keyedTools);
    }
  });

  it("the guide types no registered tool name either, and is built from the same constants as the tiers", () => {
    const guide = between(MCP, "function guideText(edition: Edition): string {", "\n}\n");
    expect(typedToolNames(guide, TOOL_NAMES)).toEqual([]);
    for (const c of ["ANON_TOOLS", "KEY_ONLY_READ_TOOLS", "ANON_SEARCH_LIMIT", "ANON_ALLOWANCE", "FREE_KEY_DAILY_QUOTA", "GET_JOBS_MAX", "MINT_URL", "DOCS_URL", "HONESTY_RULES", "FIT_FREE_PER_DAY"]) {
      expect(guide, `${c} must be read, not typed`).toContain(c);
    }
    expect(guide).not.toMatch(/\bhired?\b|\bhires\b|\bfilled\b/i);
    expect(guide).not.toMatch(/\$\s?\d/);
  });

  it("initialize.instructions names the first call through the registry and states the URL-to-id sentence", () => {
    const text = instructionsSourceOf(MCP);
    // Search first (owner decision 2026-10-11: no "call board_stats first").
    expect(text).toMatch(/`Live job search over employers' own hiring feeds\. Start with \$\{tool\("search_jobs"\)\}/);
    expect(text).not.toMatch(/board_stats|Four tiers/);
    expect(text).toMatch(/A resumebooster\.work\/jobs\?job=<id> link's id is the argument to every job tool\./);
    // Every tool name goes through tool(), so a rename throws at module load.
    expect(typedToolNames(text, TOOL_NAMES)).toEqual([]);
    expect(toolCallsOf(text).length).toBeGreaterThan(4);
    expect(MCP).toMatch(/instructions: instructionsFor\(edition\),/);
    // get_job's own description carries the sentence too.
    const getJob = between(MCP, 'name: "get_job",', 'name: "get_jobs",');
    expect(getJob).toMatch(/A resumebooster\.work\/jobs\?job=<id> link's id is this argument/);
  });
});

// ── listing is free; reading follows the gate; metering has a family ────────

describe("listing is free, a credentialed read is metered under its own family, and a look never starts the clock", () => {
  it("initialize declares prompts and resources with no change notifications and no subscriptions, and no completions", () => {
    const caps = between(MCP, "capabilities: {", "\n      },");
    expect(caps).toMatch(/tools: \{ listChanged: false \}/);
    expect(caps).toMatch(/prompts: \{ listChanged: false \}/);
    expect(caps).toMatch(/resources: \{ listChanged: false, subscribe: false \}/);
    expect(caps).not.toMatch(/completions|sampling|elicitation/);
    // NO TEMPLATES ARE OFFERED — but the listing is answered (2026-10-05,
    // L9-16): the resources capability is declared, so a strict client asks
    // resources/templates/list after initialize, and "method not found" broke
    // it. The answer is the one empty list, and nothing else in the server
    // names a template.
    expect(MCP).toMatch(/if \(method === "resources\/templates\/list"\) \{\s*return json\(rpcResult\(id, \{ resourceTemplates: \[\] \}\)\);\s*\}/);
    expect((MCP.match(/resourceTemplates/g) ?? []).length, "a template registry crept in").toBe(1);
  });

  it("prompts/list and resources/list answer before the credential is read and touch no meter and no challenge", () => {
    const lists = listingsOf(MCP);
    // Wave 4: a listing shows only what the caller can use, so it reads
    // whether a credential is PRESENT (never verified, never metered).
    expect(lists).toMatch(/prompts: PROMPTS\.filter\(\(p\) => !p\.keyed \|\| !!bearer\)/);
    expect(lists).toMatch(/resources: RESOURCES\.filter\(\(r\) => !r\.keyed \|\| !!bearer\)/);
    expect(lists).not.toMatch(/api_key_check|mcp_anon_check|unauthorized\(|answerUnkeyed|verifyOAuthBearer|body:/);
    expect(lists.replace(/!!bearer/g, "")).not.toMatch(/bearer/);
  });

  it("prompts/get is free for every caller: answered before the bearer is consulted, through neither meter, with no prompt endpoint family anywhere on the server", () => {
    const pre = between(MCP, "const resolved = readOf(method, params);", 'if (method !== "tools/call") {');
    // The prompt branch comes before the credential is looked at and is
    // unconditional on it.
    const promptAt = pre.indexOf('if (resolved?.kind === "prompt")');
    const bearerAt = pre.indexOf("!bearer");
    expect(promptAt).toBeGreaterThan(-1);
    expect(bearerAt).toBeGreaterThan(promptAt);
    expect(pre.slice(promptAt, bearerAt)).toMatch(/promptMessages\(resolved\.prompt, promptArgsOf\(params\)\)/);
    expect(pre.slice(0, bearerAt)).not.toMatch(/api_key_check|mcp_anon_check|answerUnkeyed|unauthorized\(/);
    // No prompt endpoint exists to hand a meter: the family is not on the
    // server at all, the prompt Read carries no endpoint, and the metered
    // Read type excludes it, so the gate cannot receive one.
    expect(MCP).not.toMatch(/\/mcp\/prompt/);
    expect(MCP).toMatch(/\| \{ kind: "prompt"; prompt: Prompt \}/);
    expect(MCP).toMatch(/type MeteredRead = Exclude<Read, \{ kind: "prompt" \} \| \{ kind: "error" \}>;/);
    expect(MCP).toMatch(/const read: MeteredRead \| null = resolved;/);
    expect(between(MCP, "async function answerRead(", "\n}\n")).not.toMatch(/prompt/);
  });

  it("an unkeyed guide read is free; the statistics and a job link spend the unkeyed allowance; the key's status is challenged like the tool it wraps", () => {
    const pre = between(MCP, "const read: MeteredRead | null = resolved;", 'if (method !== "tools/call") {');
    expect(pre).toMatch(/if \(read && !bearer\) \{/);
    expect(pre).toMatch(/contentsOf\(GUIDE_URI, read\.resource\.mimeType, guideText\(edition\)\)/);
    expect(pre).toMatch(/answerUnkeyed\(client, req, id, tool\("board_stats"\), \{\}, params\)/);
    expect(pre).not.toMatch(/api_key_check|unauthorized\(/);
    // The keyed resource has no branch here: it falls through to the gate,
    // whose unkeyed set does not include its metered name.
    expect(pre).not.toMatch(/MY_KEY_URI/);
    const keyed = SERVER_RESOURCES.filter((r) => r.keyed).map((r) => r.uri);
    expect(keyed.length).toBeGreaterThan(0);
  });

  it("an unkeyed read whose runner fails answers a JSON-RPC error in the read's shape, not a bare 500: every unkeyed runner call sits inside a try whose catch answers readFailed", () => {
    const pre = between(MCP, "if (read && !bearer) {", 'if (method !== "tools/call") {');
    const tryAt = pre.indexOf("try {");
    const catchAt = pre.indexOf("} catch (e) {");
    expect(tryAt).toBeGreaterThan(-1);
    expect(catchAt).toBeGreaterThan(tryAt);
    for (const m of pre.matchAll(/answerUnkeyed\(|guideText\(edition\)/g)) {
      expect(m.index!, `${m[0]} must run inside the try`).toBeGreaterThan(tryAt);
      expect(m.index!).toBeLessThan(catchAt);
    }
    expect(pre.slice(catchAt)).toMatch(/return readFailed\(id, read, e, \{\}\);/);
    // readFailed: an argument error is named; anything else is the generic
    // line with the detail kept server-side; always a JSON-RPC error.
    const helper = between(MCP, "function readFailed(", "\n}\n");
    expect(helper).toMatch(/if \(e instanceof ToolArgumentError\) return readRefused\(rpcId, e\.message, e\.fix, headers\);/);
    expect(helper).toMatch(/console\.error\(/);
    expect(helper).toMatch(/return json\(rpcError\(rpcId, -32603, `The \$\{what\} resource hit an internal error\. Try again shortly\.`\), 200, headers\);/);
    expect(helper).not.toMatch(/toolErr\(|isError/);
  });

  it("a credentialed read is metered through the one key check under its family, answered in its own shape after the check, and a failed runner answers in that shape too", () => {
    expect(MCP.match(/\.rpc\("api_key_check"/g)?.length).toBe(1);
    expect(MCP).toMatch(/const toolName = read \? meteredNameOf\(read\.endpoint\) : String\(/);
    expect(MCP).toMatch(/const meteredNameOf = \(endpoint: string\) => endpoint\.slice\(MCP_ENDPOINT_PREFIX\.length\)/);
    expect(MCP).toMatch(/const MCP_ENDPOINT_PREFIX = "\/mcp\/";/);
    expect(MCP).toMatch(/const RESOURCE_ENDPOINT = \(name: string\) => `\/mcp\/resource\/\$\{name\}`;/);
    // Answered AFTER the check allowed it, inside the metered try, before the tool dispatch.
    const check = MCP.indexOf('.rpc("api_key_check"');
    const answered = MCP.indexOf("if (read) return json(rpcResult(id, await answerRead(client, read, d, ctx)), 200, rateHeaders);");
    const dispatched = MCP.indexOf('const result = toolName === "key_status"');
    expect(answered).toBeGreaterThan(check);
    expect(dispatched).toBeGreaterThan(answered);
    // A refused key on a read answers a JSON-RPC error, never a tool-shaped refusal.
    expect(MCP).toMatch(/if \(read\) return readRefused\(id, message, fix, \{ \.\.\.rateHeaders, \.\.\.retry \}\);/);
    // And a runner that throws under a read — an argument error or an
    // internal one — is answered by readFailed BEFORE any tool-shaped
    // branch of the catch can see it.
    const catchBody = between(MCP, "  } catch (e) {\n    if (e instanceof ScorerLimited)", "\n});");
    const readAt = catchBody.indexOf("if (read) return readFailed(id, read, e, rateHeaders);");
    expect(readAt).toBeGreaterThan(-1);
    expect(readAt).toBeLessThan(catchBody.indexOf("if (e instanceof ToolArgumentError)"));
    expect(readAt).toBeLessThan(catchBody.indexOf("toolErr(`The ${toolName} tool hit an internal error"));
  });

  it("the winning api_key_check exempts exactly the server's read families from starting a pass, beside key_status", () => {
    const families = serverFamiliesOf(MCP);
    expect(families).toEqual(["resource"]);
    const sql = winningDefinition("api_key_check");
    expect(exemptFamiliesOf(sql)).toEqual(families);
    expect(sql).toMatch(/p_endpoint <> '\/mcp\/key_status'/);
  });
});

// ── the in-band hedge ───────────────────────────────────────────────────────

describe("the in-band sign-in hedge is the HTTP challenge's own string, in the tools/call gate only, for the OpenAI-marked caller only", () => {
  it("the header and the in-band string are one builder", () => {
    expect(unauthorized({}).headers.get("WWW-Authenticate")).toBe(bearerChallenge());
    expect(MCP_RAW).toMatch(/import \{[^}]*\bbearerChallenge\b[^}]*\} from "\.\/oauth\.ts"/);
    expect(MCP).toMatch(/_meta: \{ "mcp\/www_authenticate": \[bearerChallenge\(\)\] \}/);
    expect(MCP.match(/mcp\/www_authenticate/g)?.length).toBe(1);
  });

  it("every hedge site is guarded by the OpenAI marker, the keyed set and not-a-read, inside the guard's braces", () => {
    const sites = hedgeSitesOf(MCP);
    expect(sites.length).toBe(2);
    for (const s of sites) {
      expect(s.guard).toMatch(/hedgeInBand\(params\)/);
      expect(s.guard).toMatch(/!ANON_TOOLS\.includes\(toolName\)/);
      expect(s.guard).toMatch(/!read/);
      expect(s.inside).toBe(true);
    }
    // The marker is the prefix, read off the caller's _meta keys, and nothing else.
    expect(MCP).toMatch(/const OPENAI_META_PREFIX = "openai\/";/);
    expect(between(MCP, "const hedgeInBand = ", "\n};")).toMatch(/Object\.keys\(meta as object\)\.some\(\(k\) => k\.startsWith\(OPENAI_META_PREFIX\)\)/);
    // The HTTP challenge stays for everyone else: still reached by name.
    expect(MCP.match(/return unauthorized\(cors\);/g)?.length).toBeGreaterThanOrEqual(2);
    expect(between(MCP, "function inBandChallenge(", "\n}\n")).toMatch(/console\.log\(`\[AGENT-MCP\] oauth challenge via _meta on \$\{toolName\}`\)/);
    expect(between(MCP, "function inBandChallenge(", "\n}\n")).toMatch(/\.\.\.toolErr\(/);
  });

  it("the unkeyed path logs the OpenAI subject hashed, and keys a bucket on it only from OpenAI's own addresses", () => {
    const unkeyed = between(MCP, "async function answerUnkeyed(", "\n}\n");
    // A subject is the caller's own word: it is read at all only when the
    // platform-seen address is in OpenAI's published egress (egressHost), and
    // keys a bucket only hashed. Its log line carries no address beside it.
    expect(unkeyed).toMatch(/const host = await egressHost\(address, isChatGptCaller\(req\.headers, params\)\);/);
    expect(unkeyed).toMatch(/const subject = host === "chatgpt" \? openaiSubjectOf\(params\) : "";/);
    expect(unkeyed).toMatch(/const subjectHash = subject \? \(await sha256Hex\(subject\)\)\.slice\(0, 16\) : "";/);
    expect(unkeyed).toMatch(/keyless subject \$\{subjectHash\} \(\$\{toolName\}\)/);
    expect(unkeyed).not.toMatch(/on address|ipHash/);
    expect(unkeyed).toMatch(/const lookups = lookupBucket\(host, subjectHash, /);
    expect(unkeyed).toMatch(/\.rpc\("mcp_anon_check_v2", \{\s*p_bucket: m\.bucket,/);
    expect(unkeyed).not.toMatch(/p_bucket: subject|bucket: subject\b/);
    const reader = between(MCP, "const openaiSubjectOf = ", "\n};");
    expect(reader).toMatch(/`\$\{OPENAI_META_PREFIX\}subject`/);
    expect(reader).toMatch(/typeof v === "string" \? v\.trim\(\) : ""/);
    // The tool-call site hands params through, so the log line has a source.
    expect(MCP).toMatch(/await answerUnkeyed\(client, req, id, toolName, toolArgs, params\)/);
  });

  it("tools/list mirrors each tool's securitySchemes into its _meta", () => {
    // Only while sign-in is on: until then no listed tool carries a scheme.
    const list = between(MCP, "function listedTools(", "\n}\n");
    expect(list).toMatch(/if \(!signInOn\) return listed;/);
    expect(list).toMatch(/return \{ \.\.\.listed, securitySchemes, _meta: \{ securitySchemes \} \};/);
    expect(between(MCP, 'if (method === "tools/list")', 'if (method === "prompts/list")')).toMatch(/listedTools\(!!bearer, edition, state === "on"\)/);
  });

  it("serverInfo names the bump, a title, the human page and an icon that exists", () => {
    const info = between(MCP, "const SERVER_INFO = {", "\n};");
    // A FLOOR, NOT AN EQUALITY. The property is that the release carrying the
    // attach-menu work shipped, and the server is at or past it; pinning the
    // exact string made every later bump fail here -- and the repo's own rule
    // is to bump the version on ANY change to this function, so an equality
    // turns that rule into a failing test and invites someone to skip it.
    const v = /version: "2026-09-04\.(\d+)"/.exec(info);
    expect(v, "the server version left the 2026-09-04 release line").toBeTruthy();
    expect(Number(v![1]), "the server version went back past the release this file guards").toBeGreaterThanOrEqual(9);
    expect(info).toMatch(/title: "[^"]+"/);
    expect(info).toMatch(/websiteUrl: "https:\/\/resumebooster\.work\/agents"/);
    const icon = /src: "https:\/\/resumebooster\.work\/([^"]+)"/.exec(info)?.[1];
    expect(icon).toBeTruthy();
    expect(existsSync(resolve(ROOT, "public", icon!)), `public/${icon} must exist`).toBe(true);
  });
});

// ── teeth ───────────────────────────────────────────────────────────────────

describe("teeth: each property fails on a copy that breaks it", () => {
  it("a prompt renamed on the server is reported against the mirror", () => {
    const broken = MCP.replace('name: "what_can_my_key_do",', 'name: "what_can_this_key_do",');
    expect(broken).not.toBe(MCP);
    expect(promptsOf(broken).map((p) => p.name)).not.toEqual(MCP_PROMPTS.map((p) => p.name));
  });

  it("a resource whose gate flips on the server is reported against the mirror", () => {
    const broken = MCP.replace('name: "guide", title: "How this board answers an agent", mimeType: "text/markdown", keyed: false,', 'name: "guide", title: "How this board answers an agent", mimeType: "text/markdown", keyed: true,');
    expect(broken).not.toBe(MCP);
    expect(resourcesOf(broken)).not.toEqual(MCP_RESOURCES.map(({ uri, name, title, mimeType, keyed }) => ({ uri, name, title, mimeType, keyed })));
  });

  it("a name handed to tool() that the registry lacks is reported by name", () => {
    const broken = MCP.replace('tool("check_jobs_open")', 'tool("check_jobs_are_open")');
    expect(broken).not.toBe(MCP);
    expect(toolCallsOf(broken).filter((n) => !toolNamesOf(broken).includes(n))).toEqual(["check_jobs_are_open"]);
  });

  it("a tool name typed into a prompt body as a bare word is reported, and a field path is not", () => {
    const p = SERVER_PROMPTS.find((x) => x.name === "what_can_my_key_do")!;
    const typed = p.src.replace('${tool("key_status")} once', "key_status once");
    expect(typed).not.toBe(p.src);
    expect(typedToolNames(typed, TOOL_NAMES)).toEqual(["key_status"]);
    expect(typedToolNames("read features.fit_resume and apply.blockers", TOOL_NAMES)).toEqual([]);
  });

  it("a listing that meters or challenges is reported", () => {
    const lists = listingsOf(MCP);
    const metered = MCP.replace(lists, lists.replace("prompts: PROMPTS.filter(", 'await client.rpc("api_key_check", { p_key_hash: "", p_endpoint: "/mcp/prompts/list" }); prompts: PROMPTS.filter('));
    expect(metered).not.toBe(MCP);
    expect(listingsOf(metered)).toMatch(/api_key_check/);
  });

  it("a migration that drops the exempted family is reported against the server's families", () => {
    const sql = winningDefinition("api_key_check");
    const dropped = sql.replace(/\s*AND p_endpoint NOT LIKE '\/mcp\/resource\/%'/, "");
    expect(dropped).not.toBe(sql);
    expect(exemptFamiliesOf(dropped)).toEqual([]);
    expect(exemptFamiliesOf(dropped)).not.toEqual(serverFamiliesOf(MCP));
  });

  it("a server that starts metering a second family — a prompt family included — is reported against the migration", () => {
    const grown = MCP + "\nconst SESSION_ENDPOINT = (name: string) => `/mcp/session/${name}`;\n";
    expect(serverFamiliesOf(grown)).toEqual(["resource", "session"]);
    expect(exemptFamiliesOf(winningDefinition("api_key_check"))).not.toEqual(serverFamiliesOf(grown));
    const metered = MCP + "\nconst PROMPT_ENDPOINT = (name: string) => `/mcp/prompt/${name}`;\n";
    expect(serverFamiliesOf(metered)).toEqual(["prompt", "resource"]);
    expect(metered).toMatch(/\/mcp\/prompt/);
  });

  it("a bare tool name in the instructions is reported, and an unkeyed runner moved out of the try is reported", () => {
    const bare = MCP.replace('Start with ${tool("search_jobs")}:', "Start with search_jobs:");
    expect(bare).not.toBe(MCP);
    expect(typedToolNames(instructionsSourceOf(bare), TOOL_NAMES)).toEqual(["search_jobs"]);
    const pre = between(MCP, "if (read && !bearer) {", 'if (method !== "tools/call") {');
    const moved = pre.replace("    try {\n", "").replace(/\n    \} catch \(e\) \{\n      return readFailed\(id, read, e, \{\}\);\n    \}/, "");
    expect(moved).not.toBe(pre);
    expect(moved.indexOf("try {")).toBe(-1);
  });

  it("a mirror body that names a tool the server lacks is reported by name, and a typed cap on the server is reported", () => {
    const looksLikeTool = /\b[a-z]+_[a-z_]+\b/g;
    const body = "The same payload as board_statistics: totals.";
    expect([...body.matchAll(looksLikeTool)].map((m) => m[0]).filter((n) => !TOOL_NAMES.includes(n))).toEqual(["board_statistics"]);
    const typed = MCP.replace("Math.min(KEYED_SEARCH_LIMIT, Number(args.limit", "Math.min(60, Number(args.limit");
    expect(typed).not.toBe(MCP);
    expect(/Math\.min\(KEYED_SEARCH_LIMIT, Number\(args\.limit/.test(typed)).toBe(false);
  });

  it("a hedge whose guard loses the OpenAI marker, or the keyed set, or the not-a-read clause, is reported", () => {
    for (const [from, to] of [
      ["!bearer && !read && !ANON_TOOLS.includes(toolName) && hedgeInBand(params)", "!bearer && !read && !ANON_TOOLS.includes(toolName)"],
      ["!bearer && !read && !ANON_TOOLS.includes(toolName) && hedgeInBand(params)", "!bearer && !read && hedgeInBand(params)"],
      ["!bearer && !read && !ANON_TOOLS.includes(toolName) && hedgeInBand(params)", "!bearer && !ANON_TOOLS.includes(toolName) && hedgeInBand(params)"],
    ]) {
      const loosened = MCP.replace(from, to);
      expect(loosened).not.toBe(MCP);
      const sites = hedgeSitesOf(loosened);
      expect(sites.some((s) => !/hedgeInBand\(params\)/.test(s.guard) || !/!ANON_TOOLS\.includes\(toolName\)/.test(s.guard) || !/!read/.test(s.guard))).toBe(true);
    }
  });

  it("instructions that send the first call to board_stats again are reported", () => {
    const back = MCP.replace('Start with ${tool("search_jobs")}:', 'Call ${tool("board_stats")} first, then ${tool("search_jobs")}:');
    expect(back).not.toBe(MCP);
    expect(instructionsSourceOf(back)).toMatch(/board_stats/);
  });
});
