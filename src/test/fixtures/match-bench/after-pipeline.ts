/**
 * THE AFTER PIPELINE, OFFLINE: résumé-match's own code against the frozen corpus.
 *
 * What runs is the engine itself: `readProfile` (_shared/resume-profile.ts)
 * reads each dev résumé's parsed PDF text, and `runMatch`
 * (resume-match/pipeline.ts) does everything after that: title family, ring,
 * the one match_candidates statement and at most one widening statement,
 * placing and gating, requirements for the top 40, tiers, order, collapse and
 * the employer cap. Only the database is replaced, by a client that answers:
 *
 *   rpc("match_candidates")  the migration's REAL plpgsql, executed in pglite
 *                            over the corpus loaded into a job_board_postings
 *                            table whose title_tsv and effective_posted are the
 *                            generated columns production declares;
 *   rpc("metro_ring")        rings.ts (the bench has no GeoNames table);
 *   from("job_board_postings").select("id, description, min_years")
 *                            the corpus descriptions (a row nobody read has none,
 *                            so the engine marks it "requirements not read");
 *   from("job_posting_requirements")  an empty cache; writes are dropped.
 *
 * DETERMINISM. The engine's clock is held at zero, so its "is there time left"
 * branches (one automatic widening step, requirements before 1.9 s) always
 * take the same arm; its real-time deadlines still run, so pglite is warmed
 * first and a run that misses one is repeated once and then reported as
 * machine load, never as a P@10 regression. Nothing here touches the network.
 *
 * THE CONTRACT WITH THE ENGINE (everything the bench imports from it):
 *   _shared/resume-profile.ts   readProfile(text, { nowYear }) -> MatchProfile
 *   resume-match/pipeline.ts    runMatch(client, MatchInput, RunOptions) -> { rows: [{ id }], ... }
 *   supabase/migrations/*       one file that CREATEs public.match_candidates
 * plus the other spec-§18 modules, which must be present for the gate to run.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadCorpus, type Corpus } from "./corpus.ts";
import { RESUMES } from "./dev/manifest.ts";
import { ringFor } from "./rings.ts";
import type { ResumeTruth } from "./types.ts";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

/** Spec §18's phase-0 modules, plus the file runMatch lives in. */
export const ENGINE_FILES = [
  "supabase/functions/_shared/resume-profile.ts",
  "supabase/functions/_shared/title-families.ts",
  "supabase/functions/_shared/posting-requirements.ts",
  "supabase/functions/_shared/match-tiers.ts",
  "supabase/functions/_shared/licence-rules.ts",
  "supabase/functions/resume-match/index.ts",
  "supabase/functions/resume-match/pipeline.ts",
] as const;

const stripSql = (sql: string) => sql.replace(/--[^\n]*/g, "");
const sqlFiles = (root: string) => {
  const dir = join(root, "supabase", "migrations");
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".sql")).sort() : [];
};
/** The latest migration that creates public.match_candidates, or null. */
export function matchCandidatesMigration(root = REPO_ROOT): string | null {
  const hit = sqlFiles(root).filter((f) => /CREATE (OR REPLACE )?FUNCTION public\.match_candidates\(/.test(stripSql(readFileSync(join(root, "supabase", "migrations", f), "utf8"))));
  return hit.length ? join(root, "supabase", "migrations", hit.at(-1)!) : null;
}

export interface EngineState { present: string[]; missing: string[]; migration: string | null }
export function engineState(root = REPO_ROOT): EngineState {
  const present = ENGINE_FILES.filter((f) => existsSync(join(root, f)));
  const missing = ENGINE_FILES.filter((f) => !existsSync(join(root, f)));
  return { present: [...present], missing: [...missing], migration: matchCandidatesMigration(root) };
}

/** The production expression of a generated column, read from the latest migration that declares it. */
export function generatedExpression(root: string, column: string): string {
  const re = new RegExp(`ADD COLUMN IF NOT EXISTS ${column} \\w+\\s+GENERATED ALWAYS AS \\(`, "i");
  const files = sqlFiles(root).filter((f) => re.test(stripSql(readFileSync(join(root, "supabase", "migrations", f), "utf8"))));
  if (!files.length) throw new Error(`no migration declares the generated column ${column}`);
  const sql = stripSql(readFileSync(join(root, "supabase", "migrations", files.at(-1)!), "utf8"));
  const m = re.exec(sql)!;
  let depth = 1;
  let i = m.index + m[0].length;
  const start = i;
  for (; i < sql.length && depth > 0; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")") depth--;
  }
  return sql.slice(start, i - 1).trim();
}

// ─── The offline database ──────────────────────────────────────────────────
type PG = import("@electric-sql/pglite").PGlite;

