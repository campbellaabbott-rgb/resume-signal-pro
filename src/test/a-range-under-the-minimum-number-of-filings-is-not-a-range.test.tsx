/**
 * A RANGE UNDER THE MINIMUM NUMBER OF FILINGS IS NOT A RANGE.
 *
 * WHAT THIS GUARDS. Three properties of the filed-wage line, each of which has
 * a way of going quietly false:
 *
 *   1. THE MINIMUM IS ONE NUMBER IN TWO RUNTIMES. The reader migration refuses
 *      a cell and an employer total below a bar; the component prints that bar
 *      in its own copy and refuses a row below it a second time. Two runtimes,
 *      one number -- and a number that moves in one of them is a sentence that
 *      says something the data no longer supports (project_claim_drift, the
 *      "no subscriptions" incident). The guard reads the bar back out of the
 *      COMMENT-STRIPPED migration and requires the component's constant to
 *      equal it; a bar named only in a comment fails, which is the trap this
 *      repository has fallen into seven times.
 *
 *   2. THE CLIENT MIRRORS THE BARS. Every predicate lives in SQL, and the
 *      component applies the same ones again so that a row arriving outside
 *      them renders nothing. A future column, a hand-written fixture or a
 *      loosened reader cannot put a two-application "range" on a card.
 *
 *   3. THE COPY NEVER PROMISES PAY. These are wages that WERE FILED for
 *      applications that WERE CERTIFIED in a quarter that is named. They are
 *      not what the employer pays, will pay, or offers for this posting. The
 *      English copy is checked against a list of the phrasings that would turn
 *      a filing into a salary, and all nine locales are checked structurally:
 *      every sentence that carries a figure must also carry the quarter, the
 *      file and its publication date, so no translation can drop the basis
 *      while keeping the number (project_stat_provenance).
 *
 * TEETH. Each property is broken on a copy and must be reported: a mirrored
 * constant moved, a row under the bar handed to the reader-side mapper, and a
 * locale string rewritten into a promise about pay.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

/** What the reader is pretending to answer for the render cases below. */
const rpcAnswer: { rows: unknown[] } = { rows: [] };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: async () => ({ data: rpcAnswer.rows }) },
}));

import { LcaFiledWagesLine, LCA_MIN_FILINGS, LCA_MATCH_BASES, LCA_SOURCE_AUTHORITY, readLcaRow } from "@/components/jobs/LcaFiledWagesLine";

const ROOT = resolve(__dirname, "../..");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");
const READER = "20260923114903";
const LOCALES = resolve(ROOT, "src/i18n/locales");
const KEYS = ["lcaChip", "lcaRange", "lcaWhyThisCell", "lcaSponsor", "lcaNotAnOffer", "lcaBasis", "lcaMinNote"] as const;

const migRaw = (prefix: string) => {
  const f = readdirSync(MIGRATIONS).find((x) => x.startsWith(prefix) && x.endsWith(".sql"));
  if (!f) throw new Error(`no migration starts with ${prefix}`);
  return readFileSync(resolve(MIGRATIONS, f), "utf8");
};
/** Literals are asserted against SQL with its comments blanked out, never against raw text. */
const stripSqlComments = (sql: string) => sql.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");

/** The bar as the reader's own k block states it. */
function minFilingsInMigration(sql: string): number | null {
  const m = /(\d+)\s+AS\s+lca_min_filings/.exec(stripSqlComments(sql));
  return m ? Number(m[1]) : null;
}

const localeFiles = readdirSync(LOCALES).filter((f) => f.endsWith(".json"));
const localeJson = (f: string) => JSON.parse(readFileSync(join(LOCALES, f), "utf8")) as { jobsPage: Record<string, string> };

/** The phrasings that would turn a filed figure into a promise about pay. */
const PROMISE_PHRASES: Array<[label: string, re: RegExp]> = [
  ["a future tense about pay", /\bwill\s+pay\b/i],
  ["a present tense about pay", /\bpays\b/i],
  ["an expectation about earnings", /\bexpects?\s+to\s+(earn|pay|make)\b/i],
  ["a salary attributed to this posting", /\bsalary\s+for\s+this\s+(role|job|posting|position)\b/i],
  ["a figure described as on offer", /\bon\s+offer\b/i],
  ["a claim about what the reader would earn", /\b(you|they)\s+(would|will|can)\s+(earn|make)\b/i],
  ["a guarantee", /\bguarantee/i],
  ["an estimate presented as pay", /\bestimated\s+(pay|salary|wage)\b/i],
  ["a typical-pay claim", /\b(typical|average)\s+(pay|salary)\b/i],
];

