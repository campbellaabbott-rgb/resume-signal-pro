/**
 * A POSTING IS QUOTED, NEVER JUDGED.
 *
 * Ontario's Employment Standards Act, 2000 gained Part III.1 on 1 January
 * 2026, and this repository now reads four of its clauses off our own corpus.
 * The whole feature rests on one restraint: it reports what a posting's text
 * states and never whether an employer complied, because O. Reg. 476/24 s.1
 * exempts an employer under a headcount threshold and this database holds no
 * headcount for any employer on any row. Nothing in the schema can tell us
 * whether the statute reached a given posting at all.
 *
 * WHAT THIS FILE GUARDS, and why each one was a real way to get it wrong:
 *
 *  1. THE READER'S SCOPE. Rows come from the stored subdivision code, not
 *     from the public board's fuzzy location term -- that term expands to a
 *     list that also matches Ontario, California and Ontario, Ohio, and a
 *     compliance-shaped panel on a Californian posting is a different kind of
 *     wrong. Dropped postings are excluded, and the two exclusions O. Reg.
 *     476/24 actually gives us (the annual compensation ceiling, work
 *     performed outside Ontario) are applied inside the reader.
 *
 *  2. THE DOOR. The reader is SECURITY DEFINER because the corpus table is
 *     closed to anon, and a default grant to PUBLIC is invisible, so the
 *     revoke names the roles and comes BEFORE the grant.
 *
 *  3. NO VERDICT LEAVES THE DATABASE. The returned column list carries
 *     evidence and a provenance label and nothing that could be read as a
 *     score, a share or a judgement.
 *
 *  4. THE SCREENING FALSE POSITIVE, which was measured on a real posting: a
 *     legal co-op whose DUTIES involved the technology matched a bare phrase
 *     count. Both runtimes require the phrase to stand within a small window
 *     of a screening verb or the applicant noun, and the window is ONE number
 *     mirrored across the runtime boundary -- the migration compiles it into
 *     its pattern, the component re-checks the evidence it is handed with it,
 *     and a drift between them fails here.
 *
 *  5. THE PANEL. The two unconditional clauses print either the quote or "we
 *     could not find it"; the two that are not affirmative duties (screening
 *     disclosure binds only an employer that screens; Canadian experience is
 *     a prohibition) print ONLY when there is evidence, and the panel renders
 *     nothing at all when the reader answers with no row.
 *
 * COMMENT-STRIPPED, ALWAYS. Every assertion over the migration and over the
 * component reads code with comments removed. This repository has shipped a
 * dead guard four times by counting a literal that lived only in a header
 * comment, and the migration's header necessarily discusses the very literals
 * asserted below. The strip is proven to work in its own test before anything
 * depends on it.
 *
 * WHAT THE MIGRATION ASSERTIONS HERE ARE, AND ARE NOT. They are a cheap second
 * layer: a literal present in a comment-stripped file cannot tell you which
 * CTE it sits in, whether it is in a WHERE or in a SELECT list, or whether the
 * pattern it builds is ever applied. The PROOF that each predicate does
 * something lives in
 * src/test/the-ontario-reader-is-asked-real-postings-not-read-as-text.test.ts,
 * which applies this migration to a real Postgres, asks it eight postings, and
 * removes each predicate in turn to show the answer move. Read the two
 * together; do not add a behavioural claim to this file without adding the
 * posting that proves it over there.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a) },
}));

import {
  ONTARIO_ESA,
  ONTARIO_ESA_LINKS,
  OntarioEsaDisclosures,
  PAY_WORDS,
  aiEvidenceIsDisclosureShaped,
  payEvidenceIsFigureShaped,
  readOntarioDisclosureRow,
} from "../components/jobs/OntarioEsaDisclosures";

const MIG_DIR = resolve(__dirname, "../../supabase/migrations");
const MIG_FILE = "20260923191713_a_posting_is_quoted_never_judged.sql";
const MIG_RAW = readFileSync(resolve(MIG_DIR, MIG_FILE), "utf8");

/** SQL with its comments gone. See the header: the assertions below are only
 *  worth anything against this view of the file. */
