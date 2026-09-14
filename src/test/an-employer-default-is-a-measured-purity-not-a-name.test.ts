import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CATALOG, stripTsComments } from "./helpers/catalog";
import { CATEGORIZE_VERSION } from "../../supabase/functions/job-board/categories";
import {
  CONFLICT_KEY,
  EMBED_BARRED_TARGETS,
  EMPLOYER_DEFAULTS,
  EMPLOYER_DEFAULTS_VALID_THROUGH_CATEGORIZE_VERSION,
  EMPLOYER_MIN_N,
  EMPLOYER_MIN_PURITY,
  EMPLOYER_SECOND_PAGE_MIN,
  EMPLOYER_SECOND_PAGE_OFFSET_BAND,
  REFUTED_EMPLOYER_TOKENS,
  employerGuardExcludes,
  employerHolds,
  proposeByEmployer,
  resolveFirstClaim,
  resolveShadowRow,
  shadowRowPatch,
  validateEmployerDefaults,
  type EmployerDefault,
  type ShadowProposal,
} from "../../supabase/functions/job-board/shadow";

/**
 * AN EMPLOYER DEFAULT IS A MEASURED PURITY, NOT A NAME.
 *
 * The Other bucket held 172,619 postings on 2026-09-10. The owner's first
 * instinct was employer defaults — "Domino's is 33,976 rows, file it retail".
 * Measured, that number was board-wide, the bucket-scoped count is
 * 15,000-17,500, and only SEVEN of the twenty-nine employers hand-judged were
 * pure enough to file by default at all. Marriott looked pure (0.83) until
 * the residue turned out to be enriched for Executive Resolution and finance;
 * Bass Pro was 55/60 on page one and 41/60 at offset 370; AutoZone was 0.58;
 * a hospital employer (UHS, CHS) is not a clinical role.
 *
 * So the table in shadow.ts is a set of MEASUREMENTS, and this file makes the
 * measurements load-bearing: every figure pinned on an entry is RECOMPUTED
 * here from the judged rows (src/test/fixtures/other-bucket-judgments.json, a
 * byte-for-byte mirror of scratchpad/other-bucket/judgments.json: 2,365 rows
 * over 30 employers, each row [page, title, decision]) THROUGH THE MODULE'S
 * OWN GUARD FUNCTIONS. Change a regex and the purity changes; the pin fails;
 * nobody gets to type a number the rows do not support.
 *
 * Decision semantics, from judge.py: a bare field slug is a confident call;
 * "A:<field>" is ambiguous and counts AGAINST strict purity even when the
 * lenient reading agrees; "?" is no field at all.
 *
 * Exclusions mean STAY IN THE BUCKET. A Domino's Delivery Expert is not filed
 * as operations by this table, or as anything; it is left for the rule and
 * embed passes, and if they are silent it stays "other".
 */
const ROOT = resolve(__dirname, "../../supabase/functions/job-board");
const SHADOW_RAW = readFileSync(resolve(ROOT, "shadow.ts"), "utf8");
const SHADOW_CODE = stripTsComments(SHADOW_RAW);

type Judged = [page: string, title: string, decision: string];
const JUDGMENTS: Record<string, Judged[]> = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/other-bucket-judgments.json"), "utf8"),
);

const CATALOG_TOKENS = new Set(CATALOG.map((e) => e.token));
const catalogName = (token: string) => CATALOG.find((e) => e.token === token)?.name ?? "";

/** Recompute an entry's figures from the judged rows through its own guard. */
function measure(entry: EmployerDefault, rows: Judged[]) {
  const kept = rows.filter(([, title]) => !employerGuardExcludes(entry, title));
  const right = kept.filter(([, , d]) => d === entry.target).length;
  const p2 = kept.filter(([page]) => page === "p2");
  const p2right = p2.filter(([, , d]) => d === entry.target).length;
  const unguardedRight = rows.filter(([, , d]) => d === entry.target).length;
  return {
    n: kept.length,
    purity: kept.length ? right / kept.length : 0,
    secondPage: { right: p2right, n: p2.length },
    unguarded: { right: unguardedRight, n: rows.length },
    excluded: rows.length - kept.length,
  };
}

