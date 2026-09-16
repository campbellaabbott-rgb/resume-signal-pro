import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  MCP_ANON_TOOL_NAMES, MCP_ANON_CAPS, MCP_FREE_KEY_DAILY_QUOTA, MCP_TOOL_NAMES,
  MCP_PAID_TOOLS, MCP_APPLY_TOOLS,
} from "../config/mcp-tools";
import {
  MCP_URL, OAUTH_SCOPE, PRM_PATH, RESOURCE_METADATA_URL, isProtectedResourceMetadataPath, unauthorized,
} from "../../supabase/functions/agent-mcp/oauth";

/**
 * A FIRST CALL WITH NO KEY GETS AN ANSWER, NOT A WALL.
 *
 * Measured 2026-09-15: a keyless tools/call answered 200 + isError, which
 * Claude passes to the model as a tool failure and moves on — no prompt, no
 * card. claude.ai, Claude Desktop and ChatGPT offer a no-auth connect path
 * and none of their dialogs has a field for a bearer key, so for every user
 * of those hosts the first thing this server did was refuse. Now a small set
 * of read tools answers with no key at all, under two caps counted in a table
 * of their own — never in the cross-function rate budget that once 429'd
 * résumé upload and checkout when board traffic fed it.
 *
 * And since the authorization server exists, a keyless call to a KEYED tool
 * is the one place that answers a sign-in challenge instead of a refusal:
 * the response a host turns into its Connect card. That challenge is built
 * in ONE module (oauth.ts) and reached from ONE region of the dispatcher —
 * the tools/call branch for a tool outside the unkeyed set — and from
 * nowhere else: not initialize, not tools/list, not the unkeyed tools, and
 * never a rate, quota or revoked refusal on a key, because a host that sees
 * a 401 re-authenticates, and re-authenticating does not refill a quota.
 *
 * Everything below is a PROPERTY read off comment-stripped code, mirrored
 * between three runtimes — the Deno server, the frontend's mirror constant
 * (which the page, the prerender and llms-full render from), and the
 * migration that minted the free-key quota — and every property has a teeth
 * case that hands the routine a broken copy and requires it to fail.
 */
const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const stripTs = (s: string) => s.replace(/^\s*\/\/[^\n]*/gm, " ").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\{\/\*[\s\S]*?\*\/\}/g, " ");
const stripSql = (s: string) => s.replace(/--[^\n]*/g, " ");

const MCP_RAW = read("supabase/functions/agent-mcp/index.ts");
const MCP = stripTs(MCP_RAW);
const PAGE = stripTs(read("src/pages/AgentConnect.tsx"));
const PRERENDER = stripTs(read("scripts/prerender-seo.mjs"));
const LLMS = read("public/llms.txt");
const EN = JSON.parse(read("src/i18n/locales/en.json")) as Record<string, Record<string, string>>;
/**
 * The site's own words for the ledger half of "Actively hiring", read off the
 * locale file: the clause after "employers we have watched" in the saved-search
 * basis. If the site rewords its basis, this changes and the instructions must
 * follow — a hard-coded regex here would keep passing against the old sentence.
 */
const MOAT_FRAGMENT = /employers we have watched ([^,]+), or/.exec(EN.jobsPage.savedWithoutHiringFilter3)?.[1] ?? "";
const MIG_DIR = resolve(ROOT, "supabase/migrations");
const MIGRATIONS = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();

// ── parsers, each a pure function of one source text ───────────────────────

