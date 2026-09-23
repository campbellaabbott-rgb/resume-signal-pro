// @vitest-environment node
/**
 * THE ONTARIO READER IS ASKED REAL POSTINGS, NOT READ AS TEXT.
 *
 * WHAT THIS GUARDS, and why it exists as a second file. Its sibling,
 * a-posting-is-quoted-never-judged.test.tsx, guards the same feature but
 * checks the SQL half with regexes over the migration's comment-stripped
 * text: the region predicate is present, the ceiling comparison is present,
 * the proximity pattern is built from the constant. Every one of those is a
 * SPELLING. A literal present in a file says nothing about which CTE it sits
 * in, whether it is in a WHERE or in a SELECT list, or whether the pattern it
 * builds is ever applied -- which is exactly the failure project_guard_literals
 * names: guards that pin spellings pass while the code is dead. That file's
 * own "accepts what the reader actually emits" case had to paste two strings a
 * human had produced by running the migration BY HAND, so the next edit to the
 * SQL could not re-check them.
 *
 * So this file does what the LCA lane in the same build already does: applies
 * the migration to a real Postgres (pglite) over the minimum shape of the
 * corpus table it reads, and asks it postings. Six of them are the cases the
 * feature was designed around and two are the defects found in review:
 *
 *   1. An Ontario posting with an hourly rate in its pay field -- the case the
 *      board's own stated-pay filter cannot see, and the reason this reader
 *      does not use that filter.
 *   2. A Californian posting. Out of scope by the STORED subdivision code,
 *      never by the fuzzy location term the public board filters on (which
 *      expands to a list that also catches Ontario, California).
 *   3. A posting the employer's feed has dropped.
 *   4. A posting above O. Reg. 476/24 s.3's compensation ceiling.
 *   5. A posting at 150,000 US DOLLARS -- roughly CA$205,000, i.e. ABOVE the
 *      ceiling and therefore exempt, but 150000 <= 200000 is true. The board's
 *      annual columns are not converted, so the ceiling was judging a number
 *      it was not denominated in, and the migration's header claimed the error
 *      direction was always exclusion. It is not: for a currency stronger than
 *      the Canadian dollar it errs the other way, and the posting was
 *      surfaced.
 *   6. A posting the employer's feed flags as remote.
 *   7. The measured false positive: a legal co-op whose DUTIES involve the
 *      technology, with a screening verb in the same sentence but far outside
 *      the window.
 *   8. A pay field holding a GRADE and a requisition number. A bare digit is a
 *      wider door than s. 8.2(1) needs, and the fallback that quotes the whole
 *      pay field used to open on one.
 *
 * TEETH. Each predicate is removed from the migration text before it is
 * applied, and the mutated database must give a DIFFERENT answer. A predicate
 * that can be deleted without changing any answer was never doing anything,
 * and no regex over the file can tell you that.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
const READER = "20260923191713";
const migSql = (prefix: string) => {
  const f = readdirSync(MIGRATIONS).find((x) => x.startsWith(prefix) && x.endsWith(".sql"));
  if (!f) throw new Error(`no migration starts with ${prefix}`);
  return readFileSync(resolve(MIGRATIONS, f), "utf8");
};

/**
 * The minimum shape of the corpus table this reader touches, and nothing else.
 *
 * Every column here is one the reader names. Booting the whole 680-file
 * migration set would make this slow and would stop telling us anything about
 * THIS migration; the shape is small on purpose, and a column the reader
 * starts reading that is not here fails loudly at apply time.
 */
const TABLE = `
  CREATE TABLE public.job_board_postings (
    id                text PRIMARY KEY,
    region_code       text,
    missing_since     timestamptz,
    remote            boolean NOT NULL DEFAULT false,
    salary            text,
    salary_currency   text,
    salary_min_annual numeric,
    salary_max_annual numeric,
    description       text,
    last_seen         timestamptz NOT NULL DEFAULT now()
  );
`;

