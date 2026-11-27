// @vitest-environment node
/**
 * WORKDAY BOARDS NAMED BY A TENANT CODE PRINT THE BRAND ON THEIR OWN CAREER SITE.
 *
 * Owner decision OD9 (a), 2026-11-08: a Workday board that shows a tenant code
 * shows the brand its employer presents on its own Workday career site. The
 * names corpus of 2026-11-08 proposed a name for 1,430 tenants; the
 * independent re-check of 2026-11-17 judged 100 of its rows. Migration
 * 20261111150000 ships the stratum the re-check measured above the bar (high
 * confidence, hand-reviewed), less every key a pattern rule flags, plus the
 * rows the re-check judged, each wrong one corrected, less the 14 keys whose
 * name was read on a page the tenant's robots.txt disallows and the 3 that name
 * a board whose own site path it disallows: 414 keys over 354 tenants. Every
 * name and every evidence row rests on the employer's own words in the
 * 2026-11-08 capture; none on the re-check's 2026-11-17 reads. A fresh
 * sample of the list on 2026-11-18 (50 keys, three judges each, the 11-08
 * captures only, no live read) found 50/50 right by majority, a Wilson 95%
 * lower bound of 92.9% against the 85% bar fixed before the judging, so the
 * list ships. The list, with every key left out and why, is the names build's
 * final-names.json; every verdict of the sample is in its confirm/result.json.
 *
 * Checked: the file holds that list, pinned here by a hash of its key=name
 * pairs so that any machine fails on a changed name, and nothing a main
 * migration already holds; every name has its 11-08 evidence and passes the
 * bake's gate unchanged;
 * the re-check's wrong names and every class left out are absent; and on a
 * real Postgres from Supabase's default grants, applied twice, a sampled
 * board's next write takes its new name, a board left out keeps its own, a
 * hand-set override survives, the stored rows are left to the name-sync lane
 * the file re-arms, and the file refuses what it cannot vouch for.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { JOB_SOURCES } from "../../supabase/functions/job-board/sources";
import { boardName, isCodeShapedName, isUnreviewedTenantName } from "../lib/company-display";
import { EMPLOYER_NAME_OVERRIDES } from "../lib/employer-names";

vi.setConfig({ hookTimeout: 180_000, testTimeout: 90_000 });

const ROOT = resolve(__dirname, "../..");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");
const STAMP = "20261111150000";
const FILES = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
const FILE = FILES.find((f) => f.startsWith(`${STAMP}_`)) ?? "";
const SQL = FILE ? readFileSync(resolve(MIGRATIONS, FILE), "utf8") : "";
const TABLE_SQL = readFileSync(resolve(MIGRATIONS, FILES.find((f) => f.startsWith("20261025100000_")) ?? ""), "utf8");
/** The names build's list, where the build left it (the machine that ran it). */
const FINAL = resolve(homedir(), ".config/resumebooster/push-all-2026-11-17/names/final-names.json");

/** The counts final-names.json gives: keys, tenants, rows the boards served on 2026-11-08. */
const KEYS = 414;
const TENANTS = 354;
const ROWS = 28_357;
/**
 * sha256 of the file's key=name pairs, one per line, sorted: the names build's list, pinned in the
 * repository, so a name changed in both the file and the mirror fails on every machine, not only on
 * the one that holds final-names.json. A deliberate change re-pins it from the names build.
 */
const PIN = "5324391dc590110c7e76574cf80dd02bbab2f221f69b68eec604d1df3cc6cafe";

