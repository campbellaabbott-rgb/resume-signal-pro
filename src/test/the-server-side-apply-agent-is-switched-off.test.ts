// @vitest-environment node
/**
 * THE SERVER-SIDE APPLY AGENT IS SWITCHED OFF (wave 4, the apply pivot).
 *
 * Owner decision 2026-10-11: people apply themselves through their own AI,
 * and nothing is prepared, released or submitted for them by us. The code is
 * kept, dormant, behind APPLY_AGENT_ON in _shared/apply-agent-switch.ts. Each
 * function runs here as it ships (the switch is not stubbed), and the
 * assertions read what it touched:
 *
 *   apply-agent    an authorised run (cron, purchase kick or hand) answers
 *                  switchedOff and reads no mandate, prepares and releases
 *                  nothing, wakes no worker and writes no run stamp; a stranger
 *                  still gets the 403 with the build and nothing else;
 *   agent-runner   the same: nothing scanned, nothing queued, no stamp;
 *   apply-broker   a claim hands out nothing and takes no lease or heartbeat;
 *                  a ping records no heartbeat; a peek says there is nothing to
 *                  run; a worker's report on a packet it already held is still
 *                  written, so nothing in flight is lost;
 *   agent-access   approve and retry (the decisions that hand a packet to a
 *                  worker) answer 409 agent_switched_off without touching the
 *                  packet; cancel still reaches the decision; the status read of
 *                  an open pass still answers active, so an existing buyer
 *                  reads correctly, and says agentSwitchedOff;
 *   agent-pass-status  a bought pass reads exactly as before, plus
 *                  agentSwitchedOff, so the page cannot read its applications
 *                  as something that will be sent.
 *
 * And the worker's Actions workflow no longer starts on a schedule; it can
 * still be started by hand.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { APPLY_AGENT_SWITCH_ON } from "./helpers/apply-agent-switch-on";

const ROOT = resolve(__dirname, "../..");
const env: Record<string, string | undefined> = {
  SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service_harness_key",
  SUPABASE_ANON_KEY: "anon_harness_key",
  MAINTENANCE_KEY: "maintenance-harness",
  AGENT_MAINTENANCE_KEY: "runner-maintenance-harness",
  APPLY_WORKER_SECRET: "worker-secret-harness-0123456789",
  WORKER_START_URL: "https://wake.test/start",
  WORKER_START_TOKEN: "wake-token",
};
const g = globalThis as Record<string, unknown>;
let touched: string[] = [];
let fetched: string[] = [];

/** What the fake database answers, per table and per rpc. */
type World = { table: (t: string) => unknown; rpc: (n: string) => unknown };
const OPEN_PASS = {
  activated_at: null, expires_at: null, closed_at: null,
  shelf_expires_at: new Date(Date.now() + 20 * 86400_000).toISOString(),
  applications_total: 10, applications_used: 2,
};
const WORLD: World = {
  table: (t) => (t === "agent_passes" ? OPEN_PASS : null),
  rpc: (n) => {
    if (n === "agent_work_pending") return { pending: 3, should_run: true, oldest_wait_minutes: 40 };
    // .maybeSingle() hands the handler one row, never the array.
    if (n === "agent_packet_decide") return { decided_ok: true, decide_reason: "cancelled" };
    return null;
  },
};

