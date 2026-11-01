// @vitest-environment node
/**
 * THE BOARDS NAMED AFTER THE DEPLOY ARE RENAMED ON THE NEXT PASS.
 *
 * 2026-10-31: Lovable deployed main f8d72a9b (job-board 2026-09-09.96,
 * NAME_SYNC_VERSION 6) without applying 20261025100000 and 20261026100000,
 * the two files the ledger ordered BEFORE job-board. The name-sync lane ran
 * version 6 at the next pass-end over the overrides that existed then ("name
 * sync v6 complete: 6 renamed, 119 already correct", 19:19:32Z) and stamped
 * job_board_meta name_sync_version {version: 6}. A stamp of the lane's own
 * version keeps it idle for good, so applying the two files now names every
 * new write (trg_company_name_override) and never the stored rows: the 104
 * boards they name keep "parallels wordmark on light" and "PUREHomeRiver
 * Logo@2x (1)" in search, company pages and suggestions.
 *
 * The follow-up is one more migration, applied right after the two: it
 * refuses unless both are applied (their own overrides and evidence, by the
 * facts their self-checks assert), then deletes name_sync_version and
 * name_sync_progress, so job-board .96's next pass-end walks every token
 * again from the first, the new override boards included.
 *
 * Proved here on a real Postgres (pglite, starting from Supabase's default
 * grants), with the lane itself lifted out of job-board/index.ts and run
 * through the PostgREST-shaped client, over the real catalogue.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import * as L from "../../scripts/deploy-ledger.mjs";
import { JOB_SOURCES } from "../../supabase/functions/job-board/sources";
import { nameSyncQueue, nameSyncTarget, overrideFor, overrideTable } from "../../supabase/functions/job-board/name-sync";
import { PgSupabase } from "./helpers/pglite-supabase";
import { codeOf } from "./helpers/strip-comments";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const MIG_DIR = resolve(ROOT, "supabase/migrations");
const STAMP = "20261030100000";
const fileOf = (stamp: string) => readdirSync(MIG_DIR).find((f) => f.startsWith(`${stamp}_`) && f.endsWith(".sql")) ?? "";
const read = (stamp: string) => (fileOf(stamp) ? readFileSync(resolve(MIG_DIR, fileOf(stamp)), "utf8") : "");
const A = read("20261025100000");
const B = read("20261026100000");
const NEW = read(STAMP);

const STR = "'(?:[^']|'')*'";
const lit = (s: string) => s.slice(1, -1).replace(/''/g, "'");
const overridesOf = (sql: string) => {
  const m = new RegExp(`INSERT INTO public\\.company_name_overrides \\(slug, display_name\\) VALUES([\\s\\S]*?)ON CONFLICT`).exec(sql);
  return m ? [...m[1].matchAll(new RegExp(`\\((${STR}),\\s*(${STR})\\)`, "g"))].map((x) => [lit(x[1]), lit(x[2])] as [string, string]) : [];
};
const evidenceSlugsOf = (sql: string) => {
  const m = new RegExp(`INSERT INTO public\\.company_name_evidence \\(slug, display_name, evidence, quote, read_on\\) VALUES([\\s\\S]*?)ON CONFLICT`).exec(sql);
  return m ? [...m[1].matchAll(new RegExp(`\\n  \\((${STR}),\\s*${STR},\\s*ARRAY`, "g"))].map((x) => lit(x[1])) : [];
};
const A_OVERRIDES = overridesOf(A);
const B_OVERRIDES = overridesOf(B);
const B_EVIDENCE = evidenceSlugsOf(B);
const NEW_BOARDS = [...A_OVERRIDES, ...B_OVERRIDES].map(([s]) => s);
const B_BARE = B_EVIDENCE.filter((s) => !s.includes("~")).map((s) => s.slice(s.indexOf(":") + 1));

const PARALLELS = "8a680274-0b2e-46cf-b2cc-49bd2ef0c20f~9201289910657_2";
const PURE = "eea42ed6-3dcf-47f3-b99b-29a304948b2b~9200441095595_2";
const FARRANS = "ejgo~em2~CX_1";

// ── the lane, as shipped ────────────────────────────────────────────────────
const FN = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");
const CODE = codeOf(FN);
const SF = ts.createSourceFile("index.ts", FN, ts.ScriptTarget.ES2022, true);
const constNum = (name: string) => Number(new RegExp(`^const ${name} = ([0-9_]+);`, "m").exec(FN)?.[1].replace(/_/g, "") ?? NaN);
const RENAMED_TOKENS = [...(/const RENAMED_TOKENS: readonly string\[\] = \[([\s\S]*?)\];/.exec(CODE)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
// As index.ts builds it: a token more than one vendor carries.
const SHARED_TOKENS = (() => {
  const seen = new Set<string>(), dup = new Set<string>();
  for (const s of JOB_SOURCES) { if (seen.has(s.token)) dup.add(s.token); else seen.add(s.token); }
  return dup;
})();

/** The name-sync lane: the version read and the `if` it gates, as shipped. */
function laneSource(): string {
  let out = "";
  const visit = (n: ts.Node) => {
    if (out) return;
    if (ts.isBlock(n)) {
      const i = n.statements.findIndex((s) => ts.isIfStatement(s) && s.expression.getText(SF).includes("!== NAME_SYNC_VERSION"));
      if (i > 0) { out = n.statements[i - 1].getFullText(SF) + n.statements[i].getFullText(SF); return; }
    }
    ts.forEachChild(n, visit);
  };
  visit(SF);
  expect(out, "the name-sync lane was not found in job-board/index.ts").not.toBe("");
  return out;
}

