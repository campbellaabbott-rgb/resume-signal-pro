// @vitest-environment node
/**
 * THE SALARY RULE OVER GENERATED COMBINATIONS (S12-019, wave 4 fix rounds 3 and 4).
 *
 * The corpus test measures the rule on real postings; this one walks the parts
 * those postings are made of. Round 3's generator put a pay word before every
 * pay figure, so it never met the class its recheck found: an UNLABELLED pay
 * figure beside a business noun. Here:
 *   - pay with a pay word before it is the pay, whatever business sentence
 *     stands nearby, and the re-sweep keeps it;
 *   - unlabelled pay beside every business noun (a title, "| Contract |",
 *     "+ RSUs", "Target Earning potential", "coverage at", an hourly or day
 *     rate, an earnings statement) is the pay, and the re-sweep keeps it;
 *   - a figure a business noun owns ("book of business of", "valued at",
 *     "$X in new business") gives way to a later stated pay, or to null for a
 *     big one; an allowance, benefit or incentive after it is never the pay;
 *   - a bonus, allowance or referral word beside a figure keeps the old null;
 *   - every answer is verbatim text, and the re-sweep never writes NULL.
 * LIVE_RULE below is origin/main's extractSalary (8a6561c4), copied as the
 * oracle: wherever no business noun owns a figure, the answer is exactly it.
 */
import { describe, expect, it } from "vitest";
import { extractSalary, minedSalaryRefused } from "../../supabase/functions/_shared/salary-extract";

const L_MONEY = String.raw`[$€£]\s?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?\s?[kK]?`;
const L_PERIOD = String.raw`(?:per\s+(?:hour|year|annum|month|week)|an?\s+(?:hour|year)|hourly|annually|yearly|monthly|\/\s?(?:hr|hour|yr|year|mo|month|wk|week))`;
const L_RANGE = new RegExp(`(${L_MONEY})(?:\\s*${L_PERIOD})?\\s*(?:-|–|—|to|through)\\s*(${L_MONEY})(\\s*${L_PERIOD})?`, "i");
const L_FIRST = new RegExp(`^${L_MONEY}\\s*(${L_PERIOD})`, "i");
const L_SINGLE = new RegExp(`(?:(?:up\\s+to|as\\s+much\\s+as|maximum\\s+of|max(?:imum)?\\.?)\\s*)?(${L_MONEY})(\\s*${L_PERIOD})`, "i");
const L_NOT_PAY = /bonus|sign[- ]?on|stipend|reimburse|referral|allowance|credit|deposit|discount|401|gift|donat\w*|charit\w*|quota|revenue|bookings|funding|raised|valuation|in sales|sales target|budget\w*|grant\w*|scholarship|prize|fundrais\w*/i;
function lMoney(raw: string): number | null {
  const k = /k\s*$/i.test(raw.trim());
  const digits = raw.replace(/[^0-9.,]/g, "");
  const m = digits.match(/^(\d{1,3}(?:[.,]\d{3})*)(?:[.,](\d{1,2}))?$/);
  const n = Number(m ? m[1].replace(/[.,]/g, "") + (m[2] ? `.${m[2]}` : "") : digits.replace(/,/g, ""));
  return Number.isFinite(n) ? (k ? n * 1000 : n) : null;
}
const lPlausible = (lo: number, hi: number, hourly: boolean) =>
  lo > 0 && hi >= lo && hi / Math.max(lo, 1) <= 5 && (hourly ? lo >= 7 && hi <= 500 : lo >= 10_000 && hi <= 2_000_000);
function LIVE_RULE(text: string): string | null {
  const hay = text.slice(0, 12_000).replace(/&mdash;/gi, "\u2014").replace(/&ndash;/gi, "\u2013").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ");
  const range = hay.match(L_RANGE);
  if (range && range.index !== undefined) {
    if (L_NOT_PAY.test(hay.slice(Math.max(0, range.index - 40), range.index + range[0].length + 20))) return null;
    const lo = lMoney(range[1]), hi = lMoney(range[2]);
    const hourly = /hour|hr|hourly/i.test(`${range[3] ?? ""} ${L_FIRST.exec(range[0])?.[1] ?? ""}`) || (lo !== null && hi !== null && lo < 1_000 && hi < 1_000 && !/[kK]\s*$/.test(range[1] + range[2]));
    return lo !== null && hi !== null && lPlausible(lo, hi, hourly) ? range[0].replace(/\s+/g, " ").trim().slice(0, 200) : null;
  }
  const single = hay.match(L_SINGLE);
  if (single && single.index !== undefined && !L_NOT_PAY.test(hay.slice(Math.max(0, single.index - 40), single.index + single[0].length + 20))) {
    const v = lMoney(single[1]);
    if (v !== null && lPlausible(v, v, /hour|hr|hourly/i.test(single[2]))) return single[0].replace(/\s+/g, " ").trim().slice(0, 200);
  }
  return null;
}

