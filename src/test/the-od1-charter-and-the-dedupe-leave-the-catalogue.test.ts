// @vitest-environment node
/**
 * THE OD1 CHARTER AND THE DEDUPE LEAVE THE CATALOGUE (job-board 2026-09-09.102, catalogue lane).
 *
 * Owner decision OD1 (2026-11-08) retires six junk, gig and aggregator boards and labels six
 * agency boards; BB-05 retires the nine twin boards whose every posting another catalogued
 * board also lists; PRUNE-1024 retires ten dead or duplicate boards from the 2026-10-24
 * coverage report; D13 repoints thirteen boards to the vendor their employer now posts on;
 * BB-01 takes four oversize boards off the hot list; Convergint's Workday site is appended.
 *
 * EVERY KEY IS source:token. A token alone is not a board: pinpoint:helsing leaves while
 * greenhouse:helsing stays, and seven repoints keep their token under a new vendor. A check
 * keyed on the token would pass with the wrong board still carried.
 *
 * THE CURSOR IS POSITIONAL. The refresh cursor walks JOB_SOURCES by index, so a labelled
 * board is written as an object entry exactly where its packed row was, a repoint rewrites
 * its record in place, and the one new board is appended last. Each is pinned by its index
 * and by the two neighbours it had on .101.
 */
import { describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { HOT_TOKENS, JOB_SOURCES } from "../../supabase/functions/job-board/sources";
import { EMPLOYER_ALIASES } from "../../supabase/functions/job-board/employer-aliases";
import { codeOf } from "./helpers/strip-comments";
import { isUnreviewedTenantName } from "../../src/lib/company-display";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const key = (s: { source: string; token: string }) => `${s.source}:${s.token}`;
const KEYS = JOB_SOURCES.map(key);
const HAS = new Set(KEYS);
const TOKENS = new Set(JOB_SOURCES.map((s) => s.token));

/** OD1's six retirements. */
const OD1_RETIRED = [
  "teamtailor:eutalents", // XR-3: 3,269 open rows of the same spam pattern
  "workable:toloka-ai", "workable:clients-blackbox-inc", "workable:huzzle", // gig boards
  "smartrecruiters:JobsForHumanity", // BB-07: an aggregator
  "recruitee:vluchtelingenwerkvrijwilligers", // volunteer roles, not jobs
];
/** BB-05: each 'b' twin retired, with the 'a' twin that keeps every one of its postings. */
const TWINS: ReadonlyArray<[retired: string, kept: string]> = [
  ["oracle:login-esms-saasfaukgovprod1~ocs~CX_1", "oracle:fa-esms-saasfaukgovprod1~ocs~CX_1"], // LCC, 134 of 134
  ["adp:1da67361-03ef-4aa2-8925-9ef512ba7c42", "adp:009d7dae-06f5-4976-bb97-c97601e32efe"], // Prosperity Bank
  ["adp:48d65e3f-dbfc-44b9-996a-65283fbdcee9", "adp:02835ad7-1b2e-4eb2-9773-3454d03b1a3e"], // R NewLogo HR
  ["adp:ba397985-19df-4126-90de-3220631304e5", "adp:1b4164c0-a7ce-4c7b-8525-41e0f23310d4"], // Amalgamated Bank
  ["recruitee:boggimilano", "recruitee:boggimilano1"], // Boggi Milano
  ["recruitee:easyapplyrimutee", "recruitee:easyapplyrekluti"], // Kruger NearShore
  ["breezy:cdpdoctor", "breezy:community-dental-partners"], // a brand subset of its parent board
  ["paylocity:0c4c3299-d50f-40e2-aca1-0de562ac280d", "paylocity:e4d6a57d-f658-427a-a859-5d672ac07e1b"], // YMCA of Southwest Florida
  ["paylocity:b8c553b7-79ad-4da0-a8b2-3ce8e842324a", "paylocity:ff517f63-c379-48fb-acc8-8d66e8d5b076"], // Louisiana Cat
];
/** PRUNE-1024's ten. */
const PRUNED = [
  "icims:careers.spglobal.com", // duplicates S&P Global's Workday site
  "workday:lbg~wd3~broadbean_external", // every requisition is on lbg_Careers
  "greenhouse:eu~imc", // the same job ids as greenhouse:imc
  "greenhouse:dataikujobs", "greenhouse:applytonumeral", "greenhouse:starcloud", "greenhouse:deepmind", "greenhouse:etchedai",
  "ashby:corgi",
  "pinpoint:helsing", // its token stays: greenhouse:helsing is Helsing's live board
];
const RETIRED = [...OD1_RETIRED, ...TWINS.map(([b]) => b), ...PRUNED];

/** The six labelled boards: [key, name, index on .102, the neighbours it had on .101]. */
const LABELLED: ReadonlyArray<[string, string, number, string, string]> = [
  ["workable:pavago", "Pavago", 15248, "workable:hire-resolve-the-top-recruitment-agency", "workable:mercier-consultancy-group"],
  ["workable:hire-overseas", "Hire Overseas", 15281, "workable:leigh-and-co", "workable:amazingcarecareers"],
  ["smartrecruiters:JobMobz1", "Job Mobz", 3120, "smartrecruiters:ITTrailBlazers1", "smartrecruiters:AustroHolding"],
  ["recruitee:sterkinmatches", "Sterk in Matches B.V.", 24134, "bamboohr:zulzi", "recruitee:vdkgroep"],
  ["recruitee:deintraumjobwartet", "ANGEHEUERT GmbH", 41802, "recruitee:yellowstone", "recruitee:fridayrecruitment"],
  ["lever:americaatwork", "America At Work", 2509, "bamboohr:achievebh", "ashby:dapper"],
];
/** D13: [old key, new key, index on .102, neighbours on .101]. The first seven keep their token. */
const REPOINTS: ReadonlyArray<[string, string, number, string, string]> = [
  ["greenhouse:wayve", "ashby:wayve", 4007, "greenhouse:focusfinancialpartners", "greenhouse:valtech"],
  ["greenhouse:clickhouse", "ashby:clickhouse", 1033, "greenhouse:archer56", "greenhouse:formlabs"],
  ["lever:swordhealth", "greenhouse:swordhealth", 23001, "lever:significanceinc", "lever:wintermute-trading"],
  ["greenhouse:lovable", "ashby:lovable", 4168, "greenhouse:skinlaundry", "greenhouse:northpointtechnology"],
  ["greenhouse:kalshi", "ashby:kalshi", 589, "ashby:junction", "ashby:kastle"],
  ["greenhouse:webflow", "ashby:webflow", 814, "ashby:wallbit", "greenhouse:xendit"],
  ["greenhouse:worldlabs", "ashby:worldlabs", 5078, "greenhouse:zafinlabsamericasinc", "greenhouse:10beauty"],
  ["ashby:mach", "greenhouse:machindustries", 7249, "ashby:kong", "ashby:polene-paris"],
  ["greenhouse:temporaltechnologies", "ashby:temporal", 4172, "greenhouse:orchard", "greenhouse:vonage"],
  ["ashby:browserbase", "greenhouse:browserbaseinc", 883, "greenhouse:brex", "greenhouse:calm"],
  ["greenhouse:postman", "workday:postman~wd108~careers", 3998, "greenhouse:woolpert", "greenhouse:waldensecurity"],
  ["greenhouse:humeai", "ashby:hume-ai", 2150, "greenhouse:hspg", "greenhouse:iftother"],
  ["greenhouse:blackforestlabs", "ashby:black-forest-labs", 1640, "greenhouse:attivopartners", "greenhouse:britive"],
];
const BB01_COLD = ["transperfect", "duravermeer", "aaff", "tether"];

describe("the retired boards leave the catalogue, keyed by vendor and token", () => {
  it("none of the 25 retired keys is catalogued, and the catalogue is 44,499 boards", () => {
    expect(RETIRED.length).toBe(25);
    expect(RETIRED.filter((k) => HAS.has(k))).toEqual([]);
    // 44,523 on .101, 25 out, Convergint in.
    expect(JOB_SOURCES.length).toBe(44_499);
    expect(new Set(KEYS).size, "a key is carried twice").toBe(KEYS.length);
  });

  it("each twin's surviving board is still carried, so the employer stays on the board", () => {
    for (const [, kept] of TWINS) expect(HAS.has(kept), kept).toBe(true);
  });

  it("a retired key whose token another vendor carries leaves by its key, not its token", () => {
    expect(HAS.has("pinpoint:helsing")).toBe(false);
    expect(HAS.has("greenhouse:helsing"), "Helsing's live board left with its pinpoint twin").toBe(true);
    // Every other retired token is gone whole, so the token-keyed orphan prune takes its rows.
    const shared = RETIRED.filter((k) => TOKENS.has(k.slice(k.indexOf(":") + 1)));
    expect(shared).toEqual(["pinpoint:helsing"]);
  });

  it("OD1's held Workable board stays catalogued (dark until the mill screen)", () => {
    expect(HAS.has("workable:nogigiddy")).toBe(true);
  });

  it("no employer alias names a retired token, and the two aliases that did are rewritten", () => {
    const aliasTokens = new Set(Object.values(EMPLOYER_ALIASES).flatMap((a) => a.tokens));
    const retiredTokens = RETIRED.map((k) => k.slice(k.indexOf(":") + 1)).filter((t) => !TOKENS.has(t));
    expect(retiredTokens.filter((t) => aliasTokens.has(t))).toEqual([]);
    expect(EMPLOYER_ALIASES.lbg?.tokens).toEqual(["lbg~wd3~lbg_Careers"]);
    expect(EMPLOYER_ALIASES.mindrift, "an alias for a retired gig board").toBeUndefined();
  });
});

describe("the six agency boards wear the flag where their packed rows were", () => {
  it("each is an object entry with agency true, at the index and between the neighbours its row had", () => {
    for (const [k, name, at, prev, next] of LABELLED) {
      const i = KEYS.indexOf(k);
      expect(i, `${k} moved: the cursor is positional`).toBe(at);
      expect([KEYS[i - 1], KEYS[i + 1]], k).toEqual([prev, next]);
      const e = JOB_SOURCES[i] as { name: string; agency?: boolean };
      expect([e.name, e.agency], k).toEqual([name, true]);
    }
  });

  it("each is written as an object literal in the catalogue's text, the form the tagger and every parser read", () => {
    const code = codeOf(read("supabase/functions/job-board/sources.ts"));
    for (const [k, name] of LABELLED) {
      const [source, token] = [k.slice(0, k.indexOf(":")), k.slice(k.indexOf(":") + 1)];
      expect(code, k).toContain(`{ name: "${name}", source: "${source}", token: "${token}", agency: true },`);
    }
  });
});

describe("the D13 repoints are rewritten in place", () => {
  it("each new key is carried at its record's index and the old key is not", () => {
    for (const [old, now, at, prev, next] of REPOINTS) {
      expect(HAS.has(old), `${old} is still carried`).toBe(false);
      const i = KEYS.indexOf(now);
      expect(i, `${now} is not where its record was`).toBe(at);
      expect([KEYS[i - 1], KEYS[i + 1]], now).toEqual([prev, next]);
    }
  });

  it("the names stay the employers' own", () => {
    const name = (k: string) => JOB_SOURCES[KEYS.indexOf(k)]?.name;
    expect(name("greenhouse:machindustries")).toBe("Mach Industries");
    expect(name("ashby:temporal")).toBe("Temporal Technologies");
    expect(name("workday:postman~wd108~careers")).toBe("Postman");
    expect(name("ashby:black-forest-labs")).toBe("Black Forest Labs");
  });

  it("no repoint makes the bake refuse new posting pages for a name it accepted under the old token", () => {
    const token = (k: string) => k.slice(k.indexOf(":") + 1);
    for (const [old, now] of REPOINTS) {
      const name = JOB_SOURCES[KEYS.indexOf(now)]?.name;
      if (!isUnreviewedTenantName(token(old), name)) expect(isUnreviewedTenantName(token(now), name), `${now} "${name}"`).toBe(false);
    }
    // Black Forest Labs, read 2026-11-15 on its Ashby board: "Black Forest Labs builds visual intelligence".
    expect(isUnreviewedTenantName("black-forest-labs", "Black Forest Labs")).toBe(false);
  });
});

describe("the hot list and the one new board", () => {
  it("the four oversize boards are off the hot list and still catalogued, so they stream only in the cold phase", () => {
    for (const t of BB01_COLD) {
      expect(HOT_TOKENS.has(t), t).toBe(false);
      expect(TOKENS.has(t), `${t} left the catalogue`).toBe(true);
    }
    for (const t of HOT_TOKENS) expect(TOKENS.has(t), `${t} is hot but not catalogued`).toBe(true);
  });

  it("Convergint's Workday site is the last entry, so no board's position moves for it", () => {
    expect(JOB_SOURCES[JOB_SOURCES.length - 1]).toEqual({ name: "Convergint", source: "workday", token: "convergint~wd501~Gbl" });
    // The name it prints is its tenant code title-cased, and it is the employer's own (read on its site): a posting page may name it.
    expect(isUnreviewedTenantName("convergint~wd501~Gbl", "Convergint")).toBe(false);
    // The UKG board stays catalogued and unlabelled (an-agency-is-disclosed-not-hidden's round 3).
    const ukg = JOB_SOURCES.find((s) => s.source === "ukg" && s.token === "recruiting2~CON1074CVTG~1831b61a-1945-44fa-afd8-624795c9b30d") as { agency?: boolean } | undefined;
    expect(ukg).toBeTruthy();
    expect(ukg!.agency).not.toBe(true);
  });
});

describe("the high-water migration follows the catalogue", () => {
  const FILE = readdirSync(resolve(ROOT, "supabase/migrations")).find((f) => f.startsWith("20261111120000_"));
  const sql = FILE ? read(`supabase/migrations/${FILE}`).split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n") : "";

  it("its clamp is the literal JOB_SOURCES.length, written in the form the demo-board guard parses", () => {
    expect(FILE).toBe("20261111120000_the_catalogue_high_water_follows_the_retirements.sql");
    const clamps = [...sql.matchAll(/LEAST\(\(v->>'size'\)::int,\s*(\d+)\)/g)].map((m) => Number(m[1]));
    expect(clamps).toEqual([JOB_SOURCES.length]);
    expect(sql).toMatch(/WHERE k = 'catalog_highwater'/);
    expect(sql, "the self-check raises when the mark is above the catalogue").toMatch(new RegExp(`IF mark > ${JOB_SOURCES.length} THEN\\s+RAISE EXCEPTION`));
  });

  it("on a real Postgres it lowers the .101 mark to the catalogue, never raises one, runs again, and tolerates a database with no mark", async () => {
    const raw = read(`supabase/migrations/${FILE}`);
    const mark = async (db: PGlite) => (await db.query<{ n: number | null }>(`SELECT (v->>'size')::int AS n FROM public.job_board_meta WHERE k = 'catalog_highwater'`)).rows[0]?.n ?? null;
    const db = new PGlite();
    try {
      await db.exec(`CREATE TABLE public.job_board_meta (k text PRIMARY KEY, v jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`);
      await db.exec(`INSERT INTO public.job_board_meta (k, v) VALUES ('slice_stats', '{"build": "2026-09-09.102", "buildSince": "2026-11-16T00:00:00Z"}')`);
      await db.exec(raw); // no row: a notice, nothing written
      expect(await mark(db)).toBeNull();
      await db.exec(`INSERT INTO public.job_board_meta (k, v) VALUES ('catalog_highwater', '{"size": 44523, "at": "2026-11-15T00:00:00Z"}')`);
      await db.exec(raw);
      expect(await mark(db)).toBe(JOB_SOURCES.length);
      expect((await db.query<{ at: string }>(`SELECT v->>'at' AS at FROM public.job_board_meta WHERE k = 'catalog_highwater'`)).rows[0].at, "the rest of the row is kept").toBe("2026-11-15T00:00:00Z");
      await db.exec(raw);
      expect(await mark(db)).toBe(JOB_SOURCES.length);
      await db.exec(`UPDATE public.job_board_meta SET v = '{"size": 44000}' WHERE k = 'catalog_highwater'`);
      await db.exec(raw);
      expect(await mark(db), "LEAST lowers and never raises").toBe(44000);
      // The self-check alone refuses a mark above the catalogue.
      await db.exec(`UPDATE public.job_board_meta SET v = '{"size": 44523}' WHERE k = 'catalog_highwater'`);
      const selfCheck = /DO \$\$[\s\S]*?\$\$;/.exec(raw.slice(raw.lastIndexOf("-- SELF-CHECK")))?.[0] ?? "";
      await expect(db.exec(selfCheck)).rejects.toThrow(/self-check 20261111120000: the catalogue high-water is 44523/);
    } finally { await db.close(); }
  }, 30_000);

  it("refuses, and lowers nothing, until a slice of .102 or later has written slice_stats", async () => {
    const raw = read(`supabase/migrations/${FILE}`);
    const db = new PGlite();
    const mark = async () => (await db.query<{ n: number }>(`SELECT (v->>'size')::int AS n FROM public.job_board_meta WHERE k = 'catalog_highwater'`)).rows[0].n;
    try {
      await db.exec(`CREATE TABLE public.job_board_meta (k text PRIMARY KEY, v jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
        INSERT INTO public.job_board_meta (k, v) VALUES ('catalog_highwater', '{"size": 44523}')`);
      // No slice record at all, then .101's: an OPTIONS answer of .102 can come while .101's last hop still runs.
      await expect(db.exec(raw)).rejects.toThrow(/20261111120000: job_board_meta\.slice_stats names build \(none\), not job-board 2026-09-09\.102 or later/);
      expect(await mark()).toBe(44523);
      for (const build of ["2026-09-09.101", "2026-09-09.99", "garbage"]) {
        await db.exec(`INSERT INTO public.job_board_meta (k, v) VALUES ('slice_stats', '{"build": "${build}"}') ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`);
        await expect(db.exec(raw), build).rejects.toThrow(new RegExp(`names build ${build.replace(/\./g, "\\.")}, not job-board 2026-09-09\\.102`));
        expect(await mark()).toBe(44523);
      }
      for (const build of ["2026-09-09.102", "2026-09-09.1000", "2026-12-01.1"]) {
        await db.exec(`UPDATE public.job_board_meta SET v = '{"size": 44523}' WHERE k = 'catalog_highwater'`);
        await db.exec(`UPDATE public.job_board_meta SET v = '{"build": "${build}"}' WHERE k = 'slice_stats'`);
        await db.exec(raw);
        expect(await mark(), build).toBe(JOB_SOURCES.length);
      }
    } finally { await db.close(); }
  }, 30_000);
});
