/**
 * THE MATCH BENCH, OFFLINE: BEFORE replayed and v1 run on the frozen corpus.
 *
 * BEFORE is replayed from its own frozen display order (corpus.before) through
 * the ported judge; with the licence rule off it must reproduce the figures the
 * 2026-10-12 bench printed (P@10 14.5, P@20 10.0 on the exact 11). That is the
 * positive control for the port.
 *
 * v1 runs resume-match's own pipeline (runMatch, the code that deploys) against
 * a real Postgres holding the shipped migrations and the frozen corpus: each
 * dev résumé is read on the device's reader (the PDF round trip text), sent as
 * the request body the device builds (src/lib/match/request.ts, work
 * authorisation included, as the device re-applies it), validated by the
 * handler's own siteInput, and matched. Its top 20 is judged with the same
 * judge. These are DEV-SET, AUTO-JUDGED figures: the families and rules were
 * tuned on these résumés, almost no v1 row has a hand review, and the corpus
 * holds only what BEFORE and the prototype happened to read (2,731 postings,
 * 492 with a description). No gate verdict rests on them (spec 19.2); the CI
 * gate holds them from falling below the recorded baseline.v1.json.
 *
 * `oracle` replaces the reader's place, authorisation and relocation with the
 * manifest's truth: the reader corrected the strip.
 */
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PGlite } from "@electric-sql/pglite";
import { RESUMES, type ResumeTruth } from "./manifest";
import { judge, type JudgeOptions, type PostingRow, type Verdict } from "./judge";
import { bootMatchDb } from "./db";
import { benchPlaces } from "./rings";
import { PgSupabase } from "../../helpers/pglite-supabase";
import { readProfile, type MatchProfile } from "../../../../supabase/functions/_shared/resume-profile";
import { matchRequestBody } from "../../../lib/match/request";
import { siteInput } from "../../../../supabase/functions/resume-match/handler";
import { clearRingCache, runMatch, type MatchResult } from "../../../../supabase/functions/resume-match/pipeline";

const HERE = dirname(fileURLToPath(import.meta.url));
export interface CorpusPosting {
  id: string; source: string | null; token: string | null; company: string | null; title: string | null; location: string | null;
  remote: boolean | null; workMode: string | null; employmentType: string | null; country: string | null; category: string | null;
  postedAt: string | null; lastSeen: string | null; experienceBand: string | null; minYears: number | null; agency: boolean | null;
  salary: string | null; salaryMinAnnual: number | null; salaryMaxAnnual: number | null; salaryPeriod: string | null; salaryCurrency: string | null;
}
export interface Corpus {
  version: number; now: string; postings: CorpusPosting[]; descriptions: Record<string, string>;
  before: Array<{ id: string; q: string; exact: boolean; poolSize: number; ranked: Array<{ id: string; fit: number | null }>; judgeHadDescription: string[] }>;
}

let CORPUS: Corpus | null = null;
export function loadCorpus(): Corpus {
  CORPUS ??= JSON.parse(gunzipSync(readFileSync(resolve(HERE, "corpus.json.gz"))).toString("utf8")) as Corpus;
  return CORPUS;
}
export const benchNow = () => Date.parse(loadCorpus().now);

const pct = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 1000) / 10);
const mean = (xs: Array<number | null>) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
};
const asRow = (p: CorpusPosting): PostingRow => ({
  id: p.id, title: p.title ?? "", company: p.company, location: p.location, country: p.country, workMode: p.workMode,
  remote: p.remote, minYears: p.minYears, experienceBand: p.experienceBand, category: p.category, agency: p.agency,
});
function rates(vs: Verdict[], denom: number) {
  const infield = vs.filter((v) => v.role === "target" || v.role === "adjacent" || v.role === "related");
  return {
    shortlisted: vs.filter((v) => v.shortlist).length,
    seniority: pct(infield.filter((v) => v.seniority !== "ok").length, infield.length),
    seniorityN: [infield.filter((v) => v.seniority !== "ok").length, infield.length] as [number, number],
    location: pct(vs.filter((v) => v.location === "mismatch" || v.auth === "fail").length, denom),
    locationN: [vs.filter((v) => v.location === "mismatch" || v.auth === "fail").length, vs.length] as [number, number],
    licenceFail: vs.filter((v) => v.licence === "fail").length,
    wrongField: pct(vs.filter((v) => v.role === "off" || v.role === "old").length, denom),
    reviewed: vs.filter((v) => v.reviewed).length,
  };
}

