// @vitest-environment node
/**
 * A PAY LABEL BEFORE THE FIGURE KEEPS THE PAY, WHATEVER FOLLOWS IT (wave 4
 * round 2 recheck; S12-019's second narrowing).
 *
 * WHAT WAS WRONG. The first narrowing (b5947d42) ended a clause at a colon and
 * at a line break, so "Pay Range:" no longer stood in the clause before
 * "$17.00 - $19.00 per hour", and any business word within 30 characters after
 * the figure ("plus profit sharing", "deal commissions", "on closed deals")
 * refused it. That is the standard US pay-transparency line, and the
 * SALARY_PARSE_VERSION 11 re-sweep reads minedSalaryRefused: it would have set
 * correct stored pay, and its annual columns, to NULL. Job titles that hold a
 * business word ("Portfolio Analyst - $90,000 - $110,000", "Pipeline Welder
 * $30 - $40 per hour") were refused the same way.
 *
 * THE RULE NOW (round 3, w4b-fix3; the corpus test beside this one measures
 * it). The old guards decide first, in the old order, so a bonus word right
 * after a figure still refuses it (round 2 let a label override them, and a
 * sign-on bonus under "Compensation:" became the pay). A figure they accept is
 * set aside only as a business figure: a business noun is its own subject and
 * no pay word stands in its sentence or right after it. A label before the
 * figure is such a pay word, so every line here keeps its pay. The re-sweep
 * refuses only the figure the old miner took, so it never NULLs pay.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { extractSalary, minedSalaryRefused } from "../../supabase/functions/_shared/salary-extract";
import { bootBoardHandler, SVC, type BoardHandler } from "./helpers/board-handler";

/** [description, the pay it states], every one a label, a colon or a label line, the figure, then a business word. */
const RECHECK: Array<[string, string]> = [
  ["Pay Range: $17.00 - $19.00 per hour plus profit sharing", "$17.00 - $19.00 per hour"],
  ["Base Pay Range: $70,000 - $90,000 USD + profit sharing + 401(k)", "$70,000 - $90,000"],
  ["Hourly Rate: $22 - $26 + quarterly profit share", "$22 - $26"],
  ["Compensation: $120,000 - $150,000 base + deal commissions", "$120,000 - $150,000"],
  ["Account Executive OTE: $120,000 - $160,000 on closed deals", "$120,000 - $160,000"],
  ["<p><strong>Pay Range:</strong></p><p>$17.00 - $19.00 per hour plus profit sharing</p>", "$17.00 - $19.00 per hour"],
];

const OURS: Array<[string, string]> = [
  ["Salary: $80,000 - $95,000 per year plus profit-sharing bonus", "$80,000 - $95,000 per year"],
  ["Starting Pay: $18 - $21 per hour + profit share after 90 days", "$18 - $21 per hour"],
  ["Base Salary: $110,000 - $130,000 + uncapped commission on new deals", "$110,000 - $130,000"],
  ["Compensation:\n$140,000 - $175,000 OTE on deals closed", "$140,000 - $175,000"],
  ["<li><strong>Pay:</strong> $65,000 - $75,000 annually plus profit sharing and a 401(k) match</li>", "$65,000 - $75,000 annually"],
  ["OTE: $150,000 - $200,000 in deals", "$150,000 - $200,000"],
  ["Hourly Pay Rate:\n\n$19.50 - $23.00 per hour plus quarterly profit sharing", "$19.50 - $23.00 per hour"],
  ["Salary range: £45,000 - £55,000 + profit share + pipeline bonus", "£45,000 - £55,000"],
  ["Annual base salary: $95,000 - $115,000 depending on book of business", "$95,000 - $115,000"],
  ["<h3>Wage</h3><p><b>Wage:</b></p><p>$24 - $27 per hour, fleet vehicle provided, profit sharing</p>", "$24 - $27 per hour"],
];

/** Job titles holding a business word: the title is not the figure's subject. */
const TITLES: Array<[string, string]> = [
  ["Fleet Manager: $70,000 - $80,000 per year", "$70,000 - $80,000 per year"],
  ["Portfolio Analyst - $90,000 - $110,000", "$90,000 - $110,000"],
  ["Pipeline Welder $30 - $40 per hour", "$30 - $40 per hour"],
  ["Deal Desk Analyst $75,000 - $85,000 per year", "$75,000 - $85,000 per year"],
];

describe("a label, a colon, the figure and a business word: the figure is the pay", () => {
  it.each([...RECHECK, ...OURS, ...TITLES])("%s", (text, pay) => {
    expect(extractSalary(text)).toBe(pay);
    expect(minedSalaryRefused(text, pay), "the v11 re-sweep must keep the stored pay").toBe(false);
  });

  it("a bonus word right after the figure: the old guard's null stands (a safe miss), and the re-sweep keeps the stored pay", () => {
    // Round 2 let the label override the bonus words after a figure, and a
    // "Compensation: $20,000 - $30,000 sign-on bonus" became the pay (recheck 2).
    const text = "Salary Range: $95,000 - $120,000 plus deal bonuses";
    expect(extractSalary(text)).toBeNull();
    expect(minedSalaryRefused(text, "$95,000 - $120,000")).toBe(false);
  });
});