const stripSql = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
const MIG = stripSql(MIG_RAW);

const COMPONENT_RAW = readFileSync(resolve(__dirname, "../components/jobs/OntarioEsaDisclosures.tsx"), "utf8");
const stripTs = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const COMPONENT = stripTs(COMPONENT_RAW);

/** Measured on real Ontario postings, 2026-09-22. */
const AI_DISCLOSURE_VEOLIA =
  "Artificial Intelligence (AI) Disclosure: We do not use Artificial Intelligence (AI) to screen, assess, or select applicants for this position.";
const AI_DISCLOSURE_AECOM =
  "Artificial intelligence will be used to support the screening, assessment, and selection of applicants for this role.";
/** The false positive: the technology is the JOB, not the screening method.
 *  A screening verb exists in the sentence but far outside the window. */
const AI_DUTIES_NOT_A_DISCLOSURE =
  "Responsibilities include drafting artificial intelligence prompts for the legal team, summarising research outputs, and preparing the materials the partners review before we select external counsel.";
const VACANCY_FARM_BOY =
  "We do not use AI to assist in the recruitment process and this job posting is for an existing vacancy.";
const PAY_HOURLY = "$37.74 - $52.73 per hour";

const ROW = {
  od_id: "workday:acme:R-1",
  od_read_at: new Date("2026-09-22T12:00:00Z").toISOString(),
  od_pay_evidence: PAY_HOURLY,
  od_pay_basis: "salary_field",
  od_vacancy_evidence: VACANCY_FARM_BOY,
  od_ai_evidence: AI_DISCLOSURE_VEOLIA,
  od_canadian_experience_evidence: null,
};

const answer = (rows: unknown[]) => { rpc.mockReset(); rpc.mockResolvedValue({ data: rows, error: null }); };

beforeEach(() => { rpc.mockReset(); });
afterEach(() => cleanup());

describe("the strip this file depends on", () => {
  it("removes a literal that lives only in a comment (guards the guard)", () => {
    const decoy = "-- region_code = 'CA-ON' is named here in prose\nSELECT 1;";
    expect(decoy).toContain("CA-ON");
    expect(stripSql(decoy)).not.toContain("CA-ON");
    const tsDecoy = "// aiProximityChars is 40 in prose\nconst x = 1;";
    expect(stripTs(tsDecoy)).not.toContain("aiProximityChars");
  });
});

