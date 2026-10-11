// @vitest-environment node
/**
 * A COMPANY PAGE READS FACTS ONLY FROM ITS OWN HIRING SYSTEM (company
 * profiles, phase 0; migration 20261012101000).
 *
 * Live on 2026-10-11, get_company_financials('blackstone') answered Blackstone
 * Inc.'s SEC figures (BX, $14.45B revenue) for the Workable board "Blackstone
 * Shooting Sports", and 'costar' answered CoStar Group's for the Greenhouse
 * board "Co-Star": the reader matched an SEC slug to a token's first segment,
 * which no vendor owns. Before 20261009160200 the intel and similar readers
 * pooled every UKG client under recruiting~ and every EU pod board under eu~
 * (1,249 landers, Ollie's $49,920 median taken from other employers' postings).
 *
 * On pglite, in the live order: the financials table and reader
 * (20260723021844), the readers as 20260827140000 left them, the wave-3
 * rewrite (20261009160200), the employer key (20261012100000), then this file.
 * Every claim has a positive control on a database without the fix.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { CATALOG } from "./helpers/catalog";
import { employerSegment } from "@/lib/employer-key";

vi.setConfig({ hookTimeout: 180_000, testTimeout: 60_000 });

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
const mig = (prefix: string) => readFileSync(resolve(MIGRATIONS, files.find((f) => f.startsWith(prefix))!), "utf8");
const FIX = mig("20261012101000_");

const STAND_INS = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, source text NOT NULL, company_token text NOT NULL, company text NOT NULL DEFAULT '',
    category text, country text, salary_currency text, salary_min_annual numeric, missing_since timestamptz,
    effective_posted timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE public.company_profiles (company_token text PRIMARY KEY, employee_count int, employee_basis text, yc_batch text);
  CREATE TABLE public.showcase_excluded (company_token text PRIMARY KEY);
  CREATE TABLE public.job_board_company_snapshots (company_token text, snapshot_date date, company text NOT NULL DEFAULT '', open_roles int NOT NULL DEFAULT 0, PRIMARY KEY (company_token, snapshot_date));
`;

let n = 0;
/** k open postings of one board, each stating a USD floor of `pay`. */
const posts = (source: string, token: string, company: string, k: number, pay: number, category = "engineering", closed = false) =>
  Array.from({ length: k }, () => `('${source}:${token}:${n++}', '${source}', '${token}', '${company.replace(/'/g, "''")}', '${category}', 'US', 'USD', ${pay}, ${closed ? "now()" : "NULL"}, now() - interval '2 days')`);

const UKG_OLLIE_A = "recruiting~OLL1000OLLIE~355913c1-206d-48a4-bb34-020064efe845";
const UKG_OLLIE_B = "recruiting~OLL1000OLLIE~0000aaaa-0000-0000-0000-000000000000";
const UKG_BIGC = "recruiting~BIG1003BIGC~63b1fe5f-a895-49e4-afdc-7059fb08eea2";
const UKG_TROO = "recruiting2~TRO1001TROO~2b13054b-60bb-410d-9136-e52c1c7d9720";
const BX_SITE = "blackstone~wd1~blackstone_careers";
const BX_CAMPUS = "blackstone~wd1~Blackstone_Campus_Careers";

