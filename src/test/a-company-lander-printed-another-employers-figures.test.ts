// @vitest-environment node
/**
 * A COMPANY LANDER PRINTED ANOTHER EMPLOYER'S FIGURES (sweep S8-021).
 *
 * get_company_intel and get_similar_companies grouped by the token's first
 * '~' segment, the rule that folds a Workday tenant's career sites. For
 * Greenhouse/Lever EU (eu~<board>) and UKG (recruiting~<tenant>) that segment
 * is a host: live, eu~lookers and eu~rubyhotels returned byte-identical intel
 * (270 USD postings, +258 net-new) and identical similar lists, and so did two
 * UKG tenants. The browser's per-employer cache (getEmployerCtx, the compare
 * drawer) keyed the same way, so the second eu~ employer opened showed the
 * first one's headcount and filings.
 *
 * On pglite: 20260827140000 (the definitions live today), then
 * 20261009160200. A Workday tenant still pools its sites, and only them.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const rpc = vi.fn(async (_f: string, _a?: Record<string, unknown>) => ({ data: null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (f: string, a?: Record<string, unknown>) => rpc(f, a) } }));
import { getEmployerCtx } from "@/lib/employer-context";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 30_000 });

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
const mig = (prefix: string) => readFileSync(resolve(MIGRATIONS, readdirSync(MIGRATIONS).find((f) => f.startsWith(prefix))!), "utf8");

const STAND_INS = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, company_token text NOT NULL, company text NOT NULL DEFAULT '', category text,
    country text, salary_currency text, salary_min_annual numeric, missing_since timestamptz,
    effective_posted timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE public.company_profiles (company_token text PRIMARY KEY, employee_count int, employee_basis text, yc_batch text);
  CREATE TABLE public.showcase_excluded (company_token text PRIMARY KEY);
  CREATE TABLE public.job_board_company_snapshots (company_token text, snapshot_date date, open_roles int, PRIMARY KEY (company_token, snapshot_date));
`;
let n = 0;
const posts = (token: string, k: number, pay: number, category = "engineering") =>
  Array.from({ length: k }, () => `('p${n++}', '${token}', '${token}', '${category}', 'US', 'USD', ${pay}, NULL, now() - interval '2 days')`).join(",");
const SEED = `
  INSERT INTO public.job_board_postings (id, company_token, company, category, country, salary_currency, salary_min_annual, missing_since, effective_posted) VALUES
    ${posts("eu~lookers", 3, 50000)}, ${posts("eu~rubyhotels", 5, 90000, "hospitality")},
    ${posts("pwc~wd3~Advisory", 2, 100000)}, ${posts("pwc~wd3~Tax", 2, 120000)}, ${posts("pwc", 1, 10000)};
`;

async function boot(withFix: boolean) {
  const db = new PGlite();
  await db.exec(STAND_INS);
  await db.exec(mig("20260827140000_"));
  if (withFix) await db.exec(mig("20261009160200_"));
  await db.exec(SEED);
  return db;
}
const intel = async (db: PGlite, token: string) =>
  (await db.query<{ j: { usd_n: number } }>("SELECT public.get_company_intel($1) AS j", [token])).rows[0].j;
const similar = async (db: PGlite, token: string) =>
  (await db.query<{ j: Array<{ company_token: string }> }>("SELECT public.get_similar_companies($1, 6) AS j", [token])).rows[0].j.map((r) => r.company_token);

let before: PGlite, after: PGlite;
beforeAll(async () => { before = await boot(false); after = await boot(true); });

describe("a company lander printed another employer's figures", () => {
  it("positive control: before the fix, two eu~ employers answered each other's figures", async () => {
    expect((await intel(before, "eu~lookers")).usd_n).toBe(8);
  });

  it("an eu~ lander counts only its own postings", async () => {
    expect((await intel(after, "eu~lookers")).usd_n, "eu~lookers printed eu~rubyhotels' postings").toBe(3);
    expect((await intel(after, "eu~rubyhotels")).usd_n).toBe(5);
  });

  it("a Workday tenant still pools its own career sites, and nothing else that shares its first segment", async () => {
    expect((await intel(after, "pwc~wd3~Advisory")).usd_n, "the Workday sites stopped folding").toBe(4);
    expect((await intel(after, "pwc")).usd_n, "a non-Workday token named like the tenant was pooled into it").toBe(1);
  });

  it("the similar list may name another eu~ employer, never the lander's own", async () => {
    const list = await similar(after, "eu~lookers");
    expect(list).not.toContain("eu~lookers");
    // (eu~rubyhotels is in another field, so the field-matched list does not carry it.)
    const wd = await similar(after, "pwc~wd3~Advisory");
    expect(wd).not.toContain("pwc~wd3~Tax");
    expect(wd).not.toContain("pwc~wd3~Advisory");
  });

  // The cache is keyed on the employer key since 20261012100000 (hiring system
  // plus board): the source travels with the token.
  it("the browser's employer cache asks once per employer: two eu~ boards are two employers, two sites of one tenant are one", async () => {
    rpc.mockClear();
    await getEmployerCtx("eu~lookers", "greenhouse");
    await getEmployerCtx("eu~rubyhotels", "greenhouse");
    const asked = rpc.mock.calls.filter(([f]) => f === "get_company_intel").map(([, a]) => a?.p_token);
    expect(asked, "the second eu~ employer was served the first one's cached context").toEqual(["eu~lookers", "eu~rubyhotels"]);
    rpc.mockClear();
    await getEmployerCtx("acme~wd1~Careers", "workday");
    await getEmployerCtx("acme~wd1~Campus", "workday");
    expect(rpc.mock.calls.filter(([f]) => f === "get_company_intel").length).toBe(1);
  });
});
