// @vitest-environment node
/**
 * THE HIRING RECORD SAYS ONLY WHAT THE SITE WOULD SAY (M2-01, NB-28, S14X-135).
 *
 * employer_hiring_record printed every column of get_company_hiring_health on
 * every board: takedown EVENT counts over ninety days and two medians the
 * site retired on 2026-09-06. The site's employer page prints ROLE counts and
 * one median from get_company_fill_curve, and only where its gate admits them
 * for that board; on a lap-read board, an unproven read, a board whose re-post
 * test reads other sites, and a token two hiring systems share, it prints the
 * gate's sentence instead. Sampled live, the gate refused the ninety-day
 * counts on five of eight boards, and the connector printed them on all.
 *
 * Now each row prints open_roles, tracking_days and feed_total, and the fill
 * curve's figures only where the site's own gate (the byte-identical shared
 * copy) admits them, with the gate's words for the rest. A shared token gets
 * the site's refusal on both employer tools and no filing. The filing read's
 * failure is named without the database's words, and an 8-K's workforce flag
 * is carried as the reader answers it.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";
import { HIRING_RECORD_GATE_COPY, fillGateCopy, hiringRecordGate, type HiringRecordRow } from "../lib/hiring-record-gate";
import { collidedBoards } from "../lib/board-collisions";
import { FILL_SUPPORT_DAYS, MEDIAN_CENSORED_COPY, SHARED_TOKEN_COPY } from "../../supabase/functions/agent-mcp/hiring-record-view";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const ROOT = resolve(__dirname, "../..");
const EN = JSON.parse(readFileSync(resolve(ROOT, "src/i18n/locales/en.json"), "utf8")) as { jobsPage: Record<string, unknown> & { collision: { body: string } } };

/** The health row the RPC answers; the event figures are deliberately odd numbers no other field carries. */
const health = (company_token: string, o: Partial<Record<string, unknown>> = {}) => ({
  company_token, open_roles: 603, closed_90d: 4441, superseded_90d: 4029, median_days_open: 3.4624568131713,
  median_days_to_close: 11.6041986400463, tracking_days: 90, feed_total: null, ...o,
});

/** Fill-curve rows shaped as the live rows sampled on 2026-11-16 (journeys c12), each one the gate refuses. */
const CURVES: Record<string, HiringRecordRow & { company_token: string }> = {
  // full_read, but one title live at many sites: the re-post test reads other sites.
  centriaautism: {
    company_token: "centriaautism", observability_bucket: "full_read", watched_from: "2026-08-20", multi_site_title_share: 0.9469,
    filled_roles_90d: 3833, relisted_roles_90d: 3977, sufficient: false, dated_coverage: 0.81, tracking_days: 90,
    median_days_to_fill: 11.6, median_censored: false, sufficient_30: false, insufficient_reason_30: "relists",
  },
  // A lap-pending Workday board: neither read nor re-list test proven.
  "generalmotors~wd5~Careers_GM": {
    company_token: "generalmotors~wd5~Careers_GM", observability_bucket: "lap_pending", watched_from: null, multi_site_title_share: 0.41,
    filled_roles_90d: 3891, relisted_roles_90d: 3277, sufficient: true, dated_coverage: 0.95, tracking_days: 90,
    median_days_to_fill: 17.3, median_censored: false, sufficient_30: true,
  },
  // A lap-proven Oracle board: confirmed one to three reads late.
  "ibmwjb~ocs~CX_1": {
    company_token: "ibmwjb~ocs~CX_1", observability_bucket: "lap_proven", watched_from: "2026-09-01", multi_site_title_share: 0.7581,
    filled_roles_90d: 3920, relisted_roles_90d: 3270, sufficient: true, dated_coverage: 0.9, tracking_days: 78,
    median_days_to_fill: 16.2, median_censored: false, sufficient_30: true,
  },
};
const REFUSED = Object.keys(CURVES);
/** Every figure the gate refuses on those rows, as it would print. */
const REFUSED_FIGURES = [4441, 4029, 3833, 3977, 3891, 3277, 3920, 3270, 11.6, 12, 17.3, 17, 16.2, 16, 3.4624568131713, 11.6041986400463];