const SEED = `
  INSERT INTO public.job_board_postings (id, source, company_token, company, category, country, salary_currency, salary_min_annual, missing_since, effective_posted) VALUES
  ${[
    ...posts("workable", "blackstone", "Blackstone Shooting Sports", 3, 30000, "hospitality"),
    ...posts("workday", BX_SITE, "Blackstone", 3, 200000, "finance"),
    ...posts("workday", BX_CAMPUS, "Blackstone", 2, 100000, "finance"),
    ...posts("greenhouse", "costar", "Co–Star", 1, 120000, "engineering", true),
    ...posts("workday", "costar~wd1~CoStarCareers", "Costar", 4, 90000, "sales"),
    ...posts("workday", "trustmark~wd1~trustmarkcareers", "Trustmark", 2, 60000, "finance"),
    ...posts("pinpoint", "accenture", "Accenture", 2, 80000, "consulting"),
    ...posts("workday", "accenture~wd103~AccentureCareers", "Accenture", 3, 80000, "consulting"),
    ...posts("lever", "lifestance", "LifeStance Health", 3, 70000, "healthcare"),
    ...posts("workday", "lifestance~wd5~Careers", "Lifestance", 1, 70000, "healthcare"),
    ...posts("ukg", UKG_OLLIE_A, "Ollie's", 3, 40000, "retail"),
    ...posts("ukg", UKG_OLLIE_B, "Ollie's", 2, 42000, "retail"),
    ...posts("ukg", UKG_BIGC, "Big C", 5, 90000, "retail"),
    ...posts("ukg", UKG_TROO, "Troon", 4, 55000, "hospitality"),
    ...posts("greenhouse", "eu~lookers", "Lookers", 3, 50000, "retail"),
    ...posts("lever", "eu~rubyhotels", "Ruby Hotels", 5, 90000, "hospitality"),
    ...posts("oracle", "ejwl~us2~CX", "Marriott", 2, 50000, "hospitality"),
    ...posts("oracle", "ejwl~us2~CX_1001", "Marriott", 3, 52000, "hospitality"),
    ...posts("greenhouse", "clear", "CLEAR - Corporate", 2, 150000, "engineering"),
    ...posts("bamboohr", "clear", "Clear", 3, 60000, "engineering"),
    ...posts("greenhouse", "peerfin", "Peer Finance", 4, 100000, "finance"),
    ...posts("ashby", "peerhosp", "Peer Hospitality", 4, 40000, "hospitality"),
  ].join(",\n  ")};
  INSERT INTO public.company_profiles (company_token, employee_count, employee_basis) VALUES
    ('blackstone', 40, 'public_records'), ('${BX_SITE}', 4700, 'public_records');
  INSERT INTO public.job_board_company_snapshots (company_token, snapshot_date, open_roles) VALUES
    ('blackstone', current_date - 6, 100), ('blackstone', current_date, 3),
    ('${BX_SITE}', current_date - 6, 3), ('${BX_SITE}', current_date, 3),
    ('${BX_CAMPUS}', current_date - 6, 1), ('${BX_CAMPUS}', current_date, 2);
`;

const strip = (sql: string) => sql.replace(/NOTIFY pgrst[^;]*;/g, "");

async function boot(upTo: "wave3" | "fix", opts: { drift?: string } = {}) {
  const db = new PGlite();
  await db.exec(STAND_INS);
  await db.exec(strip(mig("20260723021844_")));
  await db.exec(mig("20260827140000_"));
  await db.exec(mig("20261009160200_"));
  await db.exec(mig("20261012100000_"));
  if (opts.drift) await db.exec(opts.drift);
  if (upTo === "fix") await db.exec(FIX);
  await db.exec(SEED);
  return db;
}

type Intel = { usd_n: number; employees: number | null; net_7d: number | null; open_by_source?: Array<{ source: string; open_roles: number }> };
const intel = async (db: PGlite, t: string) => (await db.query<{ j: Intel }>("SELECT public.get_company_intel($1) AS j", [t])).rows[0].j;
const fin = async (db: PGlite, t: string) => (await db.query<{ j: { ticker: string } | null }>("SELECT public.get_company_financials($1) AS j", [t])).rows[0].j;
const similar = async (db: PGlite, t: string) =>
  (await db.query<{ j: Array<{ company_token: string }> }>("SELECT public.get_similar_companies($1, 20) AS j", [t])).rows[0].j.map((r) => r.company_token);

let before: PGlite, after: PGlite;
beforeAll(async () => { [before, after] = await Promise.all([boot("wave3"), boot("fix")]); });

