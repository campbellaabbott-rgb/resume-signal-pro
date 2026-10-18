// @vitest-environment node
/**
 * THE FIRST MONEY RANGE IN A POSTING IS NOT ITS PAY (S12-019, job-board .93,
 * wave 4 round 2).
 *
 * extractSalary took the first money range in a description and judged it on
 * the 40 characters around it. An Airbus £24.5k placement was listed at
 * £350K-£800K (the value of the work, a sentence before the pay) and sat at
 * the top of the GB pay sort; 6 of the 12 "$500k+ manager" rows were
 * portfolios, fleets and P&Ls. Every range is now a candidate: one whose
 * sentence names a business figure is refused unless a pay word stands right
 * before it, and a range whose sentence names pay is preferred. SALARY_PARSE
 * VERSION 11 re-sweeps the stored rows and re-mines a stored figure the miner
 * took from the description that the rules now refuse.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { extractSalary, minedSalaryRefused } from "../../supabase/functions/_shared/salary-extract";
import { bootBoardHandler, SVC, type BoardHandler } from "./helpers/board-handler";

const AIRBUS = "As a placement student you will support the delivery of engineering projects worth £350K - £800K across the A350 programme. Salary: £24,500 per annum, plus relocation support.";
const PORTFOLIO = "You will manage a portfolio of $500K - $2M in annual revenue accounts. Pay range: $60,000 - $75,000 per year.";
const FLEET = "Oversee fleet costs of $500k - $900k across the region. Compensation $85,000 - $95,000 depending on experience.";

describe("the miner reads every range and takes the pay (S12-019)", () => {
  it("skips the business figure and takes the pay the posting states", () => {
    expect(extractSalary(AIRBUS)).toBe("£24,500 per annum");
    expect(extractSalary(PORTFOLIO)).toBe("$60,000 - $75,000 per year");
    expect(extractSalary(FLEET)).toBe("$85,000 - $95,000");
  });

  it("a business figure alone is no pay at all", () => {
    expect(extractSalary("Responsible for a P&L of $500K - $1M and a team of six.")).toBeNull();
    expect(extractSalary("Our clients' projects are valued at $350,000 - $800,000 each.")).toBeNull();
  });

  it("a single figure that stands apart from a rejected range, in a pay sentence, is read", () => {
    expect(extractSalary("Sign-on bonus of $1,000 - $2,000! Starting pay $18 per hour.")).toBe("$18 per hour");
  });

  it("positive control: the shapes it always read still read the same", () => {
    expect(extractSalary("The pay range for this role is $90,000 - $110,000.")).toBe("$90,000 - $110,000");
    expect(extractSalary("We offer $22.00 - $24.00 per hour for this position.")).toBe("$22.00 - $24.00 per hour");
    expect(extractSalary("Base salary $120k-$150k. Our sales team closed $5M - $8M in deals last year.")).toBe("$120k-$150k");
    expect(extractSalary("Annual salary of $95,000 per year")).toBe("$95,000 per year");
    expect(extractSalary("Earn $500 sign-on bonus")).toBeNull();
  });
});

describe("the re-sweep re-mines only the miner's mistakes (S12-019)", () => {
  it("refuses a stored figure the description gives as a business figure, never a vendor's pay it quotes", () => {
    expect(minedSalaryRefused(AIRBUS, "£350K - £800K")).toBe(true);
    expect(minedSalaryRefused(AIRBUS, "£24,500 per annum")).toBe(false);
    expect(minedSalaryRefused(AIRBUS, "£30,000 - £35,000"), "a figure not in the text is a vendor's field: never touched").toBe(false);
    expect(minedSalaryRefused(null, "£350K - £800K")).toBe(false);
  });

  let h: BoardHandler;
  beforeAll(async () => { h = await bootBoardHandler(); }, 120_000);

  it("backfill-salary rewrites the text and the columns of a refused mined figure, and leaves a vendor's pay alone", async () => {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${SVC}:board-chain`));
    const chainKey = [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
    h.reset();
    h.answer((q) => {
      if (q.table === "job_board_postings" && q.calls.some(([m]) => m === "select")) {
        return {
          data: [
            { id: "workday:airbus:1", source: "workday", salary: "£350K - £800K", country: "GB", title: "Engineering Placement", description: AIRBUS, employment_type: null, salary_min_annual: 350000, salary_max_annual: 800000, salary_period: "year", salary_currency: "GBP" },
            { id: "greenhouse:acme:2", source: "greenhouse", salary: "$60,000 - $75,000 per year", country: "US", title: "Account Manager", description: PORTFOLIO, employment_type: null, salary_min_annual: 60000, salary_max_annual: 75000, salary_period: "year", salary_currency: "USD" },
          ],
          error: null,
        };
      }
      return undefined;
    });
    const r = await h.post({ action: "backfill-salary", chainKey });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, done: true });
    const writes = h.db.on("job_board_postings", "update").map((q) => ({
      patch: q.calls.find(([m]) => m === "update")?.[1][0] as Record<string, unknown>,
      id: q.calls.find(([m]) => m === "eq")?.[1][1],
      ids: q.calls.find(([m]) => m === "in")?.[1][1] as string[] | undefined,
    }));
    const airbus = writes.find((w) => w.id === "workday:airbus:1");
    expect(airbus?.patch, JSON.stringify(writes)).toMatchObject({ salary: "£24,500 per annum", salary_min_annual: 24500, salary_period: "year", salary_currency: "GBP" });
    expect(writes.some((w) => w.id === "greenhouse:acme:2" || w.ids?.includes("greenhouse:acme:2")), "a pay figure already right is not rewritten").toBe(false);
  });
});
