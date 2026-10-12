import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  MCP_ANON_TOOL_NAMES, MCP_ANON_CAPS, MCP_FREE_KEY_DAILY_QUOTA, MCP_TOOL_NAMES,
  MCP_PAID_TOOLS, MCP_APPLY_TOOLS, MCP_FORM_VENDORS, MCP_FORM_VENDORS_ON_CHATGPT,
  MCP_FIT_FREE_PER_DAY, MCP_FIT_FULL_PER_DAY,
  MCP_PAGE_HOSTS, MCP_OFF_PAGE_HOSTS, MCP_MORE_HOSTS, MCP_INSTALL_REPO_URL,
} from "../config/mcp-tools";
import {
  MCP_URL, OAUTH_SCOPE, PRM_PATH, RESOURCE_METADATA_URL, isProtectedResourceMetadataPath, unauthorized,
} from "../../supabase/functions/agent-mcp/oauth";
import { ANON_ALLOWANCE } from "../../supabase/functions/agent-mcp/allowance";
import { FORM_READER_VENDORS, PUBLIC_API_FORM_VENDORS } from "../../supabase/functions/_shared/application-form";
import { FIT_FREE_PER_DAY, FIT_FULL_PER_DAY } from "../../supabase/functions/_shared/fit-allowance";

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
const TEST_CLIENT = stripTs(read("src/lib/mcp-test.ts"));
const PRERENDER = stripTs(read("scripts/prerender-seo.mjs"));
const LLMS = read("public/llms.txt");
// Relative or absolute: the file's links name the domain since 2026-10-09.
const LLMS_AGENTS_LINE = LLMS.split("\n").find((l) => /\((?:https:\/\/resumebooster\.work)?\/agents\)/.test(l)) ?? "";
/**
 * What the hand-written /agents bullet must and must not say about hosts,
 * as a pure function of the line. The line also carries a REACH sentence
 * ("Claude Code, Cursor, VS Code and any client with a header field carry
 * the key") that names every real host, so containment over the whole line
 * proves nothing; the property lives in the sentence that carries the repo
 * URL, whose ";"-separated clauses say (1) whose steps the page has and
 * (2) whose setup is in the README. Clause 1 names every tile and no
 * off-page host; the URL clause names every off-page host and no tile; no
 * long-tail host (Gemini CLI, Cline, …) is named anywhere — those live in
 * the README and a name here would be a third typed spelling; no key.
 */
const hostNames = [...MCP_PAGE_HOSTS, ...MCP_OFF_PAGE_HOSTS].map((h) => h.name);
/** Whole-name match: "Claude" does not match inside "Claude Code". */
const namesHost = (text: string, name: string): boolean => {
  let t = text;
  for (const o of hostNames) if (o !== name && o.includes(name)) t = t.split(o).join(" ");
  return new RegExp(`(?<![A-Za-z])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z])`).test(t);
};
const llmsAgentsLineOffences = (line: string): string[] => {
  const out: string[] = [];
  const sentence = line.split(/(?<=\.)\s+/).find((x) => x.includes(MCP_INSTALL_REPO_URL));
  if (!sentence) return ["no sentence carries the install repo URL"];
  const clauses = sentence.split(";").map((c) => c.trim());
  const steps = clauses[0];
  const readme = clauses.find((c) => c.includes(MCP_INSTALL_REPO_URL))!;
  if (steps === readme) return ["the steps clause and the README clause are one clause"];
  for (const h of MCP_PAGE_HOSTS) {
    if (!namesHost(steps, h.name)) out.push(`tile ${h.name} not named as the page's steps`);
    if (namesHost(readme, h.name)) out.push(`tile ${h.name} sent to the README`);
  }
  for (const h of MCP_OFF_PAGE_HOSTS) {
    if (!namesHost(readme, h.name)) out.push(`off-page host ${h.name} not sent to the README`);
    if (namesHost(steps, h.name)) out.push(`off-page host ${h.name} named as the page's steps`);
  }
  if (/rb_live_/.test(line)) out.push("a key in the line");
  for (const m of MCP_MORE_HOSTS) if (m.id !== "copy-the-prompt" && line.includes(m.name)) out.push(`long-tail host ${m.name} named`);
  return out;
};
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
/** The instructions the initialize handler serves: instructionsFor's body. */
function instructionsOf(code: string): string {
  const a = code.indexOf('method === "initialize"');
  const b = code.indexOf("instructions: instructionsFor(edition)", a);
  if (a < 0 || b < 0) throw new Error("initialize.instructions is gone");
  return functionText(code, "instructionsFor");
}
/** The newest migration defining a function. */
function newestDefining(fn: string): string {
  const f = MIGRATIONS.filter((n) => new RegExp(`FUNCTION public\\.${fn}\\s*\\(`).test(read(`supabase/migrations/${n}`))).pop();
  if (!f) throw new Error(`no migration defines ${fn}`);
  return stripSql(read(`supabase/migrations/${f}`));
}

