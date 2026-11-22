/**
 * THE SEARCH-REACH CORPUS'S MATCHER AND JUDGE (job-board .103).
 *
 * titleReads() turns a typed query into the title reads the list's two text
 * routes issue: the SIMPLE route's split title match (index.ts simpleSplit ->
 * titleFilters) or the RANKED route's search_jobs p_q against title_tsv
 * (index.ts serveList). matchedRows() lets a real Postgres (pglite) decide
 * them, so the english stemmer is the one production runs. The modules are
 * passed in, so the same reads can be computed for the build's code and for
 * the code it replaced.
 *
 * relevant() is the corpus's judgement: would a person who typed q want this
 * posting? It reads the title only, and it never consults either matcher.
 */
import type { PGlite } from "@electric-sql/pglite";

export type TitleFilter = { column: "title" | "title_tsv"; query: string; config: "simple" | "english" };
export type SearchModules = {
  join: (q: string) => string;
  expandQuery: (q: string) => { q: string; expansions: string[] };
  aliasesFor: (q: string) => Readonly<Record<string, readonly string[]>>;
  pickRoute: (q: string, aliases: Readonly<Record<string, { tokens: string[]; name: string }>>) => { route: string };
  simpleRouteFilters: (safeQ: string, aliases: Readonly<Record<string, readonly string[]>>) => { filters: TitleFilter[] } | null;
};