const lit = (s: string) => s.slice(1, -1).replace(/''/g, "'");
const STR = "'(?:[^']|'')*'";
const overridesOf = (sql: string): [string, string][] => {
  const m = /INSERT INTO public\.company_name_overrides \(slug, display_name\) VALUES([\s\S]*?)ON CONFLICT/.exec(sql);
  return m ? [...m[1].matchAll(new RegExp(`\\((${STR}),\\s*(${STR})\\)`, "g"))].map((x) => [lit(x[1]), lit(x[2])]) : [];
};
const OVERRIDES = overridesOf(SQL);
const NAMES = new Map(OVERRIDES);
type Ev = { name: string; links: string[]; quote: string; readOn: string };
const EVIDENCE = (() => {
  const m = /INSERT INTO public\.company_name_evidence \(slug, display_name, evidence, quote, read_on\)[\s\S]*?FROM \(VALUES([\s\S]*?)\n {2}\) AS v/.exec(SQL);
  if (!m) return [] as [string, Ev][];
  return [...m[1].matchAll(new RegExp(`\\((${STR}),\\s*(${STR}),\\s*ARRAY\\[((?:\\s*${STR}\\s*,?)+)\\],\\s*(${STR}),\\s*DATE '(\\d{4}-\\d{2}-\\d{2})'\\)`, "g"))]
    .map((x) => [lit(x[1]), { name: lit(x[2]), links: [...x[3].matchAll(new RegExp(STR, "g"))].map((l) => lit(l[0])), quote: lit(x[4]), readOn: x[5] }] as [string, Ev]);
})();
const tenantOf = (key: string) => key.split("~")[0];
const workday = JOB_SOURCES.filter((s) => s.source === "workday");
/** A catalogued board the key names: the token itself, or the tenant's first site no token key of this file names. */
const boardOf = (key: string) => key.includes("~")
  ? workday.find((s) => s.token === key)
  : workday.find((s) => tenantOf(s.token) === key && !NAMES.has(s.token));

/** The re-check's sampled wrong rows: the name the corpus proposed, and the right one this file ships. */
const WRONG: [string, string, string][] = [
  ["tscfl", "HVAC Photo", "Tallahassee State College"],
  ["mfs", "Mass Financial Services", "MFS"],
  ["nghs", "NGHS", "Northeast Georgia Health System"],
  ["americanglobal", "American", "American Global"],
  ["woundedwarriorproject", "Wounded Warrior Project | WWP", "Wounded Warrior Project"],
  ["gcu~wd1~Orbis", "Grand Canyon Education", "Orbis Education"],
  ["cba~wd3~CommBank_Careers", "Commonwealth Bank", "CommBank"],
  ["erm", "Environmental Resources Management", "ERM"],
  ["isc", "Information Services", "ISC"],
  ["agreenspace", "NZ National Carriers", "Team Global Express"],
];
/** Tenants and boards left out, one or more of each class, none of which may hold a key here. */
const LEFT_OUT: Record<string, string[]> = {
  "the re-check found no single right name, or a name in motion": ["gi", "warnerbros", "goldenagri", "tcbrands"],
  "the re-check judged it, but the 2026-11-08 capture does not support the name": ["travelhrportal", "vcuhealth", "hss", "gcu~wd1~GCU"],
  "sampled in a stratum under the bar, and wrong": ["wehi", "teamselecthh", "lgi", "luminegrp", "flutterbe", "employeeownedbrands", "ausvenueco", "lmg", "pmpediatrics"],
  "a pattern rule flagged it": ["christianacare", "landolakes", "hshs", "dcsd", "orix", "melcoresorts", "uvmhealth", "comfortsystemsusa~wd1~cusasw", "comfortsystemsusa~wd1~MidSouth", "bbinsurance~wd1~ArrowheadCareers", "thgrp~wd12~HeritageConstructionMaterials", "vhaca~wd10~Champlain", "crystalsugar", "melocheinc"],
  "its name folds equal to another catalogued employer's": ["deloitteie", "bdoau", "goodwinprocter", "newschool", "dennys", "morsco"],
  "code-unresolved in the corpus": ["onehealthineers", "mmc", "ncr", "campbellsoup", "blackstone", "suffolkcountyny"],
  // lumaenergy's corrected name (LUMA, not the corpus's "New LUMA") goes with these.
  "its name was read on a page the tenant's robots.txt disallows": ["citicclsa", "dallascollege", "davispolk", "eset", "fimc", "lumaenergy", "massmutual", "pepperlfuchs", "rbs", "rgare", "sdguthrie~wd3~NBPOL", "sdguthrie~wd3~SDGUTHRIEMINAMAS", "situsamc", "ucf~wd1~careers"],
  // Read on an allowed page, but a board each names sits under a Disallow: mbda's MBDA-DE and
  // MBDA-Italy sites, synchronyfinancial's careers site, vertexinc's referrals site (/Referrals/).
  "robots.txt disallows the board's own site path": ["mbda", "synchronyfinancial", "vertexinc"],
};

