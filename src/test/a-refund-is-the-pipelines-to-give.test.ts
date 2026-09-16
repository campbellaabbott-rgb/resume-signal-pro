import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// The refund trigger on agent_submissions runs as definer and fires on the
// status shapes the pipeline writes. A row's owner may write status through
// RLS too — the account panels do — so without a gate on WHO wrote the row,
// one browser session could cycle a submission through the refund shape and
// reset a paid counter to zero (adversarial review A-1, 2026-09-16). Two
// properties close the two legs, and both are pinned on the definition that
// WINS (last by filename), so a re-emitted earlier copy cannot outrank them:
//
//   1. the refund function reads the request's JWT role and gives nothing
//      back for the owner's own role or anon, BEFORE it touches a pass;
//   2. the owner's UPDATE grant on agent_queue and agent_submissions is a
//      column list — the decision columns the panels write — and never
//      names pass_id or pass_refunded_at; a REVOKE precedes it in the file.
//
// Properties over comment-stripped SQL; the teeth prove each on a copy.

const DIR = resolve(__dirname, "../../supabase/migrations");
const files = () => readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const readMig = (f: string) => readFileSync(resolve(DIR, f), "utf8");
const bare = (s: string) => s.replace(/--[^\n]*/g, "");

function effectiveDefinition(fnName: string): { file: string; sql: string } {
  const hits = files().filter((f) => readMig(f).includes(`FUNCTION public.${fnName}(`));
  if (hits.length === 0) throw new Error(`no migration defines ${fnName}`);
  const file = hits[hits.length - 1];
  return { file, sql: readMig(file) };
}

/** The body of the function between the first AS $$ and its closing $$. */
function bodyOf(sql: string): string {
  const a = sql.indexOf("AS $$");
  const b = sql.indexOf("$$;", a + 5);
  if (a < 0 || b < 0) throw new Error("no $$ body");
  return sql.slice(a + 5, b);
}