describe("SEC figures attach only to the board they were matched for", () => {
  it("positive control: before the fix, Blackstone Inc. reached the shooting range and CoStar Group reached Co-Star", async () => {
    expect((await fin(before, "blackstone"))?.ticker).toBe("BX");
    expect((await fin(before, "costar"))?.ticker).toBe("CSGP");
  });

  it("Blackstone Inc.'s figures no longer reach 'Blackstone Shooting Sports'; both Workday sites keep them", async () => {
    expect(await fin(after, "blackstone")).toBeNull();
    expect((await fin(after, BX_SITE))?.ticker).toBe("BX");
    expect((await fin(after, BX_CAMPUS))?.ticker).toBe("BX");
  });

  it("CoStar Group's figures no longer reach 'Co–Star'", async () => {
    expect(await fin(after, "costar")).toBeNull();
    expect((await fin(after, "costar~wd1~CoStarCareers"))?.ticker).toBe("CSGP");
  });

  it("each hand-decided slug attaches to the one board it was matched for", async () => {
    expect((await fin(after, "accenture~wd103~AccentureCareers"))?.ticker).toBe("ACN");
    expect(await fin(after, "accenture"), "one source per row: the Pinpoint board loses the card").toBeNull();
    expect((await fin(after, "lifestance"))?.ticker).toBe("LFST");
    expect(await fin(after, "lifestance~wd5~Careers")).toBeNull();
  });

  it("trustmark, read and rejected by the alias seed, attaches nowhere", async () => {
    expect((await fin(before, "trustmark~wd1~trustmarkcareers"))?.ticker, "positive control").toBe("TRMK");
    expect(await fin(after, "trustmark~wd1~trustmarkcareers")).toBeNull();
  });

  it("a UKG or eu~ token never matches an SEC slug by its path segment", async () => {
    await after.exec("INSERT INTO public.company_financials (slug, cik, ticker, matched_source) VALUES ('eu', 1, 'EUX', 'greenhouse'), ('recruiting', 2, 'RCX', 'ukg') ON CONFLICT DO NOTHING");
    expect(await fin(after, "eu~lookers")).toBeNull();
    expect(await fin(after, UKG_OLLIE_A)).toBeNull();
    await after.exec("DELETE FROM public.company_financials WHERE slug IN ('eu', 'recruiting')");
  });

  it("matched_source: six by hand, 170 derived, comcast and trustmark matched to no board", async () => {
    const { rows } = await after.query<{ slug: string; matched_source: string | null }>("SELECT slug, matched_source FROM public.company_financials ORDER BY slug");
    expect(rows.length).toBe(178);
    const by = Object.fromEntries(rows.map((r) => [r.slug, r.matched_source]));
    expect({ accenture: by.accenture, blackstone: by.blackstone, costar: by.costar, lifestance: by.lifestance, medline: by.medline, samsara: by.samsara })
      .toEqual({ accenture: "workday", blackstone: "workday", costar: "workday", lifestance: "lever", medline: "workday", samsara: "greenhouse" });
    expect(rows.filter((r) => r.matched_source === null).map((r) => r.slug).sort()).toEqual(["comcast", "trustmark"]);
  });
});