const PAY_LABELS = ["Salary:", "Pay Range:", "Compensation:", "Base pay", "The salary range for this role is", "OTE:", "Hourly rate:", "Pay:", "Wage:", "Annual base salary:", "Total compensation package worth", "Earn", "Target income:"];
const LAYOUTS: Array<(label: string, fig: string, tail: string) => string> = [
  (l, f, t) => `${l} ${f} ${t}`,
  (l, f, t) => `${l}\n${f} ${t}`,
  (l, f, t) => `<p><strong>${l}</strong></p><p>${f} ${t}</p>`,
  (l, f, t) => `<li>${l} ${f} ${t}</li>`,
];
const NEARBY = ["", "You will grow a book of business across the region. ", "Own the P&L for a portfolio of retail sites. ", "Manage our fleet of 40 trucks. ", "Drive pipeline and new business with enterprise accounts. ", "Our projects are valued by clients across the state. "];
const PAY_FIGURES = ["$17.00 - $19.00 per hour", "$70,000 - $90,000", "$250,000 - $300,000", "$120,000 - $160,000 per year", "£45,000 - £55,000", "€60,000 - €75,000", "$95,000 per year", "$450,000 - $600,000 annually"];
const BENIGN_TAILS = ["", "plus profit sharing", "depending on experience", "+ equity", "+ RSUs", "and a fleet vehicle", "on closed deals", "base + commission", "in our Austin office"];

/** Every business noun the rule knows, as a person writes it. */
const NOUNS = ["Business", "Portfolio", "Pipeline", "Revenue", "Sales", "Turnover", "P&L", "Profit", "Deal", "AUM", "Assets", "Spend", "Quota", "Investment",
  "Premium", "Valuation", "Funding", "Endowment", "Liability", "Project", "Projects", "Cost", "Fleet", "Equity", "Options", "RSU", "Contract", "Coverage", "Target", "Goal"];
/** Unlabelled pay beside a noun: the noun stands next to the figure and owns nothing. */
const BESIDE: Array<(noun: string, fig: string) => string> = [
  (n, f) => `${n} Manager ${f}`,
  (n, f) => `Senior ${n} Analyst - ${f}`,
  (n, f) => `${n} Lead | Remote | ${f}`,
  (n, f) => `Director, ${n} Operations — ${f}`,
  (n, f) => `${n} Director: ${f}`,
  (n, f) => `Head of ${n} - ${f}`,
  (n, f) => `${n} Associate (Remote) ${f}`,
  (n, f) => `${f} + ${n.toLowerCase()}s`,
  (n, f) => `Our advisors with a strong ${n.toLowerCase()} make ${f}.`,
  (n, f) => `Team members on the ${n.toLowerCase()} team earn ${f}.`,
  (n, f) => `Join our growing ${n.toLowerCase()} team at ${f}.`,
  (n, f) => `This ${n.toLowerCase()} role is worth ${f} to the right person.`,
  (n, f) => `${n} \n${f}`,
];
const BIG_ANNUAL = ["$200,000 - $250,000", "$210,000 to $260,000 annually", "$250K - $300K", "$205,000 - $240,000 per year", "£200,000 - £240,000"];
const HOURLY_HIGH = ["$100 - $125/hr", "$98/hr", "$165 - $185 per hour", "$200 - $250/hr"];
const DAY_RATES = ["£400 - £475", "$150 - $180"];
const UNLABELLED_PAY: Array<(fig: string) => string> = [
  (f) => `This is a 6-month contract at ${f}.`,
  (f) => `Locum coverage at ${f} for our emergency department.`,
  (f) => `W2 contract at ${f}`,
  (f) => `Project rate of ${f} for this engagement`,
  (f) => `Total target cash ${f}`,
  (f) => `At 85% to 120% performance achievement, the Target Earning potential is ${f}.`,
  (f) => `The target hiring range is ${f}.`,
  (f) => `Range: ${f} + RSUs`,
  (f) => `Hiring Range\n${f} + RSUs`,
  (f) => `Higher cost-of-living locations ${f}`,
  (f) => `Tier 1 high-cost metros ${f}`,
  (f) => `Team drivers in our dedicated fleet average ${f}.`,
];

