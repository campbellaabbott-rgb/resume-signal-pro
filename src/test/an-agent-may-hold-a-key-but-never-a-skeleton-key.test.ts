import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * CONNECT YOUR AGENT — the property the whole feature stands on: an external
 * agent holding a key can do AT MOST what its owner could do signed in, and
 * usually less. The MCP layer is a translator over existing rails — the same
 * rb_live_ keys and metering, the same job-board search, the same apply
 * pipeline with every gate intact. Each pin below is one way a refactor could
 * quietly turn the translator into a bypass.
 */
const MCP = readFileSync(resolve(__dirname, "../../supabase/functions/agent-mcp/index.ts"), "utf8");
const CONNECT = readFileSync(resolve(__dirname, "../../supabase/functions/agent-connect/index.ts"), "utf8");
const MIG = readFileSync(resolve(__dirname, "../../supabase/migrations/20260829150000_a_key_that_may_act_must_name_its_owner.sql"), "utf8");
const stripped = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("auth and metering ride the existing rails", () => {
  it("every tool call is checked and metered through api_key_check, per tool", () => {
    expect(MCP).toMatch(/api_key_check/);
    expect(MCP, "per-tool endpoint buckets are what make api_usage useful")
      .toMatch(/p_endpoint: `\/mcp\/\$\{toolName\}`/);
  });

  it("search rides the board itself — no second search engine", () => {
    // The sweep that closed 31 findings in the board's search is the argument
    // for never re-implementing it here.
    expect(MCP).toMatch(/functions\/v1\/job-board/);
    expect(stripped(MCP), "the MCP layer must hold no more search power than the site: anon key, not service, for the board call")
      .toMatch(/SUPABASE_ANON_KEY/);
    const reads = stripped(MCP).match(/from\("job_board_postings"\)/g) ?? [];
    expect(reads.length, "exactly ONE direct corpus read exists — the apply seam's fence-checked posting fetch; search must never grow one").toBe(1);
  });

  it("the honesty disclosures pass through — an agent hears what the site hears", () => {
    for (const k of ["countUnavailable", "ignoredFilters", "excludedTerms", "intentFilters", "didYouMean"]) {
      expect(MCP.includes(`"${k}"`), `disclosure ${k} must survive translation`).toBe(true);
    }
  });
});

