// @vitest-environment node
/**
 * FOUR BOARDS PRINT THE NAME THEIR EMPLOYER USES.
 *
 * The SEO/GEO audit of 2026-11-07 (B05) found four bare-token boards printing
 * a name their employer does not use: two slugs title-cased ("Creatoriq",
 * "Harmattan Ai"), one slug run together ("Americaatwork") and a web address
 * for DEAG. A posting page the bake gives a new page would print the slug as
 * its hirer, or be withheld for the address.
 *
 * Migration 20261111130000 keeps the evidence (one company_name_evidence row
 * per board, keyed vendor:token, the 20261026100000 pattern). A bare token
 * takes no override, so the names themselves are the catalogue's: sources.ts
 * renamed in place (and its byte-identical layoff-filings copy).
 *
 * Checked: each board the evidence names prints that name; each name is in the
 * words read; each passes the bake's gate unchanged and is no longer a
 * title-cased slug; none is another employer's; the migration runs on a real
 * Postgres from Supabase's default grants, after the migration that made its
 * table, checks itself, runs again and refuses what it cannot vouch for.
 *
 * RENAMED_TOKENS and NAME_SYNC_VERSION 7 (so the stored rows follow) are the
 * core lane's, and the cross-lane test checks them together with these names.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { JOB_SOURCES } from "../../supabase/functions/job-board/sources";
import { JOB_SOURCES as MIRROR } from "../../supabase/functions/layoff-filings/board-sources";
import { boardName, isCodeShapedName, isUnreviewedTenantName } from "../lib/company-display";
import { employerNameOverride } from "../lib/employer-names";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");
const FILE = "20261111130000_four_boards_print_the_name_their_employer_uses.sql";
const SQL = readFileSync(resolve(MIGRATIONS, FILE), "utf8");
const TABLE_FILE = readdirSync(MIGRATIONS).find((f) => f.startsWith("20261025100000_")) ?? "";
const TABLE_SQL = readFileSync(resolve(MIGRATIONS, TABLE_FILE), "utf8");
const lit = (s: string) => s.slice(1, -1).replace(/''/g, "'");
const STR = "'(?:[^']|'')*'";

type Ev = { name: string; links: string[]; quote: string; readOn: string };
const EVIDENCE = (() => {
  const m = new RegExp(`INSERT INTO public\\.company_name_evidence \\(slug, display_name, evidence, quote, read_on\\) VALUES([\\s\\S]*?)ON CONFLICT`).exec(SQL);
  if (!m) return new Map<string, Ev>();
  const rows = [...m[1].matchAll(new RegExp(`\\((${STR}),\\s*(${STR}),\\s*ARRAY\\[((?:\\s*${STR}\\s*,?)+)\\],\\s*(${STR}),\\s*DATE '(\\d{4}-\\d{2}-\\d{2})'\\)`, "g"))];
  return new Map(rows.map((x) => [lit(x[1]), { name: lit(x[2]), links: [...x[3].matchAll(new RegExp(STR, "g"))].map((l) => lit(l[0])), quote: lit(x[4]), readOn: x[5] }]));
})();

/** The names the four printed before (.101), each one the audit found. */
const BEFORE: Record<string, string> = {
  "ashby:creatoriq": "Creatoriq",
  "ashby:harmattan-ai": "Harmattan Ai",
  "lever:americaatwork": "Americaatwork",
  "personio:deag-deutsche-entertainment-ag": "https://www.deag.de/navi-bottom/investors/karriere.html?t=1",
};
const AFTER: Record<string, string> = {
  "ashby:creatoriq": "CreatorIQ",
  "ashby:harmattan-ai": "Harmattan AI",
  "lever:americaatwork": "America At Work",
  "personio:deag-deutsche-entertainment-ag": "DEAG Deutsche Entertainment AG",
};

const keyOf = (s: { source: string; token: string }) => `${s.source}:${s.token}`;
const split = (slug: string) => [slug.slice(0, slug.indexOf(":")), slug.slice(slug.indexOf(":") + 1)] as const;
const boardsOf = (list: typeof JOB_SOURCES, slug: string) => list.filter((s) => keyOf(s) === slug);