const AI_DISCLOSURE =
  "Artificial Intelligence (AI) Disclosure: We do not use Artificial Intelligence (AI) to screen, assess, or select applicants for this position.";
const AI_DUTIES_NOT_A_DISCLOSURE =
  "Responsibilities include drafting artificial intelligence prompts for the legal team, summarising research outputs, and preparing the materials the partners review before we select external counsel.";
const VACANCY = "This job posting is for an existing vacancy.";

interface Posting {
  id: string;
  region_code?: string | null;
  missing_since?: string | null;
  remote?: boolean;
  salary?: string | null;
  salary_currency?: string | null;
  salary_min_annual?: number | null;
  salary_max_annual?: number | null;
  description?: string | null;
}

const POSTINGS: Posting[] = [
  {
    id: "workday:acme:ON-1",
    region_code: "CA-ON",
    salary: "$37.74 - $52.73 per hour",
    salary_currency: "CAD",
    description: `${VACANCY} ${AI_DISCLOSURE}`,
  },
  { id: "workday:acme:CA-1", region_code: "US-CA", salary: "$37.74 - $52.73 per hour", salary_currency: "USD", description: VACANCY },
  { id: "workday:acme:ON-DROPPED", region_code: "CA-ON", missing_since: "2026-09-01T00:00:00Z", salary: "$40.00 per hour", salary_currency: "CAD", description: VACANCY },
  { id: "workday:acme:ON-RICH", region_code: "CA-ON", salary: "CAD 260,000 per year", salary_currency: "CAD", salary_min_annual: 240000, salary_max_annual: 260000, description: VACANCY },
  { id: "workday:acme:ON-USD", region_code: "CA-ON", salary: "USD 150,000 per year", salary_currency: "USD", salary_min_annual: 140000, salary_max_annual: 150000, description: VACANCY },
  { id: "workday:acme:ON-REMOTE", region_code: "CA-ON", remote: true, salary: "$45.00 per hour", salary_currency: "CAD", description: VACANCY },
  { id: "workday:acme:ON-COOP", region_code: "CA-ON", salary: "$25.00 per hour", salary_currency: "CAD", description: `${VACANCY} ${AI_DUTIES_NOT_A_DISCLOSURE}` },
  { id: "workday:acme:ON-GRADE", region_code: "CA-ON", salary: "Grade 7, requisition 128455", salary_currency: "CAD", description: "We are hiring." },
];

type Row = Record<string, unknown>;

async function boot(mutate?: { find: string; replace: string }): Promise<PGlite> {
  const db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
  await db.exec(TABLE);
  let sql = migSql(READER);
  if (mutate) {
    expect(sql.includes(mutate.find), `the reader no longer contains ${JSON.stringify(mutate.find)} -- the mutation proves nothing`).toBe(true);
    sql = sql.split(mutate.find).join(mutate.replace);
  }
  await db.exec(sql);
  for (const p of POSTINGS) {
    await db.query(
      `INSERT INTO public.job_board_postings
         (id, region_code, missing_since, remote, salary, salary_currency, salary_min_annual, salary_max_annual, description)
       VALUES ($1, $2, $3::timestamptz, $4, $5, $6, $7, $8, $9)`,
      [p.id, p.region_code ?? null, p.missing_since ?? null, p.remote ?? false, p.salary ?? null,
        p.salary_currency ?? null, p.salary_min_annual ?? null, p.salary_max_annual ?? null, p.description ?? null],
    );
  }
  return db;
}

const ask = async (db: PGlite, id: string): Promise<Row[]> =>
  (await db.query<Row>("SELECT * FROM public.get_ontario_posting_disclosures($1)", [id])).rows;

let db: PGlite;
beforeAll(async () => { db = await boot(); }, 60_000);
afterAll(async () => { await db?.close(); });