// ---------------------------------------------------------------------------
// BEFORE, replayed
// ---------------------------------------------------------------------------

export interface BeforeSummary {
  exactSet: { p10: number | null; p20: number | null; seniority: number | null; location: number | null };
  allSet: { p10Lower: number | null; p10Upper: number | null; p20Lower: number | null; p20Upper: number | null };
  per: Array<{ id: string; exact: boolean; R: number; p10: number | null; p20: number | null; licenceFails: number }>;
}
export function replayBefore(opts: JudgeOptions): BeforeSummary {
  const c = loadCorpus();
  const byId = new Map(c.postings.map((p) => [p.id, p]));
  const per: Array<any> = [];
  for (const t of RESUMES) {
    const b = c.before.find((x) => x.id === t.id)!;
    const had = new Set(b.judgeHadDescription);
    const all = b.ranked.map((x) => judge(t, asRow(byId.get(x.id)!), had.has(x.id) ? c.descriptions[x.id] ?? null : null, opts));
    const N = b.poolSize;
    const R = all.filter((v) => v.shortlist).length;
    const row: any = { id: t.id, exact: b.exact, R, p10: null, p20: null, licenceFails: all.filter((v) => v.licence === "fail").length };
    if (b.exact) {
      row.p10 = pct(all.slice(0, 10).filter((v) => v.shortlist).length, 10);
      row.p20 = pct(all.slice(0, 20).filter((v) => v.shortlist).length, 20);
      row.top20 = rates(all.slice(0, 20), 20);
    } else {
      row.p20Bounds = [pct(Math.max(0, R - (N - 20)), 20), pct(Math.min(R, 20), 20)];
      row.p10Bounds = [pct(Math.max(0, R - (N - 10)), 10), pct(Math.min(R, 10), 10)];
    }
    per.push(row);
  }
  const exact = per.filter((r) => r.exact);
  return {
    exactSet: {
      p10: mean(exact.map((r) => r.p10)), p20: mean(exact.map((r) => r.p20)),
      seniority: mean(exact.map((r) => r.top20.seniority)), location: mean(exact.map((r) => r.top20.location)),
    },
    allSet: {
      p10Lower: mean(per.map((r) => (r.exact ? r.p10 : r.p10Bounds[0]))), p10Upper: mean(per.map((r) => (r.exact ? r.p10 : r.p10Bounds[1]))),
      p20Lower: mean(per.map((r) => (r.exact ? r.p20 : r.p20Bounds[0]))), p20Upper: mean(per.map((r) => (r.exact ? r.p20 : r.p20Bounds[1]))),
    },
    per: per.map((r) => ({ id: r.id, exact: r.exact, R: r.R, p10: r.p10, p20: r.p20, licenceFails: r.licenceFails })),
  };
}

// ---------------------------------------------------------------------------
// v1, run
// ---------------------------------------------------------------------------

