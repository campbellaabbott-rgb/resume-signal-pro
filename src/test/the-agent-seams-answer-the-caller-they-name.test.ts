/**
 * THE AGENT'S DENO AND CI SEAMS (platform debug sweep 2026-10-04, agents-api).
 *
 * STRUCTURE ONLY, AND NOT THE PROOF. The review of this branch (2026-10-05)
 * found these assertions were the only evidence for its security claims, and
 * that the one seam it reproduced was invisible to every one of them. The
 * behaviours are now EXECUTED: agent-access, apply-broker,
 * create-agent-checkout and apply-agent run against the real migrations in
 * the-agent-functions-run-against-the-real-database.test.ts, the SQL in
 * a-paid-agent-is-funded-by-its-account-and-stopped-by-its-owner.test.ts, and
 * the worker in a-started-worker-waits-for-its-packet-and-never-sends-nameless.
 * What stays here pins the shapes those runs do not reach (an MCP tool's
 * order of checks, a CI step that must not exist), read off COMMENT-STRIPPED
 * code — a guard literal in a comment has blinded guards here before.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/[^\n]*/gm, " ").replace(/^\s*#[^\n]*/gm, " ");
const between = (src: string, from: string, to: string) => {
  const a = src.indexOf(from);
  expect(a, `anchor "${from}"`).toBeGreaterThanOrEqual(0);
  const b = src.indexOf(to, a + from.length);
  expect(b, `anchor "${to}" after "${from}"`).toBeGreaterThan(a);
  return src.slice(a, b);
};

const ACCESS = code(read("supabase/functions/agent-access/index.ts"));
const CONNECT = code(read("supabase/functions/agent-connect/index.ts"));
const MCP = code(read("supabase/functions/agent-mcp/index.ts"));
const AGENT = code(read("supabase/functions/apply-agent/index.ts"));
const BROKER = code(read("supabase/functions/apply-broker/index.ts"));
const WORKER = code(read("worker/src/index.ts"));

describe("2.09 / L3-02 — agent-access answers about the signed-in caller only, and knows the pass", () => {
  it("identity comes from the verified token; the body's address is never read", () => {
    expect(ACCESS).toMatch(/authClient\.auth\.getUser\(\)/);
    expect(ACCESS).not.toMatch(/body\.email/);
    expect(ACCESS).toMatch(/normalizeEmail\(user\.email/);
  });

  it("a signed-out caller is refused before any read", () => {
    const gate = ACCESS.indexOf("if (userErr || !user?.id)");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(ACCESS.indexOf("checkAgentByEmail("));
    expect(gate).toBeLessThan(ACCESS.indexOf('from("agent_passes")'));
  });

  it("the Stripe customer id never leaves, and Stripe is metered per account and per network", () => {
    expect(ACCESS).not.toMatch(/stripeCustomerId/);
    expect(ACCESS).toMatch(/mail_door_take/);
    expect(ACCESS).toMatch(/networkBucket\(/);
  });

  it("an open pass answers active, tier pass", () => {
    expect(ACCESS).toMatch(/tier = subscription\.active \? "subscription" : pass\.usable \? "pass" : "none"/);
    expect(ACCESS).toMatch(/active: subscription\.active \|\| pass\.usable/);
  });

  it("the owner's approve and cancel go to the service-role RPC with the verified user, and approve only a vendor the worker can complete", () => {
    expect(ACCESS).toMatch(/rpc\("agent_packet_decide", \{\s*p_user_id: user\.id,/);
    expect(ACCESS).toMatch(/if \(!isSendableVendor\(source\)\)/);
  });
});

describe("PR #13 review — agent-connect's mint is bounded", () => {
  it("passes the caller's network, as a keyed hash of the platform's address", () => {
    expect(CONNECT).toMatch(/p_net: await networkBucket\(req\.headers, serviceKey, "agent-key"\)/);
  });

  it("says why when a limit refuses", () => {
    for (const r of ["account_limit", "network_limit", "shed", "paused"]) expect(CONNECT).toMatch(new RegExp(`${r}: \\[`));
  });
});

describe("the MCP seam", () => {
  it("L9-08: the guide is answered before the credential is read, for every caller", () => {
    const guide = MCP.indexOf("if (read.resource.uri === GUIDE_URI)");
    expect(guide).toBeGreaterThan(-1);
    // Before the no-credential branch and before the key check meters anything.
    expect(guide).toBeLessThan(MCP.indexOf("if (read && !bearer)"));
    expect(guide).toBeLessThan(MCP.indexOf('.rpc("api_key_check"'));
  });

  it("L9-24 / 1.71: numeric filters forward on presence, so maxYears 0 binds", () => {
    const body = between(MCP, "function searchBody(args: Record<string, unknown>)", "\n}");
    expect(body).toMatch(/const present = \(v: unknown\) => v !== undefined && v !== null && v !== ""/);
    for (const f of ["maxAgeDays", "salaryMin", "salaryMax", "maxYears", "offset"]) {
      expect(body, `${f} still forwards on truthiness`).not.toMatch(new RegExp(`args\\.${f} \\?`));
    }
    expect(body).toMatch(/\.\.\.\(maxYears !== undefined \? \{ maxYears \} : \{\}\)/);
  });

  it("L6-07: request_application refuses a blocked employer and the cooldown BEFORE the enqueue spends a pass", () => {
    const fn = between(MCP, "async function enqueueApplication(", "\nasync function readApplicationStatus(");
    const blocked = fn.indexOf('refuse("blocked-company"');
    const cooldown = fn.indexOf('refuse("cooldown"');
    const spend = fn.indexOf('.rpc("agent_queue_enqueue"');
    expect(blocked).toBeGreaterThan(-1);
    expect(cooldown).toBeGreaterThan(-1);
    expect(blocked).toBeLessThan(spend);
    expect(cooldown).toBeLessThan(spend);
  });

  it("L9-01: an existing packet is reported as prepared, and only an unchanged row is a duplicate", () => {
    const fn = between(MCP, "async function enqueueApplication(", "\nasync function readApplicationStatus(");
    expect(fn).toMatch(/alreadyPrepared: true/);
    expect(fn).not.toMatch(/from\("agent_queue"\)\s*\.select\("status"\)/);
  });

  it("L9-17: every warning is kept, and stale names the duplicate it means", () => {
    const fn = between(MCP, "async function enqueueApplication(", "\nasync function readApplicationStatus(");
    expect(fn).toMatch(/warning: warnings\[0\], warnings/);
    expect(MCP).toMatch(/stale: "not sent: the human had already applied/);
  });

  it("L9-16: the restricted branch of check_apply_support carries the required requirements", () => {
    const fn = between(MCP, "async function runCheckApplySupport(", "\nasync function keyOwner(");
    const restricted = between(fn, "restricted: true,", "};");
    expect(restricted).toMatch(/requirements: \[/);
  });
});

describe("the preparer", () => {
  it("1.09: waiting packets are re-decided, guarded so one release cannot happen twice", () => {
    expect(AGENT).toMatch(/\.in\("release_refusal", transient\)/);
    expect(AGENT).toMatch(/update\(releaseFields\(\)\)\s*\.eq\("id", w\.id\)\.is\("released_at", null\)\.eq\("status", "ready"\)/);
  });

  it("L9-03: it reads unprepared rows first, and keeps the old read only as a fallback", () => {
    expect(AGENT).toMatch(/rpc\("agent_queue_unprepared"/);
  });

  it("L6-07: a pass-funded row a gate refuses is given back — and a prepared posting never is", () => {
    for (const reason of ["blocked-company", "employer-cooldown"]) {
      expect(AGENT).toMatch(new RegExp(`await refusePassRow\\(q, "${reason}"\\)`));
    }
    // Review: refunding a posting whose packet exists handed back an
    // application the packet was still spending (executed in
    // the-agent-functions-run-against-the-real-database).
    expect(AGENT).not.toMatch(/refusePassRow\(q, "already-prepared"\)/);
  });

  it("1.07: the subscription is read by the account's user id, never by an address", () => {
    expect(AGENT).toMatch(/client\.rpc\(ACCOUNT_SUBSCRIPTION_RPC, \{ p_user_ids: \[m\.user_id\] \}\)/);
    expect(BROKER).toMatch(/client\.rpc\(ACCOUNT_SUBSCRIPTION_RPC, \{\s*p_user_ids: \[String\(row\.user_id\)\],?\s*\}\)/);
    for (const src of [AGENT, BROKER]) expect(src).not.toMatch(/from\("agent_subscribers"\)/);
  });
});

describe("the broker", () => {
  it("L9-02: a claim handed back gives its attempt back, and a look claims nothing", () => {
    expect(BROKER).toMatch(/rpc\("agent_unclaim_submission"/);
    const peek = between(BROKER, 'if (action === "peek")', 'if (action === "claim")');
    expect(peek).toMatch(/rpc\("agent_work_pending"\)/);
    expect(peek).not.toMatch(/agent_claim_submission|agent_worker_ping/);
    expect(code(read("worker/mac/applyd"))).toMatch(/CBODY='\{"action":"peek"\}'/);
  });
});

describe("L12-09 / L9-20 — a candidate's details stay off public storage and public logs", () => {
  it("the Actions workflow uploads no evidence", () => {
    expect(code(read(".github/workflows/apply-worker.yml"))).not.toMatch(/upload-artifact/);
  });

  it("the worker's log names a packet by id and vendor unless verbose logging is asked for", () => {
    expect(WORKER).toMatch(/const VERBOSE_LOGS = process\.env\.WORKER_VERBOSE_LOGS === "1";/);
    expect(WORKER).not.toMatch(/\$\{p\.user_id\}/);
    expect(WORKER).not.toMatch(/claimed #\$\{p\.id\} \$\{p\.source\} \$\{p\.company\}/);
    expect(WORKER).toMatch(/return `UNCERTAIN \$\{who\(p\)\} — \$\{scrub\(outcome\.reason\)\}`/);
  });

  it("the screenshot is named by packet id, and the container can write where it is saved", () => {
    expect(WORKER).toMatch(/`uncertain-\$\{p\.id\}\.png`/);
    expect(read("worker/Dockerfile")).toMatch(/RUN mkdir -p \/app\/mac\/uncertain && chown -R pwuser \/app\/mac\n[\s\S]*USER pwuser/);
    expect(read("worker/fly.toml")).toMatch(/WORKER_SHOT_DIR = "\/tmp\/uncertain"/);
  });
});

describe("every changed function answers its build on the preflight", () => {
  for (const [fn, file] of [
    ["agent-access", "supabase/functions/agent-access/index.ts"],
    ["agent-connect", "supabase/functions/agent-connect/index.ts"],
    ["agent-mcp", "supabase/functions/agent-mcp/index.ts"],
    ["apply-agent", "supabase/functions/apply-agent/index.ts"],
    ["apply-broker", "supabase/functions/apply-broker/index.ts"],
    ["agent-runner", "supabase/functions/agent-runner/index.ts"],
    ["public-api", "supabase/functions/public-api/index.ts"],
  ] as const) {
    it(fn, () => {
      const src = code(read(file));
      expect(src).toMatch(/const FN_BUILD = /);
      expect(src).toMatch(/"x-fn-build": FN_BUILD/);
      // This sweep's build (2026-10-05) or a later one: a later fix to the
      // same function rebuilds it, and must not read as a regression.
      const built = /const (?:FN_BUILD|BUILD_VERSION) = "(?:[a-z-]+\.)?(\d{4}-\d{2}-\d{2})\.\d+"/.exec(src)?.[1] ?? "";
      expect(built >= "2026-10-05", `${fn} FN_BUILD date ${built || "(unparsed)"}`).toBe(true);
    });
  }
  it("agent-pass-status", () => {
    const src = code(read("supabase/functions/agent-pass-status/index.ts"));
    // 2026-10-05 or a later build (2026-10-08: a refunded payment opens no pass).
    const m = /const FN_BUILD = `\$\{FN_NAME\}\.(\d{4}-\d{2}-\d{2})\.\d+`;/.exec(src);
    expect(m, "agent-pass-status has no dated FN_BUILD").not.toBeNull();
    expect(m![1] >= "2026-10-05").toBe(true);
    expect(src).toMatch(/"x-fn-build": FN_BUILD/);
  });
});
