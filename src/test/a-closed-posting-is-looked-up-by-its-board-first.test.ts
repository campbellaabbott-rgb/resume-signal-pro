// @vitest-environment node
/**
 * S11-024: job_board_closures (~5M rows, ~10k more a day) has no posting_id
 * index. The detail dead-link lookup and get_application_lifecycle looked
 * closures up by posting_id alone, so an unknown id took 7.0 s cold and
 * 1.5 s warm on the live board, and every Account load read the whole ledger
 * inside the lifecycle function's 10 s. A posting id is source:token:native,
 * so both now reach job_board_closures_curve_idx (company_token, closed_at
 * DESC) through the token.
 *
 * Run in pglite with the ledger's real index set and sequential scans priced
 * out (enable_seqscan = off): a query that has an index to use uses it, and a
 * query that has none still plans a Seq Scan, which is the defect.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { PgSupabase } from "./helpers/pglite-supabase";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const FN = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");
const LIFECYCLE = readFileSync(resolve(ROOT, "supabase/migrations/20261009131000_a_tracker_row_reads_the_closure_log_by_the_day_and_a_free_account_has_bounds.sql"), "utf8");

const SCHEMA = `
  CREATE TABLE public.job_board_closures (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    posting_id text, source text, company_token text NOT NULL, company text, title text, category text NOT NULL DEFAULT '',
    first_seen timestamptz, posted_at timestamptz, closed_at timestamptz NOT NULL, superseded boolean NOT NULL DEFAULT false,
    suspect boolean NOT NULL DEFAULT false, batch_live_before integer, absence_basis text);
  -- The ledger's index set, as the migrations leave it (20260906090000 and earlier).
  CREATE INDEX job_board_closures_closed_at_idx ON public.job_board_closures (closed_at);
  CREATE INDEX job_board_closures_curve_idx ON public.job_board_closures (company_token, closed_at DESC)
    INCLUDE (posted_at, superseded, suspect, batch_live_before, category);
  CREATE INDEX job_board_closures_category_curve_idx ON public.job_board_closures (category, closed_at DESC);
  INSERT INTO public.job_board_closures (posting_id, source, company_token, company, title, closed_at)
    SELECT 'greenhouse:board' || (g % 50) || ':' || g, 'greenhouse', 'board' || (g % 50), 'Board', 'Role', now() - (g || ' minutes')::interval
      FROM generate_series(1, 5000) g;
  ANALYZE public.job_board_closures;
`;

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
});

async function plan(sql: string, params: unknown[] = []): Promise<string> {
  await db.exec("SET enable_seqscan = off");
  try {
    const { rows } = await db.query<{ "QUERY PLAN": string }>(`EXPLAIN ${sql}`, params);
    return rows.map((r) => r["QUERY PLAN"]).join("\n");
  } finally {
    await db.exec("RESET enable_seqscan");
  }
}

/** The detail action's closure lookup, lifted from job-board/index.ts and run through a PostgREST-shaped client; returns the SQL it sent. */
async function detailLookupSql(token: string, id: string): Promise<{ sql: string; params: unknown[] }> {
  const sf = ts.createSourceFile("index.ts", FN, ts.ScriptTarget.ES2022, true);
  let stmt = "";
  const visit = (n: ts.Node) => {
    if (stmt) return;
    if (ts.isVariableStatement(n)) {
      const t = n.getText(sf);
      if (t.includes('from("job_board_closures")') && t.includes('"title, company, closed_at"')) { stmt = t; return; }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  expect(stmt, "the detail action's closure lookup was not found").not.toBe("");
  const js = ts.transpileModule(`async function __lookup(client, token, id) { ${stmt}\n return closure; }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const client = new PgSupabase(db);
  const sent: Array<{ sql: string; params: unknown[] }> = [];
  const run = client.run.bind(client);
  client.run = async (sql: string, params: unknown[] = []) => { sent.push({ sql, params: [...params] }); return run(sql, params); };
  const lookup = new Function(`${js}\n return __lookup;`)() as (c: unknown, t: string, i: string) => Promise<unknown>;
  await lookup(client, token, id);
  const q = sent.find((s) => /job_board_closures/.test(s.sql));
  expect(q, "the lookup sent no query to job_board_closures").toBeTruthy();
  return q!;
}

/** The lifecycle function's closure CTE, as the migration ships it. */
function lifecycleClosureCte(): string {
  const at = LIFECYCLE.indexOf("  cl AS (");
  expect(at, "get_application_lifecycle's cl CTE was not found").toBeGreaterThan(0);
  let depth = 0;
  for (let j = LIFECYCLE.indexOf("(", at); j < LIFECYCLE.length; j++) {
    if (LIFECYCLE[j] === "(") depth++;
    else if (LIFECYCLE[j] === ")" && --depth === 0) return LIFECYCLE.slice(LIFECYCLE.indexOf("(", at) + 1, j);
  }
  throw new Error("unbalanced cl CTE");
}

describe("a closed posting is looked up by its board first (S11-024)", () => {
  it("control: a lookup by posting id alone has no index to use", async () => {
    const p = await plan(`SELECT title FROM public.job_board_closures WHERE posting_id = $1 ORDER BY closed_at DESC LIMIT 1`, ["greenhouse:board7:nope"]);
    // Either a sequential read or a walk of the whole closed_at index with the id as a filter.
    expect(p).toMatch(/Seq Scan on job_board_closures|Index Scan Backward using job_board_closures_closed_at_idx/);
    expect(p).not.toMatch(/Index Cond: \(company_token = /);
  });

  it("the detail action's dead-link lookup reaches the curve index through the token", async () => {
    const q = await detailLookupSql("board7", "greenhouse:board7:nope");
    const p = await plan(q.sql.replace(/\s+RETURNING \*$/, ""), q.params);
    expect(p, `the detail lookup reads the ledger without the board's index:\n${p}`).toMatch(/(?:using|Bitmap Index Scan on) job_board_closures_curve_idx/);
    expect(p).toMatch(/Index Cond: \(company_token = /);
    expect(p).not.toMatch(/Seq Scan on job_board_closures/);
  });

  it("get_application_lifecycle's closure read reaches the curve index through each posting's token", async () => {
    const p = await plan(
      `WITH ids AS (SELECT DISTINCT x AS jid FROM unnest($1::text[]) AS x) SELECT * FROM (${lifecycleClosureCte()}) cl`,
      [["greenhouse:board7:7", "greenhouse:board9:nope"]],
    );
    expect(p, `the lifecycle read scans the whole ledger:\n${p}`).toMatch(/(?:using|Bitmap Index Scan on) job_board_closures_curve_idx/);
    expect(p).toMatch(/Index Cond: \(company_token = /);
    expect(p).not.toMatch(/Seq Scan on job_board_closures/);
  });

  it("and still finds the closure it is asked about", async () => {
    const { rows } = await db.query<{ posting_id: string }>(
      `WITH ids AS (SELECT DISTINCT x AS jid FROM unnest($1::text[]) AS x) SELECT posting_id FROM (${lifecycleClosureCte()}) cl ORDER BY 1`,
      [["greenhouse:board7:7", "greenhouse:board9:nope"]],
    );
    expect(rows.map((r) => r.posting_id)).toEqual(["greenhouse:board7:7"]);
  });
});