describe("the reader is scoped, excluded and shut", () => {
  it("ships exactly one function, and it is the Ontario disclosure reader", () => {
    expect(readdirSync(MIG_DIR)).toContain(MIG_FILE);
    const creates = [...MIG.matchAll(/CREATE (?:OR REPLACE )?FUNCTION\s+public\.(\w+)/gi)].map((m) => m[1]);
    expect(creates).toEqual(["get_ontario_posting_disclosures"]);
  });

  it("scopes by the stored subdivision code and never by a location term", () => {
    expect(MIG).toMatch(/'CA-ON'::text\s+AS region_scope/);
    expect(MIG).toMatch(/p\.region_code\s*=\s*k\.region_scope/);
    // The fuzzy term is what the public board filters on; it must not appear
    // in the reader at all, in any column or predicate.
    expect(MIG, "the reader must not touch the fuzzy location string").not.toMatch(/\blocation\b/i);
  });

  it("reads only postings the employer's feed still lists", () => {
    expect(MIG).toMatch(/p\.missing_since IS NULL/);
  });

  it("applies the exclusions in the currency the ceiling is written in", () => {
    expect(MIG).toMatch(/200000::numeric\s+AS comp_exempt_annual/);
    expect(MIG).toMatch(/COALESCE\(p\.salary_max_annual, p\.salary_min_annual\) <= k\.comp_exempt_annual/);
    // THE CEILING IS A CANADIAN-DOLLAR NUMBER and the board's annual columns
    // are not converted, so the comparison has to be fenced to postings priced
    // in that currency or in none. Without the fence a US-dollar posting above
    // the real ceiling states a SMALLER number and passes -- the panel then
    // prints its could-not-find copy for a clause that never bound, and the
    // header's claim that the error direction is always exclusion is false for
    // every currency stronger than the Canadian dollar. Proved by execution in
    // the behavioural file; pinned here so the fence cannot be quietly dropped.
    expect(MIG, "the ceiling is compared without a currency fence")
      .toMatch(/upper\(btrim\(COALESCE\(p\.salary_currency, 'CAD'\)\)\) = 'CAD'/);
    expect(MIG).toMatch(/p\.remote IS NOT TRUE/);
    // ...and the panel's own ceiling is formatted in that same currency, so
    // the printed threshold and the applied threshold are one quantity.
    expect(COMPONENT).toMatch(/currency:\s*"CAD"/);
  });

  it("the pay fallback needs a figure near a pay word, not a digit anywhere", () => {
    // A bare digit is a wider door than s. 8.2(1) needs: a pay field holding a
    // grade, a band or a requisition number was quoted as what the posting
    // states for expected compensation. Both runtimes carry the same rule, and
    // the client's list of pay words is the one asserted against the SQL's.
    expect(MIG, "the pay fallback opens on any digit").not.toMatch(/WHEN s\.salary ~ '\[0-9\]'/);
    expect(MIG).toMatch(/pay_word_fwd/);
    expect(MIG).toMatch(/pay_word_rev/);
    for (const word of PAY_WORDS) {
      expect(MIG, `the reader's pay-word list is missing ${word}`).toContain(word);
    }
    expect(COMPONENT, "the client no longer re-checks the pay evidence at all").toMatch(/payEvidenceIsFigureShaped\(rawPay\)/);
  });

  it("the client mirror admits a rate and refuses a grade", () => {
    expect(payEvidenceIsFigureShaped("$37.74 - $52.73 per hour")).toBe(true);
    expect(payEvidenceIsFigureShaped("18.75 per hour")).toBe(true);
    expect(payEvidenceIsFigureShaped("salary for this position is 85,000 annually")).toBe(true);
    expect(payEvidenceIsFigureShaped("Grade 7, requisition 128455")).toBe(false);
    expect(payEvidenceIsFigureShaped("Band 4")).toBe(false);
    expect(payEvidenceIsFigureShaped("Competitive salary")).toBe(false);
  });

  it("runs as its owner, and the revoke names the roles before the grant", () => {
    expect(MIG).toMatch(/SECURITY DEFINER/);
    const revoke = MIG.indexOf("REVOKE ALL ON FUNCTION public.get_ontario_posting_disclosures(text) FROM PUBLIC, anon, authenticated;");
    const grant = MIG.indexOf("GRANT EXECUTE ON FUNCTION public.get_ontario_posting_disclosures(text) TO anon, authenticated, service_role;");
    expect(revoke, "the revoke must name PUBLIC, anon and authenticated").toBeGreaterThan(-1);
    expect(grant, "the panel is public, so anon needs EXECUTE").toBeGreaterThan(-1);
    expect(revoke, "a grant before a revoke is a grant that gets revoked").toBeLessThan(grant);
    // ...and it proves its own end state rather than assuming it.
    expect(MIG).toMatch(/prosecdef/);
    expect(MIG).toMatch(/aclexplode/);
  });

  it("returns evidence and provenance -- no verdict, no score, no share", () => {
    const table = /RETURNS TABLE \(([\s\S]*?)\)\s*LANGUAGE/.exec(MIG);
    expect(table, "could not find the returned column list").not.toBeNull();
    const cols = table![1];
    expect(cols).toMatch(/od_pay_evidence/);
    expect(cols).toMatch(/od_vacancy_evidence/);
    expect(cols).toMatch(/od_ai_evidence/);
    expect(cols).toMatch(/od_canadian_experience_evidence/);
    for (const banned of ["verdict", "score", "compliant", "compliance", "percent", "pct", "share", "violation", "flag"]) {
      expect(cols.toLowerCase(), `the reader must not return a ${banned} column`).not.toContain(banned);
    }
  });

  it("says in its stored comment that the exemption is unknowable and forbids the accusation", () => {
    // COMMENT ON FUNCTION is a string literal, so it survives the strip on
    // purpose: it is the instruction that travels with the function.
    expect(MIG).toMatch(/IS NOT KNOWABLE FROM OUR DATA/);
    expect(MIG).toMatch(/may\s+'\s*\n?\s*'?ever say that an employer broke the law|ever say that an employer broke the law/);
    expect(MIG).toMatch(/with the section cited/);
  });
});