/** A board the gate admits whole, as the positive control. */
const STRIPE: HiringRecordRow & { company_token: string } = {
  company_token: "stripe", observability_bucket: "full_read", watched_from: "2026-08-01", multi_site_title_share: 0.1068,
  filled_roles_90d: 160, relisted_roles_90d: 52, sufficient: true, dated_coverage: 0.9, tracking_days: 90,
  fill_rate_14: 0.3, fill_rate_14_lo: 0.2, fill_rate_14_hi: 0.4, median_days_to_fill: 9.6, median_censored: false, sufficient_30: true,
};

const OLD_COLUMNS = ["closed_90d", "superseded_90d", "median_days_open", "median_days_to_close"];
const SHARED = "clear";

type Row = Record<string, unknown> & { gate?: { counts: string; median: string; sentence: string | null } };
let mcp: KeylessMcp;
beforeEach(async () => {
  mcp = await bootKeylessMcp();
});

const record = async (tokens: string[]) => {
  const out = await mcp.call({ companyTokens: tokens }, { name: "employer_hiring_record" });
  expect(out.isError, out.text).toBe(false);
  return { text: out.text, body: JSON.parse(out.text) as { employers: Row[]; layoff_read: string } };
};
const answer = (tokens: string[], curves: ReadonlyArray<object> | null, curveError: string | null = null) => {
  mcp.answers.get_company_hiring_health = { data: tokens.map((t) => health(t)), error: null };
  mcp.answers.get_company_fill_curve = { data: curves, error: curveError ? { message: curveError } : null };
  mcp.answers.get_employer_layoff_filings = { data: tokens.map((t) => ({ lf_company_token: t, lf_source: null })), error: null };
};

/** The sentence the site prints for each refused half, filled as HiringRecordCard fills it. */
function siteSentence(row: HiringRecordRow): string | null {
  const g = hiringRecordGate(row);
  const d = Number(row.tracking_days) || 0;
  const vars: Record<string, Record<string, string | number>> = {
    coverage: { pct: Math.round(Number(row.dated_coverage) * 100) },
    paceTracking: { d, min: 21 },
    countsTracking: { d, min: g.countsMinTrackingDays },
    countsTrackingLap: { d, min: g.countsMinTrackingDays },
    relist: { n: (Number(row.filled_roles_90d) || 0).toLocaleString("en-US"), d },
  };
  const parts = [g.counts90.ok ? null : g.countsCopy, g.median.ok ? null : g.paceCopy]
    .filter((k): k is NonNullable<typeof k> => !!k)
    .map((k) => fillGateCopy(HIRING_RECORD_GATE_COPY[k], vars[k] ?? {}));
  const kept = [...new Set(parts)];
  return kept.length ? kept.join(" ") : null;
}

describe("1. a board the site's gate refuses prints none of the refused figures", () => {
  it("centriaautism, generalmotors~wd5~Careers_GM and ibmwjb~ocs~CX_1 carry no refused figure and none of the four old columns", async () => {
    answer(REFUSED, Object.values(CURVES));
    const { text, body } = await record(REFUSED);
    expect(body.employers.map((r) => r.company_token)).toEqual(REFUSED);
    for (const row of body.employers) {
      for (const col of OLD_COLUMNS) expect(row, `${row.company_token} carries ${col}`).not.toHaveProperty(col);
      for (const f of ["filled_roles_90d", "relisted_roles_90d", "median_days_to_fill", "median_note"]) {
        expect(row, `${row.company_token} prints ${f} the gate refuses`).not.toHaveProperty(f);
      }
      expect(row.gate?.counts).not.toBe("ok");
      expect(row.gate?.median).not.toBe("ok");
      expect(row.open_roles).toBe(603);
      expect(row.tracking_days).toBe(90);
    }
    for (const col of OLD_COLUMNS) expect(text).not.toContain(`"${col}"`);
    for (const n of REFUSED_FIGURES) expect(text, `the refused figure ${n} is printed`).not.toMatch(new RegExp(`[:\\[,]${String(n).replace(".", "\\.")}[,}\\]]`));
  });

  it("a board the gate admits prints its role counts and its median in whole days, under the site's names", async () => {
    answer(["stripe"], [STRIPE]);
    const { body } = await record(["stripe"]);
    const row = body.employers[0];
    expect(row).toMatchObject({ filled_roles_90d: 160, relisted_roles_90d: 52, median_days_to_fill: 10, gate: { counts: "ok", median: "ok", sentence: null } });
    for (const col of OLD_COLUMNS) expect(row).not.toHaveProperty(col);
  });
});

