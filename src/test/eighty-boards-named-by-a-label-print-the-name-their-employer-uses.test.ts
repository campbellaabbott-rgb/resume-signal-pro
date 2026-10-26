// @vitest-environment node
/**
 * EIGHTY BOARDS NAMED BY A LABEL PRINT THE NAME THEIR EMPLOYER USES.
 *
 * Trust round 3 (owner decisions 2026-10-25/26: true names, never a loosened
 * gate). The census tools named boards after an ADP logo file ("HRH Secaucus
 * University Transparent"), an Ashby page title ("Jobs"), a Greenhouse board
 * title ("Job Board", a bare region), an Oracle or UKG site label ("HKBU
 * e-Recruitment System", "Recruiting 2025") or the "Recruiting" suffix of an
 * employer's own portal. The bake's gate lets most of them through, so a
 * posting page would print the label as its hirer.
 *
 * Migration 20261026100000 is the source of truth here: one
 * company_name_evidence row per board (the links read and the employer's own
 * words), and a company_name_overrides row for each board whose token carries
 * a "~". A bare token cannot take an override, so its name is the catalogue's
 * (sources.ts, renamed in place, and RENAMED_TOKENS so the name-sync lane
 * renames its stored rows at NAME_SYNC_VERSION 6).
 *
 * Checked: every board the evidence names prints that name (catalogue or
 * mirror); every name is in the words read (or the vendor's own field), passes
 * the bake's gate unchanged and collides with no other employer; no new name is
 * a label; the migration runs on a real Postgres, checks itself and can run
 * again; the lane will run, after the overrides exist.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { JOB_SOURCES } from "../../supabase/functions/job-board/sources";
import { boardName, isCodeShapedName } from "../lib/company-display";
import { employerNameOverride } from "../lib/employer-names";
import { codeOf } from "./helpers/strip-comments";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const FILE = "20261026100000_eighty_more_boards_print_the_name_their_employer_uses.sql";
const SQL = readFileSync(resolve(ROOT, "supabase/migrations", FILE), "utf8");
const lit = (s: string) => s.slice(1, -1).replace(/''/g, "'");
const STR = "'(?:[^']|'')*'";

const OVERRIDES = (() => {
  const m = new RegExp(`INSERT INTO public\\.company_name_overrides \\(slug, display_name\\) VALUES([\\s\\S]*?)ON CONFLICT`).exec(SQL);
  if (!m) return [] as Array<[string, string]>;
  return [...m[1].matchAll(new RegExp(`\\((${STR}),\\s*(${STR})\\)`, "g"))].map((x) => [lit(x[1]), lit(x[2])] as [string, string]);
})();
type Ev = { name: string; links: string[]; quote: string; readOn: string };
const EVIDENCE = (() => {
  const m = new RegExp(`INSERT INTO public\\.company_name_evidence \\(slug, display_name, evidence, quote, read_on\\) VALUES([\\s\\S]*?)ON CONFLICT`).exec(SQL);
  if (!m) return new Map<string, Ev>();
  const rows = [...m[1].matchAll(new RegExp(`\\((${STR}),\\s*(${STR}),\\s*ARRAY\\[((?:\\s*${STR}\\s*,?)+)\\],\\s*(${STR}),\\s*DATE '(\\d{4}-\\d{2}-\\d{2})'\\)`, "g"))];
  return new Map(rows.map((x) => [lit(x[1]), { name: lit(x[2]), links: [...x[3].matchAll(new RegExp(STR, "g"))].map((l) => lit(l[0])), quote: lit(x[4]), readOn: x[5] }]));
})();

/** The board an evidence slug names: a "~" token is an override slug, a bare one is vendor:token. */
const boardOf = (slug: string) => {
  if (slug.includes("~")) return JOB_SOURCES.filter((s) => s.token === slug);
  const [vendor, token] = [slug.slice(0, slug.indexOf(":")), slug.slice(slug.indexOf(":") + 1)];
  return JOB_SOURCES.filter((s) => s.source === vendor && s.token === token);
};
const printed = (slug: string) => {
  const b = boardOf(slug)[0];
  return slug.includes("~") ? employerNameOverride(slug) : b?.name;
};

/** Composed from the employer's name and the region its own board names (xebiaapac's own board is "Xebia APAC"). */
const XEBIA_REGIONS = new Set(["greenhouse:xebiausa", "greenhouse:xebiacee", "greenhouse:xebiafrance", "greenhouse:xebiamea", "greenhouse:xebialatam"]);

