/**
 * AN AGENCY IS DISCLOSED, NOT HIDDEN — AND NOT HIDDEN FROM, UNLESS ASKED.
 *
 * The 2026-08-31 charter change released the staffing-agency convictions:
 * Collabera, CTG, Symicor, United Placement Group and the rest merge like any
 * employer now, and their postings are ingesting. The product answer is
 * transparency, not exclusion — a flag on the CATALOG entry (never per-posting
 * inference), stamped onto every row at ingest, worn as a badge on the card,
 * and declinable through ONE opt-in narrowing filter.
 *
 * Two incident classes stand guard over this feature from day one:
 *
 *   - the parser trap, thrice-documented: catalog entries carry optional
 *     suffixes now, and a brace-anchored regex silently unmatches every entry
 *     that has one (PetSmart vanished from the invariants that way, corrected
 *     boards read "undefined" the day the Workday giants were widened);
 *   - the tier-escalation trap: a filter must NEVER widen a search. The
 *     opt-out here is equality against a NOT NULL DEFAULT false column, so it
 *     can only remove rows — and the blind-set gate keeps every RPC that
 *     cannot bind it away from answering a request that carries it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  filterViolations,
  isUnfiltered,
  normalizeFilters,
  rpcBlindFilters,
} from "../../supabase/functions/job-board/filters.ts";
import { boardFilterBody } from "../pages/Jobs";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

const SRC = read("supabase/functions/job-board/sources.ts");
const BOARD = strip(read("supabase/functions/job-board/index.ts"));
const MIG = read("supabase/migrations/20260831120000_an_agency_is_disclosed_not_hidden.sql");
const norm = (b: Record<string, unknown>) => normalizeFilters(b, 40_000);

// The widened entry matcher, spelled exactly as source-catalog-invariants
// spells it: token, then the OPTIONAL pages window, then the OPTIONAL agency
// flag, in that order and no other. tag-agencies and merge-all both emit the
// flag last for this reason.
const ENTRY = /\{\s*name:\s*"((?:[^"\\]|\\.)*)",\s*source:\s*"([a-z0-9_]+)",\s*token:\s*"((?:[^"\\]|\\.)*)"(?:,\s*pages:\s*(\d+))?(?:,\s*agency:\s*(true))?\s*\}/g;

describe("the catalog carries the flag", () => {
  const entries = [...SRC.matchAll(ENTRY)].map((m) => ({
    name: m[1], source: m[2], token: m[3], pages: m[4], agency: m[5] === "true",
  }));

  it("a real population of tagged boards exists, and none of it is workday-giant noise", () => {
    const tagged = entries.filter((e) => e.agency);
    // 226 tagged on 2026-08-31; a floor rather than a pin so future merges
    // and future tags cannot break this line, while a parser regression that
    // dropped the suffix would.
    // 200 was the over-tagged first draft; the reviewer showed "talent" and
    // "workforce" were catching employers' own in-house portals (Cummins,
    // Molina), and the corrected vocabulary tags 139. The bound guards the
    // parser, not the vocabulary — it moves only with a narrative like this.
    expect(tagged.length, "the tagged population vanished — a parser or the tagger regressed").toBeGreaterThanOrEqual(100);
    expect(entries.length, "the entry matcher itself rotted").toBeGreaterThan(30_000);
  });

  it("the released convictions wear the flag — a released ban must not become amnesia", () => {
    const byKey = new Map(entries.map((e) => [`${e.source}:${e.token.toLowerCase()}`, e]));
    for (const key of [
      "workable:the-symicor-group-1",   // bank-recruiting firm, self-described
      "workable:unitedplacementgroup",  // placement agency
      "smartrecruiters:collabera2",     // IT staffing
      "icims:careers.ctg.com",          // fills roles for singular clients
      "icims:jobs.statefarm.com",       // hires on behalf of agents' offices
      "icims:careers.principal.com",    // hires on behalf of representatives
      "greenhouse:liquidpersonnel",
      "greenhouse:crisprecruit",
      "teamtailor:jobtalentfrance",     // the board the English-only screen once cleared
    ]) {
      const e = byKey.get(key);
      expect(e, `${key} left the catalog entirely`).toBeTruthy();
      expect(e!.agency, `${key} was convicted as an agency and carries no disclosure flag`).toBe(true);
    }
  });

  it("the suffix ORDER is pages-then-agency, and a combined entry parses", () => {
    // No tagged board carries a window override today, so the combination is
    // pinned synthetically — the day a PetSmart-sized agency board needs one,
    // every widened parser must already read it.
    const combined = '  { name: "Example Staffing", source: "icims", token: "careers.example.com", pages: 34, agency: true },';
    const m = new RegExp(ENTRY.source).exec(combined);
    expect(m, "the combined suffix order does not parse").toBeTruthy();
    expect(m![4]).toBe("34");
    expect(m![5]).toBe("true");
    // And the inverted order must NOT exist in the catalog — one order is the
    // whole reason every parser only needs one widening.
    expect(SRC).not.toMatch(/agency:\s*true,\s*pages:/);
  });

  it("every widened parser tolerates both suffixes", () => {
    // The regexes themselves, read from the files that own them — each one
    // fell (or would have fallen) to the brace-anchor trap.
    for (const [file, marker] of [
      ["src/test/source-catalog-invariants.test.ts", "agency"],
      ["src/test/an-employer-name-comes-from-the-employer.test.ts", "agency"],
      ["src/test/a-demo-board-is-not-an-employer.test.ts", "agency"],
      ["scripts/census-drivable-yield.mjs", "agency"],
    ] as const) {
      const text = strip(read(file));
      expect(text, `${file} no longer tolerates the disclosure suffix`).toMatch(/agency:\\s\*true|, agency: true\)\?/);
      void marker;
    }
  });
});

describe("ingest stamps the flag from the catalog — never inferred per posting", () => {
  it("the row build copies the entry's flag", () => {
    expect(BOARD).toMatch(/agency: s\.agency === true,/);
  });

  it("the prev-row select and mapping BOTH carry it, or every tagged row churns forever", () => {
    expect(BOARD).toMatch(/remote,salary,agency/);
    // The mapping half — the half the employment_type churn bug proved
    // nothing was pinning: a SELECTed column dropped by the mapper reads
    // undefined and the patch fires on every rotation visit.
    expect(BOARD).toMatch(/agency: r\.agency \?\? null, employment_type: r\.employment_type \?\? null,/);
  });

  it("corrections re-stamp in both directions, guarded against the deploy window", () => {
    expect(BOARD).toMatch(/typeof row\.agency === "boolean" && typeof prev\.agency === "boolean" && row\.agency !== prev\.agency/);
  });

  it("the corrections RPC learned the column the same day the edge did", () => {
    // The silently-dropped-field class: apply_posting_corrections hand-lists
    // its columns, and employment_type patches once shipped into the void.
    expect(MIG).toMatch(/agency\s+= CASE WHEN patch\.p \? 'agency'/);
    // A malformed value must degrade to "leave it" — and COALESCE cannot do
    // that job: the ::boolean cast THROWS on a bad string before COALESCE
    // sees it (the reviewer refuted the first draft's comment). The guard is
    // a spelling whitelist in front of the cast.
    expect(MIG).toMatch(/lower\(patch\.p->>'agency'\) IN \('true','false','t','f','1','0'\)/);
  });

  it("the migration is the boolean-with-verdict shape, and adds no index it cannot justify", () => {
    expect(MIG).toMatch(/ADD COLUMN IF NOT EXISTS agency boolean NOT NULL DEFAULT false/);
    // The only bound predicate matches ~99% of rows; an index would bill
    // every UPDATE on a 12-index hot table and serve no query.
    expect(MIG).not.toMatch(/CREATE INDEX/);
  });

  it("ingest survives the deploy window on both its read and its write", () => {
    // A select naming an unborn column fails the whole board read; an insert
    // carrying one fails the chunk. Both degrade instead.
    expect(BOARD).toMatch(/error\?\.message\?\.includes\("agency"\)/);
    // The strip composes with the country retry now (a database missing BOTH
    // optional columns must still take the chunk) — the spelling moved once,
    // deliberately, with that fix.
    const stripSite = BOARD.indexOf('const { agency: _a, country: _c, ...rest }');
    expect(stripSite, "the insert retry never strips the new column").toBeGreaterThan(-1);
  });
});

describe("the opt-out narrows, never widens, and is never silently dropped", () => {
  it("off by default: the bare board serves agencies", () => {
    const { applied } = norm({});
    expect(applied.excludeAgencies).toBe(false);
    expect(isUnfiltered(applied)).toBe(true);
  });

  it("a literal true narrows; anything else is refused BY NAME", () => {
    const on = norm({ excludeAgencies: true });
    expect(on.applied.excludeAgencies).toBe(true);
    expect(on.ignored).toEqual([]);
    expect(isUnfiltered(on.applied), "hiding disclosed inventory is a filtered view").toBe(false);
    // The sendableOnly:"true" silence, refused here from day one: a truthy
    // string must not evaporate while the caller believes agencies are gone.
    const str = norm({ excludeAgencies: "true" });
    expect(str.applied.excludeAgencies).toBe(false);
    expect(str.ignored).toContain("excludeAgencies");
  });

  it("no RPC can bind it, so the blind-set gate must route it — the five-filters lesson", () => {
    // The mechanical half: the moment the filter exists and is NOT in
    // RPC_BOUND_FILTERS, every ranked/capped-count exit stands down and the
    // request flows through buildQuery, the one binder. When the SQL gains a
    // parameter for it, RPC_BOUND_FILTERS gains the key and this expectation
    // inverts — deliberately, in that order.
    expect(rpcBlindFilters(norm({ excludeAgencies: true }).applied)).toContain("excludeAgencies");
    expect(rpcBlindFilters(norm({}).applied)).toEqual([]);
  });

  it("buildQuery binds equality against false — removal only", () => {
    expect(BOARD).toMatch(/if \(applied\.excludeAgencies\) q = q\.eq\("agency", false\)/);
    // And the row select fetches the column the self-check reads — placed
    // BEFORE the ordering column, whose position at the end of the select is
    // pinned by the keyset-paging guard.
    expect(BOARD).toMatch(/min_years,agency,last_seen/);
  });

  it("a tagged row leaking under the opt-out is a named violation", () => {
    const a = norm({ excludeAgencies: true }).applied;
    expect(filterViolations([{ agency: false }], a)).toEqual([]);
    expect(filterViolations([{ agency: true }], a)[0]?.field).toBe("excludeAgencies");
    // A row from a path that omits the field is NOT flagged — the ranked exit
    // never serves this filter, and absence means "not stated", not "agency".
    expect(filterViolations([{ title: "x" }], a)).toEqual([]);
  });

  it("the opt-out is disclosed back on the response", () => {
    expect(BOARD).toMatch(/if \(applied\.excludeAgencies\) out\.agenciesExcluded = true/);
  });
});

describe("the flag is served, badged, and declinable end to end", () => {
  it("rowToJob emits the flag, omitted (never defaulted) when the row lacks it", () => {
    const start = BOARD.indexOf("const rowToJob");
    const block = BOARD.slice(start, BOARD.indexOf("\n});", start));
    expect(block).toMatch(/typeof r\.agency === "boolean"/);
    expect(block).toMatch(/agency: r\.agency,/);
  });

  it("the page sends the opt-out under its contract name, literal true only", () => {
    const OFF = {
      q: "", location: "", remoteOnly: false, workMode: "", category: "", inclUncat: false,
      agentOnly: false, country: "", experience: "", companyTokens: [], salaryFloor: 0,
      salaryCeiling: 0, payBasis: "" as const, statedPayOnly: false, includeUnstatedPay: false,
      maxYears: 0, department: "", employmentType: "", vendor: "", freshness: "",
      hideAgencies: false,
    };
    expect(boardFilterBody({ ...OFF, hideAgencies: true })).toEqual({ excludeAgencies: true });
    expect(boardFilterBody(OFF)).toEqual({});
  });

  it("the badge and the toggle exist, and the URL round-trips the choice", () => {
    const JOBS = strip(read("src/pages/Jobs.tsx"));
    expect(JOBS).toMatch(/jobsPage\.agencyBadge/);
    expect(JOBS).toMatch(/job\.agency === true/);
    expect(JOBS).toMatch(/jobsPage\.hideAgencies/);
    expect(JOBS).toMatch(/initial\.get\("noAgencies"\)/);
    expect(JOBS).toMatch(/if \(hideAgencies\) p\.set\("noAgencies", "1"\)/);
    // Chip + relaxation, or the filter survives "Clear all" invisibly.
    expect(JOBS).toMatch(/key: "noAgencies"/);
    expect(JOBS).toMatch(/noAgencies: \{ hideAgencies: false \}/);
  });

  it("every locale carries the disclosure strings", () => {
    for (const f of ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"]) {
      const jp = JSON.parse(read(`src/i18n/locales/${f}.json`)).jobsPage as Record<string, unknown>;
      for (const k of ["hideAgencies", "hideAgenciesTip", "chipNoAgencies", "agencyBadge", "agencyBadgeTip"]) {
        expect(typeof jp[k], `${f} is missing jobsPage.${k}`).toBe("string");
      }
      expect(typeof (jp.filterName as Record<string, string>)?.excludeAgencies, `${f} cannot name the refused filter`).toBe("string");
    }
  });

  it("/v1 and the MCP serve the same field and take the same opt-out", () => {
    const V1 = strip(read("supabase/functions/public-api/index.ts"));
    expect(V1).toMatch(/"agency",/);                       // JOB_FIELDS
    expect(V1).toMatch(/"exclude_agencies",/);             // JOBS_PARAMS
    expect(V1).toMatch(/qb = qb\.eq\("agency", false\)/);  // the binding
    expect(V1).toMatch(/excludeAgencies: true/);           // ranked body mapping
    const MCP = strip(read("supabase/functions/agent-mcp/index.ts"));
    expect(MCP).toMatch(/if \(j\.agency === true\) out\.agency = true/);
    expect(MCP).toMatch(/excludeAgencies: \{ type: "boolean"/);
    expect(MCP).toMatch(/args\.excludeAgencies === true \? \{ excludeAgencies: true \}/);
    expect(MCP).toMatch(/"agenciesExcluded",/);
  });

  it("saved searches and the digest carry the opt-out — parity is two-sided", () => {
    const LIB = strip(read("src/lib/job-search-params.ts"));
    expect(LIB).toMatch(/if \(p\.excludeAgencies\) qs\.set\("noAgencies", "1"\)/);
    expect(LIB).toMatch(/excludeAgencies: p\.excludeAgencies \|\| undefined/);
    const DIGEST = strip(read("supabase/functions/send-search-digest/index.ts"));
    expect(DIGEST).toMatch(/excludeAgencies: p\.excludeAgencies \|\| undefined/);
    const JOBS = strip(read("src/pages/Jobs.tsx"));
    expect(JOBS, "the save site must store it").toMatch(/excludeAgencies: hideAgencies \|\| undefined/);
  });
});

describe("future merges tag on arrival", () => {
  it("merge-all emits the flag from the name screen or the cleared file's evidence bit", () => {
    const MERGE = strip(read("scripts/merge-all.mjs"));
    expect(MERGE).toMatch(/AGENCY_NAME\.test\(b\.name\) \|\| agencyEvidence\.has\(/);
    expect(MERGE).toMatch(/x\.agency === true/);
    // The staffing vocabulary must stay a strict subset of the junk-inclusive
    // gate — a spelling drift between the two is a board blocked by one and
    // untagged by the other.
    expect(MERGE).toMatch(/const AGENCY_NAME = /);
  });

  it("the mill screen writes its evidence into the cleared file, not just the console", () => {
    const SCREEN = strip(read("scripts/mill-screen-all.mjs"));
    expect(SCREEN).toMatch(/cleared\.push\(\{ vendor: b\.vendor, token: b\.token, agency: true \}\)/);
  });

  it("the tagger is idempotent by construction", () => {
    const TAG = strip(read("scripts/tag-agencies.mjs"));
    expect(TAG).toMatch(/if \(line\.includes\("agency: true"\)\) \{ already\+\+; return line; \}/);
  });
});
