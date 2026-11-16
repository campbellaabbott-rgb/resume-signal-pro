// @vitest-environment jsdom
/**
 * A FILING'S REVENUE IS NEVER SMALLER THAN ITS PROFIT (S14X-026).
 *
 * The SEC seed stored each filer's contract-revenue line as its revenue, so
 * the employer page printed Oscar Health's FY2025 revenue as $28.6M (total
 * revenues $11.70B) and M&T Bank's as $1.657B beside a $2.851B net income,
 * under "Figures as filed". On pglite, in the live order (the seed, Lovable's
 * copy of it with the first reader, then the correction):
 *   - every corrected year carries the filing's total revenue and the filing
 *     it was read from, and no row anywhere states a positive net income above
 *     its revenue;
 *   - the genuine losses larger than revenue (Revolution Medicines, Sunrun
 *     FY2024) are untouched;
 *   - a second run changes nothing, and the self-check refuses a table that
 *     still holds such a row;
 *   - each claim fails on the database before the correction.
 * The card then leaves out a revenue below a positive net income, whatever
 * the row says.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { render } from "@testing-library/react";
import { PublicCompanyCardView, printableRevenue, readFinancials } from "@/components/jobs/PublicCompanyCard";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
const mig = (prefix: string) => readFileSync(resolve(MIGRATIONS, files.find((f) => f.startsWith(prefix))!), "utf8");
const SEED = mig("20260722234500_");
const COPY = mig("20260723021844_");
const FIX = mig("20261112190000_");

// The client roles as Supabase makes them: default privileges grant ALL on
// what public creates, as on the live project.
const ROLES = `
  CREATE ROLE anon NOLOGIN NOINHERIT; CREATE ROLE authenticated NOLOGIN NOINHERIT;
  CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
`;

type Row = { fy: number; revenue: number | null; net_income: number | null; revenue_basis?: string };

async function seeded(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(ROLES);
  await db.exec(SEED);
  await db.exec(COPY);
  return db;
}
const series = async (db: PGlite, slug: string): Promise<Row[]> =>
  (await db.query<{ s: Row[] }>(`SELECT series AS s FROM public.company_financials WHERE slug = $1`, [slug])).rows[0]?.s ?? [];
const violations = async (db: PGlite): Promise<string[]> =>
  (await db.query<{ v: string }>(`
    SELECT f.slug || ' FY' || (e->>'fy') AS v
      FROM public.company_financials f, jsonb_array_elements(f.series) e
     WHERE (e->>'net_income')::numeric > 0 AND (e->>'revenue')::numeric < (e->>'net_income')::numeric
     ORDER BY 1`)).rows.map((r) => r.v);

let before: PGlite;
let after: PGlite;
beforeAll(async () => {
  before = await seeded();
  after = await seeded();
  await after.exec(FIX);
});

describe("the seed before the correction (the positive control)", () => {
  it("states a positive net income above revenue for M&T Bank and Oscar, and Oscar's revenue in millions", async () => {
    expect(await violations(before)).toEqual(["mtb FY2024", "mtb FY2025", "oscar FY2024"]);
    const oscar = (await before.query<{ j: { series: Row[] } }>(`SELECT public.get_company_financials('oscar') AS j`)).rows[0].j;
    expect(oscar.series.find((r) => r.fy === 2025)?.revenue).toBe(28_593_000);
  });
});

describe("after the correction", () => {
  it("Oscar's FY2025 revenue is the filing's $11.70B, read through the reader the page calls", async () => {
    const oscar = (await after.query<{ j: { series: Row[] } }>(`SELECT public.get_company_financials('oscar') AS j`)).rows[0].j;
    const fy25 = oscar.series.find((r) => r.fy === 2025)!;
    expect(fy25.revenue).toBeGreaterThan(1e9);
    expect(fy25.revenue).toBe(11_701_427_000);
    expect(fy25.revenue_basis).toBe("10-K 0001568651-26-000011 us-gaap:Revenues");
    expect(fy25.net_income).toBe(-443_151_000);
  });

  it("M&T Bank states no revenue in a year whose filing tags none, and never one below its net income", async () => {
    const mtb = await series(after, "mtb");
    for (const r of mtb) if (r.revenue != null && r.net_income != null) expect(r.revenue).toBeGreaterThanOrEqual(r.net_income);
    expect(mtb.filter((r) => r.fy >= 2024).map((r) => r.revenue)).toEqual([null, null]);
    expect(mtb.map((r) => r.net_income)).toEqual([2_851_000_000, 2_588_000_000, 2_741_000_000]);
  });

  it("U-Haul, Affirm and Sunbelt print their total revenue, at filing scale", async () => {
    expect((await series(after, "uhaul"))[0]).toMatchObject({ fy: 2026, revenue: 6_037_819_000, net_income: 83_128_000 });
    expect((await series(after, "affirm"))[0]).toMatchObject({ fy: 2025, revenue: 3_224_412_000 });
    expect((await series(after, "sunbeltrentals"))[0]).toMatchObject({ fy: 2026, revenue: 11_154_000_000, net_income: 1_325_000_000 });
  });

  it("no row in the table has a positive net income above its revenue", async () => {
    expect(await violations(after)).toEqual([]);
  });

  it("leaves the genuine losses larger than revenue, and every row it does not name, as seeded", async () => {
    expect(await series(after, "revolutionmedicines")).toEqual(await series(before, "revolutionmedicines"));
    expect(await series(after, "sunrun")).toEqual(await series(before, "sunrun"));
    const named = new Set(["affirm", "centene", "generalmotors", "mtb", "oscar", "pfizer", "sunbeltrentals", "uhaul", "unisys"]);
    const slugs = (await before.query<{ slug: string }>(`SELECT slug FROM public.company_financials ORDER BY slug`)).rows.map((r) => r.slug);
    expect(slugs.length).toBe(178);
    for (const s of slugs) if (!named.has(s)) expect(await series(after, s), s).toEqual(await series(before, s));
  });

  it("a second run rewrites nothing", async () => {
    const stamp = async () => (await after.query<{ t: string }>(`SELECT string_agg(slug || updated_at::text, ',' ORDER BY slug) AS t FROM public.company_financials`)).rows[0].t;
    const was = await stamp();
    await after.exec(FIX);
    expect(await stamp()).toBe(was);
  });

  it("the self-check refuses a table that still holds a profit above its revenue", async () => {
    const db = await seeded();
    await db.exec(`INSERT INTO public.company_financials (slug, cik, ticker, series) VALUES ('madeup', 1, 'MADE', '[{"fy": 2025, "revenue": 10, "net_income": 20}]')`);
    await expect(db.exec(FIX)).rejects.toThrow(/a positive net income above revenue remains for madeup FY2025/);
  });
});

describe("the card", () => {
  const MTB_AS_SEEDED = {
    ticker: "MTB", exchange: "NYSE", sec_name: "M&T BANK CORP", cik: 36270, currency: "USD",
    series: [
      { fy: 2025, revenue: 1_657_000_000, net_income: 2_851_000_000 },
      { fy: 2024, revenue: 1_541_000_000, net_income: 2_588_000_000 },
    ],
  };

  it("drops a revenue below a positive net income and keeps a loss larger than revenue", () => {
    expect(printableRevenue(1_657_000_000, 2_851_000_000)).toBeNull();
    expect(printableRevenue(0, -1_131_301_000)).toBe(0);
    expect(printableRevenue(2_037_719_000, -2_846_167_000)).toBe(2_037_719_000);
    expect(printableRevenue(11_154_000_000, 1_325_000_000)).toBe(11_154_000_000);
    expect(readFinancials(MTB_AS_SEEDED)!.series.map((r) => r.revenue)).toEqual([null, null]);
  });

  it("prints no revenue figure for {revenue 1.657e9, net income 2.851e9}, and still prints the net income", () => {
    const { container } = render(createElement(PublicCompanyCardView, { fin: readFinancials(MTB_AS_SEEDED) }));
    expect(container.querySelector(".text-2xl")).toBeNull();
    expect(container.querySelector("[data-sec-bars]")).toBeNull();
    expect(container.textContent).not.toMatch(/\$1\.(6|7|5)B/);
    expect(container.textContent).toContain("net income $2.9B (FY2025)");
  });
});
