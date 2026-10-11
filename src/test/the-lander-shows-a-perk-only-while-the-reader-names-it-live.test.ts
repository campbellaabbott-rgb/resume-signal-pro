// @vitest-environment node
/**
 * THE LANDER SHOWS A PERK ONLY WHILE THE READER NAMES IT LIVE.
 *
 * Company profiles phase 2 puts a checkmark list on the company lander. The
 * decision of what may print is split across two runtimes, and this file runs
 * both halves together: the shipped reader (get_employer_perks, migration
 * 20261012110000, executed in pglite under Supabase's default grants, called
 * as anon) and the shipped view model (src/lib/employer-perks.ts, perksView)
 * fed its real answer.
 *
 * It holds, each run:
 *   - before any audit, and for a key audited 46 days ago, or with the
 *     publish pause on, the reader names no live key and the lander gets
 *     NOTHING to render, though the claim rows exist;
 *   - a key audited inside 45 days is named live, and only its rows print;
 *   - a stated visa limit needs three postings saying it, in the reader and
 *     in the owner's draw, so the audit judges only rows that can print;
 *   - a token two vendors share, an agency's board and a vendor whose text is
 *     not stored print the reason, and only while some key is live;
 *   - the numbers the page mirrors are the numbers the SQL and the extractor
 *     module hold (read from comment-stripped SQL, never from prose).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { CANDIDATE_KEYS, PERK_THRESHOLDS, PUBLISH_EXPIRY_DAYS } from "../../supabase/functions/_shared/perks-extract";
import {
  PERK_PUBLISHABLE_KEYS,
  PERK_ROW_THRESHOLDS,
  VISA_LIMIT_MIN_STATED,
  perksView,
  readEmployerPerks,
} from "@/lib/employer-perks";
import { sqlCodeOf } from "./helpers/strip-comments";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const DIR = resolve(__dirname, "../../supabase/migrations");
const ENGINE_FILE = readdirSync(DIR).find((f) => f.startsWith("20261012110000_"))!;
const ENGINE = readFileSync(resolve(DIR, ENGINE_FILE), "utf8");
const CODE = sqlCodeOf(ENGINE);

const SUPABASE_DEFAULTS = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
`;
const BOARD = `
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, source text NOT NULL, company_token text NOT NULL, company text NOT NULL DEFAULT '',
    title text NOT NULL, description text, country text, agency boolean NOT NULL DEFAULT false,
    apply_url text NOT NULL DEFAULT '', missing_since timestamptz, effective_posted timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.job_board_company_snapshots (
    company_token text NOT NULL, snapshot_date date NOT NULL, company text NOT NULL DEFAULT '',
    open_roles integer NOT NULL DEFAULT 0, open_roles_served integer, PRIMARY KEY (company_token, snapshot_date));
`;

const HEALTH = "a1a1a1a1a1a1a1a1";
const VISA = "b2b2b2b2b2b2b2b2";
const PTO = "c3c3c3c3c3c3c3c3";

let db: PGlite;
afterAll(async () => { try { await db?.close(); } catch { /* best effort */ } });

async function asAnon(token: string) {
  await db.exec("SET ROLE anon");
  try {
    return (await db.query<{ r: unknown }>("SELECT public.get_employer_perks($1) AS r", [token])).rows[0].r as Record<string, unknown>;
  } finally {
    await db.exec("RESET ROLE");
  }
}
const viewOf = async (token: string) => perksView(readEmployerPerks(await asAnon(token)));
const publish = (perk: string, daysAgo: number) =>
  db.query("UPDATE public.employer_profile_perk_publish SET published = true, last_audited_at = now() - make_interval(days => $2) WHERE perk = $1", [perk, daysAgo]);