const anonToolsOf = (code: string): string[] => {
  const m = /const ANON_TOOLS: readonly string\[\] = \[([^\]]*)\]/.exec(code);
  if (!m) throw new Error("ANON_TOOLS is missing");
  return [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
};
const listConstOf = (code: string, name: string): string[] => {
  const m = new RegExp(`const ${name}: readonly string\\[\\] = \\[([^\\]]*)\\]`).exec(code);
  if (!m) throw new Error(`${name} is missing`);
  return [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
};
const numberConstOf = (code: string, name: string): number => {
  const m = new RegExp(`const ${name} = (\\d+);`).exec(code);
  if (!m) throw new Error(`${name} is not a plain numeric constant`);
  return Number(m[1]);
};
/** A top-level function's text, to its own closing brace at column zero. */
function functionText(code: string, fn: string): string {
  const m = new RegExp(`\\n(?:async )?function ${fn}\\(`).exec(code);
  if (!m) throw new Error(`function ${fn} is not declared`);
  const end = code.indexOf("\n}\n", m.index);
  return code.slice(m.index, end < 0 ? code.length : end + 2);
}
/**
 * Every site that answers the sign-in challenge, each with the condition
 * that guards it: the text from the nearest preceding `if (` to the call,
 * and whether the call actually sits INSIDE that if's braces (brace depth
 * between the guard and the call greater than zero). A challenge placed
 * after the guarded block closes — walling every keyed call, the unkeyed
 * tier included — carries the guard's text in `guard` and `inside: false`.
 * Index positions are into `code`, so a caller can place a site relative to
 * the dispatcher's other landmarks.
 */
function challengeSitesOf(code: string): { at: number; guard: string; inside: boolean }[] {
  const sites: { at: number; guard: string; inside: boolean }[] = [];
  for (const m of code.matchAll(/unauthorized\(/g)) {
    const at = m.index!;
    const guardStart = code.lastIndexOf("if (", at);
    const between = guardStart < 0 ? "" : code.slice(guardStart, at);
    const depth = (between.match(/\{/g) ?? []).length - (between.match(/\}/g) ?? []).length;
    sites.push({ at, guard: between, inside: guardStart >= 0 && depth > 0 });
  }
  return sites;
}
/** The dispatcher's tools/call region: from the method gate to the key check. */
function toolsCallRegionOf(code: string): { from: number; to: number } {
  const from = code.indexOf('if (method !== "tools/call") {');
  const to = code.indexOf('.rpc("api_key_check"', from);
  if (from < 0 || to < 0) throw new Error("the tools/call region is gone");
  return { from, to };
}
/** The keyed deny block: from the friendly-reasons table to the return that answers it. */
function denyBlockOf(code: string): string {
  const a = code.indexOf("const friendly: Record<string, [string, string]> = {");
  if (a < 0) throw new Error("the keyed deny block is gone");
  const b = code.indexOf("return json(", a);
  return code.slice(a, code.indexOf("\n", b));
}
/** The GET branch: from its condition to the 405 it ends in. */
function getBranchOf(code: string): string {
  const a = code.indexOf('if (req.method === "GET") {');
  if (a < 0) throw new Error("the GET branch is gone");
  return code.slice(a, code.indexOf("405);", a));
}
/** The initialize handler's instructions expression. */
function instructionsOf(code: string): string {
  const a = code.indexOf('method === "initialize"');
  const b = code.indexOf("instructions:", a);
  if (a < 0 || b < 0) throw new Error("initialize.instructions is gone");
  return code.slice(b, code.indexOf("}));", b));
}
/** The newest migration defining a function. */
function newestDefining(fn: string): string {
  const f = MIGRATIONS.filter((n) => new RegExp(`FUNCTION public\\.${fn}\\s*\\(`).test(read(`supabase/migrations/${n}`))).pop();
  if (!f) throw new Error(`no migration defines ${fn}`);
  return stripSql(read(`supabase/migrations/${f}`));
}

const UNKEYED = functionText(MCP, "answerUnkeyed");

describe("the unkeyed set is one constant, mirrored, and registered", () => {
  it("ANON_TOOLS is exactly the set the plan names", () => {
    expect(anonToolsOf(MCP)).toEqual(["board_stats", "search_jobs", "search", "fetch"]);
  });

  it("the frontend mirror names the same set, and every name is a registered tool", () => {
    expect([...MCP_ANON_TOOL_NAMES]).toEqual(anonToolsOf(MCP));
    for (const n of anonToolsOf(MCP)) expect(MCP_TOOL_NAMES, `${n} must be a registered tool`).toContain(n);
  });

  it("the paid and account sets the instructions derive from are the mirror's tiers", () => {
    expect(listConstOf(MCP, "PAID_TOOLS")).toEqual(MCP_PAID_TOOLS.map((t) => t.name));
    expect(listConstOf(MCP, "ACCOUNT_TOOLS")).toEqual(MCP_APPLY_TOOLS.map((t) => t.name));
    expect(MCP).toMatch(/const KEY_ONLY_READ_TOOLS: readonly string\[\] = TOOLS\.map\(\(t\) => t\.name\)/);
  });
});

describe("the caps are named constants, mirrored, and the only numbers the keyless branch uses", () => {
  it("both caps and the search limit are declared once and mirrored on the page side", () => {
    expect(numberConstOf(MCP, "ANON_IP_CAP_PER_DAY")).toBe(MCP_ANON_CAPS.perAddressPerDay);
    expect(numberConstOf(MCP, "ANON_GLOBAL_CAP_PER_DAY")).toBe(MCP_ANON_CAPS.globalPerDay);
    expect(numberConstOf(MCP, "ANON_SEARCH_LIMIT")).toBe(MCP_ANON_CAPS.searchRows);
    // Both must exist: a per-address bucket alone is a global bucket for the
    // hosts that share egress, and a global bucket alone is one caller's.
    expect(MCP_ANON_CAPS.globalPerDay).toBeGreaterThan(MCP_ANON_CAPS.perAddressPerDay);
  });

  it("the keyless branch hands the named constants to mcp_anon_check and clamps with the named limit", () => {
    expect(UNKEYED).toMatch(/\.rpc\("mcp_anon_check", \{ p_ip_hash: ipHash, p_global_cap: ANON_GLOBAL_CAP_PER_DAY, p_ip_cap: ANON_IP_CAP_PER_DAY \}\)/);
    expect(UNKEYED).toMatch(/Math\.min\(ANON_SEARCH_LIMIT,/);
    // No cap typed as a digit into the meter call, the clamp or the note:
    // the constant is the only spelling, or the page's mirror describes a
    // different server.
    expect(UNKEYED).not.toMatch(/p_global_cap: \d|p_ip_cap: \d|Math\.min\(\d/);
    const note = /const note = `([^`]*)`/.exec(UNKEYED)?.[1] ?? "";
    expect(note).not.toBe("");
    expect(note.replace(/\$\{[^}]*\}/g, "")).not.toMatch(/\d/);
  });

  it("the free-key figure the note promises is the minting function's own constant, mirrored", () => {
    const quota = numberConstOf(MCP, "FREE_KEY_DAILY_QUOTA");
    const minted = /c_quota integer := (\d+);/.exec(newestDefining("api_key_issue"));
    expect(minted, "api_key_issue no longer declares c_quota — RE-ANCHOR this guard").toBeTruthy();
    expect(quota).toBe(Number(minted![1]));
    expect(MCP_FREE_KEY_DAILY_QUOTA).toBe(quota);
    expect(UNKEYED).toMatch(/a free key raises this to \$\{keyRaisesTo\}/);
    expect(UNKEYED).toMatch(/const keyRaisesTo = FREE_KEY_DAILY_QUOTA\.toLocaleString\("en-US"\)/);
  });
});

describe("the keyless branch is counted in its own table and nowhere else", () => {
  it("never touches the cross-function rate budget", () => {
    expect(MCP).not.toMatch(/check_rate_limit|check_global_rate_limit|\brate_limits\b/);
  });

  it("counts the call BEFORE any runner runs, so a refused argument was counted too", () => {
    const counted = UNKEYED.indexOf('.rpc("mcp_anon_check"');
    const ran = UNKEYED.search(/await run[A-Za-z]+\(/);
    expect(counted).toBeGreaterThan(0);
    expect(ran).toBeGreaterThan(counted);
  });

  it("the address is hashed and truncated, never stored as itself", () => {
    expect(UNKEYED).toMatch(/\(await sha256Hex\(callerAddress\(req\.headers\)\)\)\.slice\(0, 16\)/);
  });

  it("the address is the platform's word, never the caller's: edge header first, then the LAST forwarded hop", () => {
    // The first entry of x-forwarded-for is whatever the caller wrote; a proxy
    // APPENDS. Keying the bucket on the first hop hands a script a fresh
    // allowance per forged value, so the bucket reads the edge-set client
    // address and, failing that, the hop the nearest proxy appended.
    const fn = functionText(MCP, "callerAddress");
    expect(fn.indexOf('"cf-connecting-ip"')).toBeGreaterThan(0);
    expect(fn.indexOf('"cf-connecting-ip"')).toBeLessThan(fn.indexOf('"x-forwarded-for"'));
    expect(fn).toMatch(/hops\.at\(-1\)/);
    expect(fn).not.toMatch(/\[0\]/);
    expect(MCP).not.toMatch(/function firstHop/);
  });

  it("a refusal is in band with the mint URL and a Retry-After, never a challenge", () => {
    expect(UNKEYED).toMatch(/if \(!a\.allowed\) \{[\s\S]*?toolErr\([\s\S]*?\$\{MINT_URL\}[\s\S]*?"Retry-After": String\(secondsToMidnightUtc\(\)\)/);
    expect(UNKEYED).not.toMatch(/unauthorized\(/);
    // The status, the header and the metadata path are spelled in the OAuth
    // module and nowhere in the dispatcher: one builder, reached by name.
    expect(MCP).not.toMatch(/WWW-Authenticate|\.well-known|\b401\b/);
  });

  it("an answer carries the note in the promised shape plus the figures as numbers", () => {
    // "N of 25" is about ONE address, so N is the address remainder — never
    // the smaller of the two buckets under the address cap's denominator.
    // When the world is the tighter bucket, that is its own clause.
    expect(UNKEYED).toMatch(/const ipLeft = Math\.max\(0, a\.ip_cap - a\.ip_used\);/);
    expect(UNKEYED).toMatch(/const globalLeft = Math\.max\(0, a\.global_cap - a\.global_used\);/);
    expect(UNKEYED).toMatch(/const worldClause = globalLeft < ipLeft \? `; \$\{globalLeft\} across every unkeyed caller` : "";/);
    expect(UNKEYED).toMatch(/const note = `unkeyed: \$\{ipLeft\} of \$\{a\.ip_cap\} anonymous calls left today\$\{worldClause\}; a free key raises this to \$\{keyRaisesTo\}`/);
    expect(UNKEYED).toMatch(/callsLeftToday: ipLeft,/);
    expect(UNKEYED).toMatch(/globalLeftToday: globalLeft,/);
    expect(UNKEYED).toMatch(/toolOk\(\{ \.\.\.out, unkeyed \}\)/);
    expect(UNKEYED).toMatch(/withKey: \{[\s\S]*?mintUrl: MINT_URL,[\s\S]*?dailyCalls: FREE_KEY_DAILY_QUOTA,/);
  });

  it("the migration behind mcp_anon_check locks it to the service role by name", () => {
    const mig = newestDefining("mcp_anon_check");
    expect(mig).toMatch(/REVOKE ALL ON FUNCTION public\.mcp_anon_check\(text, integer, integer\) FROM PUBLIC, anon, authenticated;/);
    expect(mig).toMatch(/GRANT EXECUTE ON FUNCTION public\.mcp_anon_check\(text, integer, integer\) TO service_role;/);
    expect(mig).toMatch(/ALTER TABLE public\.mcp_anon_rate ENABLE ROW LEVEL SECURITY;/);
    expect(mig).not.toMatch(/CREATE POLICY/);
    expect(mig).toMatch(/SECURITY DEFINER/);
  });
});

describe("a keyless call to a keyed tool answers the sign-in challenge — and nothing else does", () => {
  const sites = challengeSitesOf(MCP);
  const region = toolsCallRegionOf(MCP);

  it("the challenge is the module's builder, imported by name", () => {
    expect(MCP).toMatch(/from "\.\/oauth\.ts"/);
    expect(MCP_RAW).toMatch(/import \{[^}]*\bunauthorized\b[^}]*\} from "\.\/oauth\.ts"/);
    expect(sites.length).toBeGreaterThan(0);
  });

  it("every challenge site sits in the tools/call region, before any key check", () => {
    for (const s of sites) {
      expect(s.at).toBeGreaterThan(region.from);
      expect(s.at).toBeLessThan(region.to);
    }
  });

  it("every challenge is guarded by the unkeyed set: an unkeyed tool is never challenged", () => {
    expect(sites.length).toBeGreaterThan(0);
    for (const s of sites) {
      expect(s.guard).toMatch(/!ANON_TOOLS\.includes\(toolName\)/);
      // Guarded means inside the guard's braces, not merely after its text.
      expect(s.inside, `a challenge at ${s.at} sits outside the if that names the unkeyed set`).toBe(true);
    }
  });

  it("the challenge itself is a 401 Bearer challenge that points at the metadata document", async () => {
    const res = unauthorized({});
    expect(res.status).toBe(401);
    const www = res.headers.get("WWW-Authenticate") ?? "";
    const params = Object.fromEntries([...www.slice(7).matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
    expect(www.startsWith("Bearer ")).toBe(true);
    expect(params.error).toBe("invalid_token");
    expect(params.resource_metadata).toBe(RESOURCE_METADATA_URL);
    expect(params.resource_metadata).toBe(`${MCP_URL}${PRM_PATH}`);
    expect(params.scope).toBe(OAUTH_SCOPE);
    expect((await res.json() as { error: string }).error).toBe("invalid_token");
  });

  it("a rate, quota, revoked or unknown-key refusal on a key stays a 200 in band, never a challenge", () => {
    const deny = denyBlockOf(MCP);
    expect(deny).toMatch(/rate_limited:/);
    expect(deny).toMatch(/quota_exceeded:/);
    expect(deny).toMatch(/revoked:/);
    expect(deny).toMatch(/return json\(rpcResult\(id, toolErr\(message, fix\)\), 200,/);
    expect(deny).not.toMatch(/unauthorized\(/);
  });

  it("discovery — initialize, tools/list, ping — is never challenged", () => {
    expect(MCP.slice(0, region.from)).not.toMatch(/unauthorized\(/);
  });

  it("the tool runners never challenge: an unpaid or unfunded request is refused in band", () => {
    expect(functionText(MCP, "callTool")).not.toMatch(/unauthorized\(/);
    expect(functionText(MCP, "enqueueApplication")).not.toMatch(/unauthorized\(/);
    expect(UNKEYED).not.toMatch(/unauthorized\(/);
  });

  it("an OAuth token is verified by the module, mapped to the account's key before the key check, and never forwarded", () => {
    const verify = /verifyOAuthBearer\((\w+)\)/.exec(MCP);
    expect(verify, "the dispatcher must hand the bearer to verifyOAuthBearer").toBeTruthy();
    const bearerName = verify![1];
    expect(MCP).not.toMatch(new RegExp(`\\$\\{${bearerName}\\}`));
    expect(MCP).not.toMatch(new RegExp(`Bearer \\$\\{${bearerName}`));
    const mapped = MCP.indexOf("subToKeyHash(");
    expect(mapped).toBeGreaterThan(verify!.index);
    expect(mapped).toBeLessThan(region.to);
    // The metering identity is the key hash the mapping produced, checked by
    // the same RPC a pasted key is: no second meter.
    expect(MCP.match(/\.rpc\("api_key_check"/g)?.length).toBe(1);
  });

  it("a valid token whose account cannot be mapped is refused in band only on a keyed tool — an unkeyed tool still answers", () => {
    // Both refusals after the verifier — the refused verdict and the failed
    // mapping — sit inside a guard on the unkeyed set. Otherwise the tier the
    // page promises always answers is walled for a signed-in caller with no
    // email on the account.
    const mapped = MCP.indexOf("subToKeyHash(");
    const refusal = MCP.indexOf("could not be given an agent key", mapped);
    expect(refusal).toBeGreaterThan(mapped);
    const between = MCP.slice(mapped, refusal);
    const guard = between.lastIndexOf("if (!ANON_TOOLS.includes(toolName))");
    expect(guard, "the in-band refusal is not gated on the unkeyed set").toBeGreaterThan(-1);
    const depth = (between.slice(guard).match(/\{/g) ?? []).length - (between.slice(guard).match(/\}/g) ?? []).length;
    expect(depth).toBeGreaterThan(0);
    // And it is in band, never a challenge.
    expect(between.slice(guard)).not.toMatch(/unauthorized\(/);
  });

  it("the metadata document is served on the STRIPPED path from the GET branch, by the module's matcher", () => {
    const get = getBranchOf(MCP);
    expect(get).toMatch(/isProtectedResourceMetadataPath\((?:[^()]|\([^()]*\))*pathname\)/);
    expect(get).toMatch(/protectedResourceResponse\(cors\)/);
    // Both production prefixes and the bare path resolve; the raw pathname is never compared here.
    expect(isProtectedResourceMetadataPath(`/functions/v1/agent-mcp${PRM_PATH}`)).toBe(true);
    expect(isProtectedResourceMetadataPath(`/agent-mcp${PRM_PATH}`)).toBe(true);
    expect(isProtectedResourceMetadataPath("/agent-mcp")).toBe(false);
    expect(get).not.toMatch(/pathname\s*===/);
  });

  it("the dispatch routes an unkeyed call to the unkeyed branch inside the metered try, and keyed calls unchanged", () => {
    expect(MCP).toMatch(/if \(!d\) \{\s*const \{ rpc, headers \} = await answerUnkeyed\(client, req, id, toolName, toolArgs\);/);
    expect(MCP).toMatch(/callTool\(client, d\.api_key_id \?\? "", d\.key_tier, toolName, toolArgs\)/);
  });
});

describe("initialize.instructions names the four tiers from the registry, and the ledger in the site's words", () => {
  const text = instructionsOf(MCP);

  it("derives every tool list from a constant, never a typed name list", () => {
    for (const c of ["ANON_TOOLS.join", "KEY_ONLY_READ_TOOLS.join", "PAID_TOOLS.join", "ACCOUNT_TOOLS.join"]) {
      expect(text, `${c} must be interpolated`).toContain(c);
    }
    for (const c of ["ANON_SEARCH_LIMIT", "ANON_IP_CAP_PER_DAY", "ANON_GLOBAL_CAP_PER_DAY", "FREE_KEY_DAILY_QUOTA", "MINT_URL", "DOCS_URL"]) {
      expect(text, `${c} must be interpolated`).toMatch(new RegExp(`\\$\\{${c}`));
    }
    // A typed name is a second list. The only tool names allowed in the prose
    // are the ones a sentence explains (search and fetch as aliases; the two
    // verification tools; the two employer tools that carry the ledger).
    const typed = MCP_TOOL_NAMES.filter((n) => new RegExp(`(?<![A-Za-z_])${n}(?![A-Za-z_])`).test(text.replace(/\$\{[^}]*\}/g, "")));
    expect(typed.sort()).toEqual(["check_jobs_open", "employer_growth", "employer_hiring_record", "fetch", "get_job", "get_jobs", "key_status", "search", "search_jobs"].sort());
  });

  it("says the moat in the site's words — read off the locale file — and never calls a takedown a fill or a hire", () => {
    expect(MOAT_FRAGMENT, "the site's saved-search basis no longer has the clause this reads — RE-ANCHOR").not.toBe("");
    expect(MOAT_FRAGMENT.length).toBeGreaterThan(20);
    expect(MOAT_FRAGMENT).not.toMatch(/\{\{|\d/);
    expect(text).toContain(MOAT_FRAGMENT);
    expect(text).not.toMatch(/\bfills?\b|\bfilled\b|\bhired?\b|\bhires\b/i);
  });
});

describe("the page, the prerender and llms.txt derive the tier from the mirror", () => {
  it("the page renders the unkeyed tools and caps from the mirror and types neither", () => {
    expect(PAGE).toMatch(/MCP_ANON_TOOLS/);
    expect(PAGE).toMatch(/MCP_ANON_CAPS\.perAddressPerDay/);
    expect(PAGE).toMatch(/MCP_ANON_CAPS\.searchRows/);
    expect(PAGE).not.toMatch(/\b\d+ calls a day/);
  });

  it("the crawler copy and llms-full render from the same mirror", () => {
    // The /agents block, from its env read to the next page's write.
    const agents = PRERENDER.slice(PRERENDER.indexOf("const envText3 ="), PRERENDER.indexOf('path: "/freelance-boost"'));
    expect(agents.length).toBeGreaterThan(1000);
    expect(agents).toMatch(/D\.MCP_ANON_TOOLS/);
    expect(agents).toMatch(/D\.MCP_ANON_CAPS\.perAddressPerDay/);
    const llmsFull = PRERENDER.slice(PRERENDER.indexOf("lines.push(`- MCP server for AI agents"), PRERENDER.indexOf("\n", PRERENDER.indexOf("lines.push(`- MCP server for AI agents")));
    expect(llmsFull).toMatch(/D\.MCP_ANON_TOOLS/);
    expect(llmsFull).toMatch(/D\.MCP_ANON_CAPS\.perAddressPerDay/);
    expect(llmsFull).toMatch(/D\.MCP_ANON_CAPS\.globalPerDay/);
    // Neither surface types the cap: the /data-api prerender legitimately
    // states the KEYED quota elsewhere in this file, so the sweep is scoped
    // to the two blocks that describe the unkeyed tier.
    expect(agents).not.toMatch(/\b\d+ calls a day/);
    expect(llmsFull).not.toMatch(/\b\d+ calls a day/);
  });

  it("the hand-written llms.txt spells no tool count, no tool name and no cap — it points at llms-full", () => {
    const line = LLMS.split("\n").find((l) => l.includes("(/agents)")) ?? "";
    expect(line, "llms.txt lost its /agents line").not.toBe("");
    expect(line).not.toMatch(/\b\d+ tools\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen) tools\b/i);
    expect(line).not.toMatch(/\b\d+ calls/);
    for (const n of MCP_TOOL_NAMES.filter((x) => x.includes("_"))) expect(line, `${n} typed into llms.txt`).not.toContain(n);
    expect(line).toMatch(/llms-full\.txt/);
  });
});

describe("teeth: each property fails on a copy that breaks it", () => {
  it("a copy that widens ANON_TOOLS is caught", () => {
    const broken = MCP.replace('const ANON_TOOLS: readonly string[] = ["board_stats", "search_jobs", "search", "fetch"]', 'const ANON_TOOLS: readonly string[] = ["board_stats", "search_jobs", "search", "fetch", "get_job"]');
    expect(broken).not.toBe(MCP);
    expect(anonToolsOf(broken)).not.toEqual([...MCP_ANON_TOOL_NAMES]);
  });

  it("a copy that types a cap or the quota into the keyless branch is caught", () => {
    const broken = UNKEYED.replace("p_ip_cap: ANON_IP_CAP_PER_DAY", "p_ip_cap: 25");
    expect(broken).not.toBe(UNKEYED);
    expect(broken).toMatch(/p_global_cap: \d|p_ip_cap: \d|Math\.min\(\d/);
    const typedNote = UNKEYED.replace("a free key raises this to ${keyRaisesTo}", "a free key raises this to 1,000");
    const note = /const note = `([^`]*)`/.exec(typedNote)?.[1] ?? "";
    expect(note.replace(/\$\{[^}]*\}/g, "")).toMatch(/\d/);
  });

  it("the function slicer stops at the function's own closing brace, not at the end of the file", () => {
    expect(UNKEYED).not.toMatch(/Deno\.serve\(/);
    expect(UNKEYED.trimEnd().endsWith("}")).toBe(true);
  });

  it("a copy that meters through the rate budget is caught", () => {
    const broken = MCP.replace('.rpc("mcp_anon_check"', '.rpc("check_rate_limit"');
    expect(broken).not.toBe(MCP);
    expect(broken).toMatch(/check_rate_limit/);
  });

  it("a copy that runs the tool before counting it is caught", () => {
    const counted = UNKEYED.indexOf('.rpc("mcp_anon_check"');
    const ran = UNKEYED.search(/await run[A-Za-z]+\(/);
    const swapped = UNKEYED.slice(ran) + UNKEYED.slice(counted, ran);
    expect(swapped.search(/await run[A-Za-z]+\(/)).toBeLessThan(swapped.indexOf('.rpc("mcp_anon_check"'));
  });

  it("a copy that challenges a quota refusal is caught", () => {
    const deny = denyBlockOf(MCP);
    const broken = MCP.replace(deny, deny.replace("return json(rpcResult(id, toolErr(message, fix)), 200,", "if (reason === \"quota_exceeded\") return unauthorized(cors);\n      return json(rpcResult(id, toolErr(message, fix)), 200,"));
    expect(broken).not.toBe(MCP);
    expect(denyBlockOf(broken)).toMatch(/unauthorized\(/);
  });

  it("a copy that challenges an unkeyed tool is caught by the guard walk", () => {
    const site = challengeSitesOf(MCP)[0];
    const loosened = MCP.slice(0, site.at - site.guard.length) + site.guard.replace("!ANON_TOOLS.includes(toolName)", "true") + MCP.slice(site.at);
    expect(loosened).not.toBe(MCP);
    expect(challengeSitesOf(loosened).some((s) => !/!ANON_TOOLS\.includes\(toolName\)/.test(s.guard))).toBe(true);
  });

  it("a copy whose challenge sits below the guard's closing brace — walling the unkeyed tier — is caught by the depth check", () => {
    // The first challenge: `if (!bearer && !ANON_TOOLS.includes(toolName)) { return unauthorized(cors); }`
    // moved to `if (...) { log } return unauthorized(cors);` keeps the guard's
    // text before the call and answers 401 to every keyed tool.
    const site = challengeSitesOf(MCP)[0];
    const stmtStart = MCP.lastIndexOf("\n", site.at);
    const stmtEnd = MCP.indexOf("\n", site.at);
    const stmt = MCP.slice(stmtStart, stmtEnd);
    expect(stmt).toMatch(/return unauthorized\(cors\);/);
    const closing = MCP.indexOf("}", stmtEnd);
    const moved = MCP.slice(0, stmtStart) + "\n    console.log(\"keyed and keyless\");" + MCP.slice(stmtEnd, closing + 1) + "\n  return unauthorized(cors);" + MCP.slice(closing + 1);
    expect(moved).not.toBe(MCP);
    const walked = challengeSitesOf(moved);
    const outside = walked.filter((s) => !s.inside);
    expect(outside).toHaveLength(1);
    // Its guard text still names the unkeyed set — which is exactly why the text check alone let it through.
    expect(outside[0].guard).toMatch(/!ANON_TOOLS\.includes\(toolName\)/);
    expect(challengeSitesOf(MCP).every((s) => s.inside)).toBe(true);
  });

  it("a copy that spells the status, the header or the metadata path in the dispatcher is caught", () => {
    for (const planted of ["status: 401", '"WWW-Authenticate"', "/.well-known/oauth-protected-resource"]) {
      const broken = MCP.replace("const client = db();", `const client = db(); const planted = ${JSON.stringify(planted)};`);
      expect(broken).not.toBe(MCP);
      expect(broken).toMatch(/WWW-Authenticate|\.well-known|\b401\b/);
    }
  });

  it("a copy whose GET branch compares the raw pathname to a literal is caught", () => {
    const get = getBranchOf(MCP);
    const broken = MCP.replace(get, get.replace(/isProtectedResourceMetadataPath\((?:[^()]|\([^()]*\))*\)/, 'new URL(req.url).pathname === "/.well-known/oauth-protected-resource"'));
    expect(broken).not.toBe(MCP);
    expect(getBranchOf(broken)).not.toMatch(/isProtectedResourceMetadataPath\(/);
    expect(broken).toMatch(/\.well-known/);
  });

  it("a copy that forwards the verified bearer downstream is caught", () => {
    const name = /verifyOAuthBearer\((\w+)\)/.exec(MCP)![1];
    const broken = MCP.replace("const client = db();", "const client = db(); const h = { Authorization: `Bearer ${" + name + "}` };");
    expect(broken).not.toBe(MCP);
    expect(broken).toMatch(new RegExp(`Bearer \\$\\{${name}`));
  });

  it("a copy whose instructions call a takedown a hire is caught, and so is one that keeps an old sentence the site moved on from", () => {
    const text = instructionsOf(MCP);
    const broken = text.replace(MOAT_FRAGMENT, "hire and which do not");
    expect(broken).not.toBe(text);
    expect(broken).toMatch(/\bhired?\b/i);
    expect(broken).not.toContain(MOAT_FRAGMENT);
  });

  it("a copy whose note numerator is the smaller bucket under the address denominator is caught", () => {
    const mixed = UNKEYED.replace("unkeyed: ${ipLeft} of ${a.ip_cap}", "unkeyed: ${left} of ${a.ip_cap}");
    expect(mixed).not.toBe(UNKEYED);
    expect(mixed).not.toMatch(/const note = `unkeyed: \$\{ipLeft\} of \$\{a\.ip_cap\}/);
  });

  it("a copy keyed on the caller-written first forwarded hop is caught", () => {
    const fn = functionText(MCP, "callerAddress");
    const forged = fn.replace("hops.at(-1)", "hops[0]");
    expect(forged).not.toBe(fn);
    expect(forged).toMatch(/\[0\]/);
    expect(forged).not.toMatch(/hops\.at\(-1\)/);
  });
});
