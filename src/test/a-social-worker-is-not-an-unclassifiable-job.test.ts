import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
  categorize,
  CATEGORIZE_VERSION,
  NORMALISATION_STAGES,
  normalizeTitle,
  proposeCategory,
  RULE_BASIS,
  RULE_CONFIDENCE,
  V10_TERMS,
  type RuleProposal,
} from "../../supabase/functions/job-board/categories";
import * as shadow from "../../supabase/functions/job-board/shadow";
import * as embed from "../../supabase/functions/job-board/embed-classify";
import { stripTsComments } from "./helpers/catalog";

/**
 * A SOCIAL WORKER IS NOT AN UNCLASSIFIABLE JOB — THE v9 RESIDUE PASS.
 *
 * After v8, 145,973 servable postings still sat in category "other" (the
 * probe-filtered count; the unwindowed headline pile was 155,195). A
 * four-lane mining workflow (English roles, German, Romance, Nordic/Dutch/
 * other) drew every candidate live from that pile, an adversarial precision
 * check re-drew fresh matches and killed the weak ones, and 108 patterns
 * survived: 22,382 unique postings recovered (22,807 raw minus 425
 * live-counted cross-rule overlaps), 15.3% of the pile, measured 2026-08-23.
 *
 * One survivor was pulled at assembly: capital markets, whose residual
 * errors were hard wrong-field (law-firm capital-markets associates, 2/17
 * in the fresh draw). Ambiguity resolves toward NOT adding.
 *
 * ORDER IS PART OF THE CORRECTNESS ARGUMENT — first match wins, and half
 * these cases pin an ordering decision, not just a term: the clinical-
 * counselor rule before the admissions-counselor rule, business analyst
 * before systems analyst, HRIS before the ERP/platform tier, the insurance
 * sales carve-out before bare-insurance finance, optiker before filialleit,
 * apotek before the guarded Nordic tekniker.
 *
 * AFTER THIS PASS, RULES GROWTH STOPS: 56% of the remaining residue is
 * singleton title forms. Further recovery belongs to a different mechanism,
 * not more regex — do not re-propose term mining.
 *
 * v10 (2026-09-14) IS THAT DIFFERENT MECHANISM, and the v9 block below is
 * kept byte-for-byte as its own guard: categorize() must still answer every
 * case here exactly as v9 did. The v10 blocks follow.
 */
describe("a social worker is not an unclassifiable job (v9)", () => {
  it("the version is bumped so the stored-row sweep re-runs — and under v10 that sweep moves nothing", () => {
    // v10 bumps the version (the recategorize chain restarts from cursor '')
    // while categorize() is unchanged, so the re-run stamps a completed v10
    // sweep and moves zero rows: the proposal path is a separate function.
    expect(CATEGORIZE_VERSION).toBe(10);
  });

  it.each([
    ["Licensed Social Worker (LSW)", "healthcare"],
    ["Substance Abuse Counselor - Family Services", "healthcare"],
    ["Admissions Counselor", "education"],
    ["Business Systems Analyst, New Product Offerings", "data_ai"],
    ["Workday HRIS Analyst", "people_hr"],
    ["NetSuite Consultant (U.S.)", "engineering"],
    ["Insurance Agent - Farmers Insurance", "sales"],
    ["Insurance Verification Specialist", "finance"],
    ["Digital Media Planner", "marketing"],
    ["Demand Planner, HOKA", "operations"],
    ["Augenoptikermeister als Filialleiter (m/w/d)", "healthcare"],
    ["Conseiller de vente (H/F) - CDI 35h", "sales"],
    ["Sjuksköterska till Vellinge hemsjukvård", "healthcare"],
    ["Apotektekniker", "healthcare"],
  ] as const)("%s → %s", (title, want) => {
    expect(categorize(title)).toBe(want);
  });

  it.each([
    // Each stays "other": the near-miss is the point of the guard.
    ["Peer Review Coordinator"], // reviewer absent from the peer alternation
    ["Geschäftsführer (m/w/d)"], // -führer enumeration refuses managing director
    ["Specjalista ds. Ochrony Środowiska"], // environmental-protection lookahead
    ["Personal Trainer"], // only the athletic compound ships
    ["Head of AI Safety"], // safety requires a role noun
    ["Flight Attendant"], // attendant fires only with a whitelisted qualifier
  ] as const)("%s stays other", (title) => {
    expect(categorize(title)).toBe("other");
  });

  it.each([
    // Ordering-sanity: each pins a first-match-wins decision.
    ["Folderbezorger", "operations"], // bezorg before the zorg lookbehind stem
    ["Verzorgende IG", "healthcare"], // (?<!be)zorg fires on ver-zorg
    ["Rechtsanwaltsfachangestellte / Teamassistenz", "legal"], // anwalt before assistenz
    ["Kundservicemedarbetare", "customer"], // customer medarb before shop-floor medarb
    ["Adviseur Zorgverkoop", "sales"], // verkoop before the Dutch care stem
    ["Ortopedtekniker", "other"], // lookbehind guard on Nordic tekniker
    ["Steuerassistent (m/w/d)", "finance"], // tax enumeration before assistenz
    ["Conseiller Service Client (H/F)", "customer"], // service-client after sales fragment
    ["Pracownik Ochrony", "security"], // PL guard stem, genitive tail excluded
  ] as const)("%s → %s", (title, want) => {
    expect(categorize(title)).toBe(want);
  });
});