const CLIENT = `export function createClient(url, key, opts) {
  const t = globalThis.__offTouched;
  const w = globalThis.__offWorld;
  const chain = (label, answer) => new Proxy(function () {}, {
    get: (_x, p) => {
      if (p === "then") return (ok) => ok({ data: answer(), error: null });
      if (typeof p === "symbol") return undefined;
      return () => { t.push(label + "." + String(p)); return chain(label, answer); };
    },
  });
  const bearer = String(opts?.global?.headers?.Authorization ?? "").replace(/^Bearer\\s+/i, "");
  return {
    from: (table) => { t.push("from:" + table); return chain("from:" + table, () => w.table(table)); },
    rpc: (name) => { t.push("rpc:" + name); return chain("rpc:" + name, () => w.rpc(name)); },
    storage: {
      createBucket: async () => { t.push("storage.createBucket"); return { error: null }; },
      from: () => ({ createSignedUrl: async () => { t.push("storage.sign"); return { data: null, error: null }; } }),
    },
    auth: {
      getUser: async (jwt) => {
        t.push("auth.getUser");
        return (jwt ?? bearer) === "jwt-owner"
          ? { data: { user: { id: "11111111-1111-1111-1111-111111111111", email: "owner@example.com" } }, error: null }
          : { data: { user: null }, error: { message: "no session" } };
      },
      admin: { getUserById: async () => { t.push("auth.admin.getUserById"); return { data: { user: { email: "owner@example.com" } } }; } },
    },
  };
}`;
const STUBS: Record<string, string> = {
  "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
  "https://esm.sh/@supabase/supabase-js@2": CLIENT,
  "https://esm.sh/@supabase/supabase-js@2.39.3": CLIENT,
  "https://esm.sh/@supabase/supabase-js@2.45.0": CLIENT,
  "https://esm.sh/stripe@18.5.0": "export default class Stripe { constructor() { globalThis.__offTouched.push('stripe'); } }",
};

const h: Record<string, EdgeHandler> = {};
const on: Record<string, EdgeHandler> = {};
beforeAll(async () => {
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (fn: unknown) => { g.__edgeHandler = fn; } };
  for (const fn of ["apply-agent", "agent-runner", "apply-broker", "agent-access", "agent-pass-status"]) {
    h[fn] = await loadEdgeHandler(fn, STUBS);
  }
  for (const fn of ["apply-broker", "agent-access", "agent-pass-status"]) {
    on[fn] = await loadEdgeHandler(fn, { ...STUBS, ...APPLY_AGENT_SWITCH_ON });
  }
}, 240_000);
beforeEach(() => {
  touched = []; fetched = [];
  g.__offTouched = touched;
  g.__offWorld = WORLD;
  globalThis.fetch = (async (u: string | URL | Request) => { fetched.push(String(u)); return new Response("{}", { status: 204 }); }) as typeof fetch;
});

const call = (handler: EdgeHandler, fn: string, body: unknown, headers: Record<string, string> = {}) =>
  handler(new Request(`https://harness.supabase.co/functions/v1/${fn}`, {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  }));
const worker = { authorization: `Bearer ${env.APPLY_WORKER_SECRET}` };
const owner = { authorization: "Bearer jwt-owner" };
const hit = (prefix: string) => touched.filter((x) => x.startsWith(prefix));

describe("apply-agent: an authorised run does nothing and says so", () => {
  for (const [trigger, body] of [["cron", { source: "cron" }], ["purchase kick", { source: "purchase" }], ["hand run", {}]] as const) {
    it(`a ${trigger}: switchedOff, no mandate read, nothing prepared or released, no wake, no run stamp`, async () => {
      const res = await call(h["apply-agent"], "apply-agent", body, { "x-maintenance-key": env.MAINTENANCE_KEY! });
      expect(res.status).toBe(200);
      const j = await res.json();
      expect(j).toMatchObject({ switchedOff: true, version: "2026-10-11.14", trigger: trigger === "cron" ? "cron" : "manual" });
      expect(j).not.toHaveProperty("prepared");
      expect(hit("from:agent_mandates")).toEqual([]);
      expect(hit("from:agent_submissions")).toEqual([]);
      expect(hit("from:job_board_meta"), "a switched-off run must not look like a run").toEqual([]);
      expect(hit("rpc:agent_sender_online")).toEqual([]);
      expect(hit("rpc:agent_work_pending")).toEqual([]);
      expect(hit("storage.createBucket")).toEqual([]);
      expect(fetched, "a switched-off run woke a worker").toEqual([]);
    });
  }

  it("a stranger still gets the 403 with the build and nothing else", async () => {
    const res = await call(h["apply-agent"], "apply-agent", { source: "cron" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "apply-agent is a maintenance action", version: "2026-10-11.14" });
    expect(touched.filter((x) => x !== "createClient")).toEqual([]);
  });

  it("the storage repair, which releases nothing, still runs", async () => {
    const res = await call(h["apply-agent"], "apply-agent", { action: "ensure-storage" }, { "x-maintenance-key": env.MAINTENANCE_KEY! });
    expect(await res.json()).toEqual({ resumesBucket: "created" });
    expect(hit("from:agent_mandates")).toEqual([]);
  });
});