export async function bootBenchDb(): Promise<PGlite> {
  const db = await bootMatchDb({ places: false });
  const places = benchPlaces();
  await db.query(
    `INSERT INTO public.geo_places (geonameid, name, ascii_name, country, admin1_code, region, region_name, lat, lon, population)
     SELECT (row_number() OVER ())::int, x.name, x.name, x.country, x.region, x.region, x.region_name, x.lat, x.lon, x.population
     FROM jsonb_to_recordset($1::jsonb) AS x(name text, region text, region_name text, country text, lat float8, lon float8, population int)`,
    [JSON.stringify(places.map(([name, region, region_name, country, lat, lon, population]) => ({ name, region, region_name, country, lat, lon, population })))],
  );
  const c = loadCorpus();
  const now = benchNow();
  const floor = now - 29 * 86_400_000;
  const rows = c.postings.map((p) => {
    const posted = p.postedAt ? Date.parse(p.postedAt) : NaN;
    // Every corpus row was served on the day it was read, so it is inside the window by construction.
    const effective = new Date(Number.isFinite(posted) && posted > floor ? Math.min(posted, now) : now - 86_400_000).toISOString();
    return {
      id: p.id, source: p.source, company_token: p.token, company: p.company, title: p.title, location: p.location, country: p.country,
      remote: p.remote, work_mode: p.workMode, employment_type: p.employmentType, category: p.category, posted_at: p.postedAt,
      salary: p.salary, salary_min_annual: p.salaryMinAnnual, salary_max_annual: p.salaryMaxAnnual, salary_period: p.salaryPeriod,
      salary_currency: p.salaryCurrency, experience_band: p.experienceBand, min_years: p.minYears, last_seen: p.lastSeen,
      description: c.descriptions[p.id] ?? null, effective_posted: effective, agency: p.agency === true,
    };
  });
  await db.query(
    `INSERT INTO public.job_board_postings (id, source, company_token, company, title, location, country, remote, work_mode, employment_type,
       category, posted_at, salary, salary_min_annual, salary_max_annual, salary_period, salary_currency, experience_band, min_years,
       last_seen, description, effective_posted, agency)
     SELECT id, source, company_token, company, title, location, country, remote, work_mode, employment_type, category, posted_at, salary,
       salary_min_annual, salary_max_annual, salary_period, salary_currency, experience_band, min_years, last_seen, description, effective_posted, agency
     FROM jsonb_to_recordset($1::jsonb) AS x(id text, source text, company_token text, company text, title text, location text, country text,
       remote boolean, work_mode text, employment_type text, category text, posted_at timestamptz, salary text, salary_min_annual numeric,
       salary_max_annual numeric, salary_period text, salary_currency text, experience_band text, min_years int, last_seen timestamptz,
       description text, effective_posted timestamptz, agency boolean)`,
    [JSON.stringify(rows)],
  );
  await db.exec("ANALYZE public.job_board_postings; ANALYZE public.geo_places;");
  return db;
}

const PARSED = resolve(HERE, "parsed");
export const parsedText = (t: ResumeTruth) => readFileSync(resolve(PARSED, `${t.id}.pdf.txt`), "utf8");

/** The manifest's truth for what the strip asks the reader to confirm. */
export function oracleProfile(p: MatchProfile, t: ResumeTruth): MatchProfile {
  const [city, given] = t.home.split(",").map((s) => s.trim());
  // "Manchester, UK" names a country, not a region.
  const region = given && given !== "UK" && given !== t.country ? given : null;
  return {
    ...p,
    home: { city, region, country: t.country },
    canWorkIn: [...t.authorized],
    relocate: t.relocate,
    remote: t.remoteOk,
    workAuth: {
      ...p.workAuth,
      needsSponsorship: t.sponsorshipFuture,
      citizenOf: t.citizen ? [t.country] : [],
      status: t.citizen ? "citizen" : t.sponsorshipFuture ? "student_visa" : "permanent_resident",
    },
  };
}

export interface V1Row { id: string; title: string; location: string | null; country: string | null; tier: string; lane: string; requirementsRead: boolean; verdict: Verdict }
export interface V1Per {
  id: string; exact: boolean; rows: V1Row[]; p10: number; p20: number; shown: number; found: number; read: number; thin: boolean;
  steps: number[]; deadlineMissed: string | null; cpuMs: number; wallMs: number; family: string | null; ringSource: string;
}
export interface V1Summary {
  exact11: { p10: number | null; p20: number | null; location: number | null; seniority: number | null; locationPooled: [number, number]; seniorityPooled: [number, number] };
  all24: { p10: number | null; p20: number | null; location: number | null; seniority: number | null; locationPooled: [number, number]; seniorityPooled: [number, number] };
  under10: number; under20: number; zero: number; rows: number; reviewed: number; licenceFails: number;
  tiers: Record<string, number>; notRead: number;
  cpuMs: { p50: number; p90: number; max: number }; wallMs: { p50: number; p90: number; max: number };
}

const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0;
};