describe("the screening window is one number, on both sides of the runtime boundary", () => {
  it("the migration compiles the component's window into its pattern", () => {
    expect(MIG).toMatch(new RegExp(`${ONTARIO_ESA.aiProximityChars}::int\\s+AS ai_near_chars`));
    expect(MIG).toMatch(new RegExp(`${ONTARIO_ESA.payProximityChars}::int\\s+AS pay_near_chars`));
    expect(MIG).toMatch(new RegExp(`'${ONTARIO_ESA.regionCode}'::text`));
    expect(MIG).toMatch(new RegExp(`${ONTARIO_ESA.compensationExemptCad}::numeric`));
    // The pattern must be BUILT from those constants, not typed beside them.
    expect(MIG).toMatch(/format\('\(artificial intelligence\.\{0,%s\}\?\(\?:screen\|assess\|select\|applicant\)\)', k\.ai_near_chars\)/);
    expect(MIG).toMatch(/format\('\(\(\?:screen\|assess\|select\|applicant\)\.\{0,%s\}\?artificial intelligence\)', k\.ai_near_chars\)/);
  });

  it("a posting ABOUT the technology is not a disclosure about screening", () => {
    // The measured false positive. A screening verb is present in the
    // sentence; it is simply nowhere near the phrase.
    expect(AI_DUTIES_NOT_A_DISCLOSURE).toContain("artificial intelligence");
    expect(AI_DUTIES_NOT_A_DISCLOSURE).toContain("select");
    expect(aiEvidenceIsDisclosureShaped(AI_DUTIES_NOT_A_DISCLOSURE)).toBe(false);
    // Positive controls, so the refusal above cannot be satisfied by a
    // matcher that refuses everything.
    expect(aiEvidenceIsDisclosureShaped(AI_DISCLOSURE_VEOLIA)).toBe(true);
    expect(aiEvidenceIsDisclosureShaped(AI_DISCLOSURE_AECOM)).toBe(true);
    // Either order, because the reader matches in both.
    expect(aiEvidenceIsDisclosureShaped("applicants may be screened using artificial intelligence")).toBe(true);
  });

  it("accepts what the reader actually emits, not just what this file imagines", () => {
    // The SQL returns a WINDOW, not the sentence: these two strings are the
    // literal od_ai_evidence values the function produced when the migration
    // was executed against the Veolia and AECOM fixtures. A client mirror
    // that only accepts tidy sentences would blank a real disclosure.
    for (const emitted of [
      "Artificial Intelligence (AI) to screen",
      "Artificial intelligence will be used to support the screen",
    ]) {
      expect(aiEvidenceIsDisclosureShaped(emitted), `the reader emits "${emitted}" and the client drops it`).toBe(true);
      expect(readOntarioDisclosureRow({ ...ROW, od_ai_evidence: emitted })!.aiEvidence).toBe(emitted);
    }
    // The vacancy window the reader emits is a mid-sentence slice, and the
    // client keeps it for the same reason.
    const vacancyWindow = "or select applicants for this position. Vacancy Status: This posting is for an existing vacancy.";
    expect(readOntarioDisclosureRow({ ...ROW, od_vacancy_evidence: vacancyWindow })!.vacancyEvidence).toBe(vacancyWindow);
    // And the description-basis pay evidence, with its own basis label.
    const bodyPay = readOntarioDisclosureRow({ ...ROW, od_pay_evidence: "salary for this position is $85,000 per year", od_pay_basis: "description" })!;
    expect(bodyPay.payEvidence).toBe("salary for this position is $85,000 per year");
    expect(bodyPay.payBasis).toBe("description");
  });
});