/** What the role gate must look like, as properties of the body, not a spelling. */
function roleGateReport(body: string): string[] {
  const out: string[] = [];
  const gate = /current_setting\(\s*'request\.jwt\.claims'/.exec(body);
  if (!gate) out.push("no read of request.jwt.claims");
  const legacy = /current_setting\(\s*'request\.jwt\.claim\.role'/.exec(body);
  if (!legacy) out.push("no fallback read of request.jwt.claim.role");
  const refuse = /IN\s*\(\s*'authenticated'\s*,\s*'anon'\s*\)\s*THEN\s*RETURN NULL/.exec(body)
    ?? /IN\s*\(\s*'anon'\s*,\s*'authenticated'\s*\)\s*THEN\s*RETURN NULL/.exec(body);
  if (!refuse) out.push("no RETURN NULL for the authenticated/anon roles");
  const firstWrite = body.indexOf("UPDATE public.agent_passes");
  if (firstWrite < 0) out.push("no write to agent_passes");
  if (gate && firstWrite >= 0 && gate.index > firstWrite) out.push("the role is read after the pass is written");
  if (refuse && firstWrite >= 0 && refuse.index > firstWrite) out.push("the refusal sits after the pass is written");
  return out;
}

/** The winning UPDATE grant to authenticated on a table, and whether a REVOKE UPDATE precedes it in that file. */
function ownerUpdateGrant(table: string): { file: string; columns: string[] | null; revokedFirst: boolean } {
  const grantRe = new RegExp(`GRANT\\s+([^;]*?)\\s+ON\\s+public\\.${table}\\s+TO\\s+([^;]*);`, "g");
  let last: { file: string; columns: string[] | null; revokedFirst: boolean } | null = null;
  for (const f of files()) {
    const code = bare(readMig(f));
    for (const m of code.matchAll(grantRe)) {
      const privs = m[1];
      const grantees = m[2];
      if (!/\bauthenticated\b/.test(grantees)) continue;
      if (!/\bUPDATE\b|\bALL\b/.test(privs)) continue;
      const cols = /UPDATE\s*\(([^)]*)\)/.exec(privs);
      const columns = cols ? cols[1].split(",").map((c) => c.trim()).filter(Boolean) : null;
      const revoke = new RegExp(`REVOKE\\s+(?:UPDATE|ALL)[^;]*ON\\s+public\\.${table}\\s+FROM\\s+[^;]*\\bauthenticated\\b`).exec(code);
      last = { file: f, columns, revokedFirst: !!revoke && revoke.index < m.index! };
    }
  }
  if (!last) throw new Error(`no UPDATE grant to authenticated on ${table}`);
  return last;
}

const PAID_FOR_COLUMNS = ["pass_id", "pass_refunded_at"];

describe("agent_pass_refund_on_failure refunds only for the pipeline's role, on the winning definition", () => {
  const { file, sql } = effectiveDefinition("agent_pass_refund_on_failure");
  const body = bodyOf(bare(sql));

  it(`the winning definition is a real file (${file})`, () => {
    expect(file).toMatch(/^\d{14}_/);
  });

  it("reads the request's JWT role and returns before any pass is touched when it is authenticated or anon", () => {
    expect(roleGateReport(body)).toEqual([]);
  });

  it("keeps the shapes 150000 defined — the gate is who, not what", () => {
    expect(body).toMatch(/NEW\.status = 'stale'/);
    expect(body).toMatch(/NEW\.status = 'blocked' AND \(NEW\.attempts >= 99 OR coalesce\(NEW\.error, ''\) <> ''\)/);
    expect(body).toMatch(/greatest\(ap\.applications_used - 1, 0\)/);
  });

  it("never reads current_user for the decision — inside a definer function that is the definer", () => {
    expect(body).not.toMatch(/\bcurrent_user\b|\bsession_user\b/);
  });
});

describe("an owner may decide a row but never who paid for it", () => {
  for (const [table, mustHave] of [
    ["agent_queue", ["status", "decided_at"]],
    ["agent_submissions", ["status", "submitted_at", "submitted_via", "attempts", "claimed_at", "claimed_by"]],
  ] as const) {
    it(`${table}: the winning UPDATE grant to authenticated is a column list, revoked first, without the paid-for columns`, () => {
      const g = ownerUpdateGrant(table);
      expect(g.columns, `${g.file} grants whole-row UPDATE`).not.toBeNull();
      expect(g.revokedFirst, `${g.file} grants without a preceding REVOKE — a GRANT never restricts`).toBe(true);
      for (const c of PAID_FOR_COLUMNS) expect(g.columns).not.toContain(c);
      for (const c of mustHave) expect(g.columns, `the panels write ${c}`).toContain(c);
    });
  }

  it("the panels write only columns the grant names", () => {
    const root = resolve(__dirname, "../..");
    const src = (p: string) => readFileSync(resolve(root, p), "utf8");
    const subs = ownerUpdateGrant("agent_submissions").columns ?? [];
    const queue = ownerUpdateGrant("agent_queue").columns ?? [];
    const written = (code: string, table: string): string[] => {
      const out: string[] = [];
      const re = new RegExp(`from\\("${table}"\\)\\s*\\.update\\(\\{([^}]*)\\}`, "g");
      for (const m of code.matchAll(re)) {
        for (const kv of m[1].split(",")) {
          const k = kv.split(":")[0].trim();
          if (/^[a-z_]+$/.test(k)) out.push(k);
        }
      }
      return out;
    };
    const panel = src("src/components/account/ApplyQueuePanel.tsx");
    const morning = src("src/components/account/MorningQueuePanel.tsx");
    const subWrites = written(panel, "agent_submissions");
    const queueWrites = written(morning, "agent_queue");
    expect(subWrites.length).toBeGreaterThan(0);
    expect(queueWrites.length).toBeGreaterThan(0);
    for (const c of subWrites) expect(subs, `ApplyQueuePanel writes ${c}`).toContain(c);
    for (const c of queueWrites) expect(queue, `MorningQueuePanel writes ${c}`).toContain(c);
  });
});

describe("teeth", () => {
  const { sql } = effectiveDefinition("agent_pass_refund_on_failure");
  const body = bodyOf(bare(sql));

  it("a copy without the role gate is reported", () => {
    const gone = body.replace(/IF v_role IN \('authenticated', 'anon'\) THEN\s*RETURN NULL;\s*END IF;/, "");
    expect(gone).not.toBe(body);
    expect(roleGateReport(gone)).toContain("no RETURN NULL for the authenticated/anon roles");
  });

  it("a copy that reads the role only after writing the pass is reported", () => {
    const gateBlock = /v_role := coalesce\([\s\S]*?END IF;\n/.exec(body)![0];
    const moved = body.replace(gateBlock, "") .replace(/RETURN NULL;\nEND/, gateBlock + "RETURN NULL;\nEND");
    expect(moved).not.toBe(body);
    expect(roleGateReport(moved)).toContain("the role is read after the pass is written");
  });

  it("a copy that gates on current_user instead of the claims is reported", () => {
    const swapped = body.replace(/current_setting\('request\.jwt\.claims', true\)/, "current_user");
    expect(swapped).not.toBe(body);
    expect(roleGateReport(swapped)).toContain("no read of request.jwt.claims");
  });

  it("the grant reader sees a whole-row grant as null columns and a missing REVOKE as not revoked first", () => {
    // Simulate by parsing text through the same regexes the reader uses.
    const grantRe = /GRANT\s+([^;]*?)\s+ON\s+public\.agent_queue\s+TO\s+([^;]*);/;
    const whole = grantRe.exec("GRANT SELECT, UPDATE ON public.agent_queue TO authenticated;")!;
    expect(/UPDATE\s*\(([^)]*)\)/.exec(whole[1])).toBeNull();
    const cols = grantRe.exec("GRANT UPDATE (status, decided_at, pass_id) ON public.agent_queue TO authenticated;")!;
    const list = /UPDATE\s*\(([^)]*)\)/.exec(cols[1])![1].split(",").map((c) => c.trim());
    expect(list).toContain("pass_id");
  });
});