describe("a sweep that straddles a deploy must not stamp the new version", () => {
  // Measured 2026-08-23, live: the v8 recategorize chain was mid-flight when
  // v9 deployed. Its post-deploy hops ran the new code, which wrote the NEW
  // version into the progress stamp — so the chain kept its mid-alphabet
  // cursor, judged only the late ids under v9, and would have recorded a
  // completed v9 sweep with every id before "personio:" never seen by the
  // v9 rules (531 Augenoptiker rows sat in "other" with zero moved). These
  // assertions pin the provenance contract on comment-stripped code.
  const FN = readFileSync(resolve(__dirname, "../..", "supabase/functions/job-board/index.ts"), "utf8");
  const code = FN.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

  it("a hop from a chain started under other rules is refused, not continued", () => {
    expect(code).toMatch(/hopVersion !== CATEGORIZE_VERSION\) \|\| \(!Number\.isFinite\(hopVersion\) && cursor\)/);
    expect(code).toMatch(/superseded: true/);
  });

  it("both stamps carry the version the chain STARTED under", () => {
    expect(code).toMatch(/k: "recategorize_progress", v: \{ cursor, version: CATEGORIZE_VERSION, startedUnder: CATEGORIZE_VERSION/);
    expect(code).toMatch(/k: "category_rules_version", v: \{ version: CATEGORIZE_VERSION, startedUnder: CATEGORIZE_VERSION/);
  });

  it("every hop and every kick names its rules version", () => {
    expect(code).toMatch(/action: "recategorize", chainKey: key, cursor, rulesVersion: CATEGORIZE_VERSION/);
    expect(code).toMatch(/await kick\("recategorize", \{ \.\.\.\(cursor \? \{ cursor \} : \{\}\), rulesVersion: CATEGORIZE_VERSION \}\)/);
  });

  it("a completion stamp without provenance re-arms the sweep instead of being trusted", () => {
    expect(code).toMatch(/cv\?\.version !== CATEGORIZE_VERSION \|\| Number\(cv\?\.startedUnder\) !== CATEGORIZE_VERSION/);
    expect(code).toMatch(/Number\(prog\.v\?\.startedUnder\) === CATEGORIZE_VERSION/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   v10 — THE OTHER BUCKET, PHASE 1. A PROPOSAL IS NOT A MOVE.

   172,619 rows sat in "other" on 2026-09-10 (categoriesFacet head row). The
   plan (journal wf_ae544b66-955) sorts ~26% of them by three mechanisms —
   rule, employer default, embed — and its first rule is that NO PASS WRITES
   `category`. This file guards the RULE mechanism:

     * categorize() is byte-for-byte v9. Two guards: a hash of the rules
       region of the comment-stripped source, and a 796-literal pin of its
       output measured under v9 (fixtures/categorize-v9-pin.json). The version
       bump alone moves nothing.
     * proposeCategory() is a separate function that answers ONLY for titles
       v9 leaves in "other": three normalisation replays (NFKC/&amp;,
       underscore, exact-noun plurals), then the 19 gate-passing terms,
       appended last, each with its own category_key.
     * Every gate figure is recomputed from fixtures, never typed: per-term
       sample n and employers (other-bucket-v10-term-matches.json = mechC-
       gate.txt), the hand-judged employer-page rows the terms fire on
       (other-bucket-judgments.json), and the zero-collision property on the
       3,060 labelled rows (other-bucket-labelled.json). Where the artefact
       falls short of a constant, the shortfall is listed as DATA below and
       must match the recomputation exactly, so it cannot widen.
     * The refuted terms and the withheld expansions are a negative test set.
     * The teeth block runs the same checkers over broken inputs.
   ═══════════════════════════════════════════════════════════════════════════ */
const ROOT = resolve(__dirname, "../../supabase/functions/job-board");
const CATEGORIES_RAW = readFileSync(resolve(ROOT, "categories.ts"), "utf8");
const CATEGORIES_CODE = stripTsComments(CATEGORIES_RAW);

type Judged = [page: string, title: string, decision: string];
const JUDGMENTS: Record<string, Judged[]> = JSON.parse(readFileSync(resolve(__dirname, "fixtures/other-bucket-judgments.json"), "utf8"));
const LABELLED: Array<[title: string, department: string | null, slug: string]> = JSON.parse(readFileSync(resolve(__dirname, "fixtures/other-bucket-labelled.json"), "utf8"));
const PIN: { measured: string; rulesVersion: number; asTitle: Record<string, string>; asDept: Record<string, string> } = JSON.parse(readFileSync(resolve(__dirname, "fixtures/categorize-v9-pin.json"), "utf8"));
type TermRows = Record<string, Array<{ title: string; company: string; stratum: string }>>;
const TERM_MATCHES: { sampleRows: number; v9OtherRows: number; terms: TermRows; withheld: TermRows } = JSON.parse(readFileSync(resolve(__dirname, "fixtures/other-bucket-v10-term-matches.json"), "utf8"));

const TERM_KEYS = V10_TERMS.map((t) => t.key);
const STAGE_KEYS = NORMALISATION_STAGES.map(([k]) => k);
const byKey = (key: string) => V10_TERMS.find((t) => t.key === key)!;
const bare = (d: string) => !d.startsWith("A:") && d !== "?";

/**
 * The rules region: from the RULES table to the end of categorize(). Hashed
 * on comment-stripped, whitespace-normalised text so a comment edit does not
 * fire and a one-character change to any regex does.
 */
function rulesRegion(code: string): string {
  const a = code.indexOf("const RULES: Array<[JobCategory, RegExp]> = [");
  const b = code.indexOf("\n}\n", code.indexOf("export function categorize(", a));
  if (a < 0 || b < 0) return "";
  return code.slice(a, b + 3).replace(/\s+/g, " ").trim();
}
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * The judged-row cross-check: every hand-judged employer-page row the v10
 * terms fire on, with its bare decision compared to the term's target.
 * Returns the disagreements and the ambiguous rows, keyed "term@employer".
 */
function judgedCrossCheck(judgments: Record<string, Judged[]>) {
  const disagree = new Map<string, number>();
  const ambiguous = new Map<string, number>();
  const agree = new Map<string, number>();
  for (const [tok, rows] of Object.entries(judgments)) {
    for (const [, title, decision] of rows) {
      const p = proposeCategory(title);
      if (!p || !TERM_KEYS.includes(p.key)) continue;
      const k = `${p.key}@${tok}`;
      if (decision === "?") continue;
      if (!bare(decision)) ambiguous.set(k, (ambiguous.get(k) ?? 0) + 1);
      else if (decision === p.target) agree.set(p.key, (agree.get(p.key) ?? 0) + 1);
      else disagree.set(k, (disagree.get(k) ?? 0) + 1);
    }
  }
  return { agree, disagree, ambiguous };
}

/** The labelled-set collision count: v9-other titles the v10 path files against their label. */
function labelledCollisions(rows: typeof LABELLED): { v9Other: number; fired: number; collisions: string[] } {
  let v9Other = 0;
  let fired = 0;
  const collisions: string[] = [];
  for (const [title, , slug] of rows) {
    if (categorize(title, null) !== "other") continue;
    v9Other++;
    const p = proposeCategory(title, null);
    if (!p) continue;
    fired++;
    if (p.target !== slug) collisions.push(`${title}: labelled ${slug}, proposed ${p.target} (${p.key})`);
  }
  return { v9Other, fired, collisions };
}

/** Per-term sample figures, recomputed from the fixture the way mechC-gate.txt counts them. */
function termFigures(matches: typeof TERM_MATCHES.terms) {
  const out = new Map<string, { n: number; employers: number }>();
  for (const t of V10_TERMS) {
    const rows = matches[t.key] ?? [];
    out.set(t.key, { n: rows.length, employers: new Set(rows.map((r) => r.company)).size });
  }
  return out;
}

/**
 * Terms mechC-gate.ts listed under PASS that fail the criterion its own header
 * states (>= 8 sample matches, >= 2 employers) -- WITHHELD from V10_TERMS. A
 * negative test set: each title below is v9-other, gets NO proposal, and the
 * fixture's `withheld` rows reproduce the artefact figure that refused it.
 * Re-admission needs a second employer (or, for épicerie, a fresh measurement
 * of a spelling that can match), not an entry here.
 */
const WITHHELD_TERMS: Record<string, { n: number; employers: number; title: string; why: string }> = {
  inventario: { n: 7, employers: 1, title: "CONTROLADOR DE INVENTARIO", why: "7 AutoZone rows, one below RULE_TERM_MIN_JUDGED" },
  cake_decorator: { n: 8, employers: 1, title: "Cake Decorator", why: "Albertsons only" },
  caissier: { n: 10, employers: 1, title: "Caissier/Caissière", why: "Myview only" },
  repartidor: { n: 9, employers: 1, title: "REPARTIDOR", why: "AutoZone only" },
  epicerie: { n: 0, employers: 0, title: "Gérant d'épicerie", why: "the gate's `\\b[ée]picerie\\b` cannot match a title beginning with É (no ASCII word boundary before a non-ASCII letter); it matched nothing" },
};

describe("v10 — categorize() is byte-for-byte v9", () => {
  it("the rules region of the comment-stripped source hashes to the v9 text", () => {
    const region = rulesRegion(CATEGORIES_CODE);
    expect(region).toContain("\\bresearch\\b"); // the last v9 rule is inside the region
    expect(region).toContain("export function categorize(");
    // sha256 of the region, identical in HEAD (v9, 2026-08-23) and here; 11,797 chars.
    expect(sha(region)).toBe("0db96fcd467f44c79713b7c0628d3078a8d3d16ce77c44228a4bbf850e10fceb");
  });

  it("categorize() reads nothing of v10: no term, no stage, no proposal path", () => {
    const fn = CATEGORIES_CODE.slice(CATEGORIES_CODE.indexOf("export function categorize("), CATEGORIES_CODE.indexOf("\n}\n", CATEGORIES_CODE.indexOf("export function categorize(")));
    for (const needle of ["V10_TERMS", "NORMALISATION_STAGES", "normalizeTitle", "proposeCategory", "PLURAL_RULE_NOUNS"]) expect(fn).not.toContain(needle);
    // and the v10 table is defined AFTER categorize(), never spliced into RULES
    expect(CATEGORIES_CODE.indexOf("export const V10_TERMS")).toBeGreaterThan(CATEGORIES_CODE.indexOf("export function categorize("));
  });

  it("the 796-literal pin, measured under v9, reproduces byte-for-byte as title and as department", () => {
    expect(PIN.rulesVersion).toBe(9);
    expect(Object.keys(PIN.asTitle).length).toBe(796);
    expect(Object.keys(PIN.asDept).length).toBe(796);
    const drift: string[] = [];
    for (const [k, v] of Object.entries(PIN.asTitle)) if (categorize(k) !== v) drift.push(`title ${JSON.stringify(k)}: v9 ${v}, now ${categorize(k)}`);
    for (const [k, v] of Object.entries(PIN.asDept)) if (categorize("", k) !== v) drift.push(`dept ${JSON.stringify(k)}: v9 ${v}, now ${categorize("", k)}`);
    expect(drift, drift.join("\n")).toEqual([]);
  });

  it("proposeCategory() is silent for every title v9 already claims, and never proposes other", () => {
    for (const [k, v] of Object.entries(PIN.asTitle)) {
      const p = proposeCategory(k);
      if (v !== "other") expect(p, `v9 claims ${JSON.stringify(k)} as ${v}; v10 must not re-propose it`).toBeNull();
      if (p) expect(p.target).not.toBe("other");
    }
  });
});

describe("v10 — the proposal shape", () => {
  it("a proposal carries basis rule, confidence 1, the running version, and a key that is a stage or a term", () => {
    const p = proposeCategory("Commis I")!;
    expect(p).toEqual({ basis: RULE_BASIS, key: "commis", target: "hospitality_retail", confidence: RULE_CONFIDENCE, version: CATEGORIZE_VERSION });
    expect(RULE_BASIS).toBe("rule");
    expect(RULE_CONFIDENCE).toBe(1);
    for (const rows of Object.values(TERM_MATCHES.terms)) {
      for (const { title } of rows) {
        const q = proposeCategory(title) as RuleProposal;
        expect(q).not.toBeNull();
        expect([...STAGE_KEYS, ...TERM_KEYS]).toContain(q.key);
      }
    }
  });

  it("every term has a unique key and a non-other target", () => {
    expect(V10_TERMS.length).toBe(19);
    expect(new Set(TERM_KEYS).size).toBe(19);
    for (const t of V10_TERMS) expect(t.target).not.toBe("other");
    expect(new Set([...TERM_KEYS, ...STAGE_KEYS]).size).toBe(22);
  });

  it("the resolver in shadow.ts accepts a rule proposal as-is and stamps the row rule", () => {
    const p = proposeCategory("Bartender")!;
    const res = shadow.resolveFirstClaim([{ basis: p.basis, key: p.key, target: p.target, confidence: p.confidence }]);
    expect(res.kind).toBe("claim");
    const patch = shadow.shadowRowPatch(res, CATEGORIZE_VERSION);
    expect(patch?.category_basis).toBe("rule");
    expect(patch?.category_key).toBe("bartender");
    expect(patch?.category_proposed).toBe("hospitality_retail");
    expect(patch?.category_proposed_v).toBe(10);
    expect(Object.keys(patch!)).not.toContain("category");
  });
});

describe("v10 — normalisation is a replay against the frozen rules, keyed by stage", () => {
  it.each([
    ["IN_Senior Associate_SAP ABAP_SAP_Advisory_Mumbai", "engineering", "norm_underscore"], // PwC: `_` is \w, every \b rule was blind
    ["Lobby Host_Hilton Istanbul Bosphorus", "hospitality_retail", "norm_underscore"],
    ["Cashiers - Seasonal", "hospitality_retail", "norm_plural"], // Bass Pro
    ["Hosts (AM Shifts)", "hospitality_retail", "norm_plural"],
    ["Optical Fabrication Technicians", "operations", "norm_plural"], // ASML: the plural noun, NOT the refuted "front end"
    ["CT Technologists - $10,000 Sign On Bonus", "healthcare", "norm_plural"], // CHS
  ] as const)("%s → %s by %s", (title, target, key) => {
    expect(categorize(title)).toBe("other");
    expect(proposeCategory(title)).toMatchObject({ target, key, basis: "rule" });
  });

  it("the stages are exactly NFKC/&amp;, underscore, exact-noun plural — in that order", () => {
    expect(STAGE_KEYS).toEqual(["norm_nfkc", "norm_underscore", "norm_plural"]);
    expect(normalizeTitle("Press &amp; Content_Consultant  Technicians")).toBe("Press & Content Consultant Technician");
  });

  it("the withheld expansions do not ship: Mgr/Svc/Dir stay unexpanded and Tech is never Technician", () => {
    // Both were measured: the abbreviation step (7 rows, 5/7, both misses
    // known misfire classes) and Tech -> Technician (Rad/ER/CT/Med Tech would
    // fall to the bare-technician operations fallback). Each title is v9-other
    // and v10 must leave it alone, or file it by the healthcare term, never by
    // an expansion.
    for (const t of ["Program Mgr Wholesale Digital", "CUSTOMER SVC/DEPT MANAGER ON DECK", "Account Mgr-LTL", "Senior, AP Systems Admin", "Eng. II, Infra Run & Stability", "Tech"]) {
      expect(categorize(t), t).toBe("other");
      expect(proposeCategory(t), t).toBeNull();
    }
    expect(proposeCategory("Rad Tech")).toMatchObject({ key: "modality_tech", target: "healthcare" });
    expect(proposeCategory("ER Tech")).toMatchObject({ key: "modality_tech", target: "healthcare" });
    expect(normalizeTitle("Rad Tech Mgr")).toBe("Rad Tech Mgr");
    // and the source carries no such replacement (comment-stripped)
    expect(CATEGORIES_CODE).not.toMatch(/\\bMgr\\b/);
    expect(CATEGORIES_CODE).not.toMatch(/"Technician"\)/);
  });
});

describe("v10 — the 19 terms: judged matches as behaviour", () => {
  // Hand-picked from the judged rows (other-bucket-judgments.json) and the
  // sample (mechC-gate.txt); every title is v9-other and files by the named
  // key. The data-driven blocks below cover every fixture row.
  it.each([
    ["Commis I", "hospitality_retail", "commis"], // Marriott, judged
    ["Épicerie Commis temps partiel jour", "hospitality_retail", "commis"], // Myview, judged
    ["Guest Service Agent", "hospitality_retail", "guest_facing"], // Marriott, judged
    ["Guest Experience Expert 賓客體驗專家", "hospitality_retail", "guest_facing"],
    ["F&B and Event Service Expert", "hospitality_retail", "f_and_b"], // Marriott, judged
    ["Food and Beverage Manager", "hospitality_retail", "f_and_b"],
    ["Banquet Houseperson", "hospitality_retail", "banquet"],
    ["Bartender", "hospitality_retail", "bartender"], // Chili's, judged
    ["Food Runner", "hospitality_retail", "food_runner"], // Chili's, judged 61/61
    ["Food Service Worker", "hospitality_retail", "food_service_worker"], // UHS, judged
    ["Dietary Aide", "hospitality_retail", "dietary_aide"], // UHS, judged (role-not-setting)
    ["Valet", "hospitality_retail", "valet"],
    ["Stock Associate", "hospitality_retail", "stock_associate"], // JCPenney / Macy's / Bass Pro, judged
    ["Selling Advisor - Men's", "hospitality_retail", "selling_advisor"], // Saks, judged
    ["Beauty Consultant - White Marsh Mall", "hospitality_retail", "beauty_consultant"], // JCPenney, judged
    ["Baker", "hospitality_retail", "baker"], // Albertsons / Myview, judged
    ["Store Supervisor", "hospitality_retail", "store_supervisor"],
    ["Representante de Ventas", "sales", "representante_ventas"], // Sherwin-Williams, judged sales
    ["Behavioral Health Specialist", "healthcare", "behavioral_health"], // CVS / UHS / CHS, judged
    ["Medication Aide", "healthcare", "medication_aide"], // senior living, sample
    ["Med Tech", "healthcare", "medication_aide"],
    ["CT Tech", "healthcare", "modality_tech"], // UHS / CHS, judged
    ["PMHNP", "healthcare", "advanced_practice"], // CVS / UHS, judged
    ["Advanced Practice Provider", "healthcare", "advanced_practice"], // Cleveland Clinic, judged 15/15
  ] as const)("%s → %s by %s", (title, target, key) => {
    expect(categorize(title)).toBe("other");
    expect(proposeCategory(title)).toMatchObject({ target, key, basis: "rule" });
  });

  it("every sample match in the fixture files by its term's target (2,576 rows, mechC-gate.txt)", () => {
    expect(TERM_MATCHES.sampleRows).toBe(2576);
    expect(TERM_MATCHES.v9OtherRows).toBe(2573); // three stale stamps
    for (const t of V10_TERMS) {
      for (const { title } of TERM_MATCHES.terms[t.key] ?? []) {
        const p = proposeCategory(title);
        expect(p, `${t.key}: ${title}`).not.toBeNull();
        // Overlapping terms share a target ("Banquet Bartender", "Épicerie Commis"), so the target is the assertion.
        expect(p!.target, `${t.key}: ${title} -> ${p!.key}`).toBe(t.target);
      }
    }
  });

  it("per-term sample n and employers clear the rule constants -- every shipped term, no exceptions", () => {
    const fig = termFigures(TERM_MATCHES.terms);
    const failures: string[] = [];
    for (const t of V10_TERMS) {
      const f = fig.get(t.key)!;
      if (f.n < shadow.RULE_TERM_MIN_JUDGED) failures.push(`${t.key}: n ${f.n} < ${shadow.RULE_TERM_MIN_JUDGED}`);
      if (f.employers < shadow.RULE_TERM_MIN_EMPLOYERS) failures.push(`${t.key}: employers ${f.employers} < ${shadow.RULE_TERM_MIN_EMPLOYERS}`);
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("the five withheld terms are not keys, get no proposal, and the fixture reproduces the figure that refused each", () => {
    expect(Object.keys(TERM_MATCHES.withheld).sort()).toEqual(Object.keys(WITHHELD_TERMS).sort());
    for (const [key, w] of Object.entries(WITHHELD_TERMS)) {
      expect(TERM_KEYS, `${key} is shipped`).not.toContain(key);
      expect(categorize(w.title), w.title).toBe("other");
      expect(proposeCategory(w.title), `${key}: ${w.title} must get no proposal`).toBeNull();
      const rows = TERM_MATCHES.withheld[key];
      const f = { n: rows.length, employers: new Set(rows.map((r) => r.company)).size };
      expect(f, key).toEqual({ n: w.n, employers: w.employers });
      // and it really is under a bar -- a term that clears both may not be withheld
      expect(f.n < shadow.RULE_TERM_MIN_JUDGED || f.employers < shadow.RULE_TERM_MIN_EMPLOYERS, `${key} clears both bars`).toBe(true);
      // its sample rows are not re-filed by any other term either (the fixture rows carried that key alone), except where a shipped term overlaps
      for (const { title } of rows) {
        const p = proposeCategory(title);
        if (p) expect(TERM_KEYS, `${key}: ${title} now files by ${p.key}`).toContain(p.key);
      }
    }
  });

  it("the hand-judged employer-page rows the terms fire on agree with the target; the one divergence and the one ambiguity are data", () => {
    const { agree, disagree, ambiguous } = judgedCrossCheck(JUDGMENTS);
    // The judge filed AutoZone's "REPRESENTANTE DE VENTAS" rows under the
    // employer's retail reading (judge.py: egud catch-all -> hospitality_retail)
    // and Sherwin-Williams' under sales; the term files the ROLE, sales, the
    // house convention every "Sales Associate" already follows. Not a
    // conflict at runtime: AutoZone carries no employer default.
    expect(Object.fromEntries(disagree)).toEqual({ "representante_ventas@egud~us2~CX_1": 17 });
    // "Store Administrator Full Time Day" is A:admin under the Myview lens.
    expect(Object.fromEntries(ambiguous)).toEqual({ "store_supervisor@myview~wd3~paradox_careers": 1 });
    // And the agreements are the bulk: 327 judged rows across the shipped
    // terms (377 before the five withheld terms' 50 judged rows -- cake
    // decorator 14, caissier 20, repartidor 9, inventario 7 -- stopped
    // counting; the fixture is frozen, so the figure is pinned exactly).
    const total = [...agree.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(327);
    expect(agree.get("food_runner")).toBe(61);
    expect(agree.get("commis")).toBe(53);
    expect(agree.get("representante_ventas")).toBe(6);
    expect(agree.get("advanced_practice")).toBe(23);
  });

  it("appended last: zero collisions on the 3,060 labelled rows, and department-decided rows are never re-proposed", () => {
    expect(LABELLED.length).toBe(3060);
    const c = labelledCollisions(LABELLED);
    expect(c.collisions, c.collisions.join("\n")).toHaveLength(shadow.RULE_LABELLED_COLLISIONS);
    expect(c.v9Other).toBeGreaterThan(100); // the department-decided residue the terms are tested against
    // With the department in hand, the frozen rules claim every labelled row first.
    let fired = 0;
    for (const [title, dept] of LABELLED) if (proposeCategory(title, dept)) fired++;
    expect(fired).toBe(0);
  });
});

describe("v10 — the refuted terms are a negative test set, not a comment", () => {
  it.each([
    ["Front End Associate"], // ASML fab, web front-end
    ["Department Manager"], // Intertek, Blackbird, H&M
    ["Department Leader"],
    ["Outfitter"], // URBN brand
    ["To Go Specialist"], // Chili's only
    ["Front Office"], // dental/medical receptionists
    ["One App"], // ING; bare "app"
    ["Case Management Associate"], // HR and product
    ["CRA"], // Thermo-only; Community Reinvestment Act
    ["Registrar"],
    ["Endodontics Registrar"], // a dentist
    ["Scheduling Coordinator"],
    ["Brand Ambassador"],
    ["Crew Chief"], // Amentum aviation
    ["Events Associate"], // Bass Pro house title
    ["CSR"], // corporate social responsibility
    ["Spa"],
    ["Spa Manager"],
    ["Steward"],
    ["Dealer"],
    ["Service Colleague"], // Asda only
    ["Parts Specialist"], // O'Reilly/AutoZone house title
    ["Delivery Expert(09503)- 703 The Boulevard"], // Domino's delivery rows stay
    ["Manager Programs 3"], // the embed 'product' misfire — no rule either
  ] as const)("%s stays other and gets no proposal", (title) => {
    expect(categorize(title)).toBe("other");
    expect(proposeCategory(title)).toBeNull();
  });

  it("no term is a bare form of a refused head", () => {
    const src = V10_TERMS.map((t) => t.re.source).join("\n");
    for (const refused of ["front end", "department manager", "outfitter", "to go", "front office", "\\bapp\\b", "case management", "\\bcra\\b", "registrar", "scheduling coordinator", "brand ambassador", "crew chief", "events associate", "\\bcsr\\b", "\\bspa\\b", "steward", "dealer", "service colleague", "parts specialist", "\\bmanager\\b", "\\bsupervisor\\b", "\\bspecialist\\b", "\\btechnician\\b"]) {
      expect(src, refused).not.toMatch(new RegExp(refused.replace(/\\b/g, "\\\\b"), "i"));
    }
  });
});

describe("v10 — the gates are the same numbers everywhere they are spelled", () => {
  it("shadow.ts and embed-classify.ts agree on every embed constant", () => {
    expect(shadow.EMBED_K).toBe(embed.EMBED_K);
    expect(shadow.EMBED_MIN_SHARE).toBe(embed.EMBED_MIN_SHARE);
    expect(shadow.EMBED_MIN_NN1).toBe(embed.EMBED_MIN_NN1);
    expect(shadow.EMBED_REQUIRE_CENTROID_AGREE).toBe(embed.EMBED_REQUIRE_CENTROID_AGREE);
    expect([...shadow.EMBED_BARRED_TARGETS].sort()).toEqual([...embed.EMBED_BARRED_TARGETS].sort());
    expect(shadow.EMBED_ANCHOR_VERSION).toBe(embed.EMBED_ANCHOR_VERSION);
    expect(shadow.EMBED_LOO_REFERENCE).toBe(embed.EMBED_LOO_REFERENCE);
    expect(shadow.EMBED_LOO_TOLERANCE).toBe(embed.EMBED_LOO_TOLERANCE);
  });

  it("the promotion bar in shadow.ts is the bar promote_category enforces (migration 20260909225500, comment-stripped)", () => {
    const dir = resolve(__dirname, "../../supabase/migrations");
    const file = readFileSync(resolve(dir, "20260909225500_the_only_hand_that_moves_a_row_reads_the_audit_list_first.sql"), "utf8");
    const sql = file.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
    const c = (name: string) => Number(new RegExp(`${name}\\s+constant integer := (\\d+);`).exec(sql)?.[1]);
    expect(c("c_min_judged_rule")).toBe(shadow.PROMOTE_MIN_JUDGED_PER_KEY);
    expect(c("c_max_wrong_rule")).toBe(shadow.PROMOTE_MAX_WRONG);
    expect(c("c_min_judged_embed")).toBe(shadow.PROMOTE_MIN_JUDGED_PER_EMBED_TARGET);
    expect(c("c_max_wrong_embed")).toBe(shadow.PROMOTE_MAX_WRONG_PER_EMBED_TARGET);
  });

  it("the shadow migration seeds an EMPTY promotion list, and the reader reads it as zero promotions", () => {
    const dir = resolve(__dirname, "../../supabase/migrations");
    const file = readFileSync(resolve(dir, "20260909224000_a_proposal_is_not_a_move.sql"), "utf8");
    const sql = file.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
    // Either seeded shape is an empty list: a bare '[]' or '{"list": []}'.
    const seed = /'category_promotions',\s*'(\[\s*\]|\{[^']*\})'::jsonb/.exec(sql)?.[1];
    expect(seed).toBeDefined();
    expect(shadow.readPromotions(JSON.parse(seed!))).toEqual([]);
  });

  it("the promotion reader mirrors the function: audit named, counts present, bar cleared; embed keys die with their anchor set", () => {
    const ok = { basis: "rule", key: "commis", target: "hospitality_retail", audit: "rule-commis.md", judged: 8, wrong: 0 };
    const list = shadow.readPromotions({ list: [ok, { ...ok, audit: "" }, { ...ok, judged: "7" }, { ...ok, wrong: 1 }, { basis: "employer", key: "dominos", target: "hospitality_retail", audit: "employer-dominos.md", judged: "8", wrong: "0" }, { basis: "embed", key: "embed_knn_v1", target: "sales", audit: "embed-sales.md", judged: 30, wrong: 1 }, { basis: "embed", key: "embed_knn_v0", target: "sales", audit: "x.md", judged: 30, wrong: 0 }, { basis: "rule", key: "conflict", target: "sales", audit: "x.md", judged: 8, wrong: 0 }, { basis: "rule", key: "x", target: "other", audit: "x.md", judged: 8, wrong: 0 }, { basis: "nope", key: "x", target: "sales" }, null, 42] });
    expect(list.map((p) => shadow.promotionClearsBar(p))).toEqual([true, false, false, false, true, true, true]);
    expect(shadow.isPromoted(list, "rule", "commis", "hospitality_retail")).toBe(true);
    expect(shadow.isPromoted(list, "rule", "commis", "sales")).toBe(false);
    expect(shadow.promotionsValidForAnchors(list).map((p) => p.key)).not.toContain("embed_knn_v0");
    expect(shadow.readPromotions([ok])).toHaveLength(1);
    expect(shadow.readPromotions("garbage")).toEqual([]);
    expect(shadow.readPromotions({ list: "garbage" })).toEqual([]);
  });
});

describe("v10 — teeth: the checkers bite on broken inputs", () => {
  it("the rules-region hash moves on a one-character regex change and not on a comment", () => {
    const region = rulesRegion(CATEGORIES_CODE);
    const touched = rulesRegion(CATEGORIES_CODE.replace("\\bresearch\\b", "\\bresearch\\b|\\bstudy\\b"));
    expect(sha(touched)).not.toBe(sha(region));
    const commented = stripTsComments(CATEGORIES_RAW.replace("const RULES: Array<[JobCategory, RegExp]> = [", "// a comment\nconst RULES: Array<[JobCategory, RegExp]> = ["));
    expect(sha(rulesRegion(commented))).toBe(sha(region));
    expect(rulesRegion("no rules here")).toBe("");
  });

  it("the judged cross-check reports a decision that contradicts the target", () => {
    const { disagree, ambiguous } = judgedCrossCheck({ x: [["p1", "Bartender", "sales"], ["p1", "Bartender", "A:sales"], ["p1", "Bartender", "hospitality_retail"], ["p1", "Bartender", "?"]] });
    expect(Object.fromEntries(disagree)).toEqual({ "bartender@x": 1 });
    expect(Object.fromEntries(ambiguous)).toEqual({ "bartender@x": 1 });
  });

  it("the collision counter fires on a labelled row the terms would re-file", () => {
    const c = labelledCollisions([["Bartender", null, "sales"], ["Bartender", null, "hospitality_retail"], ["Software Engineer", null, "engineering"]]);
    expect(c.v9Other).toBe(2);
    expect(c.fired).toBe(2);
    expect(c.collisions).toHaveLength(1);
  });

  it("the per-term recompute bites: a shipped term with the withheld figures fails the bar, and one row fewer under one employer fails a passing term", () => {
    // The bar as the test applies it, over a fake term list.
    const bar = (rows: Array<{ company: string }>) => rows.length >= shadow.RULE_TERM_MIN_JUDGED && new Set(rows.map((r) => r.company)).size >= shadow.RULE_TERM_MIN_EMPLOYERS;
    expect(bar(TERM_MATCHES.withheld.inventario)).toBe(false); // 7/1
    expect(bar(TERM_MATCHES.withheld.caissier)).toBe(false); // 10/1: n clears, employers does not
    expect(bar(TERM_MATCHES.withheld.epicerie)).toBe(false); // 0/0
    expect(bar(TERM_MATCHES.terms.banquet)).toBe(true); // 8/3
    expect(bar(TERM_MATCHES.terms.banquet.slice(1))).toBe(false); // 7/x
    expect(bar(TERM_MATCHES.terms.banquet.map((r) => ({ ...r, company: "One House" })))).toBe(false); // 8/1
    // termFigures reports exactly what the fixture holds, so a widened fixture is visible
    const fig = termFigures({ ...TERM_MATCHES.terms, banquet: [...TERM_MATCHES.terms.banquet, { title: "Banquet Captain", company: "Someone Else", stratum: "tail" }] });
    expect(fig.get("banquet")).toEqual({ n: 9, employers: 4 });
  });

  it("the pin fails on a shifted claim", () => {
    const shifted = { ...PIN.asTitle, "Licensed Social Worker (LSW)": "other" };
    const drift = Object.entries(shifted).filter(([k, v]) => categorize(k) !== v);
    expect(drift).toHaveLength(1);
  });
});
