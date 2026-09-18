// @vitest-environment node
/**
 * A FILING WITHOUT A CURATED EMPLOYER NEVER LEAVES THE TABLE.
 *
 * Lane 3 measured the class of employer-name match that produces a wrong
 * employer: every SINGLE-TOKEN filer name, and every name two boards share.
 * Seven pairs were verified wrong by reading the tenant's own postings:
 *
 *   Emerson (139 workers, VA)     -> emerson~wd5~Emerson_College_Staff   (a college)
 *   Wise Company LLC              -> wise                                (a fintech)
 *   Mosaic Company                -> mosaic                              (a startup)
 *   Benchmark                     -> benchmark~wd1~PGH_Careers           (a hotel group)
 *   Block, Inc.                   -> block-llp AND the-block             (a law firm; a media co)
 *   Frontier Group Holdings, Inc. -> eu~frontier                         (an EU tenant)
 *   FMC CORP                      -> fmc~wd12~FMC                        (a pair batch 5 rejected)
 *
 * The never-surface rule (SPEC section 5): nothing leaves layoff_filings
 * except through a layoff_matches row, and a layoff_matches row is written
 * only by an accepted alias or by an exact match of a filer name with two or
 * more tokens against exactly ONE employer's mirrored display name. The
 * readers then hide, in SQL, anything not status active, anything without a
 * link, anything outside the display window or after our read, a WARN
 * notice under the single-site worker bar or with no count, and every 8-K/A.
 *
 * THIS GUARD IS BEHAVIOURAL. It applies lane A's eleven migrations to a real
 * Postgres (pglite), mirrors the wrong tokens under the display names lane 3
 * saw, plants the seven filers plus a future-dated notice, a 49-worker
 * notice, an 8-K/A and one control multi-token pair, runs the matcher and
 * asks the card reader for every token. All but the control must come back
 * with a NULL source. Then it re-issues the matcher and the reader from
 * MUTATED string copies -- the token floor lowered, the one-employer rule
 * dropped, the normaliser taught to strip "group" and "holdings", the worker
 * bar removed, the status and form bars removed -- and requires each
 * mutation to LEAK the specific filing it protects against, then re-seals.
 * A guard that cannot fire is decoration; the mutation steps are the proof.
 *
 * THE LINK RULE, same method: a surfaced row always carries an https link.
 * The table refuses a NULL or http:// source_url; the upsert refuses it
 * before the table sees it; the readers predicate on it. A second database
 * is booted from a DDL copy with the constraint removed, to prove the reader
 * predicate holds the line alone -- and that removing it too is the leak.
 *
 * The literals this file needs (the clauses it mutates) live in the test body
 * and nowhere in a comment of the migration (project_guard_literals).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
// Every 20260918-1xxxxx migration: lane A's eleven, plus any later lane's
// (an alias seed applies on top and changes nothing below -- the wrong pairs
// are never aliased). Lane A's function files are pinned by prefix.
const FILES = readdirSync(MIGRATIONS).filter((f) => /^202609181\d{5}_/.test(f) && f.endsWith(".sql")).sort();
const LANE_A = ["20260918100000", "20260918100100", "20260918100200", "20260918100300", "20260918100400", "20260918100500",
  "20260918100600", "20260918100700", "20260918100800", "20260918100900", "20260918101000"];
/** Every occurrence, split and joined (the app's lib target predates the newer string method). */
const replaceEvery = (text: string, needle: string, by: string) => text.split(needle).join(by);
const mig = (prefix: string) => {
  const f = FILES.find((x) => x.startsWith(prefix));
  if (!f) throw new Error(`no lane-A migration starts with ${prefix}`);
  return readFileSync(resolve(MIGRATIONS, f), "utf8");
};