describe("the row the client keeps is the row the rules admit", () => {
  it("drops evidence that arrives outside the rule that should have produced it", () => {
    const base = { ...ROW };
    expect(readOntarioDisclosureRow(base)!.aiEvidence).toBe(AI_DISCLOSURE_VEOLIA);
    expect(readOntarioDisclosureRow({ ...base, od_ai_evidence: AI_DUTIES_NOT_A_DISCLOSURE })!.aiEvidence).toBeNull();
    // A pay field that names no figure states no compensation...
    expect(readOntarioDisclosureRow({ ...base, od_pay_evidence: "Competitive salary" })!.payEvidence).toBeNull();
    // ...and a number that is not near a pay word is a grade, not a rate.
    expect(readOntarioDisclosureRow({ ...base, od_pay_evidence: "Grade 7, requisition 128455" })!.payEvidence).toBeNull();
    // Provenance is part of the evidence: no basis, no line.
    expect(readOntarioDisclosureRow({ ...base, od_pay_basis: "guessed" })!.payEvidence).toBeNull();
    expect(readOntarioDisclosureRow({ ...base, od_vacancy_evidence: "we are hiring" })!.vacancyEvidence).toBeNull();
    expect(readOntarioDisclosureRow({ ...base, od_canadian_experience_evidence: "5 years experience" })!.canadianExperienceEvidence).toBeNull();
    expect(readOntarioDisclosureRow({ ...base, od_canadian_experience_evidence: "must have Canadian experience" })!.canadianExperienceEvidence)
      .toBe("must have Canadian experience");
    // Not a row at all.
    expect(readOntarioDisclosureRow({ ...base, od_id: null })).toBeNull();
    expect(readOntarioDisclosureRow({ ...base, od_read_at: "whenever" })).toBeNull();
    expect(readOntarioDisclosureRow(null)).toBeNull();
  });
});