const COLS: Array<[string, string, (r: Record<string, unknown>) => unknown]> = [
  ["id", "text", (r) => r.id], ["source", "text", (r) => r.source], ["company_token", "text", (r) => r.token],
  ["company", "text", (r) => r.company], ["title", "text", (r) => r.title], ["location", "text", (r) => r.location],
  ["country", "text", (r) => r.country], ["remote", "boolean", (r) => r.remote], ["work_mode", "text", (r) => r.workMode],
  ["employment_type", "text", (r) => r.employmentType], ["department", "text", (r) => r.department],
  ["posted_at", "timestamptz", (r) => r.postedAt], ["last_seen", "timestamptz", (r) => r.lastSeen],
  ["missing_since", "timestamptz", (r) => r.missingSince], ["salary", "text", (r) => r.salary],
  ["salary_min_annual", "numeric", (r) => r.salaryMinAnnual], ["salary_max_annual", "numeric", (r) => r.salaryMaxAnnual],
  ["salary_period", "text", (r) => r.salaryPeriod], ["salary_currency", "text", (r) => r.salaryCurrency],
  ["experience_band", "text", (r) => r.experienceBand], ["min_years", "integer", (r) => r.minYears], ["agency", "boolean", (r) => r.agency],
];

export async function openOfflineDb(root: string, corpus: Corpus): Promise<PG> {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  await db.exec(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
    END $$;
    CREATE TABLE public.job_board_postings (
      ${COLS.map(([c, t]) => `${c} ${t}${c === "id" ? " PRIMARY KEY" : ""}`).join(",\n      ")},
      title_tsv tsvector GENERATED ALWAYS AS (${generatedExpression(root, "title_tsv")}) STORED,
      effective_posted timestamptz GENERATED ALWAYS AS (${generatedExpression(root, "effective_posted")}) STORED
    );`);
  const rows = [...corpus.rows.values()].map((r) => Object.fromEntries(COLS.map(([c, , f]) => [c, f(r as unknown as Record<string, unknown>) ?? null])));
  await db.query(
    `INSERT INTO public.job_board_postings (${COLS.map(([c]) => c).join(", ")})
     SELECT ${COLS.map(([c]) => c).join(", ")} FROM jsonb_to_recordset($1::jsonb) AS x(${COLS.map(([c, t]) => `${c} ${t}`).join(", ")})`,
    [JSON.stringify(rows)],
  );
  const migration = matchCandidatesMigration(root);
  if (!migration) throw new Error("no migration creates public.match_candidates");
  await db.exec(readFileSync(migration, "utf8"));
  return db;
}

const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`offline client: refusing identifier ${s}`);
  return `"${s}"`;
};
const plain = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]));

type QueryResult = { data: unknown; error: { message: string } | null };
class OfflineQuery implements PromiseLike<QueryResult> {
  private ids: string[] | null = null;
  private op: "select" | "upsert" = "select";
  constructor(private table: string, private corpus: Corpus) {}
  select() { this.op = "select"; return this; }
  eq() { return this; }
  in(_col: string, ids: string[]) { this.ids = ids; return this; }
  upsert() { this.op = "upsert"; return this; }
  then<A = QueryResult, B = never>(ok?: ((v: QueryResult) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve(this.answer()).then(ok, bad);
  }
  private answer(): QueryResult {
    if (this.table === "job_posting_requirements") return { data: this.op === "upsert" ? null : [], error: null };
    if (this.table === "job_board_postings" && this.op === "select") {
      const data = (this.ids ?? []).filter((id) => this.corpus.rows.has(id)).map((id) => ({
        id, description: this.corpus.description(id), min_years: this.corpus.rows.get(id)!.minYears,
      }));
      return { data, error: null };
    }
    return { data: null, error: { message: `offline client: no ${this.op} on ${this.table}` } };
  }
}

export interface OfflineClient {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
  from(table: string): OfflineQuery;
  calls: Array<{ name: string; args: Record<string, unknown> }>;
}
export function offlineClient(db: PG, corpus: Corpus): OfflineClient {
  const calls: OfflineClient["calls"] = [];
  return {
    calls,
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === "metro_ring") {
        return { data: ringFor(args.p_city as string, args.p_region as string, args.p_country as string, Number(args.p_max ?? 20)), error: null };
      }
      if (name === "match_candidates") {
        const keys = Object.keys(args).filter((k) => args[k] !== undefined);
        try {
          const r = await db.query<Record<string, unknown>>(
            `SELECT * FROM public.match_candidates(${keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(", ")})`,
            keys.map((k) => args[k]),
          );
          return { data: r.rows.map(plain), error: null };
        } catch (e) {
          const err = e as { code?: string; message?: string };
          return { data: null, error: { code: err.code, message: String(err.message ?? e) } };
        }
      }
      return { data: null, error: { message: `offline client: no rpc ${name}` } };
    },
    from: (table) => new OfflineQuery(table, corpus),
  };
}

// ─── Profile -> MatchInput ─────────────────────────────────────────────────
export type Mode = "extract" | "oracle";

/** The confirmed strip: what the reader would correct on "We read you as" (place, countries, relocation, remote, sponsorship). */
function oracle(profile: Record<string, any>, t: ResumeTruth): Record<string, any> {
  const [city, region] = t.home.split(",").map((s) => s.trim());
  return {
    ...profile,
    home: { city, region: region && region.length <= 3 ? region : null, country: t.country },
    canWorkIn: t.authorized,
    relocate: t.relocate,
    remote: t.remoteOk,
    workAuth: { ...(profile.workAuth ?? {}), needsSponsorship: t.sponsorshipFuture, citizenOf: t.citizen ? [t.country] : [] },
  };
}

export function toMatchInput(p: Record<string, any>) {
  return {
    roles: p.roles ?? [], home: p.home ?? null, extraPlaces: p.extraPlaces ?? [], relocate: p.relocate ?? "none",
    remote: !!p.remote, radiusKm: p.radiusKm ?? 40, canWorkIn: p.canWorkIn ?? [], level: p.level,
    years: p.years ?? null, targetYears: p.targetYears ?? null, careerChanger: !!p.careerChanger, former: p.former ?? null,
    student: !!p.student, degree: p.degree ?? null, licences: p.licences ?? [], workAuth: p.workAuth,
  };
}

export const parsedText = (id: string, set: "dev" | "heldout" = "dev") =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), set, "parsed", `${id}.pdf.txt`), "utf8");

// ─── The run ───────────────────────────────────────────────────────────────
export interface AfterResume {
  id: string;
  rows: string[];
  family: string | null;
  steps: number[];
  basis: { found: number; passed: number; read: number };
  setAside: Record<string, number>;
  ringSource: string;
  deadlineMissed: string | null;
  wallMs: number;
  profile: { home: unknown; canWorkIn: string[]; level: string; roles: string[]; relocate: unknown; remote: boolean };
}

export interface AfterOptions { root?: string; mode?: Mode; ids?: string[]; nowMs?: number }

export async function runAfter(opts: AfterOptions = {}): Promise<{ per: AfterResume[]; migration: string; corpusVersion: string }> {
  const root = opts.root ?? REPO_ROOT;
  const mode = opts.mode ?? "extract";
  const state = engineState(root);
  if (state.missing.length || !state.migration) {
    throw new Error(`the matcher is incomplete in ${root}: missing ${[...state.missing, ...(state.migration ? [] : ["a migration creating public.match_candidates"])].join(", ")}`);
  }
  const imp = (rel: string) => import(/* @vite-ignore */ pathToFileURL(join(root, rel)).href);
  const profileMod = await imp("supabase/functions/_shared/resume-profile.ts");
  const pipelineMod = await imp("supabase/functions/resume-match/pipeline.ts");
  if (typeof profileMod.readProfile !== "function") throw new Error("_shared/resume-profile.ts exports no readProfile");
  if (typeof pipelineMod.runMatch !== "function") throw new Error("resume-match/pipeline.ts exports no runMatch");

  const corpus = loadCorpus();
  const nowMs = opts.nowMs ?? Date.parse(corpus.frozenAt);
  const db = await openOfflineDb(root, corpus);
  try {
    const client = offlineClient(db, corpus);
    // Warm pglite so the first résumé is not timed against a cold statement.
    await client.rpc("match_candidates", { p_q_en: "nurse", p_q_simple: null, p_fresh_cutoff: new Date(nowMs - 30 * 864e5).toISOString(), p_countries: ["US"], p_ring: ["Phoenix"], p_remote: true, p_regions: [], p_country_lane: true, p_exclude_sources: null, p_lane_limit: 120, p_order: "rank" });
    const per: AfterResume[] = [];
    const truths = RESUMES.filter((t) => !opts.ids || opts.ids.includes(t.id));
    for (const t of truths) {
      const raw = profileMod.readProfile(parsedText(t.id), { nowYear: new Date(nowMs).getUTCFullYear() });
      const p = mode === "oracle" ? oracle(raw, t) : raw;
      const input = toMatchInput(p);
      let result: any = null;
      let wallMs = 0;
      for (let attempt = 0; attempt < 2; attempt++) {
        pipelineMod.clearRingCache?.();
        const t0 = performance.now();
        result = await pipelineMod.runMatch(client, input, { widen: 0, excludeSources: null, order: "rank", nowMs, startedMs: 0, clock: () => 0 });
        wallMs = performance.now() - t0;
        if (!result.deadlineMissed) break;
      }
      if (result.deadlineMissed) throw new Error(`${t.id}: the offline run missed its ${result.deadlineMissed} deadline twice; this is machine load, not a ranking result`);
      per.push({
        id: t.id,
        rows: (result.rows ?? []).map((r: { id: string }) => r.id),
        family: result.family?.key ?? null,
        steps: (result.steps ?? []).map((s: { step: number }) => s.step),
        basis: { found: result.basis?.found ?? 0, passed: result.basis?.passed ?? 0, read: result.basis?.read ?? 0 },
        setAside: Object.fromEntries(Object.entries(result.setAside ?? {}).map(([k, v]: [string, any]) => [k, v?.count ?? 0])),
        ringSource: result.searched?.ringSource ?? "none",
        deadlineMissed: result.deadlineMissed ?? null,
        wallMs: Math.round(wallMs),
        profile: { home: p.home, canWorkIn: p.canWorkIn, level: p.level, roles: p.roles, relocate: p.relocate, remote: p.remote },
      });
    }
    return { per, migration: state.migration, corpusVersion: corpus.version };
  } finally {
    await db.close();
  }
}