describe("every board the evidence names prints that name", () => {
  it("a real batch: 80 boards, 16 of them by override, each catalogued once", () => {
    expect(EVIDENCE.size).toBe(80);
    expect(OVERRIDES.length).toBe(16);
    for (const slug of EVIDENCE.keys()) expect(boardOf(slug).length, `${slug} is not one catalogued board`).toBe(1);
  });

  it("a token with a '~' takes an override (mirrored in employer-names.ts); a bare token takes its catalogue name", () => {
    const ov = new Map(OVERRIDES);
    for (const [slug, e] of EVIDENCE) {
      if (slug.includes("~")) {
        expect(ov.get(slug), `${slug}: no override row`).toBe(e.name);
        expect(employerNameOverride(slug), `${slug}: the mirror lacks the row`).toBe(e.name);
      } else {
        expect(slug, "an evidence slug for a catalogue rename is vendor:token").toMatch(/^[a-z]+:[^~]+$/);
        expect(boardOf(slug)[0]?.name, `${slug}: the catalogue still prints another name`).toBe(e.name);
        expect(employerNameOverride(slug.slice(slug.indexOf(":") + 1)), `${slug}: a bare token never takes an override`).toBeNull();
      }
    }
  });

  it("each bare token is in RENAMED_TOKENS and the lane's version moved to 6, so the stored rows follow", () => {
    const code = codeOf(readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8"));
    expect(/const NAME_SYNC_VERSION = (\d+);/.exec(code)?.[1]).toBe("6");
    const block = /const RENAMED_TOKENS: readonly string\[\] = \[([\s\S]*?)\];/.exec(code)?.[1] ?? "";
    const listed = new Set([...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]));
    for (const slug of EVIDENCE.keys()) if (!slug.includes("~")) expect(listed.has(slug.slice(slug.indexOf(":") + 1)), slug).toBe(true);
  });
});

describe("every name is the employer's own, and trusted", () => {
  it("has links on the vendor's or the employer's own host and words read on 2026-10-25 or 2026-10-26", () => {
    for (const [slug, e] of EVIDENCE) {
      expect(e.links.length, slug).toBeGreaterThan(0);
      for (const l of e.links) expect(l, slug).toMatch(/^https?:\/\/[^\s]+$/);
      expect(["2026-10-25", "2026-10-26"], slug).toContain(e.readOn);
      expect(e.quote.length, slug).toBeGreaterThan(10);
    }
  });

  it("the name is in the words read, letter for letter (accents, case and spacing aside), or the vendor's own field and the region its board names", () => {
    const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const bare = (x: string) => x.replace(/[^a-z0-9]/g, "");
    for (const [slug, e] of EVIDENCE) {
      if (XEBIA_REGIONS.has(slug)) { expect(e.quote, slug).toMatch(/Xebia/); continue; }
      const w = fold(e.name), q = fold(e.quote);
      expect(q.includes(w) || bare(q).includes(bare(w)), `${slug}: "${e.name}" is not in "${e.quote}"`).toBe(true);
    }
  });

  it("no new name is a logo, a file name, a career-site label, a year or a template", () => {
    // Anywhere in a name: the words of a logo file, a template or a recruiting portal.
    const BAD = /\b(?:logo|png|jpe?g|cmyk|rgb|transparent|full ?colou?r|wordmark|lockup|background|brand(?:ing)?|template|recruit(?:ing|ment)|career site|job board|opportunities)\b|@\dx|\b(?:19|20)\d\d\b/i;
    // As the whole name: a page title or a site's audience label ("Global Communities" is a name; "Global" is a label).
    const LABEL = /^(?:jobs?|careers?(?: page)?|job board|default|all|global|student|staff|faculty|external|corporate|vacancies|healthcare|north america|apac|france|mea|latam)$/i;
    for (const [slug, e] of EVIDENCE) {
      expect(e.name, slug).not.toMatch(BAD);
      expect(e.name, slug).not.toMatch(LABEL);
    }
  });

  it("the bake's gate prints every name unchanged", async () => {
    const g = (await import(pathToFileURL(resolve(ROOT, "scripts/prerender-names.mjs")).href)) as {
      bakeEmployerName: (t: string, n: string, o: unknown) => { name: string; reason: string | null };
    };
    for (const [slug, e] of EVIDENCE) {
      const token = slug.includes("~") ? slug : slug.slice(slug.indexOf(":") + 1);
      const v = g.bakeEmployerName(token, printed(slug) ?? "", { boardName, isCodeShapedName });
      expect([v.name, v.reason ?? null], slug).toEqual([e.name, null]);
    }
  });

  it("no new name is another employer's: it equals no other board's printed name, bar the same employer's own boards", () => {
    const SAME = new Map<string, string[]>([
      ["greenhouse:notexternal", ["greenhouse:bpcs"]], // Blueprint Technologies' other board
      ["eify~us6~CX_1001", ["oracle:eify~us6~CX_1004"]], // Springfield Clinic, the same tenant
    ]);
    const mine = new Set([...EVIDENCE.keys()].map((s) => boardOf(s)[0]).map((b) => `${b.source}:${b.token}`));
    const byName = new Map<string, string[]>();
    for (const s of JOB_SOURCES) {
      const k = `${s.source}:${s.token}`;
      if (mine.has(k)) continue;
      const n = (employerNameOverride(s.token) ?? s.name).toLowerCase();
      byName.set(n, [...(byName.get(n) ?? []), k]);
    }
    const sameNameAcross = new Map<string, string[]>();
    for (const [slug, e] of EVIDENCE) {
      const others = byName.get(e.name.toLowerCase()) ?? [];
      expect(others.filter((o) => !(SAME.get(slug) ?? []).includes(o)), `${slug} "${e.name}"`).toEqual([]);
      sameNameAcross.set(e.name, [...(sameNameAcross.get(e.name) ?? []), slug]);
    }
    // Inside the batch only one employer's own sites share a name.
    const shared = [...sameNameAcross.entries()].filter(([, v]) => v.length > 1).map(([n]) => n).sort();
    expect(shared).toEqual(["Emirates NBD", "Scottish Government"]);
  });

  it("the boards whose words did not name their employer keep their stored names", () => {
    for (const [vendor, token] of [["adp", "2d4a5356-a3d2-44a6-8c4a-1d0f86f3f2c7"], ["lever", "applydigital"], ["oracle", "eniy~em3~CX_6001"], ["oracle", "erhk~us2~CX_1001"]]) {
      expect([...EVIDENCE.keys()].some((k) => k === `${vendor}:${token}` || k === token), `${vendor}:${token}`).toBe(false);
    }
    expect(employerNameOverride("eniy~em3~CX_6001")).toBeNull();
    expect(employerNameOverride("erhk~us2~CX_1001")).toBeNull();
  });
});

