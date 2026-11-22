// @vitest-environment node
/**
 * A GREENHOUSE BOARD STATES ITS PAY, AND THE BOARD READS IT (S9-010, job-board .103).
 *
 * Greenhouse's job board API states a posting's pay when asked with
 * pay_transparency=true. Our list never asked, so a Greenhouse row's pay was
 * whatever the description miner could find, and a light board (no content)
 * had none. Read 2026-11-17: Coinbase states pay on 248 of 259 postings and we
 * read 23; Airbnb 163 of 200, we read 13; Databricks (a light board) 470 of
 * 902, its list read none.
 *
 * These run the shipped normaliser and slim spec, the list URL cut out of
 * index.ts, and the change-log set; the ranges are the boards' own shapes.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { greenhouseApi, greenhouseSalary, normalizeGreenhouse, type GreenhousePayRange } from "../../supabase/functions/job-board/normalize";
import { parseSalaryStructured } from "../../supabase/functions/_shared/salary-extract";
import { SLIM_SPECS } from "../../supabase/functions/job-board/slim-stream";
import { codeOf } from "./helpers/strip-comments";

const RAW = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const range = (title: string, lo: number, hi: number, cur = "USD"): GreenhousePayRange => ({ title, min_cents: Math.round(lo * 100), max_cents: Math.round(hi * 100), currency_type: cur });

describe("the ranges a board states, read as the row's pay", () => {
  it("a labelled annual or hourly range keeps its period", () => {
    expect(greenhouseSalary([range("Annual base salary range (excluding equity and bonus):", 166_345, 195_700)])).toBe("USD 166,345.00 – 195,700.00 per year");
    expect(greenhouseSalary([range("Hourly Rate:", 40, 60)])).toBe("USD 40.00 – 60.00 per hour");
    expect(greenhouseSalary([range("Mexico Monthly Pay Range", 43_500, 60_000, "MXN")])).toBe("MXN 43,500.00 – 60,000.00 per month");
    expect(greenhouseSalary([range("Canada Annual Pay Range", 58_000, 68_000, "CAD")])).toBe("CAD 58,000.00 – 68,000.00 per year");
  });

  it("a label that names no period states the figures, and the parser reads them as it reads mined figures", () => {
    const annual = greenhouseSalary([range("Pay Range", 168_000, 203_000)]);
    expect(annual).toBe("USD 168,000.00 – 203,000.00");
    expect(parseSalaryStructured(annual!, "US", null)).toMatchObject({ annualMin: 168_000, annualMax: 203_000, currency: "USD", period: null });
    const intern = greenhouseSalary([range("Internship", 46, 46)]);
    expect(intern).toBe("USD 46.00");
    expect(parseSalaryStructured(intern!, "US", null)?.annualMin).toBe(46 * 2080);
  });

  it("the first range that reads as pay: a typo'd zone is passed over, the zones' own order kept", () => {
    expect(greenhouseSalary([range("Zone 1 Pay Range", 311, 325_000), range("Zone 2 Pay Range", 330_000, 350_000), range("Zone 3 Pay Range", 350_000, 375_000)]))
      .toBe("USD 330,000.00 – 350,000.00");
    expect(greenhouseSalary([range("Zone 1 Pay Range", 166_000, 232_400), range("Zone 2 Pay Range", 149_400, 209_200)])).toBe("USD 166,000.00 – 232,400.00");
    expect(greenhouseSalary([range("Annual base salary range (excluding bonus):", 95_030, 179_300_152)]), "a spread past five times is not a range").toBeNull();
  });

  it("states nothing where the board states nothing usable", () => {
    for (const r of [undefined, null, [], [{}], [{ min_cents: 0, max_cents: 0, currency_type: "USD", title: "Pay Range" }], [range("Pay Range", 200_000, 100_000)], [{ min_cents: 10_000_000, max_cents: 12_000_000, title: "Pay Range" }]]) {
      expect(greenhouseSalary(r as never), JSON.stringify(r)).toBeNull();
    }
  });

  it("the normaliser hands the stated pay to the row, and a posting without ranges keeps no pay", () => {
    const out = normalizeGreenhouse({
      jobs: [
        { id: 1, title: "Accounting Manager", absolute_url: "https://www.coinbase.com/careers/positions/1", pay_input_ranges: [range("Annual base salary range (excluding equity and bonus):", 166_345, 195_700)] },
        { id: 2, title: "Engineer", absolute_url: "https://www.coinbase.com/careers/positions/2" },
      ],
    } as never, "Coinbase", "coinbase");
    expect(out.map((j) => j.salary)).toEqual(["USD 166,345.00 – 195,700.00 per year", null]);
  });
});

describe("the list asks for the pay", () => {
  const i = RAW.indexOf("\nconst listUrl = ");
  const ts = RAW.slice(i + 1, RAW.indexOf(";\n", i) + 2);
  const make = (light: boolean) =>
    new Function("isLight", "greenhouseApi", `${transformSync(ts, { loader: "ts" }).code}\nreturn listUrl;`)(() => light, greenhouseApi) as (s: { source: string; token: string }) => string;

  it("on a content list and on a light list, US and EU", () => {
    expect(make(false)({ source: "greenhouse", token: "coinbase" })).toBe("https://boards-api.greenhouse.io/v1/boards/coinbase/jobs?content=true&pay_transparency=true");
    expect(make(true)({ source: "greenhouse", token: "databricks" })).toBe("https://boards-api.greenhouse.io/v1/boards/databricks/jobs?pay_transparency=true");
    expect(make(true)({ source: "greenhouse", token: "eu~acme" })).toBe("https://boards.eu.greenhouse.io/v1/boards/acme/jobs?pay_transparency=true");
  });
});

describe("the streamed light read keeps the ranges and drops their prose", () => {
  it("SLIM_SPECS.greenhouse", () => {
    const spec = SLIM_SPECS.greenhouse;
    expect(spec.keep).toContain("pay_input_ranges");
    const o: Record<string, unknown> = {
      id: 1,
      pay_input_ranges: [{ min_cents: 16_600_000, max_cents: 23_240_000, currency_type: "USD", title: "Zone 1 Pay Range", blurb: "<p>Databricks ...</p>", description: "<p>long prose</p>" }, null],
    };
    spec.reduce!(o);
    expect(o.pay_input_ranges).toEqual([{ min_cents: 16_600_000, max_cents: 23_240_000, currency_type: "USD", title: "Zone 1 Pay Range" }]);
    const none: Record<string, unknown> = { id: 2 };
    spec.reduce!(none);
    expect("pay_input_ranges" in none).toBe(false);
  });
});

describe("the first lap's new pay is our reading, not an employer's edit (n1602)", () => {
  const REMOVE_AFTER = "2026-12-31";
  const line = /const OUR_READING_CHANGED = new Set\(\[[\s\S]*?\]\);/.exec(RAW)?.[0] ?? "";
  it("greenhouse:salary is in the set, with its removal date", () => {
    expect(codeOf(line)).toContain('"greenhouse:salary"');
    expect(line).toContain(`Remove after ${REMOVE_AFTER} (n1602)`);
  });
  // As n1426's guard: keeping the entry past the window only spares a few false
  // "employer edit" lines, dropping it early is the harmful direction, so the
  // builds cut with it may carry it and the first one after may not.
  const BUILDS_THAT_MAY_CARRY = ["2026-09-09.102", "2026-09-09.103"];
  it(`the entry is removed by ${REMOVE_AFTER}, in the first job-board build after .103`, () => {
    const today = new Date().toISOString().slice(0, 10);
    const present = codeOf(line).includes('"greenhouse:salary"');
    const build = /const BUILD_VERSION = "([^"]+)"/.exec(RAW)?.[1];
    expect(build, "job-board/index.ts names no BUILD_VERSION").toBeTruthy();
    expect(today <= REMOVE_AFTER || !present || BUILDS_THAT_MAY_CARRY.includes(build!), `remove "greenhouse:salary" from OUR_READING_CHANGED in job-board ${build}: the window closed ${REMOVE_AFTER}`).toBe(true);
  });
});