describe("the 1,249 pooled UKG and EU boards each read their own intel", () => {
  it("positive control: the readers as 20260827140000 left them pooled every recruiting~ client and every eu~ board", async () => {
    const old = new PGlite();
    await old.exec(STAND_INS);
    await old.exec(mig("20260827140000_"));
    await old.exec(SEED);
    expect((await intel(old, UKG_OLLIE_A)).usd_n, "Ollie's read Big C's postings").toBe(10);
    expect((await intel(old, "eu~lookers")).usd_n).toBe(8);
  });

  it("two UKG clients are two employers; one client's two career sites are one", async () => {
    expect((await intel(after, UKG_OLLIE_A)).usd_n).toBe(5);
    expect((await intel(after, UKG_OLLIE_B)).usd_n).toBe(5);
    expect((await intel(after, UKG_BIGC)).usd_n).toBe(5);
    expect((await intel(after, UKG_TROO)).usd_n).toBe(4);
  });

  it("every eu~ board is its own employer", async () => {
    expect((await intel(after, "eu~lookers")).usd_n).toBe(3);
    expect((await intel(after, "eu~rubyhotels")).usd_n).toBe(5);
  });

  it("a Workday or Oracle tenant pools its own sites and nothing another vendor files under the same name", async () => {
    expect((await intel(after, BX_SITE)).usd_n).toBe(5);
    expect((await intel(after, "blackstone")).usd_n, "the shooting range read the Workday tenant's postings").toBe(3);
    expect((await intel(after, "ejwl~us2~CX")).usd_n).toBe(5);
  });

  it("headcount and the week's series follow the employer's own boards", async () => {
    expect((await intel(before, "blackstone")).employees, "positive control: wave 3 kept a plain slug apart already").toBe(40);
    expect((await intel(after, BX_SITE)).employees).toBe(4700);
    expect((await intel(after, "blackstone")).employees).toBe(40);
    expect((await intel(after, BX_SITE)).net_7d, "the Workable board's snapshots leaked into the tenant's series").toBe(1);
    expect((await intel(after, "blackstone")).net_7d).toBe(-97);
  });

  it("a token two vendors carry answers both vendors' postings and says how many each holds", async () => {
    const c = await intel(after, "clear");
    expect(c.usd_n).toBe(5);
    expect(c.open_by_source).toEqual([{ source: "bamboohr", open_roles: 3 }, { source: "greenhouse", open_roles: 2 }]);
    expect((await intel(after, BX_SITE)).open_by_source, "counts THIS board, not the tenant").toEqual([{ source: "workday", open_roles: 3 }]);
  });
});

describe("the week's series keeps a tenant's site whose roles all came down", () => {
  // acme~wd1~Careers serves 10 roles all week; acme~wd1~Stores served 40 six
  // days ago and none today (every posting marked missing yesterday). The
  // wave-3 reader summed every Workday site of the tenant, so net_7d said the
  // tenant lost 40 roles. The re-keyed reader chose snapshot boards from the
  // 30-day serving postings, so a site whose roles all closed this week fell
  // out of its own series and net_7d said 0.
  const WD_SEED = `
    INSERT INTO public.job_board_postings (id, source, company_token, company, category, country, salary_currency, salary_min_annual, missing_since, effective_posted) VALUES
    ${[
      ...posts("workday", "acmewd~wd1~Careers", "Acme", 10, 50000, "operations"),
      ...Array.from({ length: 40 }, (_, i) => `('workday:acmewd~wd1~Stores:${i}', 'workday', 'acmewd~wd1~Stores', 'Acme', 'retail', 'US', 'USD', 30000, now() - interval '1 day', now() - interval '9 days')`),
      ...posts("greenhouse", "acmewd", "Acme Sports", 3, 40000, "retail"),
    ].join(",\n    ")};
    INSERT INTO public.job_board_company_snapshots (company_token, snapshot_date, open_roles) VALUES
      ('acmewd~wd1~Careers', current_date - 6, 10), ('acmewd~wd1~Careers', current_date, 10),
      ('acmewd~wd1~Stores', current_date - 6, 40), ('acmewd~wd1~Stores', current_date, 0),
      ('acmewd', current_date - 6, 50), ('acmewd', current_date, 3);
  `;
  let b: PGlite, a: PGlite;
  beforeAll(async () => {
    [b, a] = await Promise.all([boot("wave3"), boot("fix")]);
    await b.exec(WD_SEED);
    await a.exec(WD_SEED);
  });

  it("positive control: the wave-3 reader counted the closed site's 40 roles in the tenant's week", async () => {
    expect((await intel(b, "acmewd~wd1~Careers")).net_7d).toBe(-40);
  });

  it("the re-keyed reader still counts them, and still keeps a plain slug on another vendor out", async () => {
    expect((await intel(a, "acmewd~wd1~Careers")).net_7d, "a site whose roles all closed fell out of its tenant's series").toBe(-40);
    expect((await intel(a, "acmewd~wd1~Stores")).net_7d).toBe(-40);
    expect((await intel(a, "acmewd")).net_7d, "the Greenhouse board read the Workday tenant's snapshots").toBe(-47);
  });
});

