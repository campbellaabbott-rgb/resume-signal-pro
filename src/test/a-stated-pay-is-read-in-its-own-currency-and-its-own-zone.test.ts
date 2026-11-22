// @vitest-environment node
/**
 * BOARD .103 REVIEW (search-pay lens): GREENHOUSE STATED PAY, FOUR READINGS
 * THAT WERE WRONG. Real postings read 2026-11-17 with
 * GET boards-api.greenhouse.io/v1/boards/<token>/jobs/<id>?pay_transparency=true
 * (robots: Disallow /embed/ only), kept in fixtures/pay-review-103/.
 *
 * 1. A zero-decimal currency's min_cents is the whole amount. Duolingo's Tokyo
 *    posting states 17178000 JPY ("¥17,178,000 — ¥25,767,100 JPY" in its own
 *    text) and Elastic's Hungary posting 15805300 HUF ("15 805 300 Ft"); .103
 *    divided both by a hundred. Either the true figure or none (main's
 *    reading), never a hundredth of it.
 * 2. "€32.000 – €33.000" typed into the form is stored as 3200 / 3300 cents
 *    (JD Sports, Bolzano, RAL beside "Bonus"): .103 read EUR 32-33 as hourly,
 *    EUR 66,560 a year, from the vendor and from the miner.
 * 3. A range refused for its figures ends the miner's search: Gusto's Denver
 *    posting was handed San Francisco's range, and Andersen's 1099 role its
 *    "ability to earn".
 * 4. A board that labels each zone by its cities: the range naming the
 *    posting's own city is the posting's pay (13 Robinhood Zone 2 postings
 *    were stated Zone 1's band). Judged over every multi-range posting read
 *    that day (624, fixtures/greenhouse-multi-range-postings-2026-11-17.json).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { greenhouseSalary, htmlToText, leverText, normalizeGreenhouse } from "../../supabase/functions/job-board/normalize";
import { extractSalary, parseSalaryStructured } from "../../supabase/functions/_shared/salary-extract";

const FX = resolve(__dirname, "fixtures/pay-review-103");
const load = (f: string) => JSON.parse(readFileSync(resolve(FX, f), "utf8"));
// index.ts at refresh: the vendor text wins, else the description miner.
const rowPay = (job: Record<string, unknown>, token: string) => {
  const [row] = normalizeGreenhouse({ jobs: [job] } as never, token, token);
  return row.salary ?? extractSalary(htmlToText(String(job.content)).trim());
};

describe("1. a zero-decimal currency's min_cents is the whole amount", () => {
  it("Duolingo Tokyo: ¥17,178,000 or nothing, never ¥171,780", () => {
    const pay = rowPay(load("gh-duolingo-jpy.json"), "duolingo");
    expect(pay === null || parseSalaryStructured(pay, "JP", null)?.annualMin === 17_178_000 ? "ok" : pay).toBe("ok");
  });
  it("Elastic Hungary: 15,805,300 Ft or nothing, never 158,053", () => {
    const pay = rowPay(load("gh-elastic-huf.json"), "elastic");
    expect(pay === null || parseSalaryStructured(pay, "HU", null)?.annualMin === 15_805_300 ? "ok" : pay).toBe("ok");
  });
  it("a two-decimal currency is still read in cents", () => {
    expect(greenhouseSalary([{ min_cents: 4_350_000, max_cents: 6_000_000, currency_type: "MXN", title: "Monthly Pay Range" }])).toBe("MXN 43,500.00 – 60,000.00 per month");
  });
});

describe("2. a euro salary that lost its thousands is not an hourly wage", () => {
  const job = load("gh-jdsports-5020323101.json");
  const notWrong = (pay: string | null) => (pay === null || parseSalaryStructured(pay, "IT", null)?.annualMin === 32_000 ? "ok" : pay);
  it("the vendor reader refuses EUR 32.00 - 33.00 under a label that names no period", () => {
    const [row] = normalizeGreenhouse({ jobs: [job] }, "JD Sports", "jdsports");
    expect(row.salary).toBeNull();
    expect(greenhouseSalary([{ min_cents: 3_200, max_cents: 3_300, currency_type: "EUR", title: "Hourly Rate" }]), "a label that says hourly is believed").toBe("EUR 32.00 – 33.00 per hour");
  });
  it("the miner refuses '€32 — €33' with no hour word near it", () => {
    expect(notWrong(extractSalary(htmlToText(String(job.content)).trim()))).toBe("ok");
    expect(extractSalary("Retribuzione: €12 - €15 per hour, turni flessibili."), "an hour word keeps it a wage").toBe("€12 - €15 per hour");
  });
  it("the row the board stores is not EUR 66,560 a year", () => {
    expect(notWrong(rowPay(job, "jdsports"))).toBe("ok");
  });
});

describe("3. a range refused for its figures ends the miner's search", () => {
  it("Gusto's Denver posting (its Denver range typo'd) is not stated the San Francisco range", () => {
    const g = load("gh-gusto-8353775.json");
    expect(g.location.name).toMatch(/Denver/);
    expect(extractSalary(htmlToText(String(g.content)).trim())).toBeNull();
  });
  it("Andersen's 1099 commission role is not stated its 'ability to earn'", () => {
    const a = load("lever-andersencorp-huntsville.json");
    expect(a.salaryRange ?? null).toBeNull();
    expect(extractSalary(leverText(a))).toBeNull();
  });
  it("a range refused for the words around it still lets the next range be read", () => {
    expect(extractSalary("Sign-on bonus $5,000 - $10,000. Base pay range: $120,000 - $150,000 per year.")).toBe("$120,000 - $150,000 per year");
  });
});

describe("4. the zone that names the posting's city", () => {
  type R = { t: string; c: string; min: number; max: number };
  const CORPUS = JSON.parse(readFileSync(resolve(__dirname, "fixtures/greenhouse-multi-range-postings-2026-11-17.json"), "utf8")) as { postings: Array<{ b: string; id: number; loc: string; r: R[] }> };
  const ranges = (r: R[]) => r.map((x) => ({ title: x.t, currency_type: x.c, min_cents: x.min, max_cents: x.max }));
  const cities = (loc: string) => loc.split(/[;|/]/).map((x) => x.split(",")[0].trim()).filter((c) => c.length >= 3);
  const names = (title: string, loc: string) => cities(loc).some((c) => new RegExp(`\\b${c}\\b`, "i").test(title));

  it("a Robinhood posting whose cities only Zone 2 names is stated Zone 2's band", () => {
    const zone2 = CORPUS.postings.filter((p) => p.b === "robinhood" && p.r.length >= 2 && /^Zone 2 \(/.test(p.r[1].t) && !names(p.r[0].t, p.loc) && names(p.r[1].t, p.loc));
    expect(zone2.length).toBe(13);
    for (const p of zone2) {
      const z2 = ranges(p.r)[1];
      expect(greenhouseSalary(ranges(p.r), p.loc), `${p.id} ${p.loc}`).toBe(greenhouseSalary([z2]));
    }
  });

  it("over the 624 multi-range postings, only a range whose label names the posting's city moves ahead of the first", () => {
    expect(CORPUS.postings.length).toBeGreaterThanOrEqual(300);
    const moved: string[] = [];
    for (const p of CORPUS.postings) {
      const before = greenhouseSalary(ranges(p.r));
      const now = greenhouseSalary(ranges(p.r), p.loc);
      if (now === before) continue;
      moved.push(`${p.b}:${p.id}`);
      expect(now, `${p.b}:${p.id} lost its pay`).not.toBeNull();
      const chosen = ranges(p.r).find((x) => greenhouseSalary([x]) === now)!;
      expect(names(chosen.title, p.loc), `${p.b}:${p.id}: "${chosen.title}" names none of "${p.loc}"`).toBe(true);
      expect(names(ranges(p.r)[0].title, p.loc), `${p.b}:${p.id}: the first range named the city already`).toBe(false);
    }
    // 13 Robinhood Zone 2 postings; 4 Okta postings whose second band names their city or state (two only gain
    // the label's "per year"); 2 Databricks postings listing Bellevue first, whose Bellevue rate now leads the SF one.
    expect(moved.length).toBe(17);
  });

  it("a posting with no city in any label keeps the board's first range", () => {
    expect(greenhouseSalary([{ title: "Zone 1 Pay Range", currency_type: "USD", min_cents: 16_600_000, max_cents: 23_240_000 }, { title: "Zone 2 Pay Range", currency_type: "USD", min_cents: 14_940_000, max_cents: 20_920_000 }], "Remote - US")).toBe("USD 166,000.00 – 232,400.00");
  });
});