/** The board tables lane A's functions read, as stand-ins with the columns the SQL touches. */
const BOARD_STAND_INS = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, source text, company_token text, category text NOT NULL DEFAULT 'other',
    posted_at timestamptz, effective_posted timestamptz, first_seen timestamptz NOT NULL DEFAULT now(),
    last_seen timestamptz, missing_since timestamptz, country text, region_code text
  );
  CREATE TABLE public.job_board_closures (
    posting_id text, source text, company_token text, category text NOT NULL DEFAULT '',
    first_seen timestamptz, posted_at timestamptz, closed_at timestamptz NOT NULL DEFAULT now(),
    superseded boolean NOT NULL DEFAULT false, suspect boolean, batch_live_before integer, absence_basis text
  );
  CREATE TABLE public.job_board_exits (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, posting_id text, source text,
    company_token text, category text NOT NULL DEFAULT 'other', exit_reason text NOT NULL,
    days_on_board numeric, exited_at timestamptz NOT NULL DEFAULT now(), posted_at timestamptz
  );
  CREATE TABLE public.job_board_company_snapshots (
    company_token text, snapshot_date date, open_roles integer, PRIMARY KEY (company_token, snapshot_date)
  );
  CREATE TABLE public.job_board_board_observability (
    company_token text PRIMARY KEY,
    bucket text NOT NULL CHECK (bucket IN ('full_read', 'lap_proven', 'lap_pending', 'unprovable', 'unobserved')),
    lap_w0 timestamptz, as_of timestamptz NOT NULL DEFAULT now()
  );
`;

type Row = Record<string, unknown>;
const daysAgo = (n: number) => {
  const t = new Date();
  t.setUTCDate(t.getUTCDate() - n);
  return t.toISOString().slice(0, 10);
};

async function boot(ddlOverride?: (sql: string) => string): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(BOARD_STAND_INS);
  for (const f of FILES) {
    const sql = readFileSync(resolve(MIGRATIONS, f), "utf8");
    await db.exec(f.startsWith("20260918100000") && ddlOverride ? ddlOverride(sql) : sql);
  }
  return db;
}

/** The mirror of the WRONG tokens, under the display names lane 3 read on each tenant. */
const WRONG_MIRROR: Array<[vendor: string, token: string, display: string]> = [
  ["workday", "emerson~wd5~Emerson_College_Staff", "Emerson"],
  ["greenhouse", "wise", "Wise"],
  ["ashby", "mosaic", "Mosaic"],
  ["workday", "benchmark~wd1~PGH_Careers", "Benchmark"],
  ["greenhouse", "block-llp", "Block"],
  ["lever", "the-block", "Block"],
  ["workday", "eu~frontier", "Frontier"],
  ["workday", "fmc~wd12~FMC", "FMC"],
  ["lever", "cambiumnetworks", "Cambium Networks"],
  ["greenhouse", "acmewidgets", "Acme Widgets"],
];
const WRONG_TOKENS = ["emerson~wd5~Emerson_College_Staff", "wise", "mosaic", "benchmark~wd1~PGH_Careers", "block-llp", "the-block", "eu~frontier", "fmc~wd12~FMC"];
const EVERY_TOKEN = [...WRONG_TOKENS, "cambiumnetworks", "acmewidgets"];

const readAt = new Date().toISOString();
const sec = (adsh: string, filer: string, cik: number, extra: Row = {}): Row => ({
  filing_id: `sec:${adsh}`, source: "sec_8k_205", filer_raw: filer, event_date: daysAgo(20), event_basis: "sec_report_date",
  public_date: daysAgo(17), public_basis: "sec_filed", source_read_at: readAt,
  source_url: `https://www.sec.gov/Archives/edgar/data/${cik}/${adsh}/doc.htm`, source_name: "SEC EDGAR", status: "active",
  cik, adsh, form: "8-K", section_text: "Item 2.05 Costs Associated with Exit or Disposal Activities. ...", ...extra,
});
const warn = (id: string, filer: string, state: string, workers: number | null, extra: Row = {}): Row => ({
  filing_id: `warn:${id}`, source: "state_warn", filer_raw: filer, event_date: daysAgo(20), event_basis: "warn_notice_date",
  public_date: daysAgo(15), public_basis: "state_received", source_read_at: readAt,
  source_url: `https://example.invalid/${state.toLowerCase()}/warn`, source_name: `${state} workforce agency`, status: "active",
  state, feed: "bln_raw", workers, event_type: "layoff", site_raw: `${filer} site`, ...extra,
});