describe("2 and 8. a token two hiring systems share gets the site's refusal on both tools, and no filing", () => {
  it("the list says the token is shared, so the test exercises a real row", () => {
    expect(collidedBoards(SHARED)?.length).toBeGreaterThanOrEqual(2);
  });

  it("employer_hiring_record answers unknown with the site's refusal, no figure and no filing", async () => {
    answer([SHARED], [{ ...STRIPE, company_token: SHARED }]);
    mcp.answers.get_employer_layoff_filings = { data: [{ lf_company_token: SHARED, lf_source: "state_warn", lf_filer: "Clear Co" }], error: null };
    const { text, body } = await record([SHARED]);
    const row = body.employers[0];
    expect(row).toMatchObject({ company_token: SHARED, record: "unknown", unknown_reason: "shared_token", note: SHARED_TOKEN_COPY, layoff_filing: null });
    expect(row).not.toHaveProperty("open_roles");
    expect(row).not.toHaveProperty("filled_roles_90d");
    expect(text).not.toContain("Clear Co");
    expect((row.boards as unknown[]).length).toBe(collidedBoards(SHARED)!.length);
    // The fill curve is never read for it.
    expect(mcp.rpcs.filter((r) => r.name === "get_company_fill_curve")).toHaveLength(0);
  });

  it("employer_growth answers unknown with the same refusal, never the reading", async () => {
    mcp.answers.get_company_growth = { data: [{ company_token: SHARED, verdict: "grew", unknown_reason: null, net: 41, rate: 0.5 }], error: null };
    const out = await mcp.call({ companyTokens: [SHARED] }, { name: "employer_growth" });
    expect(out.isError, out.text).toBe(false);
    const row = (JSON.parse(out.text) as { employers: Row[] }).employers[0];
    expect(row).toMatchObject({ company_token: SHARED, verdict: "unknown", unknown_reason: "shared_token", note: SHARED_TOKEN_COPY });
    expect(out.text).not.toMatch(/"grew"/);
    expect(out.text).not.toMatch(/"net":41/);
  });

  it("the refusal opens with the site's own sentence", () => {
    const first = EN.jobsPage.collision.body.split(". ")[0] + ".";
    expect(first.length).toBeGreaterThan(40);
    expect(SHARED_TOKEN_COPY.startsWith(first)).toBe(true);
  });
});

describe("3. a fill-curve read that fails closes the record", () => {
  it("an error from the reader prints the gate's unread sentence and no counts", async () => {
    answer(["stripe"], null, "canceling statement due to statement timeout");
    const { text, body } = await record(["stripe"]);
    const row = body.employers[0];
    expect(row.gate).toEqual({ counts: "unread", median: "unread", sentence: HIRING_RECORD_GATE_COPY.unread });
    expect(row).not.toHaveProperty("filled_roles_90d");
    expect(text).not.toMatch(/statement timeout/);
  });

  it("a token the reader did not answer is unread the same way, never a zero", async () => {
    answer(["stripe", "notion"], [STRIPE]);
    mcp.answers.get_company_hiring_health = { data: [health("stripe"), health("notion")], error: null };
    const { body } = await record(["stripe", "notion"]);
    expect(body.employers[0]).toHaveProperty("filled_roles_90d", 160);
    expect(body.employers[1].gate).toEqual({ counts: "unread", median: "unread", sentence: HIRING_RECORD_GATE_COPY.unread });
    expect(body.employers[1]).not.toHaveProperty("filled_roles_90d");
  });
});