describe("the reader answers an Ontario posting with its own words", () => {
  it("quotes the hourly rate the board's stated-pay filter cannot see", async () => {
    const [row] = await ask(db, "workday:acme:ON-1");
    expect(row, "the in-scope Ontario posting came back with no row at all").toBeTruthy();
    expect(row.od_pay_evidence).toBe("$37.74 - $52.73 per hour");
    expect(row.od_pay_basis).toBe("salary_field");
    expect(String(row.od_vacancy_evidence)).toContain("existing vacanc");
    expect(String(row.od_ai_evidence).toLowerCase()).toContain("artificial intelligence");
  });

  it("a posting whose DUTIES involve the technology is not a screening disclosure", async () => {
    const [row] = await ask(db, "workday:acme:ON-COOP");
    expect(row).toBeTruthy();
    // The phrase is there and a screening verb is in the same sentence; the
    // window is what keeps it out.
    expect(POSTINGS[6].description).toContain("artificial intelligence");
    expect(POSTINGS[6].description).toContain("select");
    expect(row.od_ai_evidence, "a role ABOUT the technology was printed as a disclosure about screening").toBeNull();
  });

  it("a pay field stating a grade and a requisition number is not a statement about pay", async () => {
    const [row] = await ask(db, "workday:acme:ON-GRADE");
    expect(row, "the posting is in scope and must still be answered").toBeTruthy();
    expect(row.od_pay_evidence, "a grade and a requisition number were quoted as expected compensation").toBeNull();
    expect(row.od_pay_basis).toBeNull();
  });
});

describe("the exclusions are the ones the copy names", () => {
  it.each([
    ["a posting outside the stored Ontario subdivision code", "workday:acme:CA-1"],
    ["a posting the employer's feed has dropped", "workday:acme:ON-DROPPED"],
    ["a posting above the compensation ceiling", "workday:acme:ON-RICH"],
    ["a posting priced in a currency the ceiling is not denominated in", "workday:acme:ON-USD"],
    ["a posting the employer's feed flags as remote", "workday:acme:ON-REMOTE"],
  ])("%s answers zero rows", async (_label, id) => {
    expect(await ask(db, id)).toHaveLength(0);
  });

  it("the currency case is the one that used to come back, and it is a real exemption", async () => {
    // US$150,000 is roughly CA$205,000: above the ceiling, therefore exempt.
    // 150000 <= 200000 is true, so the row passed a test written in a
    // different currency. The header claimed the error direction was always
    // exclusion; for a currency stronger than the Canadian dollar it is not.
    const kept = await boot({
      find: "      AND (COALESCE(p.salary_max_annual, p.salary_min_annual) IS NULL\n           OR (upper(btrim(COALESCE(p.salary_currency, 'CAD'))) = 'CAD'\n               AND COALESCE(p.salary_max_annual, p.salary_min_annual) <= k.comp_exempt_annual))",
      replace: "      AND (COALESCE(p.salary_max_annual, p.salary_min_annual) IS NULL\n           OR COALESCE(p.salary_max_annual, p.salary_min_annual) <= k.comp_exempt_annual)",
    });
    expect(await ask(kept, "workday:acme:ON-USD"), "the mutation did not apply -- RE-ANCHOR this tooth").toHaveLength(1);
    // ...and the Canadian posting above the ceiling is still excluded either
    // way, so the mutation isolates the currency and not the ceiling.
    expect(await ask(kept, "workday:acme:ON-RICH")).toHaveLength(0);
    await kept.close();
  }, 30_000);
});