function promisesIn(text: string): string[] {
  return PROMISE_PHRASES.filter(([, re]) => re.test(text)).map(([label]) => label);
}

/**
 * THE SAME REFUSAL, PER LANGUAGE.
 *
 * A denial written in English is invisible to a Hindi sentence, and a
 * translator never sees this file. The structural check below -- lcaRange
 * keeps its seven placeholders, lcaBasis keeps the file and the date -- is
 * satisfied PERFECTLY by a promise, because the placeholders are exactly what
 * a promise would interpolate: "{{company}} zahlt {{low}} bis {{high}}" passes
 * every other assertion here. So each language carries its own list of the
 * verbs that would turn a filed figure into a salary.
 *
 * WHAT IS DELIBERATELY NOT ON THESE LISTS: every word the correct copy already
 * uses to DENY the promise. The German copy says the figures are "weder die
 * Vergütung dieser Stelle noch ein Angebot", the Filipino says "Hindi ito ang
 * bayad sa trabahong ito", the Hindi says "ये इस भूमिका का वेतन नहीं हैं" --
 * so the nouns are unusable as signals and the lists are built from the verbs
 * of promising instead. A negation-blind scanner over the nouns would report
 * the denial as the defect, which is how a guard gets switched off.
 */
const PROMISE_WORDS: Record<string, RegExp[]> = {
  de: [/\bzahlt\b/i, /\bwird\s+zahlen\b/i, /\bverdien(?:t|en|st)\b/i, /\bGehalt\s+f\u00fcr\s+diese\s+Stelle\b/i],
  es: [/\bpaga\b/i, /\bpagar\u00e1\b/i, /\bganar(?:\u00e1|\u00e1s|\u00edas)?\b/i, /\bsueldo\s+(?:de|para)\s+este\s+puesto\b/i],
  fr: [/\bverse\b/i, /\bpaie(?:ra)?\b/i, /\bgagner(?:ez|a|ait)?\b/i, /\bsalaire\s+pour\s+ce\s+poste\b/i],
  hi: [/\u092d\u0941\u0917\u0924\u093e\u0928\s+\u0915\u0930(?:\u0924\u093e|\u0924\u0940)\s+\u0939\u0948/, /\u0926\u0947\u0917(?:\u093e|\u0940)/, /\u0915\u092e\u093e(?:\u090f\u0902\u0917\u0947|\u0902\u0917\u0947|\u092f\u0947\u0917\u093e)/],
  nl: [/\bbetaalt\b/i, /\bzal\s+betalen\b/i, /\bverdien(?:t|en)\b/i, /\bsalaris\s+voor\s+deze\s+functie\b/i],
  pt: [/\bpaga\b/i, /\bpagar\u00e1\b/i, /\bganhar(?:\u00e1|\u00e3o)?\b/i, /\bsal\u00e1rio\s+desta\s+vaga\b/i],
  tl: [/\bnagbabayad\b/i, /\bmagbabayad\b/i, /\bkikita\b/i, /\bbabayaran\b/i],
};

/** One sentence per language that IS a promise about pay, so each list is shown firing. */
const PROMISE_SAMPLE: Record<string, string> = {
  de: "{{company}} zahlt {{low}} bis {{high}} und wird zahlen, was du verdienst.",
  es: "{{company}} paga {{low}} a {{high}} y pagar\u00e1 m\u00e1s el a\u00f1o que viene.",
  fr: "{{company}} verse {{low}} \u00e0 {{high}} et paiera davantage l'an prochain.",
  hi: "{{company}} {{low}} \u0938\u0947 {{high}} \u0915\u093e \u092d\u0941\u0917\u0924\u093e\u0928 \u0915\u0930\u0924\u093e \u0939\u0948 \u0914\u0930 \u0906\u0917\u0947 \u0914\u0930 \u0926\u0947\u0917\u093e\u0964",
  nl: "{{company}} betaalt {{low}} tot {{high}} en zal betalen wat je verdient.",
  pt: "{{company}} paga {{low}} a {{high}} e pagar\u00e1 mais no pr\u00f3ximo ano.",
  tl: "Ang {{company}} ay nagbabayad ng {{low}} hanggang {{high}} at magbabayad pa nang mas mataas.",
};

