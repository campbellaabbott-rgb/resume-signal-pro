import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { categorize, CATEGORIZE_VERSION } from "../../supabase/functions/job-board/categories";

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
 */
describe("a social worker is not an unclassifiable job (v9)", () => {
  it("the version is bumped so the stored-row sweep re-runs", () => {
    expect(CATEGORIZE_VERSION).toBe(9);
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