function runLane(client: PgSupabase): Promise<{ ok: boolean; detail: string } | undefined> {
  const deps: Record<string, unknown> = {
    client,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    JOB_SOURCES, RENAMED_TOKENS, SHARED_TOKENS,
    NAME_SYNC_VERSION: constNum("NAME_SYNC_VERSION"),
    NAME_SYNC_UNTIL_MS: constNum("NAME_SYNC_UNTIL_MS"),
    sliceWallStart: Date.now(),
    overrideFor, nameSyncTarget, overrideTable, nameSyncQueue,
  };
  const js = ts.transpileModule(`async function __lane() {\n${laneSource()}\n}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const scope = new Proxy(deps, {
    has: (_t, k) => typeof k === "string" && (k in deps || !(k in globalThis)),
    get: (_t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (typeof k === "string" && k in deps) return deps[k];
      throw new Error(`the lane reads \`${String(k)}\`, which this harness does not bind`);
    },
  });
  return new Function("__scope", `with (__scope) { ${js}\n return __lane(); }`)(scope) as Promise<{ ok: boolean; detail: string } | undefined>;
}

// ── production's shape, from Supabase's defaults ─────────────────────────────
const SCHEMA = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  CREATE TABLE public.job_board_meta (k text PRIMARY KEY, v jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.company_name_overrides (slug text PRIMARY KEY, display_name text NOT NULL, added_at timestamptz NOT NULL DEFAULT now());
  ALTER TABLE public.company_name_overrides ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON public.company_name_overrides FROM PUBLIC, anon, authenticated;
  CREATE TABLE public.job_board_postings (id text PRIMARY KEY, source text NOT NULL, company_token text NOT NULL, company text);
  CREATE TABLE public.job_board_closures (event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, source text NOT NULL, company_token text, company text);
  CREATE TABLE public.job_board_company_snapshots (company_token text, snapshot_date date, company text, PRIMARY KEY (company_token, snapshot_date));
  CREATE TABLE public.job_board_closure_rollup (company_token text, company text, category text, month date, PRIMARY KEY (company_token, category, month));
  CREATE OR REPLACE FUNCTION public.apply_company_name_override() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
  CREATE TRIGGER trg_company_name_override BEFORE INSERT OR UPDATE ON public.job_board_postings
    FOR EACH ROW EXECUTE FUNCTION public.apply_company_name_override();
  INSERT INTO public.company_name_overrides (slug, display_name) VALUES ('ms', 'Morgan Stanley');
`;
// What the boards stored before their names existed, and the stamp the lane left at 19:19:32Z.
const STORED = `
  ALTER TABLE public.job_board_postings DISABLE TRIGGER trg_company_name_override;
  INSERT INTO public.job_board_postings (id, source, company_token, company) VALUES
    ('adp:${PARALLELS}:1', 'adp', '${PARALLELS}', 'parallels wordmark on light'),
    ('adp:${PARALLELS}:2', 'adp', '${PARALLELS}', 'parallels wordmark on light'),
    ('adp:${PURE}:1', 'adp', '${PURE}', 'PUREHomeRiver Logo@2x (1)'),
    ('oracle:${FARRANS}:1', 'oracle', '${FARRANS}', 'Farrans Recruitment Team');
  ALTER TABLE public.job_board_postings ENABLE TRIGGER trg_company_name_override;
  INSERT INTO public.job_board_closures (source, company_token, company) VALUES
    ('adp', '${PARALLELS}', 'parallels wordmark on light'), ('oracle', '${FARRANS}', 'Farrans Recruitment Team');
  INSERT INTO public.job_board_company_snapshots VALUES ('${PARALLELS}', '2026-10-30', 'parallels wordmark on light');
  INSERT INTO public.job_board_closure_rollup VALUES ('${PARALLELS}', 'parallels wordmark on light', 'engineering', '2026-10-01');
  INSERT INTO public.job_board_meta (k, v) VALUES
    ('name_sync_version', '{"version": 6, "fixed": 6, "already": 119, "sweptAt": "2026-10-31T19:19:32Z"}'),
    ('refresh', '{"companiesFacet": []}'),
    ('slice_stats', '{"build": "2026-09-09.96"}');
`;
const keys = async (db: PGlite) => (await db.query<{ k: string }>(`SELECT k FROM public.job_board_meta ORDER BY k`)).rows.map((r) => r.k);
const names = async (db: PGlite, table: string, token: string) =>
  (await db.query<{ company: string }>(`SELECT DISTINCT company FROM public.${table} WHERE company_token = $1 ORDER BY 1`, [token])).rows.map((r) => r.company);
const fresh = async () => { const db = new PGlite(); await db.exec(SCHEMA); await db.exec(STORED); return db; };

describe("the file", () => {
  it(`exists as ${STAMP}_the_boards_named_after_the_deploy_are_renamed_on_the_next_pass.sql`, () => {
    expect(fileOf(STAMP)).toBe(`${STAMP}_the_boards_named_after_the_deploy_are_renamed_on_the_next_pass.sql`);
    expect(A_OVERRIDES).toHaveLength(88);
    expect(B_OVERRIDES).toHaveLength(16);
    expect(B_EVIDENCE).toHaveLength(80);
  });

  it("vouches for exactly the boards the two files write: 20261025100000's 88 overrides and 20261026100000's 80 evidence rows", () => {
    const arr = (name: string) => {
      const m = new RegExp(`${name} text\\[\\] := ARRAY\\[([\\s\\S]*?)\\];`).exec(NEW);
      return m ? [...m[1].matchAll(new RegExp(STR, "g"))].map((x) => lit(x[0])) : [];
    };
    expect(arr("v_a").sort()).toEqual(A_OVERRIDES.map(([s]) => s).sort());
    expect(arr("v_b").sort()).toEqual([...B_EVIDENCE].sort());
  });
});

describe("it refuses, deleting nothing, until both name files are applied", () => {
  it("neither applied: it says to apply 20261025100000 and then 20261026100000 first", async () => {
    const db = await fresh();
    await expect(db.exec(NEW)).rejects.toThrow(/Apply 20261025100000 and then 20261026100000, unedited, then this file again/);
    expect(await keys(db)).toEqual(["name_sync_version", "refresh", "slice_stats"]);
    await db.close();
  });

  it("only 20261025100000 applied: it names 20261026100000 as the one missing", async () => {
    const db = await fresh();
    await db.exec(A);
    await expect(db.exec(NEW)).rejects.toThrow(/20261026100000 is not applied[\s\S]*Apply 20261025100000 and then 20261026100000/);
    expect(await keys(db)).toContain("name_sync_version");
    await db.close();
  });

  it("a board's override missing, or naming another employer than its evidence, is refused by name", async () => {
    const db = await fresh();
    await db.exec(A);
    await db.exec(B);
    await db.exec(`DELETE FROM public.company_name_overrides WHERE slug = '${PARALLELS}'`);
    await expect(db.exec(NEW)).rejects.toThrow(new RegExp(`20261025100000 is not applied[\\s\\S]*${PARALLELS.replace(/[~.]/g, "\\$&")}`));
    await db.exec(A);
    await db.exec(`UPDATE public.company_name_overrides SET display_name = 'Farrans Recruitment Team' WHERE slug = '${FARRANS}'`);
    await expect(db.exec(NEW)).rejects.toThrow(new RegExp(`20261026100000 is not applied[\\s\\S]*${FARRANS.replace(/[~.]/g, "\\$&")}`));
    expect(await keys(db)).toContain("name_sync_version");
    await db.close();
  });
});

describe("with both applied, the lane walks every board again and renames the stored rows", () => {
  let db: PGlite;
  let client: PgSupabase;
  beforeAll(async () => {
    db = await fresh();
    client = new PgSupabase(db);
  });
  afterAll(async () => { try { await db.close(); } catch { /* best effort */ } });

  it("the incident: after the two files apply, the stamp keeps the lane idle and the stored rows keep the logo names", async () => {
    await db.exec(A);
    await db.exec(B);
    // The lifted span is the version read and the `if` it gates; a skipped `if` returns nothing, and
    // passEndNames falls through to its "name sync v6 done" line without reading a board.
    const r = await runLane(client);
    expect(r, "the version-6 stamp skipped the walk").toBeUndefined();
    expect(await names(db, "job_board_postings", PARALLELS)).toEqual(["parallels wordmark on light"]);
    expect(await names(db, "job_board_postings", FARRANS)).toEqual(["Farrans Recruitment Team"]);
  });

  it("deletes name_sync_version and name_sync_progress, and nothing else", async () => {
    await db.exec(`INSERT INTO public.job_board_meta (k, v) VALUES ('name_sync_progress', '{"version": 6, "after": "zzzz", "retry": []}')`);
    await db.exec(NEW);
    expect(await keys(db)).toEqual(["refresh", "slice_stats"]);
  });

  it("the next pass's queue starts from the first token and holds every board the two files name", async () => {
    const prog = (await db.query(`SELECT 1 FROM public.job_board_meta WHERE k = 'name_sync_progress'`)).rows;
    expect(prog, "the lane reads no progress, so prior is null").toHaveLength(0);
    const table = overrideTable((await db.query<{ slug: string; display_name: string }>(`SELECT slug, display_name FROM public.company_name_overrides`)).rows);
    const tokens = new Set<string>(RENAMED_TOKENS);
    for (const s of JOB_SOURCES) if (overrideFor(s.token, table) !== null) tokens.add(s.token);
    const q = nameSyncQueue([...tokens], null, constNum("NAME_SYNC_VERSION"));
    expect(q.resumeAfter).toBe("");
    const inQueue = new Set(q.tokens);
    // Every override slug is a catalogue token the lane reaches by exact key (none is a Workday tenant key).
    for (const slug of NEW_BOARDS) {
      expect(slug, slug).toContain("~");
      expect(JOB_SOURCES.some((s) => s.token === slug), `${slug} is no catalogue token`).toBe(true);
      expect(inQueue.has(slug), `${slug} is not in the lane's queue`).toBe(true);
    }
    for (const t of B_BARE) expect(inQueue.has(t), `${t} (a catalogue rename) is not in the lane's queue`).toBe(true);
    // A progress row left behind would have resumed past all of them.
    const stale = nameSyncQueue([...tokens], { version: constNum("NAME_SYNC_VERSION"), after: q.tokens[q.tokens.length - 1], retry: [] }, constNum("NAME_SYNC_VERSION"));
    expect(stale.tokens).toEqual([]);
  });

  it("the next pass-end renames the postings, closures, snapshots and closure rollup, and stamps version 6 again", async () => {
    const r = await runLane(client);
    expect(r?.ok, r?.detail).toBe(true);
    expect(r?.detail).toMatch(/complete: [1-9]\d* renamed/);
    for (const t of ["job_board_postings", "job_board_closures", "job_board_company_snapshots", "job_board_closure_rollup"]) {
      expect(await names(db, t, PARALLELS), t).toEqual(["Parallels"]);
    }
    expect(await names(db, "job_board_postings", PURE)).toEqual(["PURE HomeRiver"]);
    expect(await names(db, "job_board_postings", FARRANS)).toEqual(["Farrans"]);
    expect(await names(db, "job_board_closures", FARRANS)).toEqual(["Farrans"]);
    const v = (await db.query<{ v: { version: number } }>(`SELECT v FROM public.job_board_meta WHERE k = 'name_sync_version'`)).rows[0]?.v;
    expect(v?.version).toBe(constNum("NAME_SYNC_VERSION"));
  });

  it("is safe to run again: it re-arms the lane once more, and the walk finds every board already named", async () => {
    await db.exec(NEW);
    expect(await keys(db)).toEqual(["refresh", "slice_stats"]);
    await db.exec(NEW);
    const r = await runLane(client);
    expect(r?.detail).toMatch(/complete: 0 renamed/);
    expect(await names(db, "job_board_postings", PARALLELS)).toEqual(["Parallels"]);
  });

  it("its self-check fails while either key survives", async () => {
    const selfCheck = /DO \$\$[\s\S]*?\$\$;/.exec(NEW.slice(NEW.lastIndexOf("-- SELF-CHECK")))?.[0] ?? "";
    expect(selfCheck).toMatch(/RAISE EXCEPTION/);
    await expect(db.exec(selfCheck)).rejects.toThrow(new RegExp(`self-check ${STAMP}`));
    await db.exec(`DELETE FROM public.job_board_meta WHERE k = 'name_sync_version'`);
    await db.exec(`INSERT INTO public.job_board_meta (k, v) VALUES ('name_sync_progress', '{"version": 6, "after": "a"}')`);
    await expect(db.exec(selfCheck)).rejects.toThrow(new RegExp(`self-check ${STAMP}`));
  });
});

describe("the deploy order", () => {
  const policy = JSON.parse(readFileSync(resolve(ROOT, "docs/deploy-ledger.json"), "utf8"));
  const rows = [{ fn: "job-board", want: "job-board.2026-09-09.96", have: "job-board.2026-09-09.96", state: "live" }];

  it("the ledger rule orders it after the two files and nothing else: no function, no frontend", () => {
    const rule = policy.migrationOrder[STAMP];
    expect(rule?.afterMigrations).toEqual(["20261025100000", "20261026100000"]);
    expect(rule?.after).toBeUndefined();
    expect(rule?.before).toBeUndefined();
  });

  it("with job-board .96 live, the message lists the two files and then this one, in one step, before nothing", () => {
    const files = ["20261025100000", "20261026100000", STAMP].map(fileOf);
    const p = L.migrationPhases(files, policy, rows);
    expect(p.errors).toEqual([]);
    expect(p.pre.map((m: { file: string }) => m.file)).toEqual(files);
    expect(p.pre[2].note).toBe("after 20261025100000 and 20261026100000; it waits for nothing else");
    expect(p.afterFunctions).toEqual([]);
    expect(p.afterFrontend).toEqual([]);
  });
});
