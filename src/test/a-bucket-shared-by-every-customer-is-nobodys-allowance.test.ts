import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A BUCKET SHARED BY EVERY CUSTOMER IS NOBODY'S ALLOWANCE.
 *
 * 2026-09-03: the scorer moved into job-fit and two server callers arrived the
 * same day — public-api's POST /v1/fit and agent-mcp's fit_resume. job-fit
 * keyed its 120/day check_rate_limit row on x-forwarded-for[0] || "unknown".
 * A reader's browser carries the reader's address; an edge-to-edge fetch
 * carries the runtime's egress address, or nothing. So every paying API
 * customer and every MCP agent spent from ONE row, and the 121st call of the
 * day — from any of them — was refused. public-api reported that as 502
 * "scorer_unavailable, retry shortly" and agent-mcp as "internal error, try
 * again shortly": both to a caller whose retry could not succeed for up to
 * 24 hours, both after api_key_check had already charged the call.
 *
 * And agent-mcp received key_tier from api_key_check and never read it:
 * fit_resume was served to free keys while the identical feature was 402
 * upgrade_required on /v1/fit — and those free calls drained the shared row.
 *
 * Pinned here: job-fit spends from a bucket the caller names (x-rb-bucket)
 * only when the caller proves itself with the service-role bearer, and falls
 * back to the reader's address otherwise; both callers name their key; both
 * turn the scorer's 429 into an honest limit line; fit_resume is gated on tier
 * with public-api's own predicate and says so in its description.
 *
 * Every assertion runs against COMMENT-STRIPPED source: a guard literal in a
 * comment has passed a dead guard five times in this repository. The naive
 * stripper also eats a `//` inside a string, so URL pointers are checked on
 * the one raw line that carries them, never on a comment.
 */
const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const FIT = strip(read("supabase/functions/job-fit/index.ts"));
const API = strip(read("supabase/functions/public-api/index.ts"));
const MCP_RAW = read("supabase/functions/agent-mcp/index.ts");
const MCP = strip(MCP_RAW);
const PROBE = strip(read("scripts/api-contract-probe.mjs"));

/** The slice of `src` from the first `from` to the next `to` after it. */
const between = (src: string, from: string, to: string) => {
  const a = src.indexOf(from);
  expect(a, `anchor "${from}" present`).toBeGreaterThanOrEqual(0);
  const b = src.indexOf(to, a + 1);
  expect(b, `anchor "${to}" after "${from}"`).toBeGreaterThan(a);
  return src.slice(a, b);
};