describe("agent-runner: an authorised run scans and queues nothing", () => {
  it("switchedOff, no queue write, no mandate read, no run stamp", async () => {
    const res = await call(h["agent-runner"], "agent-runner", { source: "cron" }, { "x-maintenance-key": env.AGENT_MAINTENANCE_KEY! });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ switchedOff: true, version: "2026-10-11.13", trigger: "cron" });
    expect(hit("from:agent_queue")).toEqual([]);
    expect(hit("from:agent_mandates")).toEqual([]);
    expect(hit("from:job_board_postings")).toEqual([]);
    expect(hit("from:job_board_meta")).toEqual([]);
  });

  it("a stranger still gets the 403 with the build", async () => {
    const res = await call(h["agent-runner"], "agent-runner", {});
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "unauthorized", version: "2026-10-11.13" });
  });
});

describe("apply-broker: no packet leaves, and nothing reads the sender as alive", () => {
  it("a claim hands out nothing, takes no lease and records no heartbeat", async () => {
    const res = await call(h["apply-broker"], "apply-broker", { action: "claim", worker_id: "gha-1", version: "w" }, worker);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ packet: null, switchedOff: true });
    expect(hit("rpc:agent_claim_submission")).toEqual([]);
    expect(hit("rpc:agent_worker_ping")).toEqual([]);
    expect(hit("from:agent_mandates")).toEqual([]);
    expect(hit("storage.sign")).toEqual([]);
  });

  it("a ping records no heartbeat", async () => {
    const res = await call(h["apply-broker"], "apply-broker", { action: "ping", worker_id: "gha-1", version: "w" }, worker);
    expect(await res.json()).toEqual({ ok: true, build: "2026-10-11.13", switchedOff: true });
    expect(hit("rpc:agent_worker_ping")).toEqual([]);
  });

  it("a peek reads the queue but says there is nothing to run", async () => {
    const res = await call(h["apply-broker"], "apply-broker", { action: "peek" }, worker);
    const j = await res.json();
    expect(j).toMatchObject({ pending: 3, shouldRun: false, switchedOff: true });
    expect(hit("rpc:agent_work_pending")).toEqual(["rpc:agent_work_pending"]);
  });

  it("a worker's report on a packet it already held is still written", async () => {
    const res = await call(h["apply-broker"], "apply-broker", { action: "release", id: 7, patch: { status: "blocked", error: "stopped" } }, worker);
    expect(await res.json()).toEqual({ ok: true, mirrored: false });
    expect(hit("from:agent_submissions")).toContain("from:agent_submissions.update");
  });

  it("a caller without the worker secret is still refused first", async () => {
    const res = await call(h["apply-broker"], "apply-broker", { action: "claim" });
    expect(res.status).toBe(401);
    expect(touched).toEqual([]);
  });

  it("positive control: with the switch on, a claim asks the database for a packet and a ping is a heartbeat", async () => {
    await call(on["apply-broker"], "apply-broker", { action: "claim", worker_id: "gha-1", version: "w" }, worker);
    expect(hit("rpc:agent_claim_submission").length).toBeGreaterThan(0);
    touched.length = 0;
    await call(on["apply-broker"], "apply-broker", { action: "ping", worker_id: "gha-1", version: "w" }, worker);
    expect(hit("rpc:agent_worker_ping")).toEqual(["rpc:agent_worker_ping"]);
  });
});