/** A figure the noun owns: "<noun> of / valued at / worth $X", "deal size $X", "$X in/of <noun>", "$X portfolio". */
const OWNED: Array<(fig: string) => string> = [
  (f) => `Manage a personal book of business of approximately ${f}.`,
  (f) => `An associate director is responsible for a client portfolio of a minimum ${f}.`,
  (f) => `You will close typical deal sizes of ${f} with mid-market buyers.`,
  (f) => `Deliver improvement projects valued at circa ${f}.`,
  (f) => `A record of closing client pipelines in excess of ${f}.`,
  (f) => `Our facility is generating ${f} in external business revenue.`,
  (f) => `Ability to manage approximately ${f} in new business across customers.`,
  (f) => `Oversee fleet costs of ${f} across the region.`,
  (f) => `Book of business: ${f}.`,
  (f) => `Typical project value: ${f}\n`,
  (f) => `You will own a ${f} portfolio of mid-market accounts.`,
  (f) => `Equity worth ${f} vesting over four years.`,
  (f) => `Clients with a net worth of ${f}.`,
];
const BIG_BUSINESS = ["$500,000 - $1,000,000", "£350K to £800K annually", "$600k/yr", "$1,000,000 annually", "$400,000 - $900,000"];
const SMALL_BUSINESS = ["€25,000 to €40,000", "$40k-$100k", "$50,000 - $90,000"];
const LATER_PAY: Array<[string, string] | null> = [null, ["Pay Range: $50.00 - $53.00 per hour", "$50.00 - $53.00 per hour"], ["Base salary: $65,000 - $108,000", "$65,000 - $108,000"],
  ["Salary: £24,500 per annum", "£24,500 per annum"], ["Pay Range\n$60,000 - $75,000 per year", "$60,000 - $75,000 per year"], ["$30 - $35 per hour plus commission.", "$30 - $35 per hour"]];
const NOT_BASE_LATER = ["Benefits include a $12,000 per year housing benefit.", "Tuition assistance up to $10,000 per year.", "Relocation package of $15,000 - $25,000 available.",
  "Retention incentive: $20,000 - $30,000.", "Clients typically have $250,000 - $500,000 invested."];

const isSingle = (fig: string) => !/(?:-|–|—|\bto\b)\s*[$€£]/.test(fig);
const generated: string[] = [];
const check = (wrong: string[]) => expect(wrong.length, wrong.slice(0, 8).join("\n")).toBe(0);

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
    check(wrong);
  });
});

describe("unlabelled pay beside a business noun is the pay (the class recheck 3 found), and the re-sweep keeps it", () => {
  it("every noun, every way of standing beside it, big annual, high hourly and day-rate figures", () => {
    const wrong: string[] = [];
    for (const n of NOUNS) for (const beside of BESIDE) for (const f of [...BIG_ANNUAL, ...HOURLY_HIGH]) {
      const text = beside(n, f);
      generated.push(text);
      const got = extractSalary(text);
      const live = LIVE_RULE(text);
      // Exactly main's answer: the figure, or main's own null where its guards refuse it ("revenue" within 40 characters).
      if (got !== live || (live !== f && live !== null)) wrong.push(`mined ${JSON.stringify(got)}, main ${JSON.stringify(live)}: ${text}`);
      if (minedSalaryRefused(text, f)) wrong.push(`refused: ${text}`);
    }
    check(wrong);
  });

  it("contract, coverage, target, RSU, zone, title and earnings shapes, at every rate", () => {
    const wrong: string[] = [];
    for (const shape of UNLABELLED_PAY) for (const f of [...BIG_ANNUAL, ...HOURLY_HIGH, ...DAY_RATES]) {
      const text = shape(f);
      generated.push(text);
      const got = extractSalary(text);
      // A day rate is read as hourly by every version (no "per day" in the range grammar): the figure itself.
      if (got !== f || got !== LIVE_RULE(text)) wrong.push(`mined ${JSON.stringify(got)}: ${text}`);
      if (minedSalaryRefused(text, f)) wrong.push(`refused: ${text}`);
    }
    check(wrong);
  });
});