const UNKEYED = functionText(MCP, "answerUnkeyed");
const ALLOWANCE = stripTs(read("supabase/functions/agent-mcp/allowance.ts"));
/** The keyless set, owner decision 2026-10-11: every read tool, and applying yourself. */
const WAVE4_KEYLESS = [
  "board_stats", "search_jobs", "search", "fetch", "get_job", "get_jobs", "check_jobs_open",
  "employer_hiring_record", "employer_growth", "apply_myself",
];

describe("the unkeyed set is one constant, mirrored, and registered", () => {
  it("ANON_TOOLS is exactly the set the owner's decision names (every read tool, and applying yourself)", () => {
    expect(anonToolsOf(MCP)).toEqual(WAVE4_KEYLESS);
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
  it("the allowance is one constant, the owner's figures, and mirrored on the page side", () => {
    const A = ANON_ALLOWANCE;
    // Owner decision 2026-10-11 (economics 1(b)).
    expect(A.overallPerDay).toBe(20_000);
    expect(A.shares).toEqual({ claude: 10_000, chatgpt: 6_000, other: 4_000 });
    expect(A.shares.claude + A.shares.chatgpt + A.shares.other).toBe(A.overallPerDay);
    expect([A.chatgptPerPerson, A.chatgptNoSubject, A.otherPerConnection]).toEqual([200, 2_000, 100]);
    expect(A.perMinute).toEqual({ overall: 60, claude: 30, chatgpt: 20, other: 15, forms: 20 });
    expect(A.forms.overall).toBe(5_000);
    expect(A.searchRows).toBe(10);
    // The server reads its page size off the constant, never a second number.
    expect(MCP).toMatch(/const ANON_SEARCH_LIMIT = ANON_ALLOWANCE\.searchRows;/);
    // The page renders the same figures from its mirror (src/config/mcp-tools.ts).
    expect(MCP_ANON_CAPS).toMatchObject({
      overallPerDay: A.overallPerDay, shares: A.shares, chatgptPerPerson: A.chatgptPerPerson,
      chatgptNoSubject: A.chatgptNoSubject, otherPerConnection: A.otherPerConnection,
      perMinute: A.perMinute, forms: { overall: A.forms.overall }, searchRows: A.searchRows,
    });
    // The rest of the page's figures, field by field (the integration of wave 4
    // moved the mirror onto the new shape; a figure only the page carried would
    // drift unseen).
    expect(MCP_ANON_CAPS.forms).toEqual(A.forms);
    expect(MCP_ANON_CAPS.maxOffset).toBe(A.maxOffset);
    expect(MCP_ANON_CAPS.checkJobsOpenIds).toBe(A.checkJobsOpenIds);
  });

  it("the page's form vendors, its ChatGPT subset and its fit figures are the server's", () => {
    expect(MCP_FORM_VENDORS.map((v) => v.key).sort()).toEqual([...FORM_READER_VENDORS].sort());
    expect([...MCP_FORM_VENDORS_ON_CHATGPT].sort()).toEqual([...PUBLIC_API_FORM_VENDORS].sort());
    expect([MCP_FIT_FREE_PER_DAY, MCP_FIT_FULL_PER_DAY]).toEqual([FIT_FREE_PER_DAY, FIT_FULL_PER_DAY]);
  });

  it("the old shape's names survive only for the off-limits bake, carrying the nearest true figure", () => {
    // scripts/prerender-seo.mjs (owned by the company-profiles branch) still
    // reads these three; until it moves, each must say something true of the
    // new allowance rather than the retired 25/500/2,000.
    expect(MCP_ANON_CAPS.perAddressPerDay).toBe(ANON_ALLOWANCE.otherPerConnection);
    expect(MCP_ANON_CAPS.hostPoolPerDay).toBe(ANON_ALLOWANCE.shares.claude);
    expect(MCP_ANON_CAPS.globalPerDay).toBe(ANON_ALLOWANCE.overallPerDay);
    const pages = ["src/pages/AgentConnect.tsx", "src/pages/Index.tsx", "src/lib/mcp-test.ts"].map((f) => read(f)).join("\n");
    expect(pages).not.toMatch(/MCP_ANON_CAPS\.(?:perAddressPerDay|hostPoolPerDay|globalPerDay)/);
  });

  it("the keyless branch hands the named figures to mcp_anon_check_v2 and clamps with the named limit", () => {
    // One bucket, built from the verified address by allowance.ts, counted
    // against its share's minute, the overall minute, the bucket, the share
    // and the overall day — for the forms pool, the pool's own day and minute
    // (FORMS_POOL) stand where the lookups' overall counters do.
    expect(UNKEYED).toMatch(/\.rpc\("mcp_anon_check_v2", \{\s*p_bucket: m\.bucket,\s*p_bucket_cap: m\.bucketCap,\s*p_global_bucket: m\.share,\s*p_global_cap: m\.shareCap,\s*(?:\/\/[^\n]*\n\s*)?p_overall_cap: forms \? A\.forms\.overall : A\.overallPerDay,\s*p_minute_cap: m\.minuteCap,\s*p_overall_minute_cap: forms \? A\.perMinute\.forms : A\.perMinute\.overall,\s*p_overall_bucket: forms \? FORMS_POOL : "global",/);
    expect(UNKEYED).not.toMatch(/p_\w+_cap: \d|Math\.min\(\d/);
    expect(UNKEYED).toMatch(/Math\.min\(ANON_SEARCH_LIMIT,/);
    // Every cap in allowance.ts's buckets is read off ANON_ALLOWANCE.
    expect(ALLOWANCE).not.toMatch(/(?:bucketCap|shareCap|minuteCap): \d/);
    const note = /const note = `([^`]*)`/.exec(UNKEYED)?.[1] ?? "";
    expect(note).not.toBe("");
    expect(note.replace(/\$\{[^}]*\}/g, "")).not.toMatch(/\d/);
  });

  it("the page's test client asks its one metered search for the server's clamp by the mirror's name, so the button shows what an unkeyed search returns", () => {
    // The meter counts the call before any runner runs and the server clamps
    // the limit, so asking for the maximum costs what asking for one did —
    // and the sentence the button prints then matches the panels' "search
    // shows N results" instead of contradicting it.
    const call = /"tools\/call",\s*\{\s*name: "search_jobs",\s*arguments:\s*\{([^}]*)\}/.exec(TEST_CLIENT)?.[1];
    expect(call, "mcp-test.ts no longer sends one search_jobs tools/call").toBeTruthy();
    expect(call).toMatch(/limit: MCP_ANON_CAPS\.searchRows/);
    expect(call).toMatch(/query: MCP_TEST_QUERY/);
    expect(call).not.toMatch(/\d/);
  });

  it("the free-key figure the note promises is the minting function's own constant, mirrored", () => {
    const quota = numberConstOf(MCP, "FREE_KEY_DAILY_QUOTA");
    const minted = /c_quota integer := (\d+);/.exec(newestDefining("api_key_issue"));
    expect(minted, "api_key_issue no longer declares c_quota — RE-ANCHOR this guard").toBeTruthy();
    expect(quota).toBe(Number(minted![1]));
    expect(MCP_FREE_KEY_DAILY_QUOTA).toBe(quota);
    expect(UNKEYED).toMatch(/a free key gives \$\{FREE_KEY_DAILY_QUOTA\.toLocaleString\("en-US"\)\}/);
  });
});

describe("the keyless branch is counted in its own table and nowhere else", () => {
  it("never touches the cross-function rate budget", () => {
    expect(MCP).not.toMatch(/check_rate_limit|check_global_rate_limit|\brate_limits\b/);
  });

  it("counts the call BEFORE any runner runs, and judges its arguments before counting it", () => {
    const counted = UNKEYED.indexOf('.rpc("mcp_anon_check_v2"');
    const lookupsFrom = UNKEYED.indexOf("const lookups = lookupBucket(");
    // board_stats, the one runner before the meter, is cached and never
    // counted; since S12-176 it is bounded per allowance bucket, so the bucket
    // is worked out before it.
    const statsFrom = UNKEYED.indexOf('if (toolName === "board_stats") {');
    const statsEnd = UNKEYED.indexOf("const release = await keylessTurn();");
    expect(lookupsFrom).toBeGreaterThan(-1);
    expect(statsFrom).toBeGreaterThan(lookupsFrom);
    expect(statsEnd).toBeGreaterThan(statsFrom);
    const stats = UNKEYED.slice(statsFrom, statsEnd);
    expect(stats).toMatch(/await runCachedBoardStats\(\)/);
    expect(stats).not.toMatch(/mcp_anon_check/);
    const ran = UNKEYED.slice(statsEnd).search(/await run[A-Za-z]+\(/) + statsEnd;
    expect(counted).toBeGreaterThan(statsEnd);
    expect(ran).toBeGreaterThan(counted);
    // Owner decision 2026-10-11 (spec D2 §2.1): an argument the caller got
    // wrong is answered before anything is counted.
    const judged = MCP.indexOf("checkArgs(toolName, toolArgs, !bearer);");
    expect(judged).toBeGreaterThan(-1);
    expect(judged).toBeLessThan(MCP.indexOf("await answerUnkeyed(client, req, id, toolName, toolArgs, params)"));
  });

  it("the address is hashed and truncated, never stored as itself", () => {
    // A connection (full IPv4, or IPv6 /64) is hashed before it becomes a bucket.
    expect(UNKEYED).toMatch(/const address = callerAddress\(req\.headers\);/);
    // Since S12-175 the hash is keyed and changes daily (allowance.ts
    // bucketHash): a plain SHA-256 of an IPv4 address is reversible by
    // hashing the whole address space.
    expect(UNKEYED).toMatch(/lookupBucket\(host, subjectHash, await bucketHash\(secret, utcDay\(\), connection\)\)/);
    expect(UNKEYED).toMatch(/const secret = bucketSecret\(\);/);
    expect(UNKEYED).not.toMatch(/sha256Hex\((?:connection|subject|address)\)/);
    // A ChatGPT user's bucket is keyed by a hash of the subject, never the subject.
    expect(UNKEYED).toMatch(/const subjectHash = subject \? await bucketHash\(secret, utcDay\(\), subject\) : "";/);
    expect(ALLOWANCE).toMatch(/bucket: `u:chatgpt:\$\{subjectHash\}`/);
    expect(UNKEYED).not.toMatch(/p_bucket: (address|subject|connection)\b/);
    // And the subject's log line carries no address beside it.
    expect(UNKEYED).toMatch(/console\.log\(`\[AGENT-MCP\] keyless subject \$\{subjectHash\} \(\$\{toolName\}\)`\)/);
    expect(UNKEYED).not.toMatch(/ipHash/);
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

  it("a refusal is in band, by edition, with a Retry-After, never a challenge", () => {
    expect(UNKEYED).toMatch(/if \(!d\.allowed\) \{[\s\S]*?spentRefusal\(d, m, edition, keylessTwin\(toolName, args\), MINT_URL, FREE_KEY_DAILY_QUOTA\)[\s\S]*?toolErr\(message, fix\)[\s\S]*?"Retry-After": String\(minute \? secondsLeftInMinute\(\) : secondsToMidnightUtc\(\)\)/);
    expect(UNKEYED).not.toMatch(/unauthorized\(/);
    // The status, the header and the metadata path are spelled in the OAuth
    // module and nowhere in the dispatcher: one builder, reached by name.
    expect(MCP).not.toMatch(/WWW-Authenticate|\.well-known|\b401\b/);
  });

  it("an answer carries the note in the promised shape plus the figures as numbers", () => {
    // "N of CAP" is about ONE bucket, so N is the bucket remainder — never the
    // smaller of the counters under the bucket cap's denominator. When the
    // share or the day is the tighter counter, that is its own clause.
    expect(UNKEYED).toMatch(/const bucketLeft = Math\.max\(0, d\.bucket_cap - d\.bucket_used\);/);
    expect(UNKEYED).toMatch(/const shareLeft = Math\.max\(0, d\.share_cap - d\.share_used\);/);
    expect(UNKEYED).toMatch(/const left = Math\.min\(bucketLeft, shareLeft, overallLeft\);/);
    expect(UNKEYED).toMatch(/const note = `keyless: \$\{bucketLeft\} of \$\{d\.bucket_cap\.toLocaleString\("en-US"\)\} \$\{what\} left today \$\{m\.owner\}\$\{world\}; resets at midnight UTC\$\{keyClause\}`/);
    expect(UNKEYED).toMatch(/callsLeftToday: bucketLeft,/);
    expect(UNKEYED).toMatch(/globalLeftToday: overallLeft,/);
    expect(UNKEYED).toMatch(/toolOk\(\{ \.\.\.out, unkeyed: \{ \.\.\.unkeyed, note \} \}\)/);
    // The free key is offered only outside the two chat platforms.
    expect(UNKEYED).toMatch(/const keyClause = edition === "other" \?/);
  });

  it("the migrations behind both meters lock them to the service role by name", () => {
    const mig = newestDefining("mcp_anon_check");
    expect(mig).toMatch(/REVOKE ALL ON FUNCTION public\.mcp_anon_check\(text, integer, integer\) FROM PUBLIC, anon, authenticated;/);
    expect(mig).toMatch(/GRANT EXECUTE ON FUNCTION public\.mcp_anon_check\(text, integer, integer\) TO service_role;/);
    expect(mig).toMatch(/ALTER TABLE public\.mcp_anon_rate ENABLE ROW LEVEL SECURITY;/);
    expect(mig).not.toMatch(/CREATE POLICY/);
    expect(mig).toMatch(/SECURITY DEFINER/);
    const v2 = newestDefining("mcp_anon_check_v2");
    expect(v2).toMatch(/REVOKE ALL ON FUNCTION public\.mcp_anon_check_v2\(text, integer, text, integer, integer, integer, integer, text\) FROM PUBLIC, anon, authenticated;/);
    expect(v2).toMatch(/GRANT EXECUTE ON FUNCTION public\.mcp_anon_check_v2\(text, integer, text, integer, integer, integer, integer, text\) TO service_role;/);
    expect(v2).toMatch(/REVOKE ALL ON FUNCTION public\.mcp_anon_refund\(text, text, boolean, integer, text\) FROM PUBLIC, anon, authenticated;/);
    expect(v2).toMatch(/SECURITY DEFINER/);
  });
});

describe("a keyless call to a keyed tool answers the sign-in challenge while the probe says on, and the in-band answer otherwise — and nothing else challenges", () => {
  const sites = challengeSitesOf(MCP);
  const region = toolsCallRegionOf(MCP);

  it("every challenge site asks the sign-in fact first, under the same unkeyed-set guard, and answers in band unless it is on", () => {
    // The probe module owns the fact; the site reads it by name and hands
    // the decision to the module's one function, in a block guarded by the
    // same unkeyed-set test the challenge is. The full shape of each region
    // — probe, log, in-band branch, hedge, challenge, in that order — is
    // walked by a-challenge-is-answered-only-while-the-sign-in-service-is-on.
    expect(MCP_RAW).toMatch(/import \{[^}]*\bprobeSignIn\b[^}]*\} from "\.\/as-probe\.ts"/);
    for (const s of sites) {
      const probeAt = MCP.lastIndexOf("await probeSignIn()", s.at);
      expect(probeAt, `a challenge at ${s.at} answers without asking the fact`).toBeGreaterThan(region.from);
      const stretch = MCP.slice(probeAt, s.at);
      expect(stretch.length).toBeLessThan(1200);
      expect(stretch).toMatch(/noCredentialAnswer\(state, hedgeInBand\(params\)\) === "in_band"/);
      expect(stretch).not.toMatch(/api_key_check|answerUnkeyed\(/);
      const probeGuard = MCP.slice(MCP.lastIndexOf("if (", probeAt), probeAt);
      expect(probeGuard).toMatch(/!ANON_TOOLS\.includes\(toolName\)\) \{\s*const \{ state \} = $/);
    }
  });

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
    expect(MCP).toMatch(/if \(!d\) \{\s*const \{ rpc, headers \} = await answerUnkeyed\(client, req, id, toolName, toolArgs, params\);/);
    expect(MCP).toMatch(/callTool\(client, d\.api_key_id \?\? "", d\.key_tier, toolName, toolArgs, ctx\)/);
  });
});

describe("initialize.instructions: no tier block, every name off the registry, and the ledger in the site's words", () => {
  const text = instructionsOf(MCP);

  it("derives every tool name and figure from the registry and a constant, never typed", () => {
    // Owner decisions 2026-10-11 (spec §5.4): no tier block, no price, no
    // plan; the six rules; the free key named only to the full edition.
    for (const c of ["FREE_KEY_DAILY_QUOTA", "MINT_URL", "HONESTY_RULES", "GUIDE_URI"]) {
      expect(text, `${c} must be interpolated`).toMatch(new RegExp(`\\$\\{${c}`));
    }
    expect(text).toMatch(/formVendorsFor\(edition\)/);
    expect(text).toMatch(/edition === "other" \?/);
    // A typed name is a second list: every tool name reaches the prose through tool().
    const prose = text.replace(/\$\{[^}]*\}/g, "");
    // (search and fetch are English words too; the names with an underscore are unambiguous.)
    const typed = [...new Set([...MCP_TOOL_NAMES, ...WAVE4_KEYLESS])].filter((n) => n.includes("_") && new RegExp(`(?<![A-Za-z_])${n}(?![A-Za-z_])`).test(prose));
    expect(typed).toEqual([]);
    expect(prose).not.toMatch(/board_stats first|Four tiers|Agent Pass|Agent plan/);
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
    expect(PAGE).toMatch(/MCP_ANON_CAPS\.shares\.claude/);
    expect(PAGE).toMatch(/MCP_ANON_CAPS\.otherPerConnection/);
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
    expect(LLMS_AGENTS_LINE, "llms.txt lost its /agents line").not.toBe("");
    expect(LLMS_AGENTS_LINE).not.toMatch(/\b\d+ tools\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen) tools\b/i);
    expect(LLMS_AGENTS_LINE).not.toMatch(/\b\d+ calls/);
    for (const n of MCP_TOOL_NAMES.filter((x) => x.includes("_"))) expect(LLMS_AGENTS_LINE, `${n} typed into llms.txt`).not.toContain(n);
    expect(LLMS_AGENTS_LINE).toMatch(/llms-full\.txt/);
  });
  it("the hand-written llms.txt names the page's tiles as the page's steps, the off-page hosts as the README's, the install repo — and no long-tail host", () => {
    // llms.txt is the ONE surface that cannot read the mirror, so its host
    // names are typed. This pins them to the same property the page's G8
    // pins its tiles and GitHub line to: a tile change that leaves this
    // line behind fails here instead of going stale in silence.
    expect(llmsAgentsLineOffences(LLMS_AGENTS_LINE)).toEqual([]);
  });
});

describe("teeth: each property fails on a copy that breaks it", () => {
  it("a llms.txt line that drops a tile from the steps clause, sends a tile to the README, drops an off-page host, names one as the page's, loses the repo URL, names a long-tail host or carries a key is caught", () => {
    const line = LLMS_AGENTS_LINE;
    expect(llmsAgentsLineOffences(line)).toEqual([]);
    const sentence = line.split(/(?<=\.)\s+/).find((x) => x.includes(MCP_INSTALL_REPO_URL))!;
    const [steps, readme] = sentence.split(";");
    const swap = (from: string, to: string) => line.replace(from, to);
    const tile = MCP_PAGE_HOSTS[MCP_PAGE_HOSTS.length - 1].name;
    const off = MCP_OFF_PAGE_HOSTS[0].name;
    // The reach sentence elsewhere in the line still names every host, so each mutation touches only the clause under test.
    expect(llmsAgentsLineOffences(swap(steps, steps.split(tile).join("Cowork")))).toContain(`tile ${tile} not named as the page's steps`);
    expect(llmsAgentsLineOffences(swap(readme, readme.replace(off, `${off}, ${tile}`)))).toContain(`tile ${tile} sent to the README`);
    expect(llmsAgentsLineOffences(swap(readme, readme.split(off).join("Emacs")))).toContain(`off-page host ${off} not sent to the README`);
    expect(llmsAgentsLineOffences(swap(steps, steps.replace(tile, `${tile}, ${off}`)))).toContain(`off-page host ${off} named as the page's steps`);
    expect(llmsAgentsLineOffences(line.replace(MCP_INSTALL_REPO_URL, "https://example.invalid/repo"))).toContain("no sentence carries the install repo URL");
    const tail = MCP_MORE_HOSTS.find((m) => m.id !== "copy-the-prompt")!;
    expect(llmsAgentsLineOffences(`${line} ${tail.name} works too.`)).toContain(`long-tail host ${tail.name} named`);
    expect(llmsAgentsLineOffences(`${line} rb_live_abc`)).toContain("a key in the line");
    // "Claude" alone is not "Claude Code": a steps clause naming only the first tile fails on the third.
    expect(namesHost("for Claude Code only", "Claude")).toBe(false);
    expect(namesHost("for Claude only", "Claude")).toBe(true);
  });
  it("a copy that widens ANON_TOOLS is caught", () => {
    const at = MCP.indexOf("const ANON_TOOLS: readonly string[] = [");
    const broken = MCP.slice(0, at) + MCP.slice(at).replace('"apply_myself",', '"apply_myself", "debug_search",');
    expect(broken).not.toBe(MCP);
    expect(anonToolsOf(broken)).not.toEqual(WAVE4_KEYLESS);
  });

  it("a copy that types a cap or the quota into the keyless branch is caught", () => {
    const broken = UNKEYED.replace("p_bucket_cap: m.bucketCap", "p_bucket_cap: 100");
    expect(broken).not.toBe(UNKEYED);
    expect(broken).toMatch(/p_\w+_cap: \d|Math\.min\(\d/);
    const typedBucket = ALLOWANCE.replace("bucketCap: A.otherPerConnection", "bucketCap: 100");
    expect(typedBucket).not.toBe(ALLOWANCE);
    expect(typedBucket).toMatch(/(?:bucketCap|shareCap|minuteCap): \d/);
    const typedNote = UNKEYED.replace('of ${d.bucket_cap.toLocaleString("en-US")} ${what}', "of 100 ${what}");
    expect(typedNote).not.toBe(UNKEYED);
    const note = /const note = `([^`]*)`/.exec(typedNote)?.[1] ?? "";
    expect(note.replace(/\$\{[^}]*\}/g, "")).toMatch(/\d/);
  });

  it("the function slicer stops at the function's own closing brace, not at the end of the file", () => {
    expect(UNKEYED).not.toMatch(/Deno\.serve\(/);
    expect(UNKEYED.trimEnd().endsWith("}")).toBe(true);
  });

  it("a copy that meters through the rate budget is caught", () => {
    const broken = MCP.replace('.rpc("mcp_anon_check_v2"', '.rpc("check_rate_limit"');
    expect(broken).not.toBe(MCP);
    expect(broken).toMatch(/check_rate_limit/);
  });

  it("a copy that runs the tool before counting it is caught", () => {
    const counted = UNKEYED.indexOf('.rpc("mcp_anon_check_v2"');
    const ranAt = UNKEYED.indexOf("case \"search_jobs\": out = await runSearchJobs(");
    expect(ranAt).toBeGreaterThan(counted);
    const swapped = UNKEYED.slice(0, counted) + UNKEYED.slice(ranAt) + UNKEYED.slice(counted, ranAt);
    expect(swapped.indexOf("case \"search_jobs\": out = await runSearchJobs(")).toBeLessThan(swapped.indexOf('.rpc("mcp_anon_check_v2"'));
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

  it("a test client that asks for one row, or types the limit, is caught", () => {
    const call = () => /"tools\/call",\s*\{\s*name: "search_jobs",\s*arguments:\s*\{([^}]*)\}/;
    const one = TEST_CLIENT.replace("limit: MCP_ANON_CAPS.searchRows", "limit: 1");
    expect(one).not.toBe(TEST_CLIENT);
    expect(call().exec(one)![1]).toMatch(/\d/);
    expect(call().exec(one)![1]).not.toMatch(/limit: MCP_ANON_CAPS\.searchRows/);
    const typed = TEST_CLIENT.replace("query: MCP_TEST_QUERY", 'query: "nurse"');
    expect(typed).not.toBe(TEST_CLIENT);
    expect(call().exec(typed)![1]).not.toMatch(/query: MCP_TEST_QUERY/);
  });

  it("a copy whose note numerator is the smaller counter under the bucket denominator is caught", () => {
    const mixed = UNKEYED.replace("keyless: ${bucketLeft} of ${d.bucket_cap", "keyless: ${left} of ${d.bucket_cap");
    expect(mixed).not.toBe(UNKEYED);
    expect(mixed).not.toMatch(/const note = `keyless: \$\{bucketLeft\} of \$\{d\.bucket_cap/);
  });

  it("a copy keyed on the caller-written first forwarded hop is caught", () => {
    const fn = functionText(MCP, "callerAddress");
    const forged = fn.replace("hops.at(-1)", "hops[0]");
    expect(forged).not.toBe(fn);
    expect(forged).toMatch(/\[0\]/);
    expect(forged).not.toMatch(/hops\.at\(-1\)/);
  });
});