const unpublishAll = () => db.exec("UPDATE public.employer_profile_perk_publish SET published = false");

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_DEFAULTS + BOARD);
  await db.exec(ENGINE);
  await db.exec(`
    INSERT INTO public.job_board_postings (id, source, company_token, company, title, country) VALUES
      ('greenhouse:acme:1', 'greenhouse', 'acme', 'Acme', 'Engineer', 'US'),
      ('greenhouse:acme:2', 'greenhouse', 'acme', 'Acme', 'Engineer', 'GB'),
      ('greenhouse:visa2:1', 'greenhouse', 'visa2', 'Visa Two', 'Engineer', 'US'),
      ('greenhouse:visa3:1', 'greenhouse', 'visa3', 'Visa Three', 'Engineer', 'US');
    INSERT INTO public.employer_perk_lines (line_hash, line) VALUES
      ('${HEALTH}', 'Comprehensive medical, dental and vision insurance for you and your family'),
      ('${VISA}', 'Please note this role is not eligible for visa sponsorship.'),
      ('${PTO}', '25 days annual leave plus bank holidays');
    INSERT INTO public.employer_perk_rollups (source, company_token, country, perk, k, n, standard_text, qualified_share, quote_hash, quote_posting_id) VALUES
      ('greenhouse', 'acme', 'US', 'health', 6, 6, true, 0, '${HEALTH}', 'greenhouse:acme:1'),
      ('greenhouse', 'acme', 'GB', 'pto', 2, 5, false, 0.5, '${PTO}', 'greenhouse:acme:2'),
      ('greenhouse', 'visa2', 'US', 'visa_not_offered', 2, 10, false, 0, '${VISA}', 'greenhouse:visa2:1'),
      ('greenhouse', 'visa3', 'US', 'visa_not_offered', 3, 10, false, 0, '${VISA}', 'greenhouse:visa3:1'),
      ('greenhouse', 'shared', 'US', 'health', 6, 6, true, 0, '${HEALTH}', NULL),
      ('lever', 'shared', 'US', 'health', 6, 6, true, 0, '${HEALTH}', NULL),
      ('lever', 'leverco', 'US', 'health', 6, 6, true, 0, '${HEALTH}', NULL);
    INSERT INTO public.employer_perk_board_flags (source, company_token, flag, share, postings) VALUES
      ('greenhouse', 'staffco', 'agency', 1, 6);
  `);
});

describe("before any audit, the lander has nothing to render", () => {
  it("the reader names no live key, the rows exist, and the view is null on every board", async () => {
    await unpublishAll();
    const acme = await asAnon("acme");
    expect(acme.published_keys).toEqual([]);
    expect(acme.perks).toEqual([]);
    const rows = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM public.employer_perk_rollups WHERE company_token = 'acme'");
    expect(rows.rows[0].n, "the claim rows exist; only the publish flags hold them back").toBe(2);
    for (const token of ["acme", "visa3", "shared", "staffco", "leverco", "nobody"]) {
      expect(await viewOf(token), `${token}: no placeholder and no reason line before any key is live`).toBeNull();
    }
  });
});