/** Strict purity of an employer's judged rows toward its best field, no guard. */
function bestFieldPurity(rows: Judged[]) {
  const counts = new Map<string, number>();
  for (const [, , d] of rows) if (!d.startsWith("A:") && d !== "?") counts.set(d, (counts.get(d) ?? 0) + 1);
  let best = "";
  let n = 0;
  for (const [f, c] of counts) if (c > n) [best, n] = [f, c];
  return { field: best, purity: rows.length ? n / rows.length : 0, n: rows.length };
}

/**
 * The twenty-two refuted employers, by the token the sample judged them under
 * (judgments.json keys), plus every sibling sub-board of the same employer in
 * sources.ts — a default for the un-judged sibling would be a default by name.
 * Cleveland Clinic, City of New York, Saks and Big 5 were judged under short
 * keys; their catalog tokens come from employer-ranking.json / sources.ts.
 */
const REFUTED: Array<{ employer: string; tokens: string[]; judgedKey: string | null; why: string }> = [
  { employer: "Marriott", tokens: ["ejwl~us2~CX", "ejwl~us2~CX_1001", "ejwl~us2~CX_1"], judgedKey: "ejwl~us2~CX", why: "0.83, enriched for Executive Resolution / finance / receiving" },
  { employer: "Hilton", tokens: ["efet~us2~CX_1"], judgedKey: "efet~us2~CX_1", why: "0.78" },
  { employer: "Bass Pro", tokens: ["basspro~wd1~careers"], judgedKey: "basspro~wd1~careers", why: "0.81 at depth: 55/60 page one, 41/60 at offset 370" },
  { employer: "O'Reilly", tokens: ["oreillyauto~wd1~oreilly"], judgedKey: "oreillyauto~wd1~oreilly", why: "0.67 bimodal" },
  { employer: "AutoZone", tokens: ["egud~us2~CX_1"], judgedKey: "egud~us2~CX_1", why: "0.58" },
  { employer: "Macy's", tokens: ["ebwh~us2~CX_1001"], judgedKey: "ebwh~us2~CX_1001", why: "0.90 unreplicated (n = 60, no second page)" },
  { employer: "Thermo Fisher", tokens: ["thermofisher~wd5~ThermoFisherCareers"], judgedKey: "thermofisher~wd5~ThermoFisherCareers", why: "0.72" },
  { employer: "Kotak", tokens: ["hcbt~em2~CX_1001"], judgedKey: "hcbt~em2~CX_1001", why: "three-way split" },
  { employer: "CVS", tokens: ["cvshealth~wd1~CVS_Health_Careers"], judgedKey: "cvshealth~wd1~CVS_Health_Careers", why: "0.47" },
  { employer: "PwC", tokens: ["pwc~wd3~Global_Experienced_Careers", "pwc~wd3~crm_experienced_careers_site", "pwc~wd3~global_campus_careers", "pwc~wd3~US_Experienced_Careers"], judgedKey: "pwc~wd3~Global_Experienced_Careers", why: "0.65" },
  { employer: "UHS", tokens: ["jobs.uhsinc.com"], judgedKey: "jobs.uhsinc.com", why: "0.60 — a hospital employer is not a clinical role (dietary x14)" },
  { employer: "CHS", tokens: ["fa-evxo-saasfaprod1~ocs~CX_1"], judgedKey: "fa-evxo-saasfaprod1~ocs~CX_1", why: "0.52 (EVS x7)" },
  { employer: "Amentum", tokens: ["pae~wd1~Amentum_Careers"], judgedKey: "pae~wd1~Amentum_Careers", why: "0.55" },
  { employer: "JCI", tokens: ["jci~wd5~JCI", "jci~wd5~TUPU", "jci~wd5~JCI_Confidential"], judgedKey: "jci~wd5~JCI", why: "0.57" },
  { employer: "Sherwin-Williams", tokens: ["ejhp~us6~CX_1"], judgedKey: "ejhp~us6~CX_1", why: "0.42" },
  { employer: "RTX", tokens: ["globalhr~wd5~REC_RTX_Ext_Gateway", "RaytheonTechnologies"], judgedKey: "globalhr~wd5~REC_RTX_Ext_Gateway", why: "0.43" },
  { employer: "AECOM", tokens: ["AECOM2"], judgedKey: "AECOM2", why: "0.36" },
  { employer: "Northrop", tokens: ["ngc~wd1~Northrop_Grumman_External_Site"], judgedKey: "ngc~wd1~Northrop_Grumman_External_Site", why: "0.30" },
  { employer: "Cleveland Clinic", tokens: ["ccf~wd1~ClevelandClinicCareers"], judgedKey: "cleveland", why: "0.77" },
  { employer: "City of New York", tokens: ["CityOfNewYork"], judgedKey: "cityny", why: "0/60 — no field at all" },
  { employer: "Saks", tokens: ["saks~wd1~careers_at_saks"], judgedKey: "saks", why: "n = 26 < 40 (pure, but under the bar)" },
  { employer: "Big 5", tokens: ["recruiting2~BIG1003BIGC~63b1fe5f-a895-49e4-afdc-7059fb08eea2"], judgedKey: "big5", why: "n = 14 < 40 (pure, but under the bar)" },
  { employer: "Tyson Foods", tokens: ["tysonfoods~wd5~TSN", "tysonfoods~wd5~TSN5", "tysonfoods~wd5~TYIT", "tysonfoods~wd5~cvt"], judgedKey: "tyson", why: "0.68 (operations 41/60), judged under the TSN board" },
];