describe("a figure a business noun owns gives way to a later stated pay", () => {
  it("a big one: to the later pay, or to null; the re-sweep rewrites only to that pay", () => {
    const wrong: string[] = [];
    for (const owned of OWNED) for (const biz of BIG_BUSINESS) for (const later of LATER_PAY) {
      const text = later ? `${owned(biz)} ${later[0]}` : owned(biz);
      generated.push(text);
      const got = extractSalary(text);
      // "revenue" within 40 characters of the later figure keeps its old null; a single business figure before a
      // later range was never the old miner's (it read singles only when there was no range), so main's answer stands.
      const guardSeesRevenue = /revenue/.test(owned(biz)) && later !== null;
      const singleFirst = isSingle(biz) && later !== null && !isSingle(later[1]);
      const want = singleFirst ? [LIVE_RULE(text)] : later ? [later[1], ...(guardSeesRevenue ? [null] : [])] : [null];
      if (!want.includes(got)) wrong.push(`mined ${JSON.stringify(got)} want ${JSON.stringify(want)}: ${text}`);
      if (minedSalaryRefused(text, biz) && got === null) wrong.push(`would NULL: ${text}`);
    }
    check(wrong);
  });

  it("a smaller one: to a later stated pay, never to null", () => {
    const wrong: string[] = [];
    for (const owned of OWNED) for (const biz of SMALL_BUSINESS) for (const later of LATER_PAY) {
      const text = later ? `${owned(biz)} ${later[0]}` : owned(biz);
      generated.push(text);
      const got = extractSalary(text);
      const guardSeesRevenue = /revenue/.test(owned(biz)) && later !== null;
      const want = later === null ? [biz] : guardSeesRevenue ? [later[1], biz] : [later[1]];
      if (!want.includes(got)) wrong.push(`mined ${JSON.stringify(got)} want ${JSON.stringify(want)}: ${text}`);
      if (got === null) wrong.push(`NULL: ${text}`);
    }
    check(wrong);
  });

  it("an allowance, benefit, incentive or another business figure after it is never the pay", () => {
    const wrong: string[] = [];
    for (const owned of OWNED) for (const biz of BIG_BUSINESS) for (const later of NOT_BASE_LATER) {
      const text = `${owned(biz)} ${later}`;
      generated.push(text);
      const got = extractSalary(text);
      // A single business figure before a later range was never the old miner's: main's answer stands there.
      const want = isSingle(biz) && /[$€£][\d,.]+\s?[kK]?\s*(?:-|–|—|to)\s*[$€£]/.test(later) ? LIVE_RULE(text) : null;
      if (got !== want) wrong.push(`mined ${JSON.stringify(got)} want ${JSON.stringify(want)}: ${text}`);
      if (minedSalaryRefused(text, biz)) wrong.push(`refused: ${text}`);
    }
    check(wrong);
  });
});

describe("a bonus, allowance or referral word beside a figure keeps the old null", () => {
  const NOT_PAY_TAILS = ["sign-on bonus for experienced nurses", "relocation allowance", "referral bonus for referred hires", "annual bonus", "tuition reimbursement", "budget for this hire"];
  it("under every pay label, with and without a base pay after it", () => {
    const wrong: string[] = [];
    for (const l of PAY_LABELS) for (const t of NOT_PAY_TAILS) for (const after of ["", " Base pay $38 - $52 per hour."]) {
      const text = `${l} $20,000 - $30,000 ${t}.${after}`;
      generated.push(text);
      if (extractSalary(text) !== null) wrong.push(`mined ${JSON.stringify(extractSalary(text))}: ${text}`);
      for (const s of ["$20,000 - $30,000", "$38 - $52 per hour"]) if (minedSalaryRefused(text, s)) wrong.push(`refused ${s}: ${text}`);
    }
    check(wrong);
  });
});

describe("over everything generated above", () => {
  it("every answer is the posting's own text, and the re-sweep never writes NULL", () => {
    expect(generated.length).toBeGreaterThan(25_000);
    const wrong: string[] = [];
    const MONEY = /[$€£]\s?\d[\d,.]*\s?[kK]?(?:\s*(?:-|–|—|to)\s*[$€£]\s?\d[\d,.]*\s?[kK]?)?(?:\s*(?:annually|per (?:hour|year|annum)|\/yr|\/hr))?/g;
    for (const text of generated) {
      const got = extractSalary(text);
      const flat = text.replace(/\s+/g, " ");
      if (got !== null && !flat.includes(got)) wrong.push(`not verbatim ${JSON.stringify(got)}: ${text}`);
      for (const m of flat.matchAll(MONEY)) if (minedSalaryRefused(text, m[0].trim()) && got === null) wrong.push(`would NULL ${m[0]}: ${text}`);
    }
    check(wrong);
  });
});