export async function runV1(db: PGlite, opts: JudgeOptions & { oracle?: boolean; frozenClock?: boolean; only?: string[] }): Promise<{ per: V1Per[]; summary: V1Summary }> {
  const c = loadCorpus();
  const byId = new Map(c.postings.map((p) => [p.id, p]));
  const client = new PgSupabase(db);
  const now = benchNow();
  const nowYear = new Date(now).getUTCFullYear();
  clearRingCache();
  // Warm the planner and the function cache so a cold first statement is not judged against the 1.2 s deadline.
  await db.query("SELECT count(*) FROM public.job_board_postings WHERE title_tsv @@ websearch_to_tsquery('english', 'warm')");
  const per: V1Per[] = [];
  for (const t of RESUMES) {
    if (opts.only && !opts.only.includes(t.id)) continue;
    const b = c.before.find((x) => x.id === t.id)!;
    let profile = readProfile(parsedText(t), { nowYear });
    if (opts.oracle) profile = oracleProfile(profile, t);
    const input = siteInput(matchRequestBody(profile, { includeWorkAuth: true }).profile);
    let result: MatchResult | null = null;
    let wall = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      // A frozen clock judges accuracy as if the database answered at once, so machine load cannot move a gate.
      const clock = opts.frozenClock ? () => 0 : () => performance.now();
      const w0 = performance.now();
      result = await runMatch(client, input, { widen: 0, excludeSources: null, order: "rank", nowMs: now, startedMs: clock(), clock });
      wall = performance.now() - w0;
      if (!result.deadlineMissed) break;
    }
    const r = result!;
    const rows: V1Row[] = r.rows.map((row) => {
      const p = byId.get(row.id)!;
      return {
        id: row.id, title: row.title, location: row.location, country: row.country, tier: row.tier, lane: row.lane,
        requirementsRead: row.requirements !== "not read",
        verdict: judge(t, asRow(p), c.descriptions[row.id] ?? null, opts),
      };
    });
    per.push({
      id: t.id, exact: b.exact, rows,
      p10: pct(rows.slice(0, 10).filter((x) => x.verdict.shortlist).length, 10)!,
      p20: pct(rows.slice(0, 20).filter((x) => x.verdict.shortlist).length, 20)!,
      shown: rows.length, found: r.basis.found, read: r.basis.read, thin: r.thin, steps: r.steps.map((s) => s.step),
      deadlineMissed: r.deadlineMissed, cpuMs: r.cpuMs, wallMs: Math.round(wall), family: r.family?.key ?? null, ringSource: r.searched.ringSource,
    });
  }
  const set = (ps: V1Per[]) => {
    const vs = ps.flatMap((p) => p.rows.map((x) => x.verdict));
    const pooled = rates(vs, vs.length);
    return {
      p10: mean(ps.map((p) => p.p10)), p20: mean(ps.map((p) => p.p20)),
      location: mean(ps.map((p) => rates(p.rows.map((x) => x.verdict), 20).location)),
      seniority: mean(ps.map((p) => rates(p.rows.map((x) => x.verdict), 20).seniority)),
      locationPooled: pooled.locationN, seniorityPooled: pooled.seniorityN,
    };
  };
  const allRows = per.flatMap((p) => p.rows);
  const tiers: Record<string, number> = {};
  for (const x of allRows) tiers[x.tier] = (tiers[x.tier] ?? 0) + 1;
  return {
    per,
    summary: {
      exact11: set(per.filter((p) => p.exact)),
      all24: set(per),
      under10: per.filter((p) => p.shown < 10).length,
      under20: per.filter((p) => p.shown < 20).length,
      zero: per.filter((p) => p.p20 === 0).length,
      rows: allRows.length,
      reviewed: allRows.filter((x) => x.verdict.reviewed).length,
      licenceFails: allRows.filter((x) => x.verdict.licence === "fail").length,
      tiers,
      notRead: allRows.filter((x) => !x.requirementsRead).length,
      cpuMs: { p50: quantile(per.map((p) => p.cpuMs), 0.5), p90: quantile(per.map((p) => p.cpuMs), 0.9), max: Math.max(0, ...per.map((p) => p.cpuMs)) },
      wallMs: { p50: quantile(per.map((p) => p.wallMs), 0.5), p90: quantile(per.map((p) => p.wallMs), 0.9), max: Math.max(0, ...per.map((p) => p.wallMs)) },
    },
  };
}