describe("the file holds the names build's list, and only new keys", () => {
  it("is one file at its stamp", () => {
    expect(FILES.filter((f) => f.startsWith(`${STAMP}_`))).toHaveLength(1);
  });

  it(`ships ${KEYS} keys over ${TENANTS} tenants, each key once, and says so`, () => {
    expect(OVERRIDES.length).toBe(KEYS);
    expect(NAMES.size).toBe(KEYS);
    expect(new Set(OVERRIDES.map(([k]) => tenantOf(k))).size).toBe(TENANTS);
    expect(SQL).toMatch(new RegExp(`This file names ${TENANTS} of them: ${KEYS} company_name_overrides keys over ${ROWS.toLocaleString("en-US")}(?:\\s|-)+rows`));
  });

  it("holds the pinned list, name for name, on any machine", () => {
    const pairs = OVERRIDES.map(([k, n]) => `${k}=${n}`).sort().join("\n");
    expect(createHash("sha256").update(pairs).digest("hex")).toBe(PIN);
  });

  it.runIf(existsSync(FINAL))("matches final-names.json, key for key and name for name, where the names build left it", () => {
    const f = JSON.parse(readFileSync(FINAL, "utf8")) as { keys: number; tenants: number; rowsServed: number; names: { key: string; display: string }[] };
    expect([f.keys, f.tenants, f.rowsServed]).toEqual([KEYS, TENANTS, ROWS]);
    expect(Object.fromEntries([...NAMES].sort())).toEqual(Object.fromEntries(f.names.map((n) => [n.key, n.display] as [string, string]).sort()));
  });

  it("writes no key an earlier migration wrote, so ON CONFLICT DO NOTHING writes every one on main", () => {
    const earlier = new Set(FILES.filter((f) => f < FILE).flatMap((f) => overridesOf(readFileSync(resolve(MIGRATIONS, f), "utf8")).map(([k]) => k)));
    expect(earlier.size, "the reader found no earlier override").toBeGreaterThan(400);
    expect(OVERRIDES.map(([k]) => k).filter((k) => earlier.has(k))).toEqual([]);
  });

  it("never overwrites: both inserts are ON CONFLICT DO NOTHING, and nothing deletes or updates a name", () => {
    const code = SQL.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
    expect(code.match(/ON CONFLICT[^;]*;/g)).toEqual(["ON CONFLICT (slug) DO NOTHING;", "ON CONFLICT (slug) DO NOTHING;"]);
    expect(code).not.toMatch(/\b(UPDATE|DELETE FROM)\s+public\.company_name_(overrides|evidence)\b/i);
  });

  it("the mirror the app and the bake read holds every row", () => {
    for (const [k, n] of OVERRIDES) expect(EMPLOYER_NAME_OVERRIDES.get(k), k).toBe(n);
  });
});

describe("every name is the employer's own words, and the bake prints it", () => {
  it("each key has one evidence row naming the same employer, on its own Workday host, holding the name letter for letter", () => {
    expect(EVIDENCE.map(([k]) => k).sort()).toEqual(OVERRIDES.map(([k]) => k).sort());
    for (const [k, e] of EVIDENCE) {
      expect(e.name, k).toBe(NAMES.get(k));
      expect(e.links.length, k).toBeGreaterThan(0);
      for (const l of e.links) expect(l, k).toMatch(new RegExp(`^https://${tenantOf(k).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.wd\\d+\\.myworkdayjobs\\.com/\\S+$`));
      expect(e.readOn, `${k}: every name rests on the 2026-11-08 capture`).toBe("2026-11-08");
      expect(e.quote, `${k}: "${e.name}" is not in its words`).toContain(e.name);
    }
  });

  it("each key names a catalogued Workday board", () => {
    for (const [k] of OVERRIDES) expect(boardOf(k), k).toBeDefined();
  });

  it("the bake's gate prints every name unchanged, and none reads as a tenant code any more", async () => {
    const g = (await import(pathToFileURL(resolve(ROOT, "scripts/prerender-names.mjs")).href)) as {
      bakeEmployerName: (t: string, n: string, o: unknown) => { name: string; reason: string | null };
    };
    for (const [k, n] of OVERRIDES) {
      const token = boardOf(k)!.token;
      expect([g.bakeEmployerName(token, n, { boardName, isCodeShapedName }).name, g.bakeEmployerName(token, n, { boardName, isCodeShapedName }).reason], k).toEqual([n, null]);
      expect(isCodeShapedName(token, n), k).toBe(false);
      expect(isUnreviewedTenantName(token, n), k).toBe(false);
    }
  });

  it("the file never names the store of credentials", () => {
    expect(SQL).not.toMatch(/vault|secret|decrypt/i);
  });
});