/** Myview and Domino's each resolve to several boards; only one of each was judged. */
const UNJUDGED_SIBLINGS = [
  "myview~wd3~careers",
  "myview~wd3~Holt_Renfrew_External_Career_Site",
  "myview~wd3~Choice_Properties_REIT",
  "DominosPizzaNetherlands",
];

const NAME_OF: Record<string, RegExp> = {
  "fa-etjg-saasfaprod1~ocs~CX_1003": /^Chili's$/,
  "jobs.jcp.com": /^JCPenney$/,
  "dollartree~wd5~dollartreeus": /^Dollartree$/,
  "eluq~us2~CX_1": /^The Kroger Co\.$/,
  "myview~wd3~paradox_careers": /^Myview$/,
  "eofd~us6~CX_1": /^Albertsons Companies$/,
  dominos: /^Domino's$/,
};

describe("an employer default is a measured purity, not a name", () => {
  it("the fixture is the whole judgement set — 2,365 rows over 30 employers", () => {
    const rows = Object.values(JUDGMENTS).reduce((n, v) => n + v.length, 0);
    expect(Object.keys(JUDGMENTS).length).toBe(30);
    expect(rows).toBe(2365);
  });

  it("exactly the seven, keyed by token, every token a live sources.ts entry with the expected employer name", () => {
    expect(EMPLOYER_DEFAULTS.map((e) => e.token).sort()).toEqual(Object.keys(NAME_OF).sort());
    for (const e of EMPLOYER_DEFAULTS) {
      expect(CATALOG_TOKENS.has(e.token), `${e.token} is not in sources.ts`).toBe(true);
      expect(catalogName(e.token), `${e.token} resolved to the wrong employer`).toMatch(NAME_OF[e.token]);
      // Keyed by token, judged under the same token — no cross-board borrowing.
      expect(e.judgedKey).toBe(e.token);
    }
  });

  it("every pinned figure is what the judged rows produce through the entry's own guard", () => {
    for (const e of EMPLOYER_DEFAULTS) {
      const rows = JUDGMENTS[e.judgedKey];
      expect(rows?.length, `no judged rows for ${e.token}`).toBeGreaterThan(0);
      const m = measure(e, rows);
      expect(m.n, `${e.token} n`).toBe(e.n);
      expect(m.purity, `${e.token} purity`).toBeCloseTo(e.purity, 6);
      expect(m.secondPage, `${e.token} second page`).toEqual({ right: e.secondPage.right, n: e.secondPage.n });
      expect(m.unguarded, `${e.token} unguarded`).toEqual(e.unguarded);
    }
  });

  it("every entry clears every gate — purity, n, second page, offset band — and the validator agrees", () => {
    for (const e of EMPLOYER_DEFAULTS) {
      expect(e.purity, e.token).toBeGreaterThanOrEqual(EMPLOYER_MIN_PURITY);
      expect(e.n, e.token).toBeGreaterThanOrEqual(EMPLOYER_MIN_N);
      expect(e.secondPage.n, e.token).toBeGreaterThan(0);
      expect(e.secondPage.right / e.secondPage.n, e.token).toBeGreaterThanOrEqual(EMPLOYER_SECOND_PAGE_MIN);
      const frac = e.secondPage.offset / e.bucketTotal;
      expect(frac, `${e.token} second page offset`).toBeGreaterThanOrEqual(EMPLOYER_SECOND_PAGE_OFFSET_BAND[0]);
      expect(frac, `${e.token} second page offset`).toBeLessThanOrEqual(EMPLOYER_SECOND_PAGE_OFFSET_BAND[1]);
      expect(EMBED_BARRED_TARGETS.has(e.target)).toBe(false);
    }
    expect(validateEmployerDefaults(EMPLOYER_DEFAULTS, CATALOG_TOKENS)).toEqual([]);
  });

  it("the strict five clear the bar with no guard; the conditional two only with theirs", () => {
    const strict = EMPLOYER_DEFAULTS.filter((e) => e.mode === "strict").map((e) => e.token).sort();
    const conditional = EMPLOYER_DEFAULTS.filter((e) => e.mode === "conditional").map((e) => e.token).sort();
    expect(strict).toEqual(["dollartree~wd5~dollartreeus", "eluq~us2~CX_1", "fa-etjg-saasfaprod1~ocs~CX_1003", "jobs.jcp.com", "myview~wd3~paradox_careers"]);
    expect(conditional).toEqual(["dominos", "eofd~us6~CX_1"]);
    for (const e of EMPLOYER_DEFAULTS) {
      const unguarded = e.unguarded.right / e.unguarded.n;
      if (e.mode === "strict") expect(unguarded, e.token).toBeGreaterThanOrEqual(EMPLOYER_MIN_PURITY);
      else {
        expect(unguarded, e.token).toBeLessThan(EMPLOYER_MIN_PURITY);
        expect(e.guard, e.token).not.toBeNull();
      }
    }
  });

  it("guards exclude exactly as judged: the named rows stay in the bucket, and are filed nowhere", () => {
    const stays = (token: string, title: string) => {
      expect(proposeByEmployer(token, title), `${token}: ${title}`).toBeNull();
      // With rule and embed silent, the resolver is silent — no patch at all.
      expect(shadowRowPatch(resolveFirstClaim([null, proposeByEmployer(token, title), null]), 10)).toBeNull();
    };
    const files = (token: string, title: string) => {
      const p = proposeByEmployer(token, title);
      expect(p?.target, `${token}: ${title}`).toBe("hospitality_retail");
      expect(p?.basis).toBe("employer");
      expect(p?.key).toBe(token);
    };
    // Domino's: delivery, e-bike, driver and CSR rows stay.
    stays("dominos", "Delivery Expert(09503)- 703 The Boulevard");
    stays("dominos", "E-Biker(03653) - 328 Myrtle Ave");
    stays("dominos", "CSR");
    stays("dominos", "Domino's Pizza Maker/CSR Kenmore, WA (7062)");
    stays("dominos", "Domino's Delivery Expert");
    files("dominos", "Pizza Maker(01883)  401 West Villard, Suite #101 & #102");
    files("dominos", "General Manager in Training(06797)");
    // JCPenney: the one product role.
    stays("jobs.jcp.com", "Program Mgr Wholesale Digital");
    files("jobs.jcp.com", "Beauty Consultant - White Marsh Mall");
    // Dollar Tree: distribution-centre rows.
    stays("dollartree~wd5~dollartreeus", "1st Shift Assistant WMS Coordinator");
    stays("dollartree~wd5~dollartreeus", "2nd Shift Department Supervisor");
    files("dollartree~wd5~dollartreeus", "Assistant Manager I");
    // Kroger: the pre-slash department decides; STORE/... survives.
    stays("eluq~us2~CX_1", "DISTRIBUTION - ORDER SELECTOR");
    stays("eluq~us2~CX_1", "TRANSPORTATION/HOSTLER");
    stays("eluq~us2~CX_1", "LOSS PREV/CUSTOMER ENGAGEMENT SPEC");
    files("eluq~us2~CX_1", "STORE/HIRING & TRAINING SUPPORT");
    // A post-slash mention does NOT trigger the prefix guard.
    files("eluq~us2~CX_1", "GROCERY/DISTRIBUTION HELPER");
    // Myview.
    stays("myview~wd3~paradox_careers", "Director, AI Content Studio");
    stays("myview~wd3~paradox_careers", "Sr. HR Coordinator, National Wholesale (18 month Contract)");
    stays("myview~wd3~paradox_careers", "Vendor Enablement - Co-Op Student");
    stays("myview~wd3~paradox_careers", "Bilingual Senior Manager, Real Estate (ENG/FR)");
    files("myview~wd3~paradox_careers", "Store Administrator Full Time Day");
    // Albertsons.
    stays("eofd~us6~CX_1", "Fuel Station Attendant");
    stays("eofd~us6~CX_1", "Receiver - Wilmington, DE");
    stays("eofd~us6~CX_1", "Premade Salad Supv (Prod)");
    stays("eofd~us6~CX_1", "Senior Manager, Customer Insights/VOC");
    files("eofd~us6~CX_1", "Courtesy Clerk");
    // Chili's has no guard.
    files("fa-etjg-saasfaprod1~ocs~CX_1003", "Line Cook");
    // An employer outside the table never gets a default, whatever the title.
    expect(proposeByEmployer("ejwl~us2~CX", "Guest Service Agent")).toBeNull();
    expect(proposeByEmployer(null, "Pizza Maker")).toBeNull();
  });

  it("the judged exclusion count per employer is exactly what the guard removes", () => {
    const expected: Record<string, number> = {
      "fa-etjg-saasfaprod1~ocs~CX_1003": 0,
      "jobs.jcp.com": 1,
      "dollartree~wd5~dollartreeus": 3,
      "eluq~us2~CX_1": 3,
      "myview~wd3~paradox_careers": 4,
      "eofd~us6~CX_1": 8,
      dominos: 27,
    };
    for (const e of EMPLOYER_DEFAULTS) {
      expect(measure(e, JUDGMENTS[e.judgedKey]).excluded, e.token).toBe(expected[e.token]);
    }
  });

  it("the 23 refuted employers are not in the table, are real boards, and the rows say why -- and together with the seven they cover EVERY judged key", () => {
    const table = new Set(EMPLOYER_DEFAULTS.map((e) => e.token));
    expect(REFUTED.length).toBe(23);
    // Exhaustive over the judgement file: a key judged and neither defaulted
    // nor refuted is an employer a future lane could add without re-judging.
    const covered = new Set([...EMPLOYER_DEFAULTS.map((e) => e.judgedKey), ...REFUTED.map((r) => r.judgedKey).filter((k): k is string => !!k)]);
    expect(Object.keys(JUDGMENTS).filter((k) => !covered.has(k)), "judged keys neither defaulted nor refuted").toEqual([]);
    // shadow.ts's own negative set mirrors this table by judged key.
    expect(REFUTED_EMPLOYER_TOKENS.map(([k]) => k).sort()).toEqual(REFUTED.map((r) => r.judgedKey).filter((k): k is string => !!k).sort());
    for (const r of REFUTED) {
      for (const t of r.tokens) {
        expect(CATALOG_TOKENS.has(t), `${r.employer}: ${t} is not a sources.ts token — the list has rotted`).toBe(true);
        expect(table.has(t), `${r.employer} (${t}) must not carry a default: ${r.why}`).toBe(false);
      }
      if (r.judgedKey) {
        const rows = JUDGMENTS[r.judgedKey];
        expect(rows?.length, `${r.employer}: no judged rows under ${r.judgedKey}`).toBeGreaterThan(0);
        const b = bestFieldPurity(rows);
        // Refuted by the rows themselves: under the bar on purity or on n.
        const failsBar = b.purity < EMPLOYER_MIN_PURITY || b.n < EMPLOYER_MIN_N;
        expect(failsBar, `${r.employer}: best field ${b.field} ${b.purity.toFixed(3)} on n=${b.n} — not refuted by the rows`).toBe(true);
      }
    }
    for (const t of UNJUDGED_SIBLINGS) {
      expect(CATALOG_TOKENS.has(t), `${t} is not a sources.ts token`).toBe(true);
      expect(table.has(t), `${t} was never sampled and may not inherit a sibling's default`).toBe(false);
    }
  });

  it("the defaults are valid only through the rules version they were re-applied under", () => {
    // Judged on the v9 residue; the plan applied them after v10 rules on the
    // same sample. A later bump moves the residue and must re-judge first.
    expect(EMPLOYER_DEFAULTS_VALID_THROUGH_CATEGORIZE_VERSION).toBe(10);
    expect(CATEGORIZE_VERSION).toBeLessThanOrEqual(EMPLOYER_DEFAULTS_VALID_THROUGH_CATEGORIZE_VERSION);
  });

  describe("first claim: rule → employer → embed, disagreement writes 'conflict' and nothing else", () => {
    const rule = (target: ShadowProposal["target"], key = "commis"): ShadowProposal => ({ basis: "rule", key, target, confidence: 1 });
    const embed = (target: ShadowProposal["target"]): ShadowProposal => ({ basis: "embed", key: "embed_knn_v1", target, confidence: 0.7 });
    const emp = proposeByEmployer("eluq~us2~CX_1", "GROCERY/CLERK")!;

    it("rule wins when the employer agrees, and the row is stamped rule", () => {
      const c = resolveFirstClaim([emp, rule("hospitality_retail")]);
      expect(c.kind).toBe("claim");
      if (c.kind === "claim") expect(c.proposal.basis).toBe("rule");
    });

    it("employer wins when rule is silent; embed wins when both are silent", () => {
      const c = resolveFirstClaim([null, emp, embed("hospitality_retail")]);
      expect(c.kind === "claim" && c.proposal.basis).toBe("employer");
      const d = resolveFirstClaim([null, null, embed("finance")]);
      expect(d.kind === "claim" && d.proposal.target).toBe("finance");
    });

    it("the Kroger case: a rule proposal for a different field than the employer default is a conflict", () => {
      // CUSTOMER SVC/DEPT MANAGER ON DECK under the withheld abbreviation step.
      const c = resolveFirstClaim([rule("customer", "customer_svc"), emp]);
      expect(c.kind).toBe("conflict");
      const patch = shadowRowPatch(c, 10);
      expect(patch?.category_key).toBe(CONFLICT_KEY);
      expect(patch?.category_proposed).toBeNull();
      expect(patch?.category_basis).toBeNull();
    });

    it("order never decides the field: the same disagreement is a conflict in any input order", () => {
      expect(resolveFirstClaim([embed("sales"), rule("hospitality_retail")]).kind).toBe("conflict");
      expect(resolveFirstClaim([rule("hospitality_retail"), embed("sales")]).kind).toBe("conflict");
      expect(resolveFirstClaim([emp, embed("sales")]).kind).toBe("conflict");
    });

    it("silence writes nothing", () => {
      expect(resolveFirstClaim([null, null, undefined]).kind).toBe("silent");
      expect(shadowRowPatch(resolveFirstClaim([]), 10)).toBeNull();
    });

    it("an employer guard HOLDS the row: an F2-clearing embed vote cannot file a Domino's delivery row, nor a rule term a held title", () => {
      // mechA/judged.jsonl n=30: 'Delivery Expert(2140) - 445 Broadway', share 0.732, nn1 0.8565, centroid hospitality_retail -- clears F2.
      const vote = { field: "hospitality_retail", key: "embed_knn_v1", confidence: 0.732 };
      for (const title of ["Delivery Expert(2140) - 445 Broadway", "E-Biker(03653) - 328 Myrtle Ave", "CSR", "Domino's Pizza Maker/CSR Kenmore, WA (7062)"]) {
        expect(employerHolds("dominos", title), title).toBe(true);
        const res = resolveShadowRow({ title, company_token: "dominos", embed: vote });
        expect(res.kind, title).toBe("held");
        expect(shadowRowPatch(res, 10), `${title} must write nothing`).toBeNull();
      }
      // The same vote on an unheld Domino's title files by the employer (first claim), not by the vote.
      const ok = resolveShadowRow({ title: "Pizza Maker(01883)  401 West Villard", company_token: "dominos", embed: vote });
      expect(ok.kind === "claim" && ok.proposal.basis).toBe("employer");
      // A held title under another guard, with a rule term that would fire on it, is still held.
      expect(employerHolds("myview~wd3~paradox_careers", "Coordinator, Banquets")).toBe(true);
      expect(resolveShadowRow({ title: "Coordinator, Banquets", company_token: "myview~wd3~paradox_careers" }).kind).toBe("held");
      // No default, no hold: the vote stands on its own.
      expect(employerHolds("ejwl~us2~CX", "Delivery Expert")).toBe(false);
      expect(resolveShadowRow({ title: "Zqxv Wbrt Plmn", company_token: "ejwl~us2~CX", embed: vote }).kind).toBe("claim");
    });

    it("a claim's confidence is the employer's measured purity", () => {
      expect(emp.confidence).toBeCloseTo(115 / 117, 6);
    });
  });

  describe("no shadow pass may write category", () => {
    it("the patch shape has no category member, on every branch", () => {
      const emp = proposeByEmployer("dominos", "Pizza Maker")!;
      const claim = shadowRowPatch(resolveFirstClaim([emp]), 10);
      const conflict = shadowRowPatch(resolveFirstClaim([emp, { basis: "embed", key: "embed_knn_v1", target: "sales", confidence: 0.9 }]), 10);
      for (const patch of [claim, conflict]) {
        expect(patch).not.toBeNull();
        expect(Object.keys(patch!)).not.toContain("category");
        expect(Object.keys(patch!).sort()).toEqual([
          "category_basis",
          "category_confidence",
          "category_key",
          "category_proposed",
          "category_proposed_at",
          "category_proposed_v",
        ]);
      }
      expect(claim?.category_proposed).toBe("hospitality_retail");
      expect(claim?.category_proposed_v).toBe(10);
    });

    it("shadow.ts is pure: no client, no table write, no bare category key in code", () => {
      // Asserted against the comment-stripped source (house rule).
      expect(SHADOW_CODE).not.toMatch(/\.from\s*\(/);
      expect(SHADOW_CODE).not.toMatch(/\.(update|upsert|insert|rpc)\s*\(/);
      expect(SHADOW_CODE).not.toMatch(/createClient|supabase/i);
      expect(SHADOW_CODE).not.toMatch(/\bcategory\s*:/);
      expect(SHADOW_CODE).not.toMatch(/["']category["']/);
    });
  });

  describe("teeth: the guards bite on broken copies of the table", () => {
    const [dominos] = EMPLOYER_DEFAULTS.filter((e) => e.token === "dominos");
    const [albertsons] = EMPLOYER_DEFAULTS.filter((e) => e.token === "eofd~us6~CX_1");

    it("Domino's without its guard is 0.903 — the recomputation, not the pin, refuses it", () => {
      const unguarded: EmployerDefault = { ...dominos, guard: null };
      const m = measure(unguarded, JUDGMENTS.dominos);
      expect(m.purity).toBeCloseTo(215 / 238, 6);
      expect(m.purity).toBeLessThan(EMPLOYER_MIN_PURITY);
      // And the same for Albertsons: 0.933.
      const m2 = measure({ ...albertsons, guard: null }, JUDGMENTS["eofd~us6~CX_1"]);
      expect(m2.purity).toBeCloseTo(112 / 120, 6);
      expect(m2.purity).toBeLessThan(EMPLOYER_MIN_PURITY);
    });

    it("a pinned purity the rows do not support fails the recomputation", () => {
      const inflated: EmployerDefault = { ...albertsons, guard: null, purity: 1 };
      const m = measure(inflated, JUDGMENTS["eofd~us6~CX_1"]);
      expect(Math.abs(m.purity - inflated.purity)).toBeGreaterThan(1e-6);
    });

    it("the validator refuses a Marriott entry, a name-keyed entry, a shallow second page and a barred target", () => {
      const marriott: EmployerDefault = {
        ...dominos,
        token: "ejwl~us2~CX",
        judgedKey: "ejwl~us2~CX",
        guard: null,
        mode: "strict",
        purity: 50 / 60,
        n: 60,
        unguarded: { right: 50, n: 60 },
        secondPage: { right: 0, n: 0, offset: 0 },
        bucketTotal: 4263,
      };
      const v = validateEmployerDefaults([marriott], CATALOG_TOKENS).map((x) => x.reason);
      expect(v.some((r) => r.startsWith("purity"))).toBe(true);
      expect(v).toContain("no second page");

      const byName: EmployerDefault = { ...dominos, token: "Domino's" };
      expect(validateEmployerDefaults([byName], CATALOG_TOKENS).map((x) => x.reason)).toContain("token is not in sources.ts");

      const shallow: EmployerDefault = { ...dominos, secondPage: { ...dominos.secondPage, offset: 60 } };
      expect(validateEmployerDefaults([shallow], CATALOG_TOKENS).some((x) => x.reason.includes("outside the band"))).toBe(true);

      const barred: EmployerDefault = { ...dominos, target: "product" };
      expect(validateEmployerDefaults([barred], CATALOG_TOKENS).some((x) => x.reason.includes("barred"))).toBe(true);

      const conditionalNoGuard: EmployerDefault = { ...dominos, guard: null };
      expect(validateEmployerDefaults([conditionalNoGuard], CATALOG_TOKENS).map((x) => x.reason)).toContain("conditional default without a guard");

      const dup = validateEmployerDefaults([dominos, dominos], CATALOG_TOKENS).map((x) => x.reason);
      expect(dup).toContain("duplicate token");
    });

    it("a refuted employer's rows really do fail the bar (the negative set is data, not prose)", () => {
      expect(bestFieldPurity(JUDGMENTS["ejwl~us2~CX"]).purity).toBeCloseTo(50 / 60, 6);
      expect(bestFieldPurity(JUDGMENTS["egud~us2~CX_1"]).purity).toBeCloseTo(35 / 60, 6);
      expect(bestFieldPurity(JUDGMENTS.saks).n).toBe(26);
      expect(bestFieldPurity(JUDGMENTS.cityny).purity).toBe(0);
    });
  });
});