describe("the business figure's own amount is still refused (S12-019)", () => {
  it("a figure the old guards already refuse was never stored by the miner: still null, and not the re-sweep's to touch", () => {
    for (const [text, figure] of [
      ["You will manage a portfolio of $500K - $2M in annual revenue accounts.", "$500K - $2M"],
      ["Responsible for a P&L of $500K - $1M and a team of six.", "$500K - $1M"],
    ]) {
      expect(extractSalary(text)).toBeNull();
      expect(minedSalaryRefused(text, figure)).toBe(false);
    }
  });

  it.each([
    ["Oversee fleet costs of $500k - $900k across the region.", "$500k - $900k"],
    ["Support engineering projects worth £350K - £800K across the A350 programme.", "£350K - £800K"],
    ["Our clients' projects are valued at $350,000 - $800,000 each.", "$350,000 - $800,000"],
    ["Our team closed $500,000 - $900,000 in deals each quarter.", "$500,000 - $900,000"],
    ["You will own a $400K - $900K portfolio of mid-market accounts.", "$400K - $900K"],
    ["Manage deal sizes of $50K - $250K with enterprise buyers.", "$50K - $250K"],
  ])("%s", (text, figure) => {
    expect(extractSalary(text)).toBeNull();
    expect(minedSalaryRefused(text, figure), "a business figure the miner stored is re-mined").toBe(true);
  });
});

describe("the re-sweep never NULLs a range the posting states as pay", () => {
  const LABELS = ["Pay Range", "Base Pay Range", "Salary Range", "Salary", "Hourly Rate", "Compensation", "OTE", "Wage", "Starting pay", "Base salary"];
  const LAYOUTS: Array<(label: string, fig: string, tail: string) => string> = [
    (l, f, t) => `${l}: ${f} ${t}`,
    (l, f, t) => `${l}:\n${f} ${t}`,
    (l, f, t) => `<p><strong>${l}:</strong></p><p>${f} ${t}</p>`,
    (l, f, t) => `<li>${l}: ${f} ${t}</li>`,
    (l, f, t) => `Duties include managing our portfolio of vendors. ${l}: ${f} ${t}.`,
  ];
  const TAILS = ["plus profit sharing", "+ deal commissions", "on closed deals", "+ profit share + 401(k) match", "in deals", "plus a pipeline bonus", "and a fleet vehicle", "base + equity"];
  const FIGURES = ["$17.00 - $19.00 per hour", "$70,000 - $90,000", "$120,000 - $160,000 per year"];

  it("every label, layout, tail and figure: the miner takes the pay and the re-sweep leaves it", () => {
    const wrong: string[] = [];
    for (const l of LABELS) for (const lay of LAYOUTS) for (const t of TAILS) for (const f of FIGURES) {
      const text = lay(l, f, t);
      if (minedSalaryRefused(text, f)) wrong.push(`refused: ${text}`);
      // A bonus or 401(k) word right after the figure keeps the old guard's null (a safe miss), never another figure.
      const got = extractSalary(text);
      if (got !== f && !(got === null && /bonus|401/i.test(t))) wrong.push(`mined ${JSON.stringify(got)}: ${text}`);
    }
    expect(wrong, wrong.slice(0, 10).join("\n")).toEqual([]);
  });

  it("a vendor's pay the description quotes beside a NOT_PAY word is not the miner's mistake", () => {
    // The old miner's NOT_PAY window was wider, so it never stored this from the text: it is the vendor's field.
    expect(minedSalaryRefused("We offer $17.00 - $19.00 per hour plus 401(k) match.", "$17.00 - $19.00 per hour")).toBe(false);
    expect(minedSalaryRefused("Sign-on bonus of $1,000 - $2,000 for new hires.", "$1,000 - $2,000")).toBe(false);
  });

  it("a figure quoted twice is refused only when every quote is a business figure", () => {
    const text = "Pay Range: $60,000 - $75,000 per year. Last year the team closed $60,000 - $75,000 per year in deals.";
    expect(minedSalaryRefused(text, "$60,000 - $75,000 per year")).toBe(false);
  });

  let h: BoardHandler;
  beforeAll(async () => { h = await bootBoardHandler(); }, 120_000);

  it("backfill-salary leaves every labelled range alone and re-mines only the business figure", async () => {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${SVC}:board-chain`));
    const chainKey = [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
    const rows = [...RECHECK, ...OURS].map(([description, salary], i) => ({
      id: `greenhouse:labelled:${i}`, source: "greenhouse", salary, country: /£/.test(salary) ? "GB" : "US", title: "Sales Associate",
      description, employment_type: null, salary_min_annual: null, salary_max_annual: null, salary_period: null, salary_currency: null,
    }));
    rows.push({
      id: "workday:deals:1", source: "workday", salary: "$500,000 - $900,000", country: "US", title: "Account Executive",
      description: "Our team closed $500,000 - $900,000 in deals each quarter.", employment_type: null,
      salary_min_annual: 500000, salary_max_annual: 900000, salary_period: "year", salary_currency: "USD",
    } as (typeof rows)[number]);
    h.reset();
    h.answer((q) => (q.table === "job_board_postings" && q.calls.some(([m]) => m === "select") ? { data: rows, error: null } : undefined));
    const r = await h.post({ action: "backfill-salary", chainKey });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, done: true });
    const patches = h.db.on("job_board_postings", "update").map((q) => ({
      patch: q.calls.find(([m]) => m === "update")?.[1][0] as Record<string, unknown>,
      id: q.calls.find(([m]) => m === "eq")?.[1][1] as string | undefined,
      ids: (q.calls.find(([m]) => m === "in")?.[1][1] as string[] | undefined) ?? [],
    }));
    const nulled = patches.filter((p) => p.patch && "salary" in p.patch && p.patch.salary === null).flatMap((p) => [p.id, ...p.ids]);
    expect(nulled, JSON.stringify(patches)).toEqual(["workday:deals:1"]);
    for (const p of patches) {
      if (p.patch && "salary" in p.patch) expect(String(p.id), "only the business figure's text is rewritten").toBe("workday:deals:1");
    }
  });
});
