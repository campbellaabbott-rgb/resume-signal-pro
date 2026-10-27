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
import { CATALOG } from "./helpers/catalog";
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

// 2026-09-03: this suite's entry matcher was the same brace-anchored regex
// source-catalog-invariants carried, and it fell to the same trap a fourth
// time — the deploy-size compaction spelled the plain entries s(...) instead
// of { name, source, token } and the parse silently dropped from 44,039
// boards to the 463 that carry suffixes. The catalog is now IMPORTED, so no
// legal change to entry spelling can ever unparse a board again. ENTRY stays
// only for the synthetic suffix-order pin below.
import { JOB_SOURCES } from "../../supabase/functions/job-board/sources";
const ENTRY = /\{\s*name:\s*"((?:[^"\\]|\\.)*)",\s*source:\s*"([a-z0-9_]+)",\s*token:\s*"((?:[^"\\]|\\.)*)"(?:,\s*pages:\s*(\d+))?(?:,\s*agency:\s*(true))?\s*\}/g;

describe("the catalog carries the flag", () => {
  const entries = JOB_SOURCES.map((s) => ({
    name: s.name, source: s.source, token: s.token,
    pages: (s as { pages?: number }).pages, agency: (s as { agency?: boolean }).agency === true,
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
      // State Farm's and Principal's own boards were convicted here once, for
      // the roles they post for independent agents' offices; they post their
      // own roles too, and recheck 3 (2026-10-26) released them: see
      // an-employer-asked-for-by-name-is-found-by-name.
      "greenhouse:liquidpersonnel",
      "greenhouse:crisprecruit",
      "teamtailor:jobtalentfrance",     // the board the English-only screen once cleared
      // Jobandtalent's other three boards, labelled in trust round 3 (2026-10-26): the
      // screen's one-word "jobandtalent" never read their "Job&Talent".
      "teamtailor:jobandtalent",
      "lever:jobandtalent",
      "teamtailor:multitempo",
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
    // source-catalog-invariants is deliberately ABSENT: since 2026-09-03 it
    // imports JOB_SOURCES instead of parsing text, so it has no suffix
    // tolerance left to rot — the parse cannot drop a board at all.
    // THE SHARED READER IS CHECKED BY BEHAVIOUR, NOT BY SPELLING.
    //
    // The catalog guards stopped parsing text of their own and now read
    // src/test/helpers/catalog.ts, so the suffix tolerance moved there with
    // the parsing. Text-matching it would pin one regex's spelling — and the
    // helper writes the same rule differently (\bagency\s*:\s*(true|false)\b),
    // which is not a defect. What must hold is that a real entry carrying the
    // disclosure suffix survives the parse. That is checkable directly, so
    // check it: a spelling pin here would pass a reader that matched the
    // regex and dropped the flag.
    const flagged = CATALOG.filter((b) => b.agency === true);
    expect(flagged.length, "the shared catalog reader dropped the agency flag").toBeGreaterThan(0);
    expect(
      flagged.every((b) => !!b.name && !!b.token && !!b.source),
      "an agency-flagged entry lost a field to the suffix",
    ).toBe(true);

    for (const [file, marker] of [
      ["scripts/census-drivable-yield.mjs", "agency"],
    ] as const) {
      const text = strip(read(file));
      expect(text, `${file} no longer tolerates the disclosure suffix`).toMatch(/agency:\\s\*true|, agency: true\)\?/);
      void marker;
    }
  });
});

describe("trust round 3: an employer's own board is not labelled an agency, and a staffing platform is", () => {
  const byKey = new Map(JOB_SOURCES.map((s) => [`${s.source}:${s.token.toLowerCase()}`, s as { name: string; agency?: boolean }]));
  const TAGGER = read("scripts/tag-agencies.mjs");
  const ledgerSet = (name: string) => {
    const m = new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`).exec(strip(TAGGER));
    return new Set([...(m?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((x) => x[1]));
  };
  /** The agency audit's tier A (agency-flags-2026-10-25), each read on its employer's own site or feed. */
  const ROUND3 = [
    "ukg:recruiting2~con1074cvtg~1831b61a-1945-44fa-afd8-624795c9b30d", // Convergint
    "ukg:recruiting~ban1010~e9066a66-c3b9-e25c-d036-116705c05e46", // Banner Engineering
    "ukg:recruiting~laf1002lafa~1a07d948-3361-48d7-89f2-002c5a48346c", // Lafayette 148
    "ukg:recruiting2~sap1000spid~5e557a61-9707-4f47-8f76-9c11b2bfbf9e", // Smart City Networks
    "ukg:recruiting~kil1000~68c62bcb-20f8-3231-d728-9190572df832", // Kilpatrick Townsend & Stockton
    "ukg:recruiting~low1003lfcs~cfc2ee58-1207-4e12-a838-876cbc96b1f9", // Lowell Five Bank
    "adp:d290c04e-0230-4cd9-8bf0-f116bfab1405~19000101_000003", // Synchron
    "adp:4a8a08f1-ff6c-4d60-8308-4b09a199dd38", // Highlights for Children
    "adp:30e05070-07b1-4b26-9028-b97dae32cdd1", // The Barkan Companies
    "oracle:eify~us6~cx_1001", // Springfield Clinic
    "greenhouse:alphasightsresumedrop", "greenhouse:placementsio", "greenhouse:studentplacements",
    "lever:crossing-minds", "teamtailor:geant",
    "rippling:paradise-media-recruitment", "rippling:ferric-recruiting", "rippling:meundies-recruiting",
    "rippling:lylaw-recruitment", "rippling:allsup-employment-services",
  ];

  it("the twenty boards wave 4 had not cleared carry no flag, and the tagger never puts one back", () => {
    const own = ledgerSet("EMPLOYERS_OWN_BOARDS");
    for (const k of ROUND3) {
      expect(byKey.get(k), `${k} left the catalogue`).toBeTruthy();
      expect(byKey.get(k)!.agency, `${k} is its employer's own board and still wears the agency flag`).not.toBe(true);
      expect(own.has(k), `${k} is not in tag-agencies' EMPLOYERS_OWN_BOARDS, so a re-run tags it again`).toBe(true);
    }
    // Wave 4's twelve (recheck 3) stay cleared too: 32 in all.
    expect(own.size).toBe(32);
    for (const k of own) expect(byKey.get(k)?.agency, k).not.toBe(true);
  });

  it("Jobandtalent's three boards wear the flag and the convictions name them", () => {
    const conv = ledgerSet("RELEASED_CONVICTIONS");
    for (const k of ["teamtailor:jobandtalent", "lever:jobandtalent", "teamtailor:multitempo"]) {
      expect(byKey.get(k)?.agency, `${k} is a staffing platform's board`).toBe(true);
      expect(conv.has(k), k).toBe(true);
    }
  });

  it("Dallah stays flagged until a name is read for it", () => {
    expect(byKey.get("oracle:eniy~em3~cx_6001")?.agency).toBe(true);
  });

  // The review of round 3 found staffing companies' boards of the same kind as Jobandtalent's still unlabelled:
  // the agency audit read only flagged boards and name-screen hits. Each is labelled on its own feed's words, read
  // 2026-10-26 (~/.config/resumebooster/trust-round-3-fixes/ev). Not a census: other unflagged staffing brands may remain.
  const STAFFING = [
    "greenhouse:ayahealthcare", "ashby:traba", "ashby:zenjob", "bamboohr:staffzone", "bamboohr:coople", "pinpoint:coople",
    "workday:ingenovishealth~wd1~ingenovishealth", "icims:careers.insightglobal.com",
    "oracle:ehnn~us2~cx_3001", "oracle:ehnn~us2~cx", "oracle:ehnn~us2~cx_4", "oracle:ehnn~us2~cx_7", "oracle:ehnn~us2~cx_10", "oracle:ehnn~us2~cx_1001",
  ];

  it("the staffing companies' boards the review found unlabelled wear the flag, and the convictions name each one", () => {
    const conv = ledgerSet("RELEASED_CONVICTIONS");
    for (const k of STAFFING) {
      expect(byKey.get(k), `${k} left the catalogue`).toBeTruthy();
      expect(byKey.get(k)!.agency, `${k} is a staffing company's board`).toBe(true);
      expect(conv.has(k), `${k} is not in RELEASED_CONVICTIONS`).toBe(true);
    }
    expect(JOB_SOURCES.filter((s) => (s as { agency?: boolean }).agency === true).length).toBe(134);
  });

  it("every TrueBlue site that lists requisitions is labelled, so the label holds wherever the dedupe stores one", () => {
    // PeopleReady's site (CX_1) was labelled alone, but every one of its requisitions is also on the corporate site
    // CX_3001, which ranks first, so its rows were stored there unlabelled and the flagged board served none.
    const sites = JOB_SOURCES.filter((s) => s.source === "oracle" && s.token.startsWith("ehnn~"));
    const unlabelled = sites.filter((s) => (s as { agency?: boolean }).agency !== true).map((s) => s.token);
    // RenewableWorks listed no requisition on 2026-10-26 and TrueBlue's own words do not name it: left as it is.
    expect(unlabelled).toEqual(["ehnn~us2~CX_2001"]);
    expect(byKey.get("oracle:ehnn~us2~cx_3001")?.agency, "the site the requisitions are stored under").toBe(true);
  });

  it("a workforce company whose own words do not say staffing stays as it is (Allegis Global Solutions: \"not about filling seats\")", () => {
    expect(byKey.get("smartrecruiters:allegisglobalsolutions")?.agency).not.toBe(true);
    expect(ledgerSet("RELEASED_CONVICTIONS").has("smartrecruiters:allegisglobalsolutions")).toBe(false);
  });

  it("the tagger's dry run tags nothing on this catalogue", () => {
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    const out = execFileSync(process.execPath, ["scripts/tag-agencies.mjs", "--dry-run"], { cwd: root, encoding: "utf8" });
    expect(out).toMatch(/^tagged 0 boards \((\d+) already carried the flag\)/m);
    expect(Number(/\((\d+) already carried/.exec(out)?.[1])).toBe(JOB_SOURCES.filter((s) => (s as { agency?: boolean }).agency === true).length);
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

  it("the RPCs bind it now, so the opt-out keeps the ranked path", () => {
    // THE INVERSION THIS TEST WAS WRITTEN TO EXPECT, and in the order it
    // named: 20260901090000 gave search_jobs and count_jobs_capped a
    // p_exclude_agencies parameter, so the key joined RPC_BOUND_FILTERS and
    // the blind-set gate stopped standing the ranked exits down.
    //
    // What it cost while blind, measured live 2026-09-01 with adjacent
    // repeated controls: q="nurse" answered ranked; the same query carrying
    // the opt-out answered UNRANKED. Both counts were honest — a disclosed
    // 10,000 ceiling against an exact 22,467 from the other counting path —
    // but the searcher who asked to hide staffing agencies silently lost
    // relevance ranking, and that was the part worth paying a migration for.
    expect(rpcBlindFilters(norm({ excludeAgencies: true }).applied)).toEqual([]);
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
      country: "", experience: "", companyTokens: [], salaryFloor: 0,
      salaryCeiling: 0, payBasis: "" as const, statedPayOnly: false, includeUnstatedPay: false,
      maxYears: 0, department: "", employmentType: "", vendor: "", freshness: "",
      hideAgencies: false,
    };
    expect(boardFilterBody({ ...OFF, hideAgencies: true })).toEqual({ excludeAgencies: true });
    expect(boardFilterBody(OFF)).toEqual({});
  });

  it("the badge and the toggle exist, and the URL round-trips the choice", () => {
    const JOBS = strip(read("src/pages/Jobs.tsx"));
    // Pass B (2026-10-12): the card is the listing vocabulary's JobCard, whose
    // first chip is the agency-board disclosure, read from the served flag.
    const CARD = strip(read("src/components/jobs/listing/JobCard.tsx"));
    expect(CARD).toMatch(/job\.agency === true \? <AgencyBoardChip/);
    expect(JOBS, "the board mounts the card").toMatch(/<JobCard\b/);
    expect(JOBS).toMatch(/jobsPage\.agencyBadge/);
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
      for (const k of ["hideAgencies", "hideAgenciesTip", "chipNoAgencies", "agencyBadge"]) {
        expect(typeof jp[k], `${f} is missing jobsPage.${k}`).toBe("string");
      }
      const card = JSON.parse(read(`src/i18n/shards/listing/${f}.json`)).listing.card as Record<string, unknown>;
      for (const k of ["agencyBoard", "agencyBoardTip"]) expect(typeof card[k], `${f} is missing listing.card.${k}`).toBe("string");
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
    // The name screen reads agencyScreenText, never the raw name: what a label
    // field adds to a name is no evidence, the name that remains is (the
    // census-names test owns why), so the hit's nameFrom rides along.
    expect(MERGE).toMatch(/AGENCY_NAME\.test\(agencyScreenText\(vendor, b\.name, \{ nameFrom: b\.nameFrom \}\)\) \|\| agencyEvidence\.has\(/);
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
    expect(TAG).toMatch(/if \(line\.includes\("agency: true"\)\) \{\s*already\+\+;[\s\S]*?return line;\s*\}/);
  });
});