describe("agent-access: no packet is released, and an existing buyer still reads correctly", () => {
  for (const action of ["approve", "retry"]) {
    it(`${action}: 409 agent_switched_off, and the packet is not read or decided`, async () => {
      const res = await call(h["agent-access"], "agent-access", { action, id: 42 }, owner);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ ok: false, reason: "agent_switched_off" });
      expect(hit("from:agent_submissions")).toEqual([]);
      expect(hit("rpc:agent_packet_decide")).toEqual([]);
    });
  }

  it("a bad id is still a 400 first, and a signed-out caller still a 401", async () => {
    expect((await call(h["agent-access"], "agent-access", { action: "approve", id: "x" }, owner)).status).toBe(400);
    expect((await call(h["agent-access"], "agent-access", { action: "approve", id: 42 })).status).toBe(401);
  });

  it("cancel, which stops a packet, still reaches the decision", async () => {
    const res = await call(h["agent-access"], "agent-access", { action: "cancel", id: 42 }, owner);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, reason: "cancelled" });
    expect(touched.filter((x) => x === "rpc:agent_packet_decide")).toEqual(["rpc:agent_packet_decide"]);
  });

  it("the status of an open pass still answers active, tier pass", async () => {
    const res = await call(h["agent-access"], "agent-access", {}, owner);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j).toMatchObject({ active: true, tier: "pass", status: "pass" });
    expect(j.pass).toMatchObject({ state: "unactivated", usable: true, applicationsLeft: 8 });
    expect(j.agentSwitchedOff, "the status must say nothing will be sent for the pass").toBe(true);
  });

  it("positive control: with the switch on, approve reads the packet and the status carries no switched-off flag", async () => {
    await call(on["agent-access"], "agent-access", { action: "approve", id: 42 }, owner);
    expect(hit("from:agent_submissions").length).toBeGreaterThan(0);
    const j = await (await call(on["agent-access"], "agent-access", {}, owner)).json();
    expect(j).toMatchObject({ active: true, tier: "pass" });
    expect(j).not.toHaveProperty("agentSwitchedOff");
  });
});

describe("agent-pass-status: a bought pass reads as before, and says nothing will be sent", () => {
  it("the pass, its applications left and agentSwitchedOff", async () => {
    const res = await call(h["agent-pass-status"], "agent-pass-status", {}, owner);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.pass).toMatchObject({ state: "unactivated", applicationsTotal: 10, applicationsUsed: 2, applicationsLeft: 8 });
    expect(j.agentSwitchedOff).toBe(true);
    expect(touched, "a status read must not reach Stripe").not.toContain("stripe");
  });

  it("a signed-out caller is still a 401, and the preflight carries the new build", async () => {
    expect((await call(h["agent-pass-status"], "agent-pass-status", {})).status).toBe(401);
    const pre = await h["agent-pass-status"](new Request("https://harness.supabase.co/functions/v1/agent-pass-status", { method: "OPTIONS" }));
    expect(pre.headers.get("x-fn-build")).toBe("agent-pass-status.2026-10-11.13");
  });

  it("positive control: with the switch on, the same read carries no switched-off flag", async () => {
    const j = await (await call(on["agent-pass-status"], "agent-pass-status", {}, owner)).json();
    expect(j.pass).toMatchObject({ state: "unactivated", applicationsLeft: 8 });
    expect(j).not.toHaveProperty("agentSwitchedOff");
  });
});

describe("the apply worker's workflow starts only by hand", () => {
  const raw = readFileSync(resolve(ROOT, ".github/workflows/apply-worker.yml"), "utf8");
  const wf = parse(raw) as Record<string, unknown>;
  const triggers = (wf.on ?? (wf as Record<string, unknown>)["true"]) as Record<string, unknown>;

  it("has workflow_dispatch and no schedule", () => {
    expect(Object.keys(triggers ?? {})).toEqual(["workflow_dispatch"]);
    const code = raw.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    expect(code).not.toMatch(/^\s*schedule\s*:/m);
    expect(code).not.toMatch(/^\s*-\s*cron\s*:/m);
  });

  it("still runs the worker with its one secret when started", () => {
    const jobs = wf.jobs as Record<string, { steps: Array<{ env?: Record<string, string> }> }>;
    const send = jobs.send.steps.find((s) => s.env && "APPLY_WORKER_SECRET" in s.env);
    expect(send?.env?.APPLY_WORKER_SECRET).toBe("${{ secrets.APPLY_WORKER_SECRET }}");
  });
});