type Gate = { bakeEmployerName: (t: string, n: string, o: unknown) => { name: string; reason: string | null } };
const gate = async () => (await import(pathToFileURL(resolve(ROOT, "scripts/prerender-names.mjs")).href)) as Gate;

describe("each board the evidence names prints that name", () => {
  it("the evidence is these four boards, each catalogued once, keyed vendor:token", () => {
    expect([...EVIDENCE.keys()].sort()).toEqual(Object.keys(AFTER).sort());
    for (const slug of EVIDENCE.keys()) {
      expect(slug, "an evidence slug for a catalogue rename is vendor:token").toMatch(/^[a-z]+:[^~:]+$/);
      expect(boardsOf(JOB_SOURCES, slug).length, `${slug} is not one catalogued board`).toBe(1);
    }
  });

  it("the catalogue and its layoff-filings copy print the evidence's name, and a bare token takes no override", () => {
    for (const [slug, e] of EVIDENCE) {
      expect(e.name, slug).toBe(AFTER[slug]);
      expect(boardsOf(JOB_SOURCES, slug)[0]?.name, `${slug}: the catalogue still prints another name`).toBe(e.name);
      expect(boardsOf(MIRROR, slug)[0]?.name, `${slug}: the layoff-filings copy prints another name`).toBe(e.name);
      expect(employerNameOverride(split(slug)[1]), `${slug}: a bare token never takes an override`).toBeNull();
    }
  });

  it("America At Work is also labelled a search firm, in the same build", () => {
    expect(boardsOf(JOB_SOURCES, "lever:americaatwork")[0]?.agency).toBe(true);
    expect(EVIDENCE.get("lever:americaatwork")?.quote).toMatch(/on behalf of a confidential global organization/);
  });
});

describe("each name is the employer's own, and trusted", () => {
  it("has a link on the vendor's feed or the posting's own page and words read on 2026-11-08", () => {
    for (const [slug, e] of EVIDENCE) {
      const token = split(slug)[1];
      expect(e.links.length, slug).toBeGreaterThan(0);
      for (const l of e.links) {
        expect(l, slug).toMatch(/^https:\/\/[^\s]+$/);
        expect(l, `${slug}: the link is not this board's`).toContain(token);
      }
      expect(e.readOn, slug).toBe("2026-11-08");
      expect(e.quote.length, slug).toBeGreaterThan(10);
    }
  });

  it("the name is in the words read, letter for letter", () => {
    for (const [slug, e] of EVIDENCE) expect(e.quote, `${slug}: "${e.name}" is not in its quote`).toContain(e.name);
  });

  it("the bake's gate prints every new name unchanged, and none is a title-cased slug any more", async () => {
    const g = await gate();
    for (const [slug, e] of EVIDENCE) {
      const token = split(slug)[1];
      const v = g.bakeEmployerName(token, e.name, { boardName, isCodeShapedName });
      expect([v.name, v.reason ?? null], slug).toEqual([e.name, null]);
      expect(isUnreviewedTenantName(token, e.name), `${slug}: "${e.name}" still reads as an unreviewed slug`).toBe(false);
    }
  });

  it("every old name was one the gates refuse, so the rename is what lets a posting page print its hirer", async () => {
    const g = await gate();
    for (const [slug, old] of Object.entries(BEFORE)) {
      const token = split(slug)[1];
      const refused = g.bakeEmployerName(token, old, { boardName, isCodeShapedName }).reason !== null || isUnreviewedTenantName(token, old);
      expect(refused, `${slug}: "${old}" passes both gates`).toBe(true);
    }
    // The three slugs are exactly the shape the fresh-page rule names.
    expect(isUnreviewedTenantName("creatoriq", "Creatoriq")).toBe(true);
    expect(isUnreviewedTenantName("harmattan-ai", "Harmattan Ai")).toBe(true);
    expect(isUnreviewedTenantName("americaatwork", "Americaatwork")).toBe(true);
  });

  it("no new name is another employer's: it equals no other board's printed name", () => {
    const mine = new Set(EVIDENCE.keys());
    const byName = new Map<string, string[]>();
    for (const s of JOB_SOURCES) {
      const k = keyOf(s);
      if (mine.has(k)) continue;
      const n = (employerNameOverride(s.token) ?? s.name).toLowerCase();
      byName.set(n, [...(byName.get(n) ?? []), k]);
    }
    for (const [slug, e] of EVIDENCE) expect(byName.get(e.name.toLowerCase()) ?? [], `${slug} "${e.name}"`).toEqual([]);
  });

  it("the file never names the store of credentials", () => {
    expect(SQL).not.toMatch(/vault|secret|decrypted/i);
  });
});