describe("the apply seam is agent_queue and nothing later", () => {
  it("inserts the queue row exactly as the runner does: approved, fit scored, deduped", () => {
    expect(MCP).toMatch(/\.from\("agent_queue"\)\s*\n?\s*\.upsert/);
    expect(MCP, "'approved' is read in BOTH review and auto mode, and is the true statement")
      .toMatch(/status: "approved",/);
    expect(MCP, "a null fit_pct is a packet that silently never releases")
      .toMatch(/fit_pct: fit\.pct,/);
    expect(MCP).toMatch(/onConflict: "user_id,posting_id", ignoreDuplicates: true/);
  });

  it("never writes agent_submissions — that table refuses client inserts for exactly this reason", () => {
    const s = stripped(MCP);
    const writes = s.match(/from\("agent_submissions"\)\s*\.\s*(insert|upsert|update|delete)/g) ?? [];
    expect(writes, "agent_submissions is read-only here; writing it skips decideRelease entirely").toEqual([]);
  });

  it("re-checks the serving fences at insert time — the only moment the pipeline checks them", () => {
    expect(MCP).toMatch(/applyServingFences\(/);
  });

  it("holds no worker credentials and never touches the broker", () => {
    const s = stripped(MCP) + stripped(CONNECT);
    expect(s.includes("APPLY_WORKER_SECRET")).toBe(false);
    expect(s.includes("apply-broker")).toBe(false);
  });

  it("entitlement is status-and-period, never existence", () => {
    // agent-entitlement.ts:1-31 records the incident: the two functions that
    // release applications checked that a row EXISTED, and an unauthenticated
    // endpoint could mint rows.
    expect(MCP).toMatch(/rowIsEntitled\(/);
    expect(MCP).toMatch(/ENTITLEMENT_COLUMNS/);
  });

  it("the vendor set is imported, never a sixth hand-copied list", () => {
    expect(MCP).toMatch(/import \{ SENDABLE_VENDORS \} from "\.\.\/_shared\/apply-automation\.ts"/);
    expect(stripped(MCP)).not.toMatch(/\[\s*"breezy"/);
  });
});

describe("identity comes from credentials, never from the body", () => {
  it("the MCP owner is derived from the key row by api_key_id", () => {
    expect(MCP).toMatch(/from\("api_keys"\)\.select\("user_id"\)\.eq\("id", apiKeyId\)/);
    const s = stripped(MCP);
    expect(s.includes("args.userId") || s.includes("args.user_id"), "a user id in tool arguments is an impersonation surface").toBe(false);
  });

  it("agent-connect reads the user from the verified token and reads NO body at all", () => {
    expect(CONNECT).toMatch(/auth\.getUser\(\)/);
    expect(stripped(CONNECT).includes("req.json"), "a body field is one refactor away from becoming an identity").toBe(false);
  });

  it("agent-connect mints atomically through the per-user RPC, never revoke-first", () => {
    // The old flow revoked the working key, THEN called a mint that could 409 —
    // a keyless window (review finding). And it used the per-email cap a
    // stranger can fill with account-less keys (DoS finding). The atomic RPC
    // rotates + inserts in one transaction, scoped to user_id.
    expect(CONNECT).toMatch(/rpc\("api_key_issue_agent"/);
    expect(CONNECT).toMatch(/p_user_id: user\.id/);
    const s = stripped(CONNECT);
    expect(s.match(/from\("api_keys"\)\s*\n?\s*\.(insert|update)/), "no direct key writes — the RPC owns rotation atomically")
      .toBeNull();
    expect(s.includes("api_key_issue\"") || s.includes("api_key_issue'"), "the per-EMAIL mint must not be used for agent keys")
      .toBe(false);
  });

  it("the mint RPC rotates and inserts in one transaction, scoped to user_id, no per-email cap", () => {
    const RPC = readFileSync(resolve(__dirname, "../../supabase/migrations/20260829170000_an_agent_key_rotates_atomically_and_counts_only_its_own.sql"), "utf8");
    expect(RPC).toMatch(/UPDATE public\.api_keys[\s\S]*?WHERE user_id = p_user_id AND revoked_at IS NULL/);
    expect(RPC).toMatch(/INSERT INTO public\.api_keys[\s\S]*?p_user_id\)/);
    expect(RPC, "OUT names must be prefixed — the 42702 trap").toMatch(/issued_ok boolean/);
    expect(RPC, "the cap must be per-user, never per-email").not.toMatch(/owner_email\s*=/);
    expect(RPC).toMatch(/GRANT EXECUTE ON FUNCTION public\.api_key_issue_agent[\s\S]*?TO service_role/);
  });

  it("one live agent key per user is a DB constraint, not a comment", () => {
    expect(MIG).toMatch(/CREATE UNIQUE INDEX[\s\S]*?ON public\.api_keys \(user_id\)[\s\S]*?WHERE user_id IS NOT NULL AND revoked_at IS NULL/);
  });
});

describe("the apply request respects the mandate's whole scope, not just the pipeline's gates", () => {
  it("re-checks the reach fences the pipeline enforces ONLY at selection", () => {
    // decideRelease enumerates vendor/fit/cap/blocked/cooldown — NOT
    // country/category/age/salary, which agent-runner binds at selection and
    // nothing downstream re-checks. A queue row from this seam would skip them,
    // so the seam must enforce them itself.
    expect(MCP).toMatch(/scope-country/);
    expect(MCP).toMatch(/scope-category/);
    expect(MCP).toMatch(/scope-age/);
    expect(MCP).toMatch(/scope-salary/);
    expect(MCP, "the mandate must be read WITH its reach columns")
      .toMatch(/countries, category, include_uncategorised, max_age_days, salary_min/);
    expect(MCP, "the posting must be read WITH the columns those fences test")
      .toMatch(/country,apply_url,salary,salary_min_annual/);
  });
});

describe("the MCP transport is spec-honest under hostile input", () => {
  it("params:null cannot crash the handler into a bare 500", () => {
    expect(MCP).toMatch(/msg\.params && typeof msg\.params === "object" && !Array\.isArray\(msg\.params\)/);
  });
  it("a notification never receives a response, before any method branch", () => {
    expect(MCP).toMatch(/if \(isNotification && method !== "notifications\/initialized"/);
  });
  it("advertises only the batch-free protocol revision it actually implements", () => {
    expect(MCP).toMatch(/const MCP_PROTOCOL_VERSIONS = \["2025-06-18"\];/);
  });
  it("deny responses carry rate headers and an honest Retry-After", () => {
    expect(MCP).toMatch(/secondsToMidnightUtc\(\)/);
    expect(MCP).toMatch(/"Retry-After": "60"/);
  });
  it("an internal tool error returns a generic line, never the raw message", () => {
    const s = stripped(MCP);
    expect(s.includes("toolErr(message)"), "the raw error message must not reach the client").toBe(false);
    expect(MCP).toMatch(/hit an internal error/);
  });
});

describe("the migration is a column, not a power", () => {
  it("adds nullable user_id and its partial index, and touches nothing else", () => {
    expect(MIG).toMatch(/ADD COLUMN IF NOT EXISTS user_id uuid;/);
    expect(MIG).toMatch(/WHERE user_id IS NOT NULL/);
    expect(MIG, "no RPC changes — api_key_check must keep working unmodified").not.toMatch(/CREATE (OR REPLACE )?FUNCTION/);
    expect(MIG, "no policy changes — api_keys stays service-role only").not.toMatch(/CREATE POLICY/);
  });
});

describe("MCP protocol surface", () => {
  it("serves discovery unauthenticated and declines what it does not support", () => {
    expect(MCP).toMatch(/method === "initialize"/);
    expect(MCP).toMatch(/method === "tools\/list"/);
    expect(MCP).toMatch(/batching not supported/);
    expect(MCP, "a tool failure is a RESULT with isError — a protocol error tears down sessions")
      .toMatch(/isError: true/);
  });

  it("declares exactly the six tools the docs promise", () => {
    for (const t of ["search_jobs", "get_job", "check_apply_support", "request_application", "application_status", "board_stats"]) {
      expect(MCP.includes(`name: "${t}"`), `tool ${t} missing`).toBe(true);
    }
  });
});