describe("what the re-check found wrong, and every class left out, stays out", () => {
  it("each sampled wrong row carries the re-check's right name, never the corpus's", () => {
    for (const [k, wrong, right] of WRONG) {
      expect(NAMES.get(k), k).toBe(right);
      expect(NAMES.get(k), k).not.toBe(wrong);
    }
  });

  for (const [why, keys] of Object.entries(LEFT_OUT)) {
    it(`leaves out what ${why}`, () => {
      for (const k of keys) {
        const held = k.includes("~") ? OVERRIDES.filter(([x]) => x === k) : OVERRIDES.filter(([x]) => tenantOf(x) === k);
        expect(held, k).toEqual([]);
      }
    });
  }

  it("the self-check refuses a write to any key robots.txt reaches, by either class", () => {
    const m = /WHERE o\.added_at = now\(\) AND \(o\.slug = ANY \(v_multi\) OR o\.slug IN \(([^)]*)\)\);/.exec(SQL);
    expect(m, "the self-check's list of keys it refuses to write moved").not.toBeNull();
    const refused = [...m![1].matchAll(new RegExp(STR, "g"))].map((x) => lit(x[0]));
    const robots = [...LEFT_OUT["its name was read on a page the tenant's robots.txt disallows"], ...LEFT_OUT["robots.txt disallows the board's own site path"]];
    expect(robots).toHaveLength(17);
    expect(robots.filter((k) => !refused.includes(k))).toEqual([]);
  });

  it("a tenant named board by board takes no tenant key, so a site added later keeps its own name", () => {
    const byBoard = new Set(OVERRIDES.filter(([k]) => k.includes("~")).map(([k]) => tenantOf(k)));
    expect(byBoard.size).toBeGreaterThan(30);
    expect([...byBoard].filter((t) => NAMES.has(t))).toEqual([]);
  });
});

