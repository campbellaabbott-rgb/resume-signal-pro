// @vitest-environment node
/**
 * THE SALARY RULE OVER GENERATED COMBINATIONS (S12-019, wave 4 round 3).
 *
 * The corpus test measures the rule on real postings; this one walks every
 * combination of the parts those postings are made of, so a new label, layout,
 * tail or business phrase cannot slip between the corpus rows:
 *   - pay with a pay word before it is the pay, whatever business sentence
 *     stands nearby and whatever benign words follow, and the re-sweep keeps it;
 *   - a big business figure the old miner took gives way to the pay stated
 *     later, or to null, and the re-sweep re-mines it;
 *   - a smaller business figure gives way only to a later figure labelled as
 *     pay, never to null;
 *   - a bonus, allowance or referral word beside a figure keeps the old null,
 *     and the re-sweep never touches what the old miner did not take;
 *   - every answer is verbatim text, and the re-sweep NULLs nothing below the
 *     big-figure line.
 */
import { describe, expect, it } from "vitest";
import { extractSalary, minedSalaryRefused, parseSalaryStructured } from "../../supabase/functions/_shared/salary-extract";

const PAY_LABELS = ["Salary:", "Pay Range:", "Compensation:", "Base pay", "The salary range for this role is", "OTE:", "Hourly rate:", "Pay:", "Wage:", "Annual base salary:", "Total compensation package worth", "Earn"];
const LAYOUTS: Array<(label: string, fig: string, tail: string) => string> = [
  (l, f, t) => `${l} ${f} ${t}`,
  (l, f, t) => `${l}\n${f} ${t}`,
  (l, f, t) => `<p><strong>${l}</strong></p><p>${f} ${t}</p>`,
  (l, f, t) => `<li>${l} ${f} ${t}</li>`,
];
const NEARBY = ["", "You will grow a book of business across the region. ", "Own the P&L for a portfolio of retail sites. ", "Manage our fleet of 40 trucks. ", "Drive pipeline and new business with enterprise accounts. ", "Our projects are valued by clients across the state. "];
const PAY_FIGURES = ["$17.00 - $19.00 per hour", "$70,000 - $90,000", "$250,000 - $300,000", "$120,000 - $160,000 per year", "£45,000 - £55,000", "€60,000 - €75,000", "$95,000 per year", "$450,000 - $600,000 annually"];
const BENIGN_TAILS = ["", "plus profit sharing", "depending on experience", "+ equity", "and a fleet vehicle", "on closed deals", "base + commission", "in our Austin office"];

const BUSINESS_SUBJECTS: Array<(fig: string) => string> = [
  (f) => `Manage a personal book of business of approximately ${f}.`,
  (f) => `An associate director is responsible for a client portfolio of a minimum ${f}.`,
  (f) => `You will close typical deal sizes of ${f} with mid-market buyers.`,
  (f) => `Deliver improvement projects valued at circa ${f}.`,
  (f) => `A record of closing client pipelines in excess of ${f}.`,
  (f) => `Total cost of fleet management is > ${f} and the role manages it.`,
  (f) => `Our facility is generating ${f} in external business revenue.`,
  (f) => `Ability to manage approximately ${f} in new business across customers.`,
];
const BIG_BUSINESS = ["$500,000 - $1,000,000", "£350K to £800K annually", "$600k/yr", "$1,000,000 annually", "$400,000 - $900,000"];
const SMALL_BUSINESS = ["€25,000 to €40,000", "$40k-$100k", "$50,000 - $90,000"];
const LATER_PAY: Array<string | null> = [null, "Pay Range: $50.00 - $53.00 per hour", "Base salary: $65,000 - $108,000", "Salary: £24,500 per annum"];
const figureOf = (later: string) => later.slice(later.indexOf(":") + 2);
const isSingle = (fig: string) => !/(?:-|–|—|\bto\b)\s*[$€£]/.test(fig);

const generated: string[] = [];

describe("pay with a pay word before it is the pay, and the re-sweep keeps it", () => {
  it("every label, layout, nearby business sentence, figure and benign tail", () => {
    const wrong: string[] = [];
    for (const l of PAY_LABELS) for (const lay of LAYOUTS) for (const near of NEARBY) for (const f of PAY_FIGURES) for (const t of BENIGN_TAILS) {
      const text = near + lay(l, f, t);
      generated.push(text);
      const got = extractSalary(text);
      if (got !== f) wrong.push(`mined ${JSON.stringify(got)}: ${text}`);
      if (minedSalaryRefused(text, f)) wrong.push(`refused: ${text}`);
    }
    expect(wrong.length, wrong.slice(0, 8).join("\n")).toBe(0);
  });
});