describe("a key prints only while its audit is under 45 days old", () => {
  it("published 44 days ago: named live, and its rows print with their basis", async () => {
    await unpublishAll();
    await publish("health", 44);
    const acme = await asAnon("acme");
    expect(acme.published_keys).toEqual(["health"]);
    const view = await viewOf("acme");
    expect(view?.kind).toBe("claims");
    if (view?.kind !== "claims") return;
    expect(view.groups.map((g) => [g.country, g.checks.map((c) => [c.perk, c.k, c.n])])).toEqual([["US", [["health", 6, 6]]]]);
    expect(view.groups[0].checks[0]).toMatchObject({ postingId: "greenhouse:acme:1", standardText: true });
    expect(view.groups[0].checks[0].quote).toMatch(/medical, dental and vision insurance/);
  });

  it("audited 46 days ago: the reader stops naming it and the lander renders nothing, rows or not", async () => {
    await unpublishAll();
    await publish("health", PUBLISH_EXPIRY_DAYS + 1);
    const acme = await asAnon("acme");
    expect(acme.published_keys).toEqual([]);
    expect(await viewOf("acme")).toBeNull();
  });

  it("the publish pause hides every key at once", async () => {
    await unpublishAll();
    await publish("health", 1);
    await db.exec("UPDATE public.employer_profile_config SET publish_paused = true");
    try {
      expect((await asAnon("acme")).published_keys).toEqual([]);
      expect(await viewOf("acme")).toBeNull();
    } finally {
      await db.exec("UPDATE public.employer_profile_config SET publish_paused = false");
    }
  });

  it("a second live key in a second country groups by country, with the statutory note on the UK row", async () => {
    await unpublishAll();
    await publish("health", 1);
    await publish("pto", 1);
    const view = await viewOf("acme");
    if (view?.kind !== "claims") throw new Error(`expected claims, got ${JSON.stringify(view)}`);
    expect(view.groups.map((g) => g.country)).toEqual(["US", "GB"]);
    const pto = view.groups[1].checks[0];
    expect(pto).toMatchObject({ perk: "pto", k: 2, n: 5, qualifiedShare: 0.5 });
    expect(pto.baseline?.sourceUrl).toMatch(/^https:\/\/www\.legislation\.gov\.uk\//);
    expect(view.groups[0].checks[0].baseline, "no US statute is cited").toBeNull();
  });
});

describe("a stated visa limit needs three postings saying it", () => {
  it("the reader shows 3 of 10 and not 2 of 10", async () => {
    await unpublishAll();
    await publish("visa_not_offered", 1);
    expect(((await asAnon("visa2")).perks as unknown[]).length).toBe(0);
    expect(await viewOf("visa2")).toBeNull();
    const v3 = await viewOf("visa3");
    if (v3?.kind !== "claims") throw new Error("expected claims for visa3");
    expect(v3.groups[0].checks).toEqual([]);
    expect(v3.groups[0].limits.map((c) => [c.perk, c.k, c.n])).toEqual([["visa_not_offered", 3, 10]]);
  });

  it("the owner's draw holds the same bar, so the audit judges only rows that can print", async () => {
    const d = (await db.query<{ r: { rows: Array<{ company_token: string }> } }>("SELECT public.employer_perk_audit_draw('visa_not_offered', 60) AS r")).rows[0].r;
    expect(d.rows.map((r) => r.company_token)).toEqual(["visa3"]);
  });
});

describe("withheld boards print the reason, and only while some key is live", () => {
  it("a token two vendors share: the reason, no check", async () => {
    await unpublishAll();
    await publish("health", 1);
    const shared = await asAnon("shared");
    expect(shared.collision).toBe(true);
    expect(await viewOf("shared")).toEqual({ kind: "withheld", reason: "collision", share: null });
  });

  it("an agency's board, and a vendor whose benefits text we do not store", async () => {
    expect(await viewOf("staffco")).toEqual({ kind: "withheld", reason: "agency", share: null });
    expect(await viewOf("leverco")).toEqual({ kind: "withheld", reason: "vendor_text_not_stored", share: null });
  });

  it("a board with no rows and no flag renders nothing", async () => {
    expect(await viewOf("nobody")).toBeNull();
  });
});

describe("the page mirrors the numbers the SQL and the extractor hold", () => {
  it("the candidate keys and the claim threshold", () => {
    expect([...PERK_PUBLISHABLE_KEYS].sort()).toEqual([...CANDIDATE_KEYS].sort());
    expect(PERK_ROW_THRESHOLDS).toEqual(PERK_THRESHOLDS);
  });

  it("the reader re-checks the same threshold, and the rollup's CHECK states it", () => {
    const reader = CODE.slice(CODE.indexOf("FUNCTION public.get_employer_perks(p_token text)"));
    const m = /r\.n >= (\d+) AND r\.k >= (\d+) AND r\.k \* (\d+) >= r\.n/.exec(reader);
    expect(m, "the reader's threshold re-check is not in executable SQL").not.toBeNull();
    expect([Number(m![1]), Number(m![2]), 1 / Number(m![3])]).toEqual([PERK_ROW_THRESHOLDS.minReadable, PERK_ROW_THRESHOLDS.minStated, PERK_ROW_THRESHOLDS.minShare]);
    const check = /employer_perk_rollups_thresholds CHECK \(n >= (\d+) AND k >= (\d+) AND k \* (\d+) >= n/.exec(CODE);
    expect(check && [Number(check[1]), Number(check[2]), 1 / Number(check[3])]).toEqual([5, 2, 0.1]);
  });

  it("the visa bar is one number in the reader, the draw and the page", () => {
    const bars = [...CODE.matchAll(/r\.perk <> 'visa_not_offered' OR r\.k >= (\d+)/g)].map((x) => Number(x[1]));
    expect(bars, "the bar should appear in the draw and in the reader").toHaveLength(2);
    for (const b of bars) expect(b).toBe(VISA_LIMIT_MIN_STATED);
  });

  it("the reader names its live keys from the same list that gates its rows", () => {
    const reader = CODE.slice(CODE.indexOf("FUNCTION public.get_employer_perks(p_token text)"));
    expect(reader).toMatch(/'published_keys', COALESCE\(\(SELECT jsonb_agg\(lk\.perk ORDER BY lk\.perk\) FROM live lk\)/);
  });
});