/** The fixture: the seven wrong pairs, the three hidden-by-the-reader rows, one control. */
const FIXTURE: Row[] = [
  warn("emerson", "Emerson", "VA", 139),
  warn("wise", "Wise Company LLC", "TX", 210),
  sec("mosaic-1", "Mosaic Company", 1285785),
  warn("benchmark", "Benchmark", "PA", 88),
  sec("block-1", "Block, Inc.", 1512673, { headcount: 900 }),
  sec("frontier-1", "Frontier Group Holdings, Inc.", 1670076, { pct: 10 }),
  sec("fmc-1", "FMC CORP", 37785, { pct: 8 }),
  // hidden by the reader, never by the matcher:
  warn("acme-49", "Acme Widgets", "CA", 49),
  sec("cambium-2", "Cambium Networks Corp", 1738177, { form: "8-K/A", status: "amendment", amends_adsh: "cambium-1", event_date: daysAgo(10), public_date: daysAgo(10) }),
  // the control: two tokens, one employer, prints
  sec("cambium-1", "Cambium Networks Corp", 1738177, { pct: 53.6 }),
];
/** Refused at the door, so no reader can ever see it. */
const FUTURE_NOTICE = warn("acme-future", "Acme Widgets", "CA", 120, { event_date: "2099-12-31", public_date: "2099-12-31" });

async function seed(db: PGlite) {
  await db.query(`SELECT * FROM public.layoff_board_names_mirror($1::jsonb, now(), false)`, [
    JSON.stringify(WRONG_MIRROR.map(([vendor, company_token, display_name]) => ({ vendor, company_token, display_name }))),
  ]);
  // Live US postings in every notice's state, so the WARN state gate is NOT
  // what refuses the wrong pairs -- the token rule has to do it alone.
  await db.exec(`
    INSERT INTO public.job_board_postings (id, source, company_token, posted_at, effective_posted, country, region_code) VALUES
      ('p1', 'workday', 'emerson~wd5~Emerson_College_Staff', now() - interval '5 days', now() - interval '5 days', 'US', 'US-VA'),
      ('p2', 'greenhouse', 'wise', now() - interval '5 days', now() - interval '5 days', 'US', 'US-TX'),
      ('p3', 'workday', 'benchmark~wd1~PGH_Careers', now() - interval '5 days', now() - interval '5 days', 'US', 'US-PA'),
      ('p4', 'greenhouse', 'acmewidgets', now() - interval '5 days', now() - interval '5 days', 'US', 'US-CA');
  `);
  const up = (await db.query(`SELECT * FROM public.layoff_filings_upsert($1::jsonb)`, [JSON.stringify([...FIXTURE, FUTURE_NOTICE])])).rows[0] as Row;
  return up;
}

async function readAll(db: PGlite): Promise<Record<string, Row>> {
  const rows = (await db.query(`SELECT * FROM public.get_employer_layoff_filings($1::text[])`, [EVERY_TOKEN])).rows as Row[];
  return Object.fromEntries(rows.map((r) => [String(r.lf_company_token), r]));
}

async function rebuild(db: PGlite) {
  return (await db.query(`SELECT * FROM public.layoff_matches_rebuild()`)).rows[0] as Row;
}