describe("4. every sentence printed is the gate's own, filled as the site fills it", () => {
  it("each refused row's sentence equals fillGateCopy(HIRING_RECORD_GATE_COPY[key]) for its keys", async () => {
    const young = { ...STRIPE, company_token: "young", tracking_days: 14 };
    const curves = [...Object.values(CURVES), young];
    const tokens = curves.map((c) => c.company_token);
    answer(tokens, curves);
    const { body } = await record(tokens);
    for (const row of body.employers) {
      const curve = curves.find((c) => c.company_token === row.company_token)!;
      const want = siteSentence(curve);
      expect(want, `${row.company_token} is refused something`).toBeTruthy();
      expect(row.gate?.sentence, row.company_token as string).toBe(want);
    }
    // The young board's sentence carries its own figures.
    expect(body.employers.find((r) => r.company_token === "young")?.gate?.sentence).toMatch(/watched this board for 14 days[\s\S]*at least 21 days/);
  });
});

describe("5. layoff_read never carries the database's words (NB-28)", () => {
  it("a reader error is named as unavailable, the record is intact, and no Postgres text reaches the caller", async () => {
    answer(["stripe"], [STRIPE]);
    mcp.answers.get_employer_layoff_filings = { data: null, error: { message: 'ERROR: relation "public.employer_layoff_filings" does not exist' } };
    const { text, body } = await record(["stripe"]);
    expect(body.layoff_read).toBe("unread: filing reader unavailable");
    expect(text).not.toMatch(/ERROR:|relation|does not exist|employer_layoff_filings/);
    expect(body.employers[0]).toMatchObject({ filled_roles_90d: 160, layoff_filing: null });
  });
});

describe("7. a censored median prints the site's sentence, never a number", () => {
  const censored = {
    ...STRIPE, company_token: "slowco", median_censored: true, median_days_to_fill: 30, sufficient_30: true, still_open_30_lo: 0.62,
  };
  it("where the thirty-day share bounds it, the site's censored sentence and no median_days_to_fill", async () => {
    answer(["slowco"], [censored]);
    const { body } = await record(["slowco"]);
    const row = body.employers[0];
    expect(row).not.toHaveProperty("median_days_to_fill");
    expect(row.median_note).toBe(fillGateCopy(MEDIAN_CENSORED_COPY, { d: FILL_SUPPORT_DAYS }));
    expect(row.gate?.median).toBe("ok");
  });

  it("where it does not, neither the sentence nor a number", async () => {
    answer(["slowco"], [{ ...censored, still_open_30_lo: 0.41 }]);
    const { body } = await record(["slowco"]);
    const row = body.employers[0];
    expect(row).not.toHaveProperty("median_days_to_fill");
    expect(row).not.toHaveProperty("median_note");
    expect(row.gate?.median).not.toBe("ok");
  });

  it("the sentence and its day count are the site's", () => {
    expect(MEDIAN_CENSORED_COPY).toBe(EN.jobsPage.hhMedianCensored);
    const jobs = readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8");
    expect(Number(/export const FILL_SUPPORT_MAX_DAYS = (\d+);/.exec(jobs)?.[1])).toBe(FILL_SUPPORT_DAYS);
  });
});

describe("S14X-135. an 8-K's workforce flag is carried as the reader answers it", () => {
  const filing = (workforce: unknown) => ({
    lf_company_token: "stripe", lf_source: "sec_8k_205", lf_relation: "filer", lf_filer: "Stripe, Inc.", lf_event_date: "2026-11-01",
    lf_event_basis: "sec_report_date", lf_public_date: "2026-11-03", lf_public_basis: "sec_filed", lf_state: null, lf_site: null,
    lf_workers: null, lf_event_type: null, lf_effective_date: null, lf_pct: null, lf_headcount: null, lf_form: "8-K",
    lf_workforce: workforce, lf_source_url: "https://www.sec.gov/x", lf_source_name: "SEC EDGAR", lf_read_at: "2026-11-03T10:00:00Z", lf_more_n: 0,
  });
  it.each([[true, true], [false, false], [null, null]])("lf_workforce %s is workforce %s", async (given, want) => {
    answer(["stripe"], [STRIPE]);
    mcp.answers.get_employer_layoff_filings = { data: [filing(given)], error: null };
    const { body } = await record(["stripe"]);
    expect((body.employers[0].layoff_filing as Record<string, unknown>).workforce).toBe(want);
  });
});
