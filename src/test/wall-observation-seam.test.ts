/**
 * THE WALL CENSUS NOW FEEDS THE TABLE IT WAS BUILT FOR.
 *
 * Before 2026-08-10 the pieces existed and did not touch: botwall-sweep
 * measured per-tenant walls weekly and DISCARDED the rows; apply_tenant_walls
 * sat empty; record_tenant_wall had zero callers; tenantSendable() gated
 * nothing because nothing ever wrote what it reads. A census, run on a
 * schedule, feeding nothing — the audit that found it measured ~13,700
 * postings sitting on tenants with no bot wall that the agent could not touch
 * for want of exactly these rows.
 *
 * The seam is the broker, by design: the worker holds no service key
 * (irreversibly, under Lovable Cloud), and record_tenant_wall is
 * service_role-only because a caller who can write here can steer the agent at
 * forms it cannot complete — that hole shipped world-writable once
 * (20260808134902) and stays closed.
 *
 * PROPERTIES UNDER TEST, each of which fails safe:
 *   - the sweep samples by company_token — the table's key — not display name;
 *   - only REACHED tenants become observations (unreachable writes no row);
 *   - the broker refuses a non-boolean verdict rather than coercing it;
 *   - no broker credentials -> a labelled dry run, never a silent success.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const SWEEP = read("worker/src/botwall-sweep.ts");
const BROKER = read("supabase/functions/apply-broker/index.ts");
const WORKFLOW = read(".github/workflows/botwall-sweep.yml");

describe("the sweep's observations can join the table", () => {
  it("samples company_token — apply_tenant_walls' key — not display name", () => {
    expect(SWEEP).toMatch(/select=company_token,company,apply_url/);
    expect(SWEEP).toMatch(/seen\.set\(r\.company_token/);
  });

  it("only a REACHED tenant becomes an observation", () => {
    // The table's founding rule: an unreachable probe writes no row. A goto
    // timeout must never be recorded as either walled or clean.
    expect(SWEEP).toMatch(/if \(reached\) observations\.push\(\{ vendor, token: t\.token, walled: walls\.size > 0/);
  });

  it("persists through the broker's wall action, never directly", () => {
    expect(SWEEP).toMatch(/action: "wall", observations/);
    // No service key, no direct RPC: the sweep must not carry either.
    expect(SWEEP).not.toMatch(/SERVICE_ROLE|record_tenant_wall/);
  });

  it("missing credentials is a LABELLED dry run, not a silent success", () => {
    expect(SWEEP).toMatch(/DRY RUN: \$\{obs\.length\} observations NOT persisted/);
  });

  it("a failed persist surfaces as a workflow warning, not a swallowed catch", () => {
    expect(SWEEP).toMatch(/::warning title=Wall observations not persisted::/);
  });
});

describe("the broker's wall action refuses what the table refuses", () => {
  const wall = (() => {
    const i = BROKER.indexOf('if (action === "wall")');
    expect(i).toBeGreaterThan(-1);
    return BROKER.slice(i, BROKER.indexOf('return json({ ok: true, written, rejected });', i));
  })();

  it("exists and is dispatched", () => {
    expect(BROKER).toMatch(/"claim", "release", "uncertain", "pending", "ping", "wall"/);
  });

  it("refuses a non-boolean verdict instead of coercing it", () => {
    // `walled` arrives from JSON. Coercing undefined/null to false would turn
    // "we could not tell" into "measured clean" — the exact lie the schema's
    // NOT NULL exists to prevent.
    expect(wall).toMatch(/typeof o\.walled !== "boolean"/);
  });

  it("refuses blank vendor or token — a blank token matches every posting", () => {
    expect(wall).toMatch(/if \(!vendor \|\| !token \|\| typeof o\.walled/);
  });

  it("caps a single call", () => {
    expect(wall).toMatch(/raw\.length > 500/);
  });

  it("writes through the service-role RPC with named params", () => {
    expect(wall).toMatch(/client\.rpc\("record_tenant_wall", \{\s*p_vendor: vendor, p_token: token, p_walled: o\.walled, p_walls: walls,\s*\}\)/);
  });

  it("sits behind the same shared-secret gate as every other action", () => {
    // The action must be INSIDE the authenticated body — after the 401 return.
    const authIdx = BROKER.indexOf('return json({ error: "unauthorized"');
    const wallIdx = BROKER.indexOf('if (action === "wall")');
    expect(authIdx).toBeGreaterThan(-1);
    expect(wallIdx).toBeGreaterThan(authIdx);
  });
});

describe("the weekly run can actually persist", () => {
  it("the workflow passes the broker credentials (optional, labelled)", () => {
    expect(WORKFLOW).toMatch(/APPLY_BROKER_URL: \$\{\{ secrets\.APPLY_BROKER_URL \}\}/);
    expect(WORKFLOW).toMatch(/APPLY_WORKER_SECRET: \$\{\{ secrets\.APPLY_WORKER_SECRET \}\}/);
  });

  it("the broker declares a bumped BUILD_VERSION so the deploy is checkable", () => {
    expect(BROKER).toMatch(/const BUILD_VERSION = "2026-08-10\.\d+"/);
  });
});