describe("a filing without a curated employer never leaves the table", () => {
  let db: PGlite;
  let upsert: Row;

  beforeAll(async () => {
    db = await boot();
    upsert = await seed(db);
  }, 120_000);
  afterAll(async () => { await db?.close(); });

  it("found the eleven lane-A migrations it executes (guards the guard)", () => {
    for (const p of LANE_A) expect(FILES.some((f) => f.startsWith(p)), `${p} is missing`).toBe(true);
    expect(FILES.length).toBeGreaterThanOrEqual(11);
  });

  it("the future-dated notice is refused at the door, by name and reason", () => {
    expect(upsert.lu_inserted).toBe(FIXTURE.length);
    expect(upsert.lu_refused).toBe(1);
    expect(upsert.lu_refused_ids).toEqual(["warn:acme-future"]);
    expect(String((upsert.lu_refused_reasons as string[])[0])).toMatch(/after today/);
  });

  it("the matcher writes no row for any of the seven wrong pairs and one for the control", async () => {
    const m = await rebuild(db);
    const rows = (await db.query(`SELECT filing_id, company_token, matched_via FROM public.layoff_matches ORDER BY 1, 2`)).rows as Row[];
    const matchedWrong = rows.filter((r) => WRONG_TOKENS.includes(String(r.company_token)));
    expect(matchedWrong, `wrong pairs reached layoff_matches: ${JSON.stringify(matchedWrong)}`).toEqual([]);
    expect(rows.filter((r) => r.company_token === "cambiumnetworks").map((r) => r.filing_id).sort()).toEqual(["sec:cambium-1", "sec:cambium-2"]);
    // The refusals are COUNTED, so the candidate queue can read them: the six
    // single-token filers (Block's two tokens share one norm -- it is counted
    // as single, the ambiguity rule being second in line), and none of the
    // seven matched.
    expect(m.lm_refused_single).toBe(6);
    expect(m.lm_refused_ambiguous).toBe(0);
    expect(m.lm_exact_multitoken).toBe(3);   // cambium x2 + acme (the READER hides acme's 49)
    expect(m.lm_alias).toBe(0);
    expect(m.lm_unmatched).toBe(7);          // the seven wrong filers reach no board
  });

  it("the card reader answers one row per token and a NULL source for all but the control", async () => {
    const by = await readAll(db);
    expect(Object.keys(by).sort()).toEqual([...EVERY_TOKEN].sort());
    for (const tok of WRONG_TOKENS) {
      expect(by[tok].lf_source, `${tok} printed a filing`).toBeNull();
      expect(by[tok].lf_filer, `${tok} printed a filer name`).toBeNull();
      expect(by[tok].lf_more_n).toBe(0);
    }
    // The 49-worker notice is matched (the matcher decides WHO) and hidden (the reader decides WHAT).
    expect(by["acmewidgets"].lf_source).toBeNull();
    expect(by["acmewidgets"].lf_workers).toBeNull();
    // The control prints the 8-K, never the 8-K/A, and every row that prints carries its link.
    expect(by["cambiumnetworks"].lf_source).toBe("sec_8k_205");
    expect(by["cambiumnetworks"].lf_form).toBe("8-K");
    expect(by["cambiumnetworks"].lf_filer).toBe("Cambium Networks Corp");
    expect(by["cambiumnetworks"].lf_more_n).toBe(0);
    expect(String(by["cambiumnetworks"].lf_source_url)).toMatch(/^https:\/\//);
  });

  it("the lander reader agrees: nothing for the wrong tokens, the one 8-K for the control", async () => {
    for (const tok of WRONG_TOKENS) {
      const rows = (await db.query(`SELECT * FROM public.get_employer_layoff_filings_all($1)`, [tok])).rows;
      expect(rows, `${tok} listed a filing on the employer page`).toEqual([]);
    }
    const c = (await db.query(`SELECT la_form, la_total_n FROM public.get_employer_layoff_filings_all('cambiumnetworks')`)).rows as Row[];
    expect(c).toEqual([{ la_form: "8-K", la_total_n: 1 }]);
  });

  it("the MCP and card path is the same reader, so the row it prints is the row the card prints", async () => {
    // One SECURITY DEFINER reader for every surface (SPEC section 6): the
    // property that keeps the MCP field and the card from disagreeing.
    const fns = (await db.query(`SELECT proname, prosecdef FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('get_employer_layoff_filings', 'get_employer_layoff_filings_all', 'get_layoff_partition')`)).rows as Row[];
    expect(fns.length).toBe(3);
    expect(fns.every((f) => f.prosecdef === true)).toBe(true);
    const anon = (await db.query(`SELECT has_table_privilege('anon', 'public.layoff_filings', 'SELECT') AS f, has_table_privilege('anon', 'public.layoff_matches', 'SELECT') AS m`)).rows[0] as Row;
    expect(anon).toEqual({ f: false, m: false });
  });

  describe("teeth: each rule proven to be what keeps its filing in", () => {
    const MATCHER = mig("20260918100400");
    const READER = mig("20260918100500");
    const NORM = mig("20260918100100");

    const TOKEN_FLOOR = "(SELECT count(*) FROM unnest(string_to_array(f.filer_norm, ' ')) AS tk(t) WHERE length(tk.t) >= 2) >= 2";
    const TOKEN_FLOOR_LOWERED = "(SELECT count(*) FROM unnest(string_to_array(f.filer_norm, ' ')) AS tk(t) WHERE length(tk.t) >= 2) >= 1";
    const ONE_EMPLOYER = "HAVING count(DISTINCT c.employer) = 1";
    const SUFFIXES = "'co', 'company', 'lp', 'llp', 'sa', 'nv', 'ag', 'se', 'the', 'and'];";
    const WORKER_BAR = "AND (f.source <> 'state_warn' OR f.workers >= (SELECT kk.layoff_warn_min_workers FROM k kk))";
    const STATUS_BAR = "AND f.status = 'active'";
    const FORM_BAR = "AND f.form IS DISTINCT FROM '8-K/A'";

    it("the clauses this file mutates are spelled where it expects them", () => {
      expect(MATCHER.split(TOKEN_FLOOR).length, "token floor sites in the matcher").toBe(4);
      expect(MATCHER.split(ONE_EMPLOYER).length, "one-employer sites in the matcher").toBe(3);
      expect(NORM.split(SUFFIXES).length, "the suffix list in the normaliser").toBe(2);
      expect(READER.split(WORKER_BAR).length, "the worker bar in the reader").toBe(2);
      expect(READER.split(STATUS_BAR).length, "the status bar in the reader").toBe(2);
      expect(READER.split(FORM_BAR).length, "the form bar in the reader").toBe(2);
    });

    it("token floor lowered to one: the five single-token filers leak; Block stays out (two employers); Frontier stays out (its norm is three words)", async () => {
      await db.exec(replaceEvery(MATCHER, TOKEN_FLOOR, TOKEN_FLOOR_LOWERED));
      await rebuild(db);
      const by = await readAll(db);
      expect(by["emerson~wd5~Emerson_College_Staff"].lf_filer).toBe("Emerson");
      expect(by["emerson~wd5~Emerson_College_Staff"].lf_workers).toBe(139);
      expect(by["wise"].lf_filer).toBe("Wise Company LLC");
      expect(by["mosaic"].lf_filer).toBe("Mosaic Company");
      expect(by["benchmark~wd1~PGH_Careers"].lf_filer).toBe("Benchmark");
      expect(by["fmc~wd12~FMC"].lf_filer).toBe("FMC CORP");
      expect(by["block-llp"].lf_source).toBeNull();
      expect(by["the-block"].lf_source).toBeNull();
      expect(by["eu~frontier"].lf_source).toBeNull();
    });

    it("token floor lowered AND the one-employer rule dropped: Block prints on the law firm and the media company", async () => {
      await db.exec(
        replaceEvery(
          replaceEvery(MATCHER, TOKEN_FLOOR, TOKEN_FLOOR_LOWERED),
          ONE_EMPLOYER, "HAVING count(DISTINCT c.employer) >= 1"),
      );
      await rebuild(db);
      const by = await readAll(db);
      expect(by["block-llp"].lf_filer).toBe("Block, Inc.");
      expect(by["the-block"].lf_filer).toBe("Block, Inc.");
      expect(by["the-block"].lf_headcount).toBe(900);
    });

    it("the normaliser taught to strip group and holdings (with the floor lowered): Frontier Group Holdings prints on the EU tenant", async () => {
      // The loose set lifted SEC hits 803 -> 957 and manufactured this pair.
      await db.exec(NORM.replace(SUFFIXES, "'co', 'company', 'lp', 'llp', 'sa', 'nv', 'ag', 'se', 'the', 'and', 'group', 'holdings'];"));
      await db.exec(`UPDATE public.layoff_filings SET filer_norm = public.layoff_norm(filer_raw)`);
      await db.exec(replaceEvery(MATCHER, TOKEN_FLOOR, TOKEN_FLOOR_LOWERED));
      await rebuild(db);
      const by = await readAll(db);
      expect(by["eu~frontier"].lf_filer).toBe("Frontier Group Holdings, Inc.");
    });

    it("the shipped normaliser and matcher put back: every wrong token is NULL again", async () => {
      await db.exec(NORM);
      await db.exec(`UPDATE public.layoff_filings SET filer_norm = public.layoff_norm(filer_raw)`);
      await db.exec(MATCHER);
      await rebuild(db);
      const by = await readAll(db);
      for (const tok of WRONG_TOKENS) expect(by[tok].lf_source, tok).toBeNull();
      expect(by["cambiumnetworks"].lf_source).toBe("sec_8k_205");
    });

    it("worker bar removed from the reader: the 49-worker notice prints as 49", async () => {
      await db.exec(READER.replace(WORKER_BAR, ""));
      const by = await readAll(db);
      expect(by["acmewidgets"].lf_workers).toBe(49);
      await db.exec(READER);
    });

    it("status bar removed alone: the 8-K/A is still held by the form bar; form bar removed alone: still held by the status bar", async () => {
      await db.exec(READER.replace(STATUS_BAR, ""));
      expect((await readAll(db))["cambiumnetworks"].lf_more_n).toBe(0);
      await db.exec(READER.replace(FORM_BAR, ""));
      expect((await readAll(db))["cambiumnetworks"].lf_more_n).toBe(0);
      await db.exec(READER);
    });

    it("status and form bars both removed: the 8-K/A prints as its own line", async () => {
      await db.exec(READER.replace(STATUS_BAR, "").replace(FORM_BAR, ""));
      const by = await readAll(db);
      // The amendment is newer, so it would even become THE line.
      expect(by["cambiumnetworks"].lf_form).toBe("8-K/A");
      expect(by["cambiumnetworks"].lf_more_n).toBe(1);
      await db.exec(READER);
      expect((await readAll(db))["cambiumnetworks"].lf_form).toBe("8-K");
    });
  });
});

describe("a surfaced filing always carries its link", () => {
  it("the table refuses a NULL and an http:// source_url; the upsert refuses it before the table sees it", async () => {
    const db = await boot();
    try {
      const base = `INSERT INTO public.layoff_filings (filing_id, source, filer_raw, filer_norm, event_date, event_basis, public_date, public_basis, source_read_at, source_url, source_name, state, feed, event_type, workers)`;
      const vals = `VALUES ($1, 'state_warn', 'Acme Widgets', 'acme widgets', current_date - 5, 'warn_notice_date', current_date - 3, 'state_received', now(), $2, 'CA EDD', 'CA', 'bln_raw', 'layoff', 120)`;
      await expect(db.query(`${base} ${vals}`, ["warn:nolink", null])).rejects.toThrow(/null value|not-null/i);
      await expect(db.query(`${base} ${vals}`, ["warn:http", "http://example.invalid/warn"])).rejects.toThrow(/check constraint/i);
      const up = (await db.query(`SELECT * FROM public.layoff_filings_upsert($1::jsonb)`, [
        JSON.stringify([warn("http", "Acme Widgets", "CA", 120, { source_url: "http://example.invalid/warn" }), { ...warn("nolink", "Acme Widgets", "CA", 120), source_url: null }]),
      ])).rows[0] as Row;
      expect(up.lu_refused).toBe(2);
      expect((up.lu_refused_reasons as string[]).every((r) => /https/.test(r))).toBe(true);
    } finally {
      await db.close();
    }
  }, 120_000);

  it("with the table's link constraints removed, the reader predicate alone hides a linkless row -- and removing that too is the leak", async () => {
    // A second database from a DDL copy: the two constraints deleted, so a row
    // with no link can exist. The readers must still refuse to print it.
    const LINK_DDL = /source_url\s+text NOT NULL CHECK \(source_url ~ '\^https:\/\/'\),/g;
    const DDL = mig("20260918100000");
    expect(DDL.match(LINK_DDL)?.length, "the link column is spelled where the mutation expects it").toBe(1);
    const db = await boot((sql) => sql.replace(LINK_DDL, "source_url text,"));
    try {
      await db.query(`SELECT * FROM public.layoff_board_names_mirror($1::jsonb, now(), false)`, [
        JSON.stringify([{ vendor: "lever", company_token: "cambiumnetworks", display_name: "Cambium Networks" }]),
      ]);
      await db.exec(`
        INSERT INTO public.layoff_filings (filing_id, source, filer_raw, filer_norm, event_date, event_basis, public_date, public_basis, source_read_at, source_url, source_name, cik, adsh, form, section_text)
        VALUES ('sec:nolink', 'sec_8k_205', 'Cambium Networks Corp', 'cambium networks', current_date - 5, 'sec_report_date', current_date - 3, 'sec_filed', now(), NULL, 'SEC EDGAR', 1738177, 'nolink', '8-K', 'Item 2.05 ...')
      `);
      await rebuild(db);
      const matched = (await db.query(`SELECT count(*)::int AS n FROM public.layoff_matches WHERE filing_id = 'sec:nolink'`)).rows[0] as Row;
      expect(matched.n, "the matcher joins it (who), the reader must refuse it (what)").toBe(1);
      const held = (await db.query(`SELECT lf_source, lf_source_url FROM public.get_employer_layoff_filings(ARRAY['cambiumnetworks'])`)).rows[0] as Row;
      expect(held).toEqual({ lf_source: null, lf_source_url: null });
      const heldAll = (await db.query(`SELECT * FROM public.get_employer_layoff_filings_all('cambiumnetworks')`)).rows;
      expect(heldAll).toEqual([]);

      const READER = mig("20260918100500");
      const LINK_BAR = "AND f.source_url IS NOT NULL";
      expect(READER.split(LINK_BAR).length).toBe(2);
      await db.exec(READER.replace(LINK_BAR, ""));
      const leaked = (await db.query(`SELECT lf_source, lf_source_url FROM public.get_employer_layoff_filings(ARRAY['cambiumnetworks'])`)).rows[0] as Row;
      expect(leaked.lf_source, "MUTATED reader printed a filing with no link").toBe("sec_8k_205");
      expect(leaked.lf_source_url).toBeNull();
      await db.exec(READER);
      expect(((await db.query(`SELECT lf_source FROM public.get_employer_layoff_filings(ARRAY['cambiumnetworks'])`)).rows[0] as Row).lf_source).toBeNull();
    } finally {
      await db.close();
    }
  }, 120_000);
});
