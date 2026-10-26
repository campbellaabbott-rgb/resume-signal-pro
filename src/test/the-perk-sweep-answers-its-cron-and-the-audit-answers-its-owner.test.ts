// @vitest-environment node
/**
 * THE PERK SWEEP ANSWERS ITS CRON, AND THE AUDIT ANSWERS ITS OWNER.
 *
 * employer-profiles runs with verify_jwt = false (pg_cron carries no JWT), so
 * its own checks are the only door. Against the shipped handler with only its
 * network faked (helpers/edge-harness):
 *
 *   - the preflight names the build and allows both key headers;
 *   - no key, a short cron key, a wrong admin key, or an unset ADMIN_API_KEY
 *     with an empty header is 401 with NO client built and NO call made;
 *   - a cron key of the right length the vault does not hold is 401 after
 *     exactly one call, employer_profiles_cron_key_matches, and no sweep;
 *   - the owner's key does not run the sweep, and the cron's key opens no
 *     audit action;
 *   - the vault's key runs the sweep: lease, config, take, one store per
 *     board with the right finished flags, the lease released, a run row;
 *   - a held lease, the pause switch, and a failed store (best-effort: the
 *     next board is still stored) each end the way they say;
 *   - the owner's audit actions check their input before any call, and a
 *     withheld key is refused without one.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { buildIsAtLeast } from "./helpers/fn-build";
import { boardsOf, type TakenRow } from "../../supabase/functions/employer-profiles/sweep";
import { EXTRACTOR_VERSION } from "../../supabase/functions/_shared/perks-extract";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const STUBS: Record<string, string> = {
  "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
  "https://esm.sh/@supabase/supabase-js@2":
    "export function createClient(url, key) { globalThis.__perkClients.push(key); return globalThis.__perkDb; }",
};
const env: Record<string, string> = {
  SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service_harness",
  ADMIN_API_KEY: "admin-key-harness-0123456789",
};
const VAULT_KEY = "c".repeat(64);
const BENEFITS = "About us\nWe build software for logistics companies and care about craft, kindness and shipping work that matters to the people who rely on it every day.\nWhat we offer\nMedical, dental and vision insurance for you and your family\n401(k) retirement plan with a company match";

let handler: EdgeHandler;
let db: FakeDb;
let calls: string[];
let clients: string[];
let takes: TakenRow[][];
let argsLog: Array<{ fn: string; args: Record<string, unknown> }>;
const argsOf = (fn: string) => argsLog.filter((a) => a.fn === fn).map((a) => a.args);

const row = (token: string, i: number, body: string | null = BENEFITS): TakenRow =>
  ({ company_token: token, posting_id: `greenhouse:${token}:${String(i).padStart(3, "0")}`, source: "greenhouse", country: "US", agency: false, title: `Engineer ${i}`, body });

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] } };
  handler = await loadEdgeHandler("employer-profiles", STUBS);
}, 120_000);

beforeEach(() => {
  env.ADMIN_API_KEY = "admin-key-harness-0123456789";
  calls = [];
  clients = [];
  takes = [];
  argsLog = [];
  db = new FakeDb();
  db.tables.employer_profile_config = [{ id: true, sweep_paused: false, sweep_batch: 300, sweep_wall_ms: 20000 }];
  const track = (name: string, f: (a: Record<string, unknown>) => { data: unknown; error: unknown }) => (a: Record<string, unknown>) => { calls.push(name); argsLog.push({ fn: name, args: a }); return f(a) as never; };
  db.rpcs.employer_profiles_cron_key_matches = track("employer_profiles_cron_key_matches", (a) => ({ data: a.p_key === VAULT_KEY, error: null }));
  db.rpcs.employer_profile_lease_take = track("employer_profile_lease_take", () => ({ data: true, error: null }));
  db.rpcs.employer_profile_lease_release = track("employer_profile_lease_release", () => ({ data: true, error: null }));
  db.rpcs.employer_perk_sweep_take = track("employer_perk_sweep_take", () => ({ data: takes.shift() ?? [], error: null }));
  db.rpcs.employer_perk_store = track("employer_perk_store", (a) => ({ data: { stored: (a.p_rows as unknown[]).length, refused: 0, lines: (a.p_lines as unknown[]).length }, error: null }));
  for (const fn of ["employer_perk_audit_status", "employer_perk_audit_draw", "employer_perk_audit_record", "employer_profile_set_pause"]) {
    db.rpcs[fn] = track(fn, () => ({ data: { ok: true }, error: null }));
  }
  const g = globalThis as Record<string, unknown>;
  g.__perkDb = db;
  g.__perkClients = clients;
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  handler(new Request("https://harness.supabase.co/functions/v1/employer-profiles", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  }));
const cron = (key = VAULT_KEY) => ({ "x-employer-profiles-cron": key });
const owner = (key = env.ADMIN_API_KEY) => ({ "x-admin-key": key });

describe("the doors", () => {
  it("the preflight names the build and allows both key headers", async () => {
    const r = await handler(new Request("https://harness.supabase.co/functions/v1/employer-profiles", { method: "OPTIONS" }));
    expect(buildIsAtLeast(r.headers.get("x-fn-build"), "employer-profiles", "2026-10-12")).toBe(true);
    const allowed = (r.headers.get("access-control-allow-headers") ?? "").split(",").map((h) => h.trim());
    expect(allowed).toEqual(expect.arrayContaining(["x-admin-key", "x-employer-profiles-cron", "content-type"]));
  });

  it("refuses a GET", async () => {
    const r = await handler(new Request("https://harness.supabase.co/functions/v1/employer-profiles"));
    expect(r.status).toBe(405);
    expect(r.headers.get("x-fn-build")).toMatch(/^employer-profiles\./);
  });

  it("no key, a short cron key, or a wrong admin key: 401 before any client or call", async () => {
    for (const h of [{}, cron("short-key"), owner("wrong-admin-key-0000000000"), { ...cron("x".repeat(31)) }]) {
      for (const action of ["sweep", "audit_status"]) {
        const r = await post({ action }, h);
        expect(r.status, `${action} with ${JSON.stringify(h)}`).toBe(401);
      }
    }
    expect(clients).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("an unset ADMIN_API_KEY opens nothing, even to an empty header", async () => {
    env.ADMIN_API_KEY = "";
    expect((await post({ action: "audit_status" }, { "x-admin-key": "" })).status).toBe(401);
    expect(clients).toEqual([]);
  });

  it("a cron key the vault does not hold: 401 after exactly the key check", async () => {
    const r = await post({ action: "sweep" }, cron("d".repeat(64)));
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "The sweep is for the scheduler only." });
    expect(calls).toEqual(["employer_profiles_cron_key_matches"]);
  });

  it("the owner's key does not run the sweep, and the cron's key opens no audit action", async () => {
    expect((await post({ action: "sweep" }, owner())).status).toBe(401);
    expect(calls).toEqual([]);
    for (const action of ["audit_status", "audit_draw", "audit_record", "audit_pause"]) {
      expect((await post({ action, perk: "health" }, cron())).status, action).toBe(401);
    }
    expect(calls).toEqual([]);
  });

  it("an unknown action is a 400 even with a key", async () => {
    expect((await post({ action: "delete_everything" }, owner())).status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe("the sweep, with the vault's key", () => {
  it("leases, reads, stores each board with its finished flag, releases, and logs a run", async () => {
    // One take of 300: board a (2 postings, finished), board b (298, the last
    // board, and the take was filled, so not finished). Then nothing pending.
    takes.push([...[0, 1].map((i) => row("a", i)), ...Array.from({ length: 298 }, (_, i) => row("b", i))]);
    const r = await post({ action: "sweep" }, cron());
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toMatchObject({ ok: true, stoppedBy: "batch", postings: 300, boards: 2, stored: 300, storeErrors: 0, extractorVersion: EXTRACTOR_VERSION });
    expect(j.msPerPosting).toBeGreaterThan(0);
    expect(calls).toEqual(["employer_profiles_cron_key_matches", "employer_profile_lease_take", "employer_perk_sweep_take",
      "employer_perk_store", "employer_perk_store", "employer_profile_lease_release"]);
    const stores = argsOf("employer_perk_store");
    expect(stores.map((s) => [s.p_token, s.p_done, s.p_cursor])).toEqual([["a", true, "greenhouse:a:001"], ["b", false, "greenhouse:b:297"]]);
    const first = (stores[0].p_rows as Array<Record<string, unknown>>)[0];
    expect(first).toMatchObject({ readable: true, franchise: false, agency: false, extractor_version: EXTRACTOR_VERSION });
    expect(Number(first.y) & 1, "health read as offered").toBe(1);
    expect((stores[0].p_lines as Array<{ h: string; line: string }>).every((l) => /^[0-9a-f]{16}$/.test(l.h) && l.line.length <= 200)).toBe(true);
    const take = argsOf("employer_perk_sweep_take")[0];
    expect(take).toEqual({ p_limit: 300, p_version: EXTRACTOR_VERSION, p_budget_ms: 3000 });
    const lease = argsOf("employer_profile_lease_take")[0];
    expect(lease).toMatchObject({ p_name: "sweep", p_seconds: 90 });
    expect(db.rows("employer_profile_runs").map((x) => [x.kind, x.ok, x.postings_read])).toEqual([["sweep", true, 300]]);
    expect(clients).toEqual(["service_harness"]);
  });

  it("an overlapping minute finds the lease held and does nothing", async () => {
    db.rpcs.employer_profile_lease_take = () => { calls.push("employer_profile_lease_take"); return { data: false, error: null }; };
    const j = await (await post({ action: "sweep" }, cron())).json();
    expect(j).toMatchObject({ ok: true, stoppedBy: "lease_held", postings: 0 });
    expect(calls).toEqual(["employer_profiles_cron_key_matches", "employer_profile_lease_take"]);
  });

  it("the pause switch stops it before a single take", async () => {
    db.tables.employer_profile_config[0].sweep_paused = true;
    takes.push([row("a", 0)]);
    const j = await (await post({ action: "sweep" }, cron())).json();
    expect(j.stoppedBy).toBe("paused");
    expect(calls).not.toContain("employer_perk_sweep_take");
    expect(calls).toContain("employer_profile_lease_release");
  });

  it("stops when nothing is pending, and a failed store is skipped while the next board is stored", async () => {
    takes.push([row("a", 0), row("b", 0)]);
    db.rpcs.employer_perk_store = (a) => {
      calls.push("employer_perk_store");
      return a.p_token === "a" ? { data: null, error: { message: "deadlock detected" } } : { data: { stored: 1, refused: 0, lines: 3 }, error: null };
    };
    const r = await post({ action: "sweep" }, cron());
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j).toMatchObject({ ok: true, stoppedBy: "empty", postings: 2, boards: 1, stored: 1, storeErrors: 1 });
    expect(j.note).toMatch(/store a: deadlock detected/);
  });

  it("an unreadable config sweeps nothing and says so", async () => {
    db.tables.employer_profile_config = [];
    const r = await post({ action: "sweep" }, cron());
    expect(r.status).toBe(500);
    expect((await r.json()).note).toMatch(/could not be read/);
    expect(calls).not.toContain("employer_perk_sweep_take");
  });

  it("an unreadable description is stored as unread, never as 'states nothing'", async () => {
    takes.push([row("a", 0, null), row("a", 1, "Too short.")]);
    await post({ action: "sweep" }, cron());
    const rows = argsOf("employer_perk_store")[0].p_rows as Array<Record<string, unknown>>;
    expect(rows.map((x) => [x.readable, x.y, x.q, x.n, x.quote_line_hash])).toEqual([[false, 0, 0, 0, null], [false, 0, 0, 0, null]]);
  });
});

describe("boardsOf: which boards a take finished", () => {
  it("every board but the last is finished; the last only when the take came back short", () => {
    const rows = [row("a", 0), row("a", 1), row("b", 0)];
    expect(boardsOf(rows, 3).map((b) => [b.token, b.rows.length, b.done])).toEqual([["a", 2, true], ["b", 1, false]]);
    expect(boardsOf(rows, 10).map((b) => b.done)).toEqual([true, true]);
    expect(boardsOf([], 10)).toEqual([]);
  });
});

describe("the owner's audit actions", () => {
  it("each answers the owner's key and calls its one function", async () => {
    const cases: Array<[Record<string, unknown>, string, Record<string, unknown>]> = [
      [{ action: "audit_status" }, "employer_perk_audit_status", {}],
      [{ action: "audit_draw", perk: "health" }, "employer_perk_audit_draw", { p_perk: "health", p_rows: 60 }],
      [{ action: "audit_record", perk: "health", mode: "launch", judged: 60, correct: 58, note: "judges A+B, owner spot-checked 10" }, "employer_perk_audit_record",
        { p_perk: "health", p_mode: "launch", p_judged: 60, p_correct: 58, p_note: "judges A+B, owner spot-checked 10" }],
      [{ action: "audit_pause", publish: true }, "employer_profile_set_pause", { p_sweep: null, p_publish: true, p_note: null }],
    ];
    for (const [body, fn, args] of cases) {
      calls = [];
      const r = await post(body, owner());
      expect(r.status, fn).toBe(200);
      expect(calls).toEqual([fn]);
      expect(argsOf(fn).at(-1)).toEqual(args);
    }
  });

  it("checks input before any call: a withheld key, a bad mode, a count that cannot be", async () => {
    for (const body of [
      { action: "audit_draw", perk: "flex" },
      { action: "audit_draw", perk: "health", rows: 0 },
      { action: "audit_record", perk: "health", mode: "publish", judged: 60, correct: 60 },
      { action: "audit_record", perk: "health", mode: "launch", judged: 60, correct: 61 },
      { action: "audit_record", perk: "health", mode: "launch", judged: "60", correct: 57 },
      { action: "audit_pause", publish: "yes" },
    ]) {
      expect((await post(body, owner())).status, JSON.stringify(body)).toBe(400);
    }
    expect(calls).toEqual([]);
  });

  it("a refusal from the database (22023) is a 400 with its reason", async () => {
    db.rpcs.employer_perk_audit_record = () => ({ data: null, error: { code: "22023", message: "not a candidate key: flex can never publish" } });
    const r = await post({ action: "audit_record", perk: "flex", mode: "launch", judged: 60, correct: 60 }, owner());
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/can never publish/);
  });
});

describe("the function's configuration", () => {
  it("verify_jwt is off for employer-profiles, as the cron needs, with its doors named beside it", () => {
    const toml = readFileSync(resolve(__dirname, "../../supabase/config.toml"), "utf8");
    expect(toml).toMatch(/\[functions\.employer-profiles\]\s*\n\s*verify_jwt = false/);
  });
});