describe("teeth: every predicate removed changes an answer", () => {
  it("without the subdivision predicate, a Californian posting is answered", async () => {
    const bad = await boot({ find: "      AND p.region_code = k.region_scope\n", replace: "" });
    expect(await ask(bad, "workday:acme:CA-1")).toHaveLength(1);
    await bad.close();
  }, 30_000);

  it("without the dropped-posting predicate, a posting the feed no longer lists is answered", async () => {
    const bad = await boot({ find: "      AND p.missing_since IS NULL\n", replace: "" });
    expect(await ask(bad, "workday:acme:ON-DROPPED")).toHaveLength(1);
    await bad.close();
  }, 30_000);

  it("without the remote predicate, a remote-flagged posting is answered", async () => {
    const bad = await boot({ find: "      AND p.remote IS NOT TRUE\n", replace: "" });
    expect(await ask(bad, "workday:acme:ON-REMOTE")).toHaveLength(1);
    await bad.close();
  }, 30_000);

  it("with the screening window widened, the legal co-op is printed as a disclosure", async () => {
    // The window is the ONLY thing separating a role about the technology from
    // a disclosure about recruitment, and widening it is how that gets lost.
    const bad = await boot({ find: "40::int         AS ai_near_chars", replace: "200::int        AS ai_near_chars" });
    const [row] = await ask(bad, "workday:acme:ON-COOP");
    expect(row.od_ai_evidence, "the mutation did not apply -- RE-ANCHOR this tooth").toBeTruthy();
    expect(String(row.od_ai_evidence).toLowerCase()).toContain("artificial intelligence");
    await bad.close();
  }, 30_000);

  it("with the pay-word requirement dropped, a grade is quoted as expected compensation", async () => {
    const bad = await boot({
      find: "      CASE WHEN s.salary ~* pat.pay_word_fwd OR s.salary ~* pat.pay_word_rev\n           THEN btrim(s.salary) END",
      replace: "      CASE WHEN s.salary ~ '[0-9]' THEN btrim(s.salary) END",
    });
    const [row] = await ask(bad, "workday:acme:ON-GRADE");
    expect(row.od_pay_evidence, "the mutation did not apply -- RE-ANCHOR this tooth").toBe("Grade 7, requisition 128455");
    expect(row.od_pay_basis).toBe("salary_field");
    await bad.close();
  }, 30_000);

  it("and the sealed reader still answers the Ontario posting and refuses the rest", async () => {
    expect(await ask(db, "workday:acme:ON-1")).toHaveLength(1);
    for (const id of ["workday:acme:CA-1", "workday:acme:ON-DROPPED", "workday:acme:ON-REMOTE", "workday:acme:ON-USD"]) {
      expect(await ask(db, id)).toHaveLength(0);
    }
  });
});

describe("the client mirror admits exactly what the reader emits", () => {
  it("every evidence string the reader produced survives the client's re-check", async () => {
    // THE HALF THAT WAS DONE BY HAND. Its sibling pasted two strings a human
    // had got by running this migration once, and called them what the reader
    // emits -- so a change to the SQL could not re-check them. These come out
    // of the database in this run.
    const { readOntarioDisclosureRow, payEvidenceIsFigureShaped, aiEvidenceIsDisclosureShaped } =
      await import("../components/jobs/OntarioEsaDisclosures");
    const [row] = await ask(db, "workday:acme:ON-1");
    const read = readOntarioDisclosureRow({
      od_id: row.od_id,
      od_read_at: new Date(row.od_read_at as string).toISOString(),
      od_pay_evidence: row.od_pay_evidence,
      od_pay_basis: row.od_pay_basis,
      od_vacancy_evidence: row.od_vacancy_evidence,
      od_ai_evidence: row.od_ai_evidence,
      od_canadian_experience_evidence: row.od_canadian_experience_evidence,
    });
    expect(read, "the client dropped a row the reader admitted").not.toBeNull();
    expect(read!.payEvidence, "the client dropped pay evidence the reader emitted").toBe(row.od_pay_evidence);
    expect(read!.vacancyEvidence).toBe(row.od_vacancy_evidence);
    expect(read!.aiEvidence, "the client dropped a disclosure the reader emitted").toBe(row.od_ai_evidence);
    // And the two mirrors agree with the SQL on the two cases it refused.
    expect(payEvidenceIsFigureShaped("Grade 7, requisition 128455")).toBe(false);
    expect(payEvidenceIsFigureShaped(String(row.od_pay_evidence))).toBe(true);
    expect(aiEvidenceIsDisclosureShaped(AI_DUTIES_NOT_A_DISCLOSURE)).toBe(false);
  });
});