describe("the migration on a real Postgres, from Supabase's default grants", () => {
  let db: PGlite;
  const fresh = async () => {
    const d = new PGlite();
    await d.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
      CREATE TABLE public.company_name_overrides (slug text PRIMARY KEY, display_name text NOT NULL, added_at timestamptz NOT NULL DEFAULT now());
    `);
    return d;
  };
  beforeAll(async () => {
    db = await fresh();
    await db.exec(TABLE_SQL); // the migration that makes the evidence table (and its own rows)
    await db.exec(SQL);
  });
  afterAll(async () => { try { await db.close(); } catch { /* best effort */ } });

  it("writes the four evidence rows as written, and no override", async () => {
    const rows = (await db.query<{ slug: string; display_name: string; read_on: string }>(
      `SELECT slug, display_name, read_on::text AS read_on FROM public.company_name_evidence WHERE slug IN (${Object.keys(AFTER).map((k) => `'${k}'`).join(", ")}) ORDER BY slug`,
    )).rows;
    expect(rows.map((r) => [r.slug, r.display_name, r.read_on])).toEqual(Object.keys(AFTER).sort().map((k) => [k, AFTER[k], "2026-11-08"]));
    expect((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.company_name_overrides WHERE slug LIKE '%:%'`)).rows[0].n).toBe(0);
  });

  it("is safe to run again", async () => {
    const before = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM public.company_name_evidence")).rows[0].n;
    await db.exec(SQL);
    expect((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM public.company_name_evidence")).rows[0].n).toBe(before);
  });

  it("refuses a row left under another name, since DO NOTHING would keep it", async () => {
    const d = await fresh();
    try {
      await d.exec(TABLE_SQL);
      await d.exec(`INSERT INTO public.company_name_evidence (slug, display_name, evidence, quote, read_on) VALUES ('ashby:creatoriq', 'Creatoriq', ARRAY['https://api.ashbyhq.com/posting-api/job-board/creatoriq'], 'an older guess at the name', DATE '2026-11-01')`);
      await expect(d.exec(SQL)).rejects.toThrow(/20261111130000: 3 of the 4 .*ashby:creatoriq=Creatoriq/);
    } finally { await d.close(); }
  });

  it("refuses an override keyed vendor:token, which the override trigger never reads", async () => {
    await db.exec(`INSERT INTO public.company_name_overrides (slug, display_name) VALUES ('lever:americaatwork', 'America At Work')`);
    try {
      await expect(db.exec(SQL)).rejects.toThrow(/20261111130000: an override is keyed vendor:token/);
    } finally {
      await db.exec(`DELETE FROM public.company_name_overrides WHERE slug = 'lever:americaatwork'`);
    }
    await db.exec(SQL);
  });

  it("refuses to run before the migration that makes its table", async () => {
    const d = await fresh();
    try {
      await expect(d.exec(SQL)).rejects.toThrow(/20261111130000: public\.company_name_evidence does not exist/);
    } finally { await d.close(); }
  });

  it("keeps the evidence where no client can read it, and refuses a table a client can read", async () => {
    for (const role of ["anon", "authenticated"]) {
      expect((await db.query<{ p: boolean }>(`SELECT has_table_privilege('${role}', 'public.company_name_evidence', 'SELECT') AS p`)).rows[0].p, role).toBe(false);
    }
    await db.exec("GRANT SELECT ON TABLE public.company_name_evidence TO anon");
    try {
      await expect(db.exec(SQL)).rejects.toThrow(/20261111130000: anon or authenticated can read or write/);
    } finally {
      await db.exec("REVOKE SELECT ON TABLE public.company_name_evidence FROM anon");
    }
    await db.exec(SQL);
  });
});