/** index.ts ftsSafe and ftsQuery, copied; the corpus test checks the copies against the file. */
export function ftsSafe(t: string): string {
  if (((t.match(/"/g) ?? []).length & 1) === 1) t = t.replace(/"/g, " ");
  t = t.replace(/(^|\s)[-&/–—]+(\s|$)/g, " ");
  return t.replace(/[(),.'\\:]/g, " ").replace(/\s+/g, " ").trim();
}
export function ftsQuery(raw: string): string {
  const safe = ftsSafe(raw);
  if (/^[a-z0-9]+s$/i.test(safe) && safe.length >= 5) {
    return `${safe} or "${safe.slice(0, -1)} s"`;
  }
  return safe;
}

export type Reads = { qText: string; route: string; filters: TitleFilter[] };

/** The title reads the list issues for a typed query (no filters, no employer key). */
export function titleReads(typed: string, m: SearchModules): Reads {
  const qText = m.join(typed.toLowerCase().trim().slice(0, 200));
  const route = m.pickRoute(qText, {}).route;
  if (route === "SIMPLE") {
    const split = m.simpleRouteFilters(ftsSafe(qText), m.aliasesFor(qText));
    if (split) return { qText, route, filters: split.filters };
    const ex = m.expandQuery(qText);
    return { qText, route, filters: [{ column: "title", query: ex.expansions.length ? ftsSafe(ex.q) : ftsQuery(qText), config: "simple" }] };
  }
  return { qText, route, filters: [{ column: "title_tsv", query: m.expandQuery(qText).q, config: "english" }] };
}

export const TITLE_TSV = "setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(company, '')), 'B') || setweight(to_tsvector('english', coalesce(department, '')), 'C')";

export type PoolRow = { t: string; c: string | null; d: string | null };

export async function loadPool(pg: PGlite, rows: readonly PoolRow[]): Promise<void> {
  await pg.exec("DROP TABLE IF EXISTS pool; CREATE TABLE pool (i int primary key, title text, company text, department text)");
  for (let i = 0; i < rows.length; i++) await pg.query("INSERT INTO pool VALUES ($1, $2, $3, $4)", [i, rows[i].t, rows[i].c, rows[i].d]);
}

/** The pool rows every filter matches, by index. */
export async function matchedRows(pg: PGlite, filters: readonly TitleFilter[]): Promise<number[]> {
  const where = filters.map((f, n) => `(${f.column === "title_tsv" ? TITLE_TSV : `to_tsvector('${f.config}', coalesce(title, ''))`}) @@ websearch_to_tsquery('${f.config}', $${n + 1})`);
  const { rows } = await pg.query<{ i: number }>(`SELECT i FROM pool WHERE ${where.join(" AND ")} ORDER BY i`, filters.map((f) => f.query));
  return rows.map((r) => r.i);
}

// ── the judgement ──────────────────────────────────────────────────────────
const SPELL: Record<string, RegExp> = {
  backend: /\bback[\s-]?end\b/, frontend: /\bfront[\s-]?end\b/, fullstack: /\bfull[\s-]?stack\b/,
  devops: /\bdev[\s-]?ops\b/, devsecops: /\bdev[\s-]?sec[\s-]?ops\b/, ai: /(^|[^a-z0-9])(ai|a\.i\.?|artificial intelligence)([^a-z0-9]|$)/,
  ml: /\b(ml|machine learning)\b/, software: /\bsoftware\b/, web: /\bweb\b/, mobile: /\bmobile\b/, ios: /\bios\b/,
  android: /\bandroid\b/, java: /\bjava\b/, python: /\bpython\b/, salesforce: /\bsalesforce\b/, react: /\breact\b/,
};
const COMPOUND = new Set(["backend", "frontend", "fullstack", "devops", "devsecops"]);
const ROLE = /\b(developers?|engineers?|programmers?|swe|sde)\b/;
/** A title naming a different job beside the words: a manager, a tester, a seller, an analyst. */
const OTHER_JOB = /\b(manager|director|head|vp|vice president|recruiter|qa|quality|test|tester|testing|sdet|security|sales|support|solutions?|analyst|scientist|designer|architect|consultant|marketing|network|reliability)\b/;
const SENIOR = /\b(senior|sr|snr)\b/;

function softwareDomains(q: string): string[] | null {
  const s = q.toLowerCase().replace(/a\.i\./g, "ai").replace(/artificial intelligence/g, "ai").replace(/machine learning/g, "ml")
    .replace(/\bback[\s-]?end\b/g, "backend").replace(/\bfront[\s-]?end\b/g, "frontend").replace(/\bfull[\s-]?stack\b/g, "fullstack")
    .replace(/\bdev[\s-]?sec[\s-]?ops\b/g, "devsecops").replace(/\bdev[\s-]?ops\b/g, "devops");
  const ws = s.split(/\s+/).filter(Boolean);
  if (!ws.some((w) => /^(developers?|engineers?)$/.test(w))) return null;
  const doms = ws.filter((w) => w in SPELL);
  if (!doms.length) return null;
  const compound = doms.filter((d) => COMPOUND.has(d));
  return compound.length ? [...compound, ...doms.filter((d) => !COMPOUND.has(d) && d !== "software")] : doms;
}

const JUDGE: Record<string, (t: string) => boolean> = {
  "business developer": (t) => /\bbusiness\b/.test(t) && /\b(developers?|development)\b/.test(t) && !/\b(intelligence|application|software|systems?)\b/.test(t),
  "business development": (t) => JUDGE["business developer"](t),
  "property developer": (t) => /\bpropert(y|ies)\b/.test(t) && /\b(developers?|development)\b/.test(t),
  "real estate developer": (t) => /\breal estate\b/.test(t) && /\b(developers?|development)\b/.test(t),
  "land developer": (t) => /\bland\b/.test(t) && /\b(developers?|development)\b/.test(t),
  "product developer": (t) => /\bproducts?\b/.test(t) && /\b(developers?|development)\b/.test(t),
  "product engineer": (t) => /\bproducts?\b/.test(t) && /\bengineers?\b/.test(t),
  "sales engineer": (t) => /\bsales\b/.test(t) && /\bengineers?\b/.test(t),
  "sales developer": (t) => /\bsales\b/.test(t) && /\b(developers?|development)\b/.test(t),
  "application engineer": (t) => /\bapplications?\b/.test(t) && /\bengineers?\b/.test(t),
  "applications developer": (t) => /\bapplications?\b/.test(t) && /\bdevelopers?\b/.test(t),
  "front end manager": (t) => SPELL.frontend.test(t) && /\bmanager\b/.test(t) && !/\b(software|engineers?|engineering|developers?|web|ui)\b/.test(t),
  "front end associate": (t) => SPELL.frontend.test(t) && /\bassociate\b/.test(t) && !/\b(software|engineers?|developers?)\b/.test(t),
  "front end supervisor": (t) => SPELL.frontend.test(t) && /\bsupervisor\b/.test(t) && !/\b(software|engineers?|developers?)\b/.test(t),
  "web content developer": (t) => /\bweb\b/.test(t) && /\bcontent\b/.test(t) && /\bdevelopers?\b/.test(t),
  "software sales engineer": (t) => /\bsoftware\b/.test(t) && /\bsales\b/.test(t) && /\bengineers?\b/.test(t),
  "learning developer": (t) => /\blearning\b/.test(t) && /\b(developers?|development)\b/.test(t) && !/\bmachine\b/.test(t),
  "curriculum developer": (t) => /\bcurriculum\b/.test(t) && /\b(developers?|development)\b/.test(t),
  "data engineer": (t) => /\bdata\b/.test(t) && /\bengineers?\b/.test(t) && !/\b(manager|director|head)\b/.test(t),
  "cloud engineer": (t) => /\bcloud\b/.test(t) && /\bengineers?\b/.test(t) && !/\b(manager|director|head)\b/.test(t),
  "civil engineer": (t) => /\bcivil\b/.test(t) && /\bengineers?\b/.test(t),
  "back end": (t) => SPELL.backend.test(t),
  nurse: (t) => /\bnurs(e|es|ing)\b/.test(t),
  "registered nurse": (t) => /\bregistered nurses?\b/.test(t) || /\brn\b/.test(t),
  "customer success": (t) => /\bcustomer success\b/.test(t),
  privacy: (t) => /\bprivacy\b/.test(t),
  "product designer": (t) => /\bproducts?\b/.test(t) && /\bdesigners?\b/.test(t),
  "data analyst": (t) => /\bdata\b/.test(t) && /\banalysts?\b/.test(t),
  pharmacist: (t) => /\bpharmacists?\b/.test(t),
};

/** Would a person who typed q want this posting? */
export function relevant(q: string, title: string): boolean {
  const t = title.toLowerCase().replace(/&amp;/g, "&");
  const key = q.toLowerCase().trim();
  if (JUDGE[key]) return JUDGE[key](t);
  const doms = softwareDomains(key);
  if (!doms) throw new Error(`no judgement for "${q}"`);
  if (!doms.every((d) => SPELL[d].test(t))) return false;
  if (SENIOR.test(key) && !SENIOR.test(t)) return false;
  return ROLE.test(t) && !OTHER_JOB.test(t);
}