describe("similar employers exclude the employer itself and no one else", () => {
  it("a Workday tenant's list names neither of its sites; the board that only shares its name is another employer", async () => {
    const list = await similar(after, BX_SITE);
    expect(list).not.toContain(BX_SITE);
    expect(list).not.toContain(BX_CAMPUS);
    expect(list).toContain("peerfin");
  });

  it("a UKG client's list names other clients but never its own sites", async () => {
    const list = await similar(after, UKG_OLLIE_A);
    expect(list).not.toContain(UKG_OLLIE_A);
    expect(list).not.toContain(UKG_OLLIE_B);
    expect(list).toContain(UKG_BIGC);
  });

  it("a plain slug's list never names itself, and may name a same-named board on another vendor", async () => {
    const list = await similar(after, "blackstone");
    expect(list).not.toContain("blackstone");
    expect(list).toContain("peerhosp");
  });
});

describe("the file checks itself and re-runs", () => {
  it("refuses a live reader it does not know rather than overwrite it", async () => {
    const drift = `CREATE OR REPLACE FUNCTION public.get_company_financials(p_token text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT jsonb_build_object('hand_edit', true) $$;`;
    await expect(boot("fix", { drift })).rejects.toThrow(/drifted/);
  });

  it("applies twice, and a re-run never overturns a match set by hand afterwards", async () => {
    await after.exec("UPDATE public.company_financials SET matched_source = 'workday' WHERE slug = 'lifestance'");
    await after.exec(FIX);
    const { rows } = await after.query<{ m: string }>("SELECT matched_source AS m FROM public.company_financials WHERE slug = 'lifestance'");
    expect(rows[0].m).toBe("workday");
    await after.exec("UPDATE public.company_financials SET matched_source = 'lever' WHERE slug = 'lifestance'");
  });

  it("the three readers stay callable by both client roles", async () => {
    const { rows } = await after.query<Record<string, boolean>>(`SELECT
      has_function_privilege('anon', 'public.get_company_intel(text)', 'EXECUTE') AS i,
      has_function_privilege('anon', 'public.get_similar_companies(text,integer)', 'EXECUTE') AS s,
      has_function_privilege('authenticated', 'public.get_company_financials(text)', 'EXECUTE') AS f`);
    expect(rows[0]).toEqual({ i: true, s: true, f: true });
  });
});

describe("the migration's lists are the catalogue's", () => {
  const values = (from: string) => [...from.matchAll(/\('([^']+)', '([a-z]+)'\)/g)].map((m) => [m[1], m[2]] as const);
  const code = FIX.replace(/--[^\n]*/g, "");
  const updates = code.split(/UPDATE public\.company_financials f/).slice(1).map((s) => s.slice(0, s.indexOf(";")));
  const hand = values(updates[0]);
  const derived = values(updates[1]);
  const seeded = [...mig("20260722234500_").matchAll(/^\s*\('([^']+)', (\d+), '/gm)].map((m) => m[1]);
  const vendorsOf = (slug: string) => new Set(CATALOG.filter((e) => employerSegment(e.token) === slug).map((e) => e.source));

  it("the hand-decided six are exactly the seeded slugs whose segment spans two vendors", () => {
    const spans = seeded.filter((s) => vendorsOf(s).size > 1).sort();
    expect(hand.map(([s]) => s).sort()).toEqual(spans);
    for (const [slug, source] of hand) expect(vendorsOf(slug).has(source), `${slug}: ${source} carries no board under it`).toBe(true);
  });

  it("every derived pair names a vendor that carries a board under that segment", () => {
    expect(derived.length).toBe(170);
    const bad = derived.filter(([slug, source]) => !vendorsOf(slug).has(source)).map(([s, v]) => `${s}:${v}`);
    expect(bad).toEqual([]);
  });

  it("every seeded slug is hand-decided, derived, or left matched to no board for a stated reason", () => {
    const covered = new Set([...hand, ...derived].map(([s]) => s));
    const left = seeded.filter((s) => !covered.has(s)).sort();
    expect(left).toEqual(["comcast", "trustmark"]);
    expect(vendorsOf("comcast").size, "comcast is back in the catalogue: derive it").toBe(0);
  });
});