describe("the migration on a real Postgres, from Supabase's default grants", () => {
  const TRIGGER_FN = (() => {
    for (const f of [...FILES].reverse()) {
      const m = /CREATE OR REPLACE FUNCTION public\.apply_company_name_override\(\)[\s\S]*?\$\$;/.exec(readFileSync(resolve(MIGRATIONS, f), "utf8"));
      if (m) return m[0];
    }
    throw new Error("apply_company_name_override moved; re-point this test");
  })();
  const fresh = async (withEvidenceTable = true) => {
    const d = new PGlite();
    await d.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
      CREATE TABLE public.company_name_overrides (slug text PRIMARY KEY, display_name text NOT NULL, added_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE public.job_board_postings (id text PRIMARY KEY, source text NOT NULL DEFAULT 'workday', company_token text NOT NULL, company text);
      CREATE TABLE public.job_board_meta (k text PRIMARY KEY, v jsonb, updated_at timestamptz NOT NULL DEFAULT now());
      ${TRIGGER_FN}
      CREATE TRIGGER trg_company_name_override BEFORE INSERT OR UPDATE ON public.job_board_postings
        FOR EACH ROW EXECUTE FUNCTION public.apply_company_name_override();
    `);
    if (withEvidenceTable) await d.exec(TABLE_SQL);
    return d;
  };
  const count = async (d: PGlite, table: string) => (await d.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.${table}`)).rows[0].n;

  let db: PGlite;
  let before = { overrides: 0, evidence: 0 };
  beforeAll(async () => {
    db = await fresh();
    // Set by hand before this file: BeiGene's tenant under another spelling.
    await db.exec(`INSERT INTO public.company_name_overrides (slug, display_name) VALUES ('beigene', 'BeiGene')`);
    // Rows stored before the names existed, and the lane's stamp of the walk it finished.
    await db.exec(`
      ALTER TABLE public.job_board_postings DISABLE TRIGGER trg_company_name_override;
      INSERT INTO public.job_board_postings (id, company_token, company) VALUES
        ('workday:nghs~wd1~External:S1', 'nghs~wd1~External', 'Nghs'),
        ('workday:lgi~wd5~LGI_Careers:S2', 'lgi~wd5~LGI_Careers', 'Lgi');
      ALTER TABLE public.job_board_postings ENABLE TRIGGER trg_company_name_override;
      INSERT INTO public.job_board_meta (k, v) VALUES
        ('name_sync_version', '{"version": 7, "fixed": 4, "already": 505}'),
        ('name_sync_progress', '{"version": 7, "after": "a"}'),
        ('slice_stats', '{"build": "2026-09-09.102"}');
    `);
    before = { overrides: await count(db, "company_name_overrides"), evidence: await count(db, "company_name_evidence") };
    await db.exec(SQL);
  });
  afterAll(async () => { try { await db.close(); } catch { /* best effort */ } });

  const write = async (id: string, token: string, company: string) => {
    await db.query(`INSERT INTO public.job_board_postings (id, company_token, company) VALUES ($1, $2, $3)`, [id, token, company]);
    return (await db.query<{ company: string }>(`SELECT company FROM public.job_board_postings WHERE id = $1`, [id])).rows[0].company;
  };

  it("writes every key but the one already set by hand, and evidence only for the names it wrote", async () => {
    expect(await count(db, "company_name_overrides")).toBe(before.overrides + KEYS - 1);
    expect(await count(db, "company_name_evidence")).toBe(before.evidence + KEYS - 1);
  });

  it("a sampled board's next write prints its new name, by tenant key and by exact site", async () => {
    expect(await write("workday:nghs~wd1~External:N1", "nghs~wd1~External", "Nghs")).toBe("Northeast Georgia Health System");
    expect(await write("workday:tscfl~wd12~TSC_External_Career_Site:N2", "tscfl~wd12~TSC_External_Career_Site", "Tscfl")).toBe("Tallahassee State College");
    expect(await write("workday:cba~wd3~CommBank_Careers:N3", "cba~wd3~CommBank_Careers", "Cba")).toBe("CommBank");
    expect(await write("workday:maxar~wd1~Vantor:N4", "maxar~wd1~Vantor", "Maxar")).toBe("Vantor");
  });

  it("a tenant's site no key names keeps its stored name", async () => {
    expect(await write("workday:cba~wd3~Another_Site:N5", "cba~wd3~Another_Site", "Cba")).toBe("Cba");
    expect(await write("workday:maxar~wd1~Staffing:N6", "maxar~wd1~Staffing", "Maxar")).toBe("Maxar");
  });

  it("a hand-set override survives, with no evidence row put beside it", async () => {
    expect((await db.query<{ display_name: string }>(`SELECT display_name FROM public.company_name_overrides WHERE slug = 'beigene'`)).rows[0].display_name).toBe("BeiGene");
    expect((await db.query(`SELECT 1 FROM public.company_name_evidence WHERE slug = 'beigene'`)).rows).toHaveLength(0);
    expect(await write("workday:beigene~wd5~BeiGene:N7", "beigene~wd5~BeiGene", "Beigene")).toBe("BeiGene");
  });

  it("the classes left out take no override, and their boards keep their names", async () => {
    const all = Object.values(LEFT_OUT).flat();
    const held = (await db.query<{ slug: string }>(`SELECT slug FROM public.company_name_overrides WHERE slug = ANY($1) OR split_part(slug, '~', 1) = ANY($1)`, [all])).rows;
    expect(held.map((r) => r.slug)).toEqual([]);
    expect(await write("workday:lgi~wd5~LGI_Careers:N8", "lgi~wd5~LGI_Careers", "Lgi")).toBe("Lgi");
    expect(await write("workday:gi~wd1~Global_Infrastructure:N9", "gi~wd1~Global_Infrastructure", "Gi")).toBe("Gi");
  });

  it("leaves the stored rows to the name-sync lane, which it re-arms, and touches no other key", async () => {
    expect((await db.query<{ company: string }>(`SELECT company FROM public.job_board_postings WHERE id = 'workday:nghs~wd1~External:S1'`)).rows[0].company).toBe("Nghs");
    const keys = (await db.query<{ k: string }>(`SELECT k FROM public.job_board_meta ORDER BY k`)).rows.map((r) => r.k);
    expect(keys).toEqual(["slice_stats"]);
    // The lane's write is an UPDATE, and the trigger names it.
    await db.exec(`UPDATE public.job_board_postings SET company = company WHERE id = 'workday:nghs~wd1~External:S1'`);
    expect((await db.query<{ company: string }>(`SELECT company FROM public.job_board_postings WHERE id = 'workday:nghs~wd1~External:S1'`)).rows[0].company).toBe("Northeast Georgia Health System");
  });

  it("keeps the evidence where no client can read it", async () => {
    for (const role of ["anon", "authenticated"]) {
      expect((await db.query<{ p: boolean }>(`SELECT has_table_privilege('${role}', 'public.company_name_evidence', 'SELECT') AS p`)).rows[0].p, role).toBe(false);
    }
  });

  it("is safe to run again: the same rows, and one more walk armed", async () => {
    const o = await count(db, "company_name_overrides"), e = await count(db, "company_name_evidence");
    await db.exec(`INSERT INTO public.job_board_meta (k, v) VALUES ('name_sync_version', '{"version": 7}')`);
    await db.exec(SQL);
    expect([await count(db, "company_name_overrides"), await count(db, "company_name_evidence")]).toEqual([o, e]);
    expect((await db.query(`SELECT 1 FROM public.job_board_meta WHERE k = 'name_sync_version'`)).rows).toHaveLength(0);
    expect((await db.query<{ display_name: string }>(`SELECT display_name FROM public.company_name_overrides WHERE slug = 'beigene'`)).rows[0].display_name).toBe("BeiGene");
  });

  it("refuses, changing nothing, while a name the re-check read as wrong stands on its key", async () => {
    const d = await fresh();
    try {
      await d.exec(`INSERT INTO public.company_name_overrides (slug, display_name) VALUES ('tscfl', 'HVAC Photo')`);
      const n = await count(d, "company_name_overrides");
      await expect(d.exec(SQL)).rejects.toThrow(/20261111150000: a name the re-check of 2026-11-17 read as wrong stands: tscfl = HVAC Photo/);
      expect(await count(d, "company_name_overrides")).toBe(n);
    } finally { await d.close(); }
  });

  it("refuses a name whose evidence is a read later than the 2026-11-08 capture", async () => {
    const d = await fresh();
    try {
      await d.exec(`INSERT INTO public.company_name_evidence (slug, display_name, evidence, quote, read_on) VALUES
        ('nghs', 'Northeast Georgia Health System', ARRAY['https://nghs.wd1.myworkdayjobs.com/External'], 'posting: "Northeast Georgia Health System is a non-profit..."', DATE '2026-11-17')`);
      const n = await count(d, "company_name_overrides");
      await expect(d.exec(SQL)).rejects.toThrow(/20261111150000: 1 override\(s\) this file wrote lack the evidence naming them \(first: nghs\)/);
      expect(await count(d, "company_name_overrides")).toBe(n);
    } finally { await d.close(); }
  });

  it("refuses past the 1,000 rows job-board's name-sync lane reads in its one read", async () => {
    const d = await fresh();
    try {
      await d.exec(`INSERT INTO public.company_name_overrides (slug, display_name) SELECT 'zz-filler-' || g, 'Filler ' || g FROM generate_series(1, 600) g`);
      await expect(d.exec(SQL)).rejects.toThrow(/20261111150000: company_name_overrides holds \d+ rows, and job-board's name-sync lane reads at most 1,000/);
    } finally { await d.close(); }
  });

  it("refuses to run before the migration that makes the evidence table", async () => {
    const d = await fresh(false);
    try {
      await expect(d.exec(SQL)).rejects.toThrow(/20261111150000 refuses: public\.company_name_evidence does not exist/);
    } finally { await d.close(); }
  });

  it("refuses an evidence table a client can read", async () => {
    const d = await fresh();
    try {
      await d.exec("GRANT SELECT ON TABLE public.company_name_evidence TO anon");
      await expect(d.exec(SQL)).rejects.toThrow(/20261111150000: anon or authenticated can read or write/);
    } finally { await d.close(); }
  });
});