describe("the migration on a real Postgres", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
      CREATE TABLE public.company_name_overrides (slug text PRIMARY KEY, display_name text NOT NULL, added_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE public.company_name_evidence (slug text PRIMARY KEY, display_name text NOT NULL, evidence text[] NOT NULL, quote text NOT NULL, read_on date NOT NULL);
      ALTER TABLE public.company_name_evidence ENABLE ROW LEVEL SECURITY;
      REVOKE ALL ON TABLE public.company_name_evidence FROM PUBLIC, anon, authenticated;
      GRANT ALL ON TABLE public.company_name_evidence TO service_role;
      INSERT INTO public.company_name_overrides (slug, display_name) VALUES ('ms', 'Morgan Stanley'), ('fa-ewqq-saasfaprod1~ocs~CX_1', 'HKBU (an older guess)');
    `);
    await db.exec(SQL);
  });
  afterAll(async () => { try { await db.close(); } catch { /* best effort */ } });

  it("writes every override and evidence row, replaces an older name, and leaves the rest", async () => {
    const o = new Map((await db.query<{ slug: string; display_name: string }>("SELECT slug, display_name FROM public.company_name_overrides")).rows.map((r) => [r.slug, r.display_name]));
    expect(o.get("fa-ewqq-saasfaprod1~ocs~CX_1")).toBe("Hong Kong Baptist University");
    expect(o.get("ms")).toBe("Morgan Stanley");
    expect(o.size).toBe(OVERRIDES.length + 1);
    expect((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM public.company_name_evidence")).rows[0].n).toBe(80);
  });

  it("is safe to run again, and its self-check fails when a row it vouches for is missing", async () => {
    await db.exec(SQL);
    await db.exec(`DELETE FROM public.company_name_overrides WHERE slug = 'ejgo~em2~CX_1'`);
    const selfCheck = /DO \$\$[\s\S]*?\$\$;/.exec(SQL.slice(SQL.lastIndexOf("-- SELF-CHECK")))?.[0] ?? "";
    expect(selfCheck).toMatch(/RAISE EXCEPTION/);
    await expect(db.exec(selfCheck)).rejects.toThrow(/20261026100000/);
    await db.exec(`INSERT INTO public.company_name_overrides (slug, display_name) VALUES ('greenhouse:corelight', 'Corelight')`);
    await expect(db.exec(SQL)).rejects.toThrow(/20261026100000.*greenhouse:corelight/); // an override keyed vendor:token is refused
    await db.exec(`DELETE FROM public.company_name_overrides WHERE slug = 'greenhouse:corelight'`);
    await db.exec(SQL);
    expect((await db.query<{ d: string }>(`SELECT display_name AS d FROM public.company_name_overrides WHERE slug = 'ejgo~em2~CX_1'`)).rows[0].d).toBe("Farrans");
  });

  it("keeps the evidence where no client can read it", async () => {
    for (const role of ["anon", "authenticated"]) {
      expect((await db.query<{ p: boolean }>(`SELECT has_table_privilege('${role}', 'public.company_name_evidence', 'SELECT') AS p`)).rows[0].p, role).toBe(false);
    }
  });
});

describe("the deploy order", () => {
  const ledger = JSON.parse(readFileSync(resolve(ROOT, "docs/deploy-ledger.json"), "utf8"));
  it("the names go in before job-board deploys, so the version-6 lane reads them", () => {
    expect(ledger.migrationOrder["20261026100000"]?.before).toEqual(["fn:job-board"]);
  });
});