const localeKey = (file: string) => file.replace(/\.json$/, "");
function promiseWordsIn(file: string, text: string): string[] {
  return (PROMISE_WORDS[localeKey(file)] ?? []).filter((re) => re.test(text)).map((re) => String(re));
}

describe("the minimum is one number in two runtimes", () => {
  it("the reader names the bar in code, and the component mirrors it exactly", () => {
    const inSql = minFilingsInMigration(migRaw(READER));
    expect(inSql, "the reader migration no longer names the bar in executable SQL").not.toBeNull();
    expect(LCA_MIN_FILINGS).toBe(inSql);
    expect(LCA_MIN_FILINGS).toBeGreaterThanOrEqual(3);
  });

  it("the bar is not merely written in a comment", () => {
    const raw = migRaw(READER);
    const stripped = stripSqlComments(raw);
    // The name appears in executable SQL -- once where it is defined and once
    // for each predicate that reads it. A file that only discussed it in prose
    // would leave the reader ungated and this guard reading a comment.
    expect((stripped.match(/lca_min_filings/g) ?? []).length).toBeGreaterThanOrEqual(3);
    // ...and the COMMENTS of that same file state it nowhere, so the number this
    // guard reads back can only have come from code that runs.
    const commentsOnly = [
      ...[...raw.matchAll(/--[^\n]*/g)].map((m) => m[0]),
      ...[...raw.matchAll(/\/\*[\s\S]*?\*\//g)].map((m) => m[0]),
    ].join("\n");
    expect(commentsOnly.length, "the migration lost its reasoning").toBeGreaterThan(200);
    expect(commentsOnly).not.toMatch(/\d+\s+AS\s+lca_min_filings/);
  });

  it("teeth: a component constant that drifts from the migration is reported", () => {
    const moved = migRaw(READER).replace(/(\d+)\s+AS\s+lca_min_filings/, "9 AS lca_min_filings");
    expect(minFilingsInMigration(moved)).toBe(9);
    expect(LCA_MIN_FILINGS).not.toBe(minFilingsInMigration(moved));
  });
});

describe("the client refuses a row the bars would not have admitted", () => {
  const base = {
    ow_company_token: "acmewidgets",
    ow_soc_code: "15-1252",
    ow_soc_title: "Software Developers",
    ow_worksite_state: "CA",
    ow_wage_low: 120000,
    ow_wage_high: 145600,
    ow_wage_median: 124800,
    ow_filings_n: 12,
    ow_match_basis: "soc_and_state",
    ow_employer_filings_n: 21,
    ow_employer_cells_n: 2,
    ow_fiscal_quarter: "FY2026 Q3",
    ow_source_file: "LCA_Disclosure_Data_FY2026_Q3.xlsx",
    ow_source_url: "https://www.dol.gov/media/LCA_Disclosure_Data_FY2026_Q3.xlsx",
    ow_published_on: "2026-08-25",
  };

  it("reads a complete row", () => {
    const r = readLcaRow(base);
    expect(r?.wages?.wageLow).toBe(120000);
    expect(r?.employer.employerFilingsN).toBe(21);
    expect(LCA_MATCH_BASES).toContain(r?.wages?.basis);
  });

  it("the reader's null answer is a null answer, never a fact", () => {
    expect(readLcaRow({ ow_company_token: "x", ow_employer_filings_n: null, ow_source_file: null })).toBeNull();
    expect(readLcaRow(null)).toBeNull();
  });

  it("a cell under the bar loses its range but keeps the employer's totals", () => {
    const r = readLcaRow({ ...base, ow_filings_n: LCA_MIN_FILINGS - 1 });
    expect(r).not.toBeNull();
    expect(r?.wages).toBeNull();
    expect(r?.employer.employerFilingsN).toBe(21);
  });

  it("an employer total under the bar renders nothing at all", () => {
    expect(readLcaRow({ ...base, ow_employer_filings_n: LCA_MIN_FILINGS - 1 })).toBeNull();
  });

  it("a basis outside the vocabulary, a link that is not https, or a date that is not a plain date is refused", () => {
    expect(readLcaRow({ ...base, ow_match_basis: "nearest_guess" })?.wages).toBeNull();
    expect(readLcaRow({ ...base, ow_source_url: "http://www.dol.gov/media/x.xlsx" })).toBeNull();
    expect(readLcaRow({ ...base, ow_published_on: "2026-08-25T00:00:00Z" })).toBeNull();
    expect(readLcaRow({ ...base, ow_wage_high: 1 })?.wages).toBeNull();
  });
});

describe("the copy never promises pay, and never drops the basis of a number", () => {
  it("ships all six keys in all nine locales", () => {
    expect(localeFiles.length).toBeGreaterThanOrEqual(9);
    for (const f of localeFiles) {
      const j = localeJson(f).jobsPage;
      for (const k of KEYS) expect(typeof j[k], `${f} is missing jobsPage.${k}`).toBe("string");
    }
  });

  it("the English copy carries none of the phrasings that would turn a filing into a salary", () => {
    for (const f of localeFiles.filter((x) => x.startsWith("en"))) {
      const j = localeJson(f).jobsPage;
      for (const k of KEYS) {
        expect(promisesIn(j[k]), `${f} jobsPage.${k} reads as a promise about pay: "${j[k]}"`).toEqual([]);
      }
      expect(j.lcaNotAnOffer.toLowerCase()).toContain("not an offer");
    }
  });

  it("every locale keeps the figure beside its basis: the quarter, the file and the publication date", () => {
    for (const f of localeFiles) {
      const j = localeJson(f).jobsPage;
      for (const token of ["{{company}}", "{{n}}", "{{occupation}}", "{{state}}", "{{quarter}}", "{{low}}", "{{high}}"]) {
        expect(j.lcaRange, `${f} jobsPage.lcaRange dropped ${token}`).toContain(token);
      }
      for (const token of ["{{file}}", "{{published}}"]) {
        expect(j.lcaBasis, `${f} jobsPage.lcaBasis dropped ${token}`).toContain(token);
      }
      expect(j.lcaBasis, `${f} jobsPage.lcaBasis must name the authority the data comes from`).toContain("Labor");
      expect(j.lcaChip).toContain("{{quarter}}");
      expect(j.lcaSponsor).toContain("{{total}}");
      // The bar is interpolated, never typed into a sentence in nine places.
      expect(j.lcaMinNote, `${f} jobsPage.lcaMinNote must interpolate the bar`).toContain("{{min}}");
      expect(j.lcaMinNote.replace("{{min}}", ""), `${f} jobsPage.lcaMinNote types a number instead of interpolating one`).not.toMatch(/\d/);
    }
  });

  it("the component names the authority the licence requires it to name", () => {
    expect(LCA_SOURCE_AUTHORITY).toBe("US Department of Labor");
    const en = localeJson("en.json").jobsPage;
    expect(en.lcaBasis).toContain(LCA_SOURCE_AUTHORITY);
    // ...and says, in the same breath, that naming the source is not an endorsement.
    expect(en.lcaBasis.toLowerCase()).toContain("does not endorse");
  });

  it("every non-English locale carries none of ITS OWN phrasings that promise pay", () => {
    // The eight locales the English regexes cannot see. Each list is proven to
    // fire on a planted sentence in the teeth case below, so a list that has
    // gone empty or been written wrong is a failure here and not a pass.
    const checked: string[] = [];
    for (const f of localeFiles.filter((x) => !x.startsWith("en"))) {
      const key = localeKey(f);
      expect(PROMISE_WORDS[key], `${f} has no promise-word list -- a locale was added and this guard did not follow`).toBeTruthy();
      checked.push(key);
      const j = localeJson(f).jobsPage;
      for (const k of KEYS) {
        expect(promiseWordsIn(f, j[k]), `${f} jobsPage.${k} reads as a promise about pay: "${j[k]}"`).toEqual([]);
      }
    }
    expect(checked.length, "the non-English locales are not being checked at all").toBeGreaterThanOrEqual(7);
  });

  it("teeth: one planted promise per language, and every list fires", () => {
    // WITHOUT THIS the lists above are decoration: eight regexes that match
    // nothing match a correct file and a rewritten one alike.
    for (const [key, sample] of Object.entries(PROMISE_SAMPLE)) {
      expect(promiseWordsIn(`${key}.json`, sample).length, `the ${key} list did not fire on "${sample}"`).toBeGreaterThan(0);
    }
    // ...and a list must not fire on the shipped copy of its own language,
    // which is the false positive that gets a guard deleted.
    for (const key of Object.keys(PROMISE_SAMPLE)) {
      const j = localeJson(`${key}.json`).jobsPage;
      expect(promiseWordsIn(`${key}.json`, j.lcaNotAnOffer)).toEqual([]);
    }
  });

  it("a figure derived from a unit the file did not state as yearly cannot ship under copy that does not say so", async () => {
    // THE COUPLING, not a spelling. The loader is imported and asked what it
    // does with each unit the disclosure file carries; the copy is then
    // required to match what it found, in BOTH directions -- so a loader that
    // starts converting fails here until the basis line names the conversion,
    // and a basis line that names a conversion nobody makes fails too.
    //
    // Measured over the matched population (2026-09-22): Year 13,185, Hour
    // 1,021, Week 11, Month 7, Bi-Weekly 6. The hourly rows alone are 7.2% of
    // it, so "a cell is what was filed" is a claim with real money behind it.
    const loader = await import("../../scripts/load-oflc-lca.mjs");
    const derived = ["Hour", "Week", "Month", "Bi-Weekly", "Day"]
      .filter((u) => loader.filedAnnualWage(100, u) !== null);
    expect(loader.filedAnnualWage(120000, "Year"), "the loader no longer reads a yearly filing at all -- re-anchor this guard").toBe(120000);

    const en = localeJson("en.json").jobsPage;
    const copy = KEYS.map((k) => en[k]).join(" ");
    const namesTheConversion = /\b(?:converted|conversion|annualis|annualiz|2,?080\s*hours)\b/i.test(copy);
    if (derived.length > 0) {
      expect(namesTheConversion,
        `the loader turns ${derived.join(", ")} into an annual figure and the copy states it as filed`).toBe(true);
    } else {
      expect(namesTheConversion,
        "the copy names a conversion the loader does not make").toBe(false);
    }
  });

  it("teeth: a loader that converts an hourly filing under unchanged copy is reported", () => {
    // The same check, run against a stand-in that does convert. If this cannot
    // fail, the case above is not a check.
    const converting = (amount: number, unit: string) =>
      ({ year: 1, hour: 2080, week: 52, month: 12 }[unit.toLowerCase()] ?? 0) * amount || null;
    const derived = ["Hour", "Week", "Month"].filter((u) => converting(100, u) !== null);
    expect(derived).toEqual(["Hour", "Week", "Month"]);
    const copy = KEYS.map((k) => localeJson("en.json").jobsPage[k]).join(" ");
    expect(/\b(?:converted|conversion|annualis|annualiz|2,?080\s*hours)\b/i.test(copy),
      "the shipped copy must NOT name a conversion, because the shipped loader makes none").toBe(false);
  });

  it("teeth: a locale string rewritten into a promise about pay is reported", () => {
    const planted = "{{company}} pays {{low}} to {{high}} for {{occupation}} and will pay more next year.";
    expect(promisesIn(planted).length).toBeGreaterThanOrEqual(2);
    // ...and a basis line with the file dropped fails the structural check.
    const stripped = localeJson("en.json").jobsPage.lcaBasis.replace("{{file}}", "the file");
    expect(stripped).not.toContain("{{file}}");
  });
});

describe("the rendered line says what it is a figure of", () => {
  const ROW = {
    ow_company_token: "acmewidgets",
    ow_soc_code: "15-1252",
    ow_soc_title: "Software Developers",
    ow_worksite_state: "CA",
    ow_wage_low: 120000,
    ow_wage_high: 145600,
    ow_wage_median: 124800,
    ow_filings_n: 12,
    ow_match_basis: "soc_and_state",
    ow_employer_filings_n: 21,
    ow_employer_cells_n: 2,
    ow_fiscal_quarter: "FY2026 Q3",
    ow_source_file: "LCA_Disclosure_Data_FY2026_Q3.xlsx",
    ow_source_url: "https://www.dol.gov/media/LCA_Disclosure_Data_FY2026_Q3.xlsx",
    ow_published_on: "2026-08-25",
  };

  it("prints the count, the occupation, the state, the quarter and the file it came from", async () => {
    rpcAnswer.rows = [ROW];
    render(<LcaFiledWagesLine companyToken="acmewidgets" companyName="Acme Widgets" socCode="15-1252" worksiteState="US-CA" />);
    const line = await screen.findByText(/filed 12 certified labor condition applications/i);
    expect(line.textContent).toContain("Software Developers");
    expect(line.textContent).toContain("CA");
    expect(line.textContent).toContain("FY2026 Q3");
    expect(await screen.findByText(/LCA_Disclosure_Data_FY2026_Q3\.xlsx/)).toBeTruthy();
    expect(await screen.findByText(/2026-08-25/)).toBeTruthy();
    expect(await screen.findByText(/not this role's pay and not an offer/i)).toBeTruthy();
    // The bar the line is gated on is stated, from the constant, not typed.
    expect(await screen.findByText(new RegExp(`at least ${LCA_MIN_FILINGS} certified applications`, "i"))).toBeTruthy();
  });

  it("a cell chosen without an occupation says on what basis it was chosen", async () => {
    // WHY THIS CELL IS ON THIS POSTING. The only call site asks with no
    // occupation and no state, because nothing on a posting carries either --
    // and with neither, the reader's nearness rule can land only on the
    // employer's largest cell. That cell's occupation has no connection to the
    // role being read: under the heading "Filed H-1B wages" on a retail
    // posting it can print a software occupation in another state. The
    // quarter and the file were named and the CHOICE was not, which is the
    // half project_stat_provenance is about.
    for (const basis of ["employer_top", "state_top"]) {
      rpcAnswer.rows = [{ ...ROW, ow_match_basis: basis }];
      const { container, unmount } = render(<LcaFiledWagesLine companyToken="acmewidgets" companyName="Acme Widgets" />);
      const line = await waitFor(() => {
        const el = container.querySelector(`[data-lca-basis="${basis}"]`);
        expect(el, `${basis} renders no sentence saying how the cell was chosen`).not.toBeNull();
        return el!;
      });
      expect(line.textContent).toMatch(/largest group of applications/i);
      expect(line.textContent, "the sentence must say the posting states no occupation code").toMatch(/occupation code/i);
      unmount();
    }
  });

  it("a cell matched to the asked occupation does not carry that sentence", async () => {
    // The four occupation-matched bases need no explanation: the occupation
    // the range already names IS why the cell is there. A sentence saying
    // otherwise on those rows would be false.
    rpcAnswer.rows = [{ ...ROW, ow_match_basis: "soc_and_state" }];
    const { container } = render(<LcaFiledWagesLine companyToken="acmewidgets" companyName="Acme Widgets" socCode="15-1252" worksiteState="US-CA" />);
    await screen.findByText(/filed 12 certified labor condition applications/i);
    expect(container.querySelector("[data-lca-basis]"), "a matched cell claims it was not matched").toBeNull();
  });

  it("renders nothing for the reader's null answer -- no placeholder, no absence on screen", async () => {
    rpcAnswer.rows = [{ ...ROW, ow_employer_filings_n: null, ow_source_file: null, ow_wage_low: null, ow_match_basis: null }];
    const { container } = render(<LcaFiledWagesLine companyToken="nobody" companyName="Nobody Ltd" />);
    await waitFor(() => expect(container.textContent).toBe(""));
  });

  it("renders the sponsorship total without a range when no cell is near enough", async () => {
    rpcAnswer.rows = [{ ...ROW, ow_soc_code: null, ow_soc_title: null, ow_worksite_state: null, ow_wage_low: null, ow_wage_high: null, ow_wage_median: null, ow_filings_n: null, ow_match_basis: null }];
    render(<LcaFiledWagesLine companyToken="acmewidgets" companyName="Acme Widgets" socCode="29-1141" worksiteState="US-CA" />);
    expect(await screen.findByText(/21 certified applications on file/i)).toBeTruthy();
    expect(screen.queryByText(/labor condition applications for/i)).toBeNull();
  });
});