describe("the panel prints the posting's words, the clause, and the links", () => {
  const POSTING_URL = "https://careers.example.ca/jobs/R-1";

  it("quotes each clause verbatim beside its section, with all three links", async () => {
    answer([ROW]);
    const { container } = render(<OntarioEsaDisclosures postingId={ROW.od_id} postingUrl={POSTING_URL} />);
    await waitFor(() => expect(container.querySelector("[data-esa-panel='ontario']")).not.toBeNull());
    expect(rpc).toHaveBeenCalledWith("get_ontario_posting_disclosures", { p_id: ROW.od_id });

    const text = container.textContent ?? "";
    expect(text).toContain(PAY_HOURLY);
    expect(text).toContain(VACANCY_FARM_BOY);
    expect(text).toContain(AI_DISCLOSURE_VEOLIA);
    expect(text).toMatch(/8\.2\(1\)/);
    expect(text).toMatch(/8\.5\(1\)\(a\)/);
    expect(text).toMatch(/8\.4\(1\)/);
    expect(text).toContain(ONTARIO_ESA.regionCode);
    expect(text).toContain(String(ONTARIO_ESA.minEmployees));

    const href = (k: string) => container.querySelector(`[data-esa-link='${k}']`)?.getAttribute("href");
    expect(href("statute")).toBe(ONTARIO_ESA_LINKS.statute);
    expect(href("regulation")).toBe(ONTARIO_ESA_LINKS.regulation);
    expect(href("posting")).toBe(POSTING_URL);

    // No raw i18n keys reached the page.
    expect(text).not.toMatch(/ontarioEsa\./);
  });

  it("the two present-only clauses render only when there is evidence", async () => {
    answer([{ ...ROW, od_ai_evidence: AI_DUTIES_NOT_A_DISCLOSURE, od_canadian_experience_evidence: null }]);
    const { container, unmount } = render(<OntarioEsaDisclosures postingId={ROW.od_id} postingUrl={POSTING_URL} />);
    await waitFor(() => expect(container.querySelector("[data-esa-panel='ontario']")).not.toBeNull());
    expect(container.querySelector("[data-esa-clause='ai']"), "a posting ABOUT the technology is not a disclosure").toBeNull();
    expect(container.querySelector("[data-esa-clause='canadian-experience']")).toBeNull();
    // The unconditional pair still renders, so the nulls above are the rule
    // working rather than the panel failing.
    expect(container.querySelector("[data-esa-clause='pay']")).not.toBeNull();
    expect(container.querySelector("[data-esa-clause='vacancy']")).not.toBeNull();
    unmount();

    answer([{ ...ROW, od_ai_evidence: AI_DISCLOSURE_AECOM }]);
    const second = render(<OntarioEsaDisclosures postingId={ROW.od_id} postingUrl={POSTING_URL} />);
    await waitFor(() => expect(second.container.querySelector("[data-esa-clause='ai']")).not.toBeNull());
    expect(second.container.textContent).toContain(AI_DISCLOSURE_AECOM);
  });

  it("the exclusions line names what was applied, not a clause that was not", async () => {
    // IT NAMED THE WRONG BASIS. The line told the reader that remote postings
    // were left out because O. Reg. 476/24 exempts work performed outside
    // Ontario -- but a role worked remotely FROM Ontario is work performed in
    // Ontario, and what the reader actually drops is whatever the employer's
    // feed flags as remote. Nine locales said the same wrong thing.
    answer([ROW]);
    const { container } = render(<OntarioEsaDisclosures postingId={ROW.od_id} postingUrl={POSTING_URL} />);
    await waitFor(() => expect(container.querySelector("[data-esa-panel='ontario']")).not.toBeNull());
    const text = (container.textContent ?? "").toLowerCase();
    expect(text, "the line does not say the remote exclusion is the feed's own flag").toMatch(/flags? as remote/);
    expect(text, "the line does not name the currency rule the ceiling needs").toMatch(/another currency/);
    expect(text, "the line still calls a remote posting work done elsewhere").not.toContain("work done elsewhere");
  });

  it("an absent unconditional clause is said as what we could not find, not as a failure", async () => {
    answer([{ ...ROW, od_pay_evidence: null, od_pay_basis: null, od_vacancy_evidence: null }]);
    const { container } = render(<OntarioEsaDisclosures postingId={ROW.od_id} postingUrl={POSTING_URL} />);
    await waitFor(() => expect(container.querySelector("[data-esa-panel='ontario']")).not.toBeNull());
    const text = (container.textContent ?? "").toLowerCase();
    expect(container.querySelector("[data-esa-clause='pay']")).not.toBeNull();
    expect(text).toContain("we found no stated figure");
    for (const word of ["illegal", "unlawful", "violation", "non-compliant", "breach", "penalty", "failed to comply"]) {
      expect(text, `the panel must never say "${word}"`).not.toContain(word);
    }
    expect(text, "no share, no rate, no percentage on this surface").not.toContain("%");
  });

  it("renders nothing when the reader answers with no row", async () => {
    answer([]);
    const { container } = render(<OntarioEsaDisclosures postingId={ROW.od_id} postingUrl={POSTING_URL} />);
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });

  it("renders nothing when the reader is not there yet", async () => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
    const { container } = render(<OntarioEsaDisclosures postingId={ROW.od_id} postingUrl={POSTING_URL} />);
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });
});

describe("the component's own code carries no verdict", () => {
  it("states no compliance conclusion anywhere in its comment-stripped source", () => {
    const code = COMPONENT.toLowerCase();
    for (const word of ["illegal", "unlawful", "violation", "non-compliant", "noncompliant", "penalty", "broke the law", "failed to comply"]) {
      expect(code, `${word} appears in the component's code`).not.toContain(word);
    }
    // ...and the strip is not hiding the check: the file DOES discuss those
    // ideas in prose, which is where they belong.
    expect(COMPONENT_RAW.toLowerCase()).toContain("broke the law");
  });
});