describe("a bucket shared by every customer is nobody's allowance", () => {
  it("job-fit spends from the bucket a trusted caller names, and from the reader's address otherwise", () => {
    const fn = between(FIT, "function bucketFor(", "Deno.serve(");
    expect(fn).toMatch(/req\.headers\.get\("x-rb-bucket"\)/);
    expect(fn, "the name is believed only under the service-role bearer").toMatch(/Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/);
    expect(fn, "an unset service key must never let an empty bearer match").toMatch(/named && service && bearer === service/);
    expect(fn, "the IP fallback the site relies on").toMatch(/req\.headers\.get\("x-forwarded-for"\)\?\.split\(","\)\[0\]\?\.trim\(\) \|\| "unknown"/);
    expect(fn).toMatch(/max: FIT_KEY_MAX, scope: "key"/);
    expect(fn).toMatch(/max: FIT_IP_MAX, scope: "ip"/);
    expect(FIT, "the site's allowance is untouched").toMatch(/const FIT_IP_MAX = 120;/);
    expect(FIT, "a key's allowance is the RPC's ceiling, equal to a default key's daily quota").toMatch(/const FIT_KEY_MAX = 1000;/);
    expect(FIT, "check_rate_limit raises above 45 chars of p_ip").toMatch(/\/\^key:\[A-Za-z0-9-\]\{1,41\}\$\//);
    expect(FIT).toMatch(/p_function: "job-board-fit", p_ip: bucket\.id, p_max_requests: bucket\.max, p_window_minutes: 1440/);
    expect(FIT, "no IP-keyed rpc may survive beside it").not.toMatch(/p_ip: clientIp/);
    expect(FIT, "a browser must not be able to send the header").not.toMatch(/Access-Control-Allow-Headers":[^\n]*x-rb-bucket/);
  });

  it("job-fit answers a spent bucket as 429 rate_limited with a Retry-After", () => {
    const refusal = between(FIT, "if (allowed === false)", "job_board_postings");
    expect(refusal).toMatch(/error: "rate_limited"/);
    expect(refusal).toMatch(/limit: bucket\.max/);
    expect(refusal, "older bundles read this flag").toMatch(/rateLimited: true/);
    expect(refusal).toMatch(/429, \{ "Retry-After": "3600" \}/);
  });

  it("public-api names its key's bucket and returns the scorer's 429 as a 429, not a 502", () => {
    expect(API).toMatch(/return await fitResume\(req, rateHeaders, d\.key_tier, d\.api_key_id\);/);
    const fn = between(API, "async function fitResume(", "async function stats(");
    expect(fn).toMatch(/tier: string \| null, apiKeyId: string \| null\)/);
    expect(fn).toMatch(/"x-rb-bucket": `key:\$\{apiKeyId\}`/);
    expect(fn).toMatch(/const service = Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\) \?\? "";/);
    expect(fn, "the bearer job-fit trusts").toMatch(/Authorization: `Bearer \$\{service\}`/);
    expect(fn, "the anon bearer would make job-fit ignore the bucket name").not.toMatch(/Authorization: `Bearer \$\{anon\}`/);
    expect(fn).toMatch(/if \(res\.status === 429\)/);
    expect(fn).toMatch(/fail\(429, "rate_limited", [^\n]*"Retry-After": "3600"/);
    expect(fn.indexOf("res.status === 429"), "the 429 branch must run before the generic !res.ok -> 502").toBeLessThan(fn.indexOf('fail(502, "scorer_unavailable"'));
  });

  it("agent-mcp names its key's bucket and answers the scorer's 429 with the limit, never 'internal error'", () => {
    const fn = between(MCP, "async function runFitResume(", "async function runBoardStats(");
    expect(fn).toMatch(/async function runFitResume\(args: Record<string, unknown>, apiKeyId: string\)/);
    expect(fn).toMatch(/"x-rb-bucket": `key:\$\{apiKeyId\}`/);
    expect(fn).toMatch(/Authorization: `Bearer \$\{service\}`/);
    expect(fn).not.toMatch(/Authorization: `Bearer \$\{anon\}`/);
    expect(fn).toMatch(/if \(res\.status === 429\) throw new ScorerLimited\(/);
    expect(fn.indexOf("res.status === 429")).toBeLessThan(fn.indexOf("!res.ok || !f?.fits"));
    expect(MCP).toMatch(/class ScorerLimited extends Error/);
    const serve = MCP.slice(MCP.indexOf("Deno.serve("));
    const handled = between(serve, "if (e instanceof ScorerLimited)", "toolErr(`The ${toolName} tool hit an internal error");
    expect(handled).toMatch(/daily fit-scoring allowance/);
    expect(handled).toMatch(/"Retry-After": "3600"/);
    expect(handled, "an isError tool result, like every other refusal here").toMatch(/rpcResult\(id, toolErr\(/);
  });

  it("agent-mcp gates fit_resume on tier with public-api's own predicate, before any search runs, and says so", () => {
    expect(MCP).toMatch(/const isPaidTier = \(tier: string \| null\) => tier != null && tier !== "free" && tier !== "trial";/);
    expect(API, "the predicate must be the one /v1/fit applies").toMatch(/const paid = tier != null && tier !== "free" && tier !== "trial";/);
    expect(MCP).toMatch(/callTool\(client, d\.api_key_id \?\? "", d\.key_tier, toolName, toolArgs\)/);
    expect(MCP).toMatch(/tier: string \| null,\s*name: string,\s*args: Record<string, unknown>,\s*\): Promise<unknown>/);
    const dispatch = between(MCP, 'case "fit_resume":', 'case "check_apply_support":');
    expect(dispatch).toMatch(/if \(!isPaidTier\(tier\)\)/);
    expect(dispatch).toMatch(/return toolErr\(\s*"fit_resume is a paid feature/);
    expect(dispatch).toMatch(/return toolOk\(await runFitResume\(args, apiKeyId\)\);/);
    expect(dispatch.indexOf("isPaidTier(tier)"), "refused before scoring").toBeLessThan(dispatch.indexOf("runFitResume(args"));
    // The upgrade pointer holds a `//`, which the stripper would eat; it is
    // checked on the raw line that opens the string — a line of code, not a
    // comment — and that line must sit inside the dispatch case.
    const pointer = MCP_RAW.split("\n").find((l) => l.includes("Upgrade the key at "));
    expect(pointer, "the same upgrade pointer /v1/fit gives").toMatch(/^\s*"Upgrade the key at https:\/\/resumebooster\.work\/data-api/);
    expect(MCP_RAW.indexOf("Upgrade the key at ")).toBeGreaterThan(MCP_RAW.indexOf('case "fit_resume":'));
    expect(MCP_RAW.indexOf("Upgrade the key at ")).toBeLessThan(MCP_RAW.indexOf('case "check_apply_support":'));
    const tool = between(MCP, 'name: "fit_resume"', 'name: "board_stats"');
    expect(tool).toMatch(/PAID — needs a paid API key, exactly like POST \/v1\/fit/);
    expect(MCP, "initialize must not list it among the free read tools").toMatch(/Read tools \(search_jobs, get_job, board_stats, check_apply_support\)/);
    expect(MCP).toMatch(/"fit_resume needs a paid key, like POST \/v1\/fit\. /);
  });

  it("the live probe, holding a free key, expects the in-band refusal — never a score", () => {
    const block = between(PROBE, 'name: "fit_resume", arguments', "unkeyed tool call");
    expect(block).toMatch(/isError === true/);
    expect(block).toMatch(/\/paid\/i\.test\(j\?\.error/);
    expect(block).toMatch(/!Array\.isArray\(j\?\.jobs\)/);
    expect(block).not.toMatch(/fit_resume jobs carry a numeric fit/);
  });
});
