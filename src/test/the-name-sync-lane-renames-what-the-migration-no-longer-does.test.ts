// @vitest-environment node
/**
 * S11-133 / S11-135: wave 3's employer-name migration renamed about 80,800
 * stored postings, their closures and snapshots on 216 boards in ONE
 * transaction, and its all-postings self-verify could roll it back if ingest
 * inserted a row meanwhile. The migration now adds only the names and the
 * trigger change; job-board's name-sync lane (NAME_SYNC_VERSION 4) renames the
 * stored rows a board at a time, by the trigger's own precedence over
 * company_name_overrides, into the closure rollup too.
 *
 * The lane is lifted out of job-board/index.ts with the TypeScript parser and
 * RUN against a real Postgres (pglite) holding the migrations' trigger and
 * overrides, through the PostgREST-shaped client the agent tests use.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { PgSupabase } from "./helpers/pglite-supabase";
import { nameSyncTarget, overrideFor, overrideTable } from "../../supabase/functions/job-board/name-sync";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const FN = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");
const MIG = (f: string) => readFileSync(resolve(ROOT, "supabase/migrations", f), "utf8");
const NAMES = MIG("20261009100100_an_employer_named_by_its_system_code_gets_the_name_it_uses.sql");
const COLLISIONS = MIG("20261009100600_an_employer_name_never_doubles_as_another_employers.sql");
const SF = ts.createSourceFile("index.ts", FN, ts.ScriptTarget.ES2022, true);
const constNum = (name: string) => Number(new RegExp(`^const ${name} = ([0-9_]+);`, "m").exec(FN)?.[1].replace(/_/g, "") ?? NaN);

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

function runLane(deps: Record<string, unknown>): Promise<unknown> {
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
  return new Function("__scope", `with (__scope) { ${js}\n return __lane(); }`)(scope) as Promise<unknown>;
}

const SCHEMA = `
  CREATE TABLE public.job_board_meta (k text PRIMARY KEY, v jsonb, updated_at timestamptz);
  CREATE TABLE public.company_name_overrides (slug text PRIMARY KEY, display_name text NOT NULL, added_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.job_board_postings (id text PRIMARY KEY, source text NOT NULL, company_token text NOT NULL, company text);
  CREATE TABLE public.job_board_closures (event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, source text NOT NULL, company_token text, company text);
  CREATE TABLE public.job_board_company_snapshots (company_token text, snapshot_date date, company text, PRIMARY KEY (company_token, snapshot_date));
  CREATE TABLE public.job_board_closure_rollup (company_token text, company text, category text, month date, PRIMARY KEY (company_token, category, month));
  CREATE OR REPLACE FUNCTION public.apply_company_name_override() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
  CREATE TRIGGER trg_company_name_override BEFORE INSERT OR UPDATE ON public.job_board_postings
    FOR EACH ROW EXECUTE FUNCTION public.apply_company_name_override();
  -- July's names, as production holds them.
  INSERT INTO public.company_name_overrides (slug, display_name) VALUES ('nvidia', 'NVIDIA'), ('cc', 'Chanel'), ('flextronics', 'Flex'), ('spectrumhealth', 'Spectrum Health');
`;
// Stored before the names (trigger off, as history was).
const STORED = `
  ALTER TABLE public.job_board_postings DISABLE TRIGGER trg_company_name_override;
  INSERT INTO public.job_board_postings (id, source, company_token, company) VALUES
    ('workday:ms~wd5~external:1', 'workday', 'ms~wd5~external', 'Ms'),
    ('workday:ms~wd5~external:2', 'workday', 'ms~wd5~external', 'Ms'),
    ('workday:flextronics~wd1~Careers:1', 'workday', 'flextronics~wd1~Careers', 'Flex'),
    ('greenhouse:flex:1', 'greenhouse', 'flex', 'Flex'),
    ('greenhouse:cc:1', 'greenhouse', 'cc', 'Climate Corps'),
    ('greenhouse:acme:1', 'greenhouse', 'acme', 'Acme'),
    ('lever:acme:1', 'lever', 'acme', 'Acme Labs Old');
  ALTER TABLE public.job_board_postings ENABLE TRIGGER trg_company_name_override;
  INSERT INTO public.job_board_closures (source, company_token, company) VALUES
    ('workday', 'ms~wd5~external', 'Ms'), ('workday', 'clarioclinical~wd1~clarioclinical_careers', 'Clarioclinical'),
    ('workday', 'flextronics~wd1~Careers', 'Flex'), ('greenhouse', 'flex', 'Flex'),
    ('greenhouse', 'acme', 'Acme'), ('lever', 'acme', 'Acme Labs Old');
  INSERT INTO public.job_board_company_snapshots VALUES ('ms~wd5~external', '2026-10-07', 'Ms'), ('acme', '2026-10-07', 'Acme');
  INSERT INTO public.job_board_closure_rollup VALUES
    ('ms~wd5~external', 'Ms', 'finance', '2026-08-01'), ('flextronics~wd1~Careers', 'Flex', 'operations', '2026-09-01'),
    ('flex', 'Flex', 'sales', '2026-09-01'), ('acme', 'Acme', 'other', '2026-09-01');
`;

const JOB_SOURCES = [
  { source: "workday", token: "ms~wd5~external", name: "Ms" },
  { source: "workday", token: "clarioclinical~wd1~clarioclinical_careers", name: "Clarioclinical" },
  { source: "workday", token: "flextronics~wd1~Careers", name: "Flextronics" },
  { source: "greenhouse", token: "flex", name: "Flex" },
  { source: "greenhouse", token: "cc", name: "Climate Corps" },
  { source: "greenhouse", token: "acme", name: "Acme Corp" },
  { source: "lever", token: "acme", name: "Acme Labs" },
];

let db: PGlite;
let client: PgSupabase;
beforeEach(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(STORED);
  await db.exec(NAMES);
  await db.exec(COLLISIONS);
  client = new PgSupabase(db);
});

const names = async (table: string, token: string, source?: string) =>
  (await db.query<{ company: string }>(
    `SELECT DISTINCT company FROM public.${table} WHERE company_token = $1${source ? " AND source = $2" : ""} ORDER BY 1`,
    source ? [token, source] : [token],
  )).rows.map((r) => r.company);

const deps = (over: Record<string, unknown> = {}) => ({
  client,
  console: { log: () => {}, warn: () => {}, error: () => {} },
  JOB_SOURCES,
  RENAMED_TOKENS: ["acme"],
  SHARED_TOKENS: new Set(["acme"]),
  NAME_SYNC_VERSION: constNum("NAME_SYNC_VERSION"),
  NAME_SYNC_UNTIL_MS: constNum("NAME_SYNC_UNTIL_MS"),
  sliceWallStart: Date.now(),
  overrideFor,
  nameSyncTarget,
  overrideTable,
  ...over,
});

describe("20261009100100 leaves the stored rows to the lane (S11-133)", () => {
  it("the migration no longer rewrites a named board's stored rows in its own transaction", async () => {
    expect(await names("job_board_postings", "ms~wd5~external")).toEqual(["Ms"]);
    expect(await names("job_board_closures", "ms~wd5~external")).toEqual(["Ms"]);
    expect(await names("job_board_company_snapshots", "ms~wd5~external")).toEqual(["Ms"]);
  });

  it("but every later write takes the name, through the trigger", async () => {
    await db.exec(`INSERT INTO public.job_board_postings (id, source, company_token, company) VALUES ('workday:ms~wd5~external:9', 'workday', 'ms~wd5~external', 'Ms')`);
    expect((await db.query<{ company: string }>(`SELECT company FROM public.job_board_postings WHERE id = 'workday:ms~wd5~external:9'`)).rows[0].company).toBe("Morgan Stanley");
  });
});

describe("the name-sync lane renames them, a board at a time (S11-133, S11-135)", () => {
  it("renames a named board's postings, closures, snapshots and closure rollup, and stamps its version", async () => {
    await runLane(deps());
    for (const t of ["job_board_postings", "job_board_closures", "job_board_company_snapshots", "job_board_closure_rollup"]) {
      expect(await names(t, "ms~wd5~external"), t).toEqual(["Morgan Stanley"]);
    }
    expect(await names("job_board_closures", "clarioclinical~wd1~clarioclinical_careers")).toEqual(["Clario (eResearch Technology)"]);
    const v = (await db.query<{ v: { version: number } }>(`SELECT v FROM public.job_board_meta WHERE k = 'name_sync_version'`)).rows[0]?.v;
    expect(v?.version).toBe(constNum("NAME_SYNC_VERSION"));
  });

  it("an override no longer hands one employer another's name, and the employer it named keeps its own", async () => {
    await runLane(deps());
    for (const t of ["job_board_postings", "job_board_closures", "job_board_closure_rollup"]) {
      expect(await names(t, "flextronics~wd1~Careers"), t).toEqual(["Flex Ltd."]);
      expect(await names(t, "flex"), t).toEqual(["Flex"]);
    }
    expect(await names("job_board_postings", "cc"), "a bare token is never a tenant slug").toEqual(["Climate Corps"]);
  });

  it("each board on a shared token takes its own vendor's name, and the token-keyed tables are left alone", async () => {
    await runLane(deps());
    expect(await names("job_board_postings", "acme", "greenhouse")).toEqual(["Acme Corp"]);
    expect(await names("job_board_postings", "acme", "lever")).toEqual(["Acme Labs"]);
    expect(await names("job_board_closures", "acme", "lever")).toEqual(["Acme Labs"]);
    expect(await names("job_board_company_snapshots", "acme")).toEqual(["Acme"]);
    expect(await names("job_board_closure_rollup", "acme")).toEqual(["Acme"]);
  });

  it("stops on its clock without stamping, and the next run finishes the job", async () => {
    await runLane(deps({ sliceWallStart: Date.now() - constNum("NAME_SYNC_UNTIL_MS") - 1_000 }));
    expect(await names("job_board_postings", "ms~wd5~external"), "a lane past its clock renamed a board").toEqual(["Ms"]);
    expect((await db.query(`SELECT 1 FROM public.job_board_meta WHERE k = 'name_sync_version'`)).rows, "a lane the clock stopped stamped itself done").toHaveLength(0);
    await runLane(deps());
    expect(await names("job_board_postings", "ms~wd5~external")).toEqual(["Morgan Stanley"]);
  });
});