describe("a big business figure gives way to the pay stated later, or to null", () => {
  it("every business phrase, big figure and later pay", () => {
    const wrong: string[] = [];
    for (const subject of BUSINESS_SUBJECTS) for (const biz of BIG_BUSINESS) for (const later of LATER_PAY) {
      const text = later ? `${subject(biz)} ${later}` : subject(biz);
      generated.push(text);
      // The later figure is judged by the old guards too: when the business sentence's own "revenue" stands
      // within their 40 characters before it, they refuse it, and null is the answer.
      const guardSeesRevenue = /revenue/.test(subject(biz));
      const want = later ? [figureOf(later), ...(guardSeesRevenue ? [null] : [])] : [null];
      // A single figure is the old miner's only when the text has no range: a later range was its answer already.
      const oldTookIt = !(isSingle(biz) && later !== null && !isSingle(figureOf(later)));
      const got = extractSalary(text);
      if (!want.includes(got)) wrong.push(`mined ${JSON.stringify(got)} want ${JSON.stringify(want)}: ${text}`);
      if (minedSalaryRefused(text, biz) !== oldTookIt) wrong.push(`refused=${!oldTookIt}: ${text}`);
    }
    expect(wrong.length, wrong.slice(0, 8).join("\n")).toBe(0);
  });
});

describe("a smaller business figure gives way only to a later figure labelled as pay", () => {
  it("every business phrase, smaller figure and later pay: never null", () => {
    const wrong: string[] = [];
    for (const subject of BUSINESS_SUBJECTS) for (const biz of SMALL_BUSINESS) for (const later of LATER_PAY) {
      const text = later ? `${subject(biz)} ${later}` : subject(biz);
      generated.push(text);
      // Every later figure, range or single, is looked at for a pay label; one the old guards refuse (the
      // business sentence's own "revenue" within their 40 characters) is not, and the old answer stands.
      const guardSeesRevenue = /revenue/.test(subject(biz));
      const want = later === null ? [biz] : guardSeesRevenue ? [figureOf(later), biz] : [figureOf(later)];
      const got = extractSalary(text);
      if (!want.includes(got)) wrong.push(`mined ${JSON.stringify(got)} want ${JSON.stringify(want)}: ${text}`);
      if (got === null) wrong.push(`NULL: ${text}`);
      if (minedSalaryRefused(text, biz) !== (got !== biz)) wrong.push(`refused disagrees with the answer: ${text}`);
    }
    expect(wrong.length, wrong.slice(0, 8).join("\n")).toBe(0);
  });
});

describe("a bonus, allowance or referral word beside a figure keeps the old null", () => {
  const NOT_PAY_TAILS = ["sign-on bonus for experienced nurses", "relocation allowance", "referral bonus for referred hires", "annual bonus", "tuition reimbursement", "budget for this hire"];
  it("under every pay label, with and without a base pay after it", () => {
    const wrong: string[] = [];
    for (const l of PAY_LABELS) for (const t of NOT_PAY_TAILS) for (const after of ["", " Base pay $38 - $52 per hour."]) {
      const text = `${l} $20,000 - $30,000 ${t}.${after}`;
      generated.push(text);
      const got = extractSalary(text);
      if (got !== null) wrong.push(`mined ${JSON.stringify(got)}: ${text}`);
      for (const s of ["$20,000 - $30,000", "$38 - $52 per hour"]) if (minedSalaryRefused(text, s)) wrong.push(`refused ${s}: ${text}`);
    }
    expect(wrong.length, wrong.slice(0, 8).join("\n")).toBe(0);
  });
});

describe("over everything generated above", () => {
  it("every answer is the posting's own text, and the re-sweep NULLs nothing below the big-figure line", () => {
    expect(generated.length).toBeGreaterThan(18_000);
    const wrong: string[] = [];
    const MONEY = /[$€£]\s?\d[\d,.]*\s?[kK]?(?:\s*(?:-|–|—|to)\s*[$€£]\s?\d[\d,.]*\s?[kK]?)?(?:\s*(?:annually|per (?:hour|year|annum)|\/yr))?/g;
    for (const text of generated) {
      const got = extractSalary(text);
      const flat = text.replace(/\s+/g, " ");
      if (got !== null && !flat.includes(got)) wrong.push(`not verbatim ${JSON.stringify(got)}: ${text}`);
      for (const m of flat.matchAll(MONEY)) {
        const s = m[0].trim();
        if (!minedSalaryRefused(text, s) || got !== null) continue;
        const p = parseSalaryStructured(s);
        const top = p?.annualMax ?? p?.annualMin ?? 0;
        if (top < 200_000) wrong.push(`NULLed a figure below the line (${s}): ${text}`);
      }
    }
    expect(wrong.length, wrong.slice(0, 8).join("\n")).toBe(0);
  });
});
