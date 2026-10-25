/**
 * THE ZERO PAGE SAYS ONLY WHAT ITS INPUTS AGREE ON
 * (profiles+design hotfix: verify triage 2026-10-24 blocker 2, its fix round,
 * and the recheck of 2026-10-25).
 *
 * The history, each step found false on a live page:
 *   - 2026-10-18 (live): "We have not read BASS ABA Therapy's whole board
 *     recently" on every zero page with no stated total, although the board
 *     is read in full every lap (BASS ABA: full_read, 89 tracking days).
 *   - the hotfix: "As of our latest full read, no role on this board is
 *     dated in the last 30 days" for a read in full, and "None of the 3 roles
 *     ... is dated in the last 30 days (read DATE)" for a fresh total. The
 *     review found Delaney at the Green (an Oracle sub-site whose three
 *     requisitions, dated this month, a sibling site serves) printing the
 *     second. The fix round kept the first for a stale total, and the recheck
 *     showed Delaney's row reads that way 49 hours after its last stated
 *     total.
 *
 * So the rule is no longer patched from cases. THE CORPUS
 * (fixtures/zero-page-corpus-2026-10-25.json): every live company page whose
 * board served 0 open roles on 2026-10-25, 12,564 of the 44,379 catalogued
 * boards, with the inputs zeroReadingOf sees and each board's own public
 * feed read minutes later through job-board's own fetchBoard. Against it, at
 * 2e3bc5a1 the page printed a sentence the board's own feed contradicts on
 * 352 rows: "No roles dated in the last 30 days" on 342 boards whose feeds
 * date roles this month (330 Oracle sub-sites, most served under a sibling
 * site), "None of the N roles ..." on 7 (four Workday sites whose roles a
 * sibling holds, three ADP boards), and "As of our latest full read ..." on 3
 * (two Breezy boards, one Paylocity) whose inputs match 10,248 true rows
 * exactly. Read 49 hours later with the same inputs, 2e3bc5a1 prints the
 * full-read sentence falsely on 328 rows.
 *
 * THE TABLE (a zero page: the list answered, it lists nothing, no visitor
 * filter). "fact" is boardTotalFact: a complete read (state ok or empty)
 * that stated a total, no older than 48 hours, uncapped.
 *
 *   curve answered? | stated total             | bucket                     | reading | sentence
 *   no, or no cols  | -                        | -                          | null    | "No roles are listed on this page right now."
 *   yes             | fact, 0, state empty     | any                        | empty   | "No roles on X's job board when we read it AGO."
 *   yes             | fact above 0, any state  | any                        | null    | the page's own line (the board and the page disagree)
 *   yes             | stale, capped, unknown   | any                        | null    | the page's own line
 *   yes             | none                     | null, tracking >= 1        | unread  | "We have not read X's whole board recently."
 *   yes             | none                     | full_read, lap_proven,     | null    | the page's own line (the page cannot see the
 *                   |                          | lap_pending, unprovable,   |         | vendor, and a read in full was contradicted
 *                   |                          | unobserved, null with 0,   |         | by its own feed on rows like the true ones)
 *                   |                          | unknown, absent            |         |
 *
 * KNOWN EDGES (round 3 review, 2026-10-25), each named rather than patched:
 *   - a windowed bucket (lap_pending, unprovable) is the newest visit's alone.
 *     For the vendors whose complete reads leave no stated total (job-board's
 *     DERIVED_FEED_TOTAL_SOURCES: Rippling, JazzHR, Teamtailor), one windowed
 *     visit after a complete read reads exactly like no complete read, and a
 *     zero page has no rows to name its vendor by. So the windowed buckets now
 *     say the page's own line; the two corpus rows that said "not read" from
 *     them (a UKG board read 600 of 1,046, an ADP board 300 of 433) were true,
 *     and lose a true sentence, not gain a false one.
 *   - a board re-catalogued with old postings reads bucket null with tracking
 *     days for up to 30 minutes after its first read (until the closure
 *     refresh classifies it), and says "not read" in that window. No corpus
 *     row has that shape; it is kept, since the arm is true on all 23 rows.
 *
 * THE WATCH PROMISE ("Watch this board and your account will count its new
 * postings when they appear", and the toast's "We'll email you when they post
 * new roles"). A watch is a saved search on this token, so it counts only
 * postings stored under it. On the 332 corpus rows whose in-window roles a
 * sibling site serves (326 Oracle, 304 with a stated total and 22 lap-proven
 * with none; and, matched by base id since round 4, 6 Workday rows listing
 * copies of a sibling's requisitions, all with a stated total), it counts
 * nothing, ever. It is made only where the inputs agree with it (lander-model's
 * watchPromiseOf): no stated total, the newest observed day a complete read,
 * and a token neither dedupe can empty (an Oracle site, or a Workday site of a
 * tenant with another catalogued site). 10,178 rows; the round 4 cases are in
 * pd-hotfix-a-watch-on-a-workday-site-whose-tenant-has-another-promises-nothing.test.tsx.
 *
 * THE HEAD. Every zero page's title and description said the employer had
 * open roles ("{X} jobs: open roles from their own hiring system", "Browse
 * {X}'s open roles dated in the last 30 days"). zeroPageHead names none.
 *
 * The page's own line is true of every zero page and says nothing about the
 * employer's board; it carries no read time, since "board read 5 min ago"
 * beside it reads as what that read found. The fullRead sentence's missing
 * read time (a review minor) goes with the sentence.
 *
 * The page's own mapping from the curve row (src/pages/Jobs.tsx, the
 * lander's boardTotal input) is read out of the source and run on every
 * corpus row, so a merge that drops the bucket from it fails here.
 */
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { COMPANY_SHARD_LOCALES, companyShard, loadCompanyShard } from "./helpers/company-shard";
import { buildLanderModel, watchPromiseOf, zeroReadingOf, type BoardTotalInput, type LanderInput } from "@/lib/company/lander-model";
import { WORKDAY_MULTI_SITE_TENANTS } from "@/lib/company/workday-multi-site-tenants";
import { CompanyHeader, zeroAnswer, zeroPageHead } from "@/components/jobs/company/CompanyHeader";
import { CompanyEmptyState } from "@/components/jobs/company/CompanyEmptyState";

const ROOT = resolve(__dirname, "../..");
const JOBS = readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8");
/** The lander's boardTotal input as Jobs.tsx writes it, from the curve row. */
const MAPPING = /boardTotal: curveAnsweredAt === null \? undefined : hiringCurve\s*\?\s*(\{[^{}]*\})\s*:\s*null,/;
const pageMapping = (src: string) => {
  const m = MAPPING.exec(src);
  if (!m) throw new Error("the lander's boardTotal input moved: RE-ANCHOR this test on it");
  return new Function("hiringCurve", `return (${m[1]});`) as (row: unknown) => BoardTotalInput;
};
const fromRow = pageMapping(JOBS);

// ── the corpus ─────────────────────────────────────────────────────────────
type CorpusRow = [token: string, vendor: string, bucket: string | null, tracking: number | null, total: number | null, readAt: string | null,
  state: string | null, capped: boolean | null, feed: string, inWindow: number | null, siblingServed: number | null];
type Edge = { name: string; vendor: string; inputs: Record<string, unknown>; truth: string; must_not?: string; known_edge?: boolean };
const CORPUS = JSON.parse(readFileSync(resolve(__dirname, "fixtures/zero-page-corpus-2026-10-25.json"), "utf8")) as {
  at: string; columns: string[]; rows: CorpusRow[]; wrong_2e3bc5a1: Record<string, [reading: string | null, why: string]>;
  round3: { watch_named: Record<string, string>; edges: Edge[] };
};
const CORPUS_AT = Date.parse(CORPUS.at);
/** A corpus row as get_company_fill_curve answered it (the columns the page reads). */
const curveRow = (r: CorpusRow) => ({
  company_token: r[0], open_roles: 0, observability_bucket: r[2], tracking_days: r[3],
  feed_total: r[4], feed_read_at: r[5], feed_state: r[6], feed_capped: r[7],
});
const rowOf = (token: string) => {
  const r = CORPUS.rows.find((x) => x[0] === token);
  if (!r) throw new Error(`${token} is not in the corpus`);
  return r;
};

const t = i18n.t.bind(i18n);
const input = (o: Partial<LanderInput> = {}): LanderInput => ({
  token: "bassabatherapy", storedName: "BASS ABA Therapy", bakedName: null, cachedName: null,
  listTotal: 0, listFloor: false, feedTotal: 0, feedFloor: false, feedAsOf: null,
  boardReadAt: null, source: null, agency: false, collision: null, isUsajobs: false,
  loading: false, error: false, budgetRefusal: false, gated: { verdict: "unknown", withheld: null },
  verdict: "unknown", growth: "unknown", layoffRows: 0, visitorFilters: [], now: CORPUS_AT, ...o,
});
const zeroPage = (row: unknown, o: Partial<LanderInput> = {}) => buildLanderModel(input({ boardTotal: fromRow(row), ...o }));
const OWN_LINE = "No roles are listed on this page right now.";
const UNREAD_EN = "We have not read BASS ABA Therapy's whole board recently.";
/** The sentences the corpus refuted, in any form. */
const REFUTED = /None of the \d|is not dated in the last|As of our latest full read|No roles dated in the last|We show roles dated|board read/;
const NOT_READ = /not read|have not read/i;
/** What our own reads say: no observation in seven days on a tracked board, and no stated total. */
const ourReadsSayUnread = (r: CorpusRow) => r[4] === null && r[2] === null && (r[3] ?? 0) >= 1;
/** The token is a site a dedupe can empty: an Oracle site, or a Workday site of a tenant with another catalogued site (round 4). */
const dedupedSite = (r: CorpusRow) => r[1] === "oracle" || (r[1] === "workday" && WORKDAY_MULTI_SITE_TENANTS.has(r[0].split("~")[0]));
/** The rows whose roles in the window a sibling site serves (a Workday copy by its base id, round 4): a watch on this token counts nothing there. */
const siblingHolds = (r: CorpusRow) => (r[10] ?? 0) > 0;
const WATCH_BODY = "Watch this board and your account will count its new postings when they appear.";

beforeAll(() => { loadCompanyShard(); });

describe("the corpus: every live zero page of 2026-10-25", () => {
  it("is whole: 12,564 zero pages, each with its inputs and its board's own feed", () => {
    expect(CORPUS.columns).toEqual(["token", "vendor", "observability_bucket", "tracking_days", "feed_total", "feed_read_at", "feed_state", "feed_capped", "feed", "in_window", "sibling_served"]);
    expect(CORPUS.rows.length).toBe(12564);
    expect(new Set(CORPUS.rows.map((r) => r[0])).size).toBe(12564);
    expect(CORPUS.rows.filter((r) => r[8] === "ok").length, "feeds read").toBe(11857);
    expect(Object.keys(CORPUS.wrong_2e3bc5a1).length, "rows 2e3bc5a1 got wrong").toBe(352);
  });

  it("on every row the page says only its own line, or 'not read' exactly where our own reads say so", () => {
    const tally: Record<string, number> = {};
    for (const r of CORPUS.rows) {
      const m = zeroPage(curveRow(r), { token: r[0], storedName: "BASS ABA Therapy" });
      expect(m.variant, r[0]).toBe("zero");
      const reading = m.zeroReading ?? "own";
      tally[reading] = (tally[reading] ?? 0) + 1;
      if (m.zeroReading === "unread") expect(ourReadsSayUnread(r), `${r[0]}: "not read" on a board our reads say we read`).toBe(true);
      else expect(m.zeroReading, `${r[0]}: a sentence about what a read found`).toBeNull();
      if (ourReadsSayUnread(r)) expect(m.zeroReading, r[0]).toBe("unread");
    }
    expect(tally).toEqual({ own: 12541, unread: 23 });
  });

  it("no row the page can show prints a sentence the corpus refuted, and the 352 rows 2e3bc5a1 got wrong print the page's own line", () => {
    for (const r of CORPUS.rows) {
      const line = zeroAnswer(t, zeroPage(curveRow(r), { token: r[0] }), "en");
      expect(line, r[0]).not.toMatch(REFUTED);
      if (r[0] in CORPUS.wrong_2e3bc5a1) expect(line, `${r[0]} (${CORPUS.wrong_2e3bc5a1[r[0]][1]})`).toBe(OWN_LINE);
    }
  });

  it("the same inputs read 49 hours later (the recheck's ingest gap) still print nothing a read found", () => {
    const later = CORPUS_AT + 49 * 3_600_000;
    for (const r of CORPUS.rows) {
      const m = zeroPage(curveRow(r), { token: r[0], now: later });
      expect(m.zeroReading === null || (m.zeroReading === "unread" && ourReadsSayUnread(r)), r[0]).toBe(true);
    }
  });

  it("the rows 2e3bc5a1 got wrong are the shapes the review and the recheck named, and more", () => {
    const wrong = CORPUS.wrong_2e3bc5a1;
    const by = (reading: string | null) => Object.values(wrong).filter(([x]) => x === reading).length;
    expect({ list: by(null), older: by("older"), fullRead: by("fullRead") }).toEqual({ list: 342, older: 7, fullRead: 3 });
    // Delaney at the Green: three requisitions dated this month on its own Oracle feed, served under a sibling site.
    expect(wrong["eexs~us2~CX_19005"]?.[1]).toMatch(/the feed carries 3 role\(s\) dated in the last 30 days .*served under a sibling site/);
    // A Workday site that stated 5 at a read in state empty while two of its roles were posted 5 and 12 days earlier.
    expect(wrong["akumincorp~wd5~adgcareers"]).toEqual(["older", expect.stringMatching(/the feed carries 2 role\(s\) dated in the last 30 days/)]);
    // A Breezy board read in full with no total, whose feed dates a role 29 days before the corpus.
    expect(wrong["sabanto"]?.[0]).toBe("fullRead");
  });
});

describe("the named boards", () => {
  it("BASS ABA (Greenhouse, full_read, no stated total) says only the page's own line, never 'not read'", () => {
    const r = rowOf("bassabatherapy");
    expect(fromRow(curveRow(r))).toEqual({ total: null, readAt: null, state: null, capped: null, bucket: "full_read", trackingDays: r[3] });
    const m = zeroPage(curveRow(r));
    expect(m.zeroReading).toBeNull();
    expect(zeroAnswer(t, m, "en")).toBe(OWN_LINE);
  });

  it("Delaney at the Green (an Oracle sub-site, 3 stated in state ok, all 3 dated this month) says only the page's own line, fresh or 49 hours stale", () => {
    const r = rowOf("eexs~us2~CX_19005");
    expect([r[4], r[6], r[9]]).toEqual([3, "ok", 3]);
    const fresh = zeroPage(curveRow(r), { token: r[0], storedName: "Delaney at the Green" });
    expect(fresh.boardTotal, "the total is still a fact the model holds").toEqual({ total: 3, readAt: r[5] });
    expect(fresh.zeroReading).toBeNull();
    expect(zeroAnswer(t, fresh, "en")).toBe(OWN_LINE);
    const stale = zeroPage(curveRow(r), { token: r[0], storedName: "Delaney at the Green", now: Date.parse(r[5]!) + 49 * 3_600_000 });
    expect(stale.zeroReading, "the recheck's case: no full-read sentence once the total is stale").toBeNull();
    expect(zeroAnswer(t, stale, "en")).toBe(OWN_LINE);
  });

  it("a Workday site that stated 5 at a read in state empty, and Centurylink1 that stated 43, read alike: the inputs cannot tell them apart", () => {
    const akumin = rowOf("akumincorp~wd5~adgcareers");
    const century = rowOf("Centurylink1");
    expect([akumin[6], century[6]]).toEqual(["empty", "empty"]);
    expect([akumin[9], century[9]], "roles dated in the window on each board's own feed").toEqual([2, 0]);
    for (const r of [akumin, century]) expect(zeroPage(curveRow(r), { token: r[0] }).zeroReading, r[0]).toBeNull();
  });

  it("hdrc (a stale total of 1 in state ok under a newer read) and the whole-feed zero boards say the page's own line", () => {
    for (const tok of ["hdrc~ca3~CX_1", "acds", "tilt", "northern", "cotenyc", "Bilue"]) {
      expect(zeroAnswer(t, zeroPage(curveRow(rowOf(tok)), { token: tok }), "en"), tok).toBe(OWN_LINE);
    }
  });
});

describe("the watch promise (round 3): made only where a watch on this token can count the board's new postings", () => {
  it("on no corpus row whose roles a sibling site holds, on no row with a stated total, and on every row the inputs allow: 10,178 of 12,564", () => {
    const tally = { promise: 0, siblingRows: 0, siblingNoTotal: 0 };
    for (const r of CORPUS.rows) {
      const m = zeroPage(curveRow(r), { token: r[0] });
      if (siblingHolds(r)) {
        tally.siblingRows++;
        if (r[4] === null) tally.siblingNoTotal++;
        expect(m.watchPromise, `${r[0]}: its roles are served under a sibling site, so a watch here counts nothing`).toBe(false);
      }
      if (r[4] !== null) expect(m.watchPromise, `${r[0]}: the board states ${r[4]} roles this page does not list`).toBe(false);
      if (m.watchPromise) {
        tally.promise++;
        expect([r[4], r[2], dedupedSite(r), siblingHolds(r)], r[0]).toEqual([null, "full_read", false, false]);
      }
      expect(m.watchPromise, r[0]).toBe(r[4] === null && r[2] === "full_read" && !dedupedSite(r));
    }
    expect(tally).toEqual({ promise: 10178, siblingRows: 332, siblingNoTotal: 22 });
  });

  it("the boards the review checked live, each with the sibling site that holds its roles, promise nothing", () => {
    const named = Object.entries(CORPUS.round3.watch_named);
    expect(named.length).toBe(14);
    for (const [tok, holder] of named) {
      const r = rowOf(tok);
      expect(siblingHolds(r), `${tok}: the corpus serves its roles under a sibling (the review: ${holder})`).toBe(true);
      expect(zeroPage(curveRow(r), { token: tok }).watchPromise, tok).toBe(false);
    }
  });

  it("the 22 lap-proven sub-sites with no stated total promise nothing: the token is a site the sub-site dedupe empties", () => {
    const rows = CORPUS.rows.filter((r) => siblingHolds(r) && r[4] === null);
    expect(rows.length).toBe(22);
    for (const r of rows) {
      expect(r[2], r[0]).toBe("lap_proven");
      expect(watchPromiseOf({ boardTotal: fromRow(curveRow(r)), token: r[0] }), r[0]).toBe(false);
    }
  });

  it("nothing is promised before the curve answers, on a reader without its columns, or where our newest read was not whole", () => {
    const bass = curveRow(rowOf("bassabatherapy"));
    expect(watchPromiseOf({ boardTotal: fromRow(bass), token: "bassabatherapy" }), "the positive control").toBe(true);
    expect(watchPromiseOf({ boardTotal: undefined, token: "bassabatherapy" })).toBe(false);
    expect(watchPromiseOf({ boardTotal: null, token: "bassabatherapy" })).toBe(false);
    for (const b of ["unobserved", "lap_pending", "unprovable", "lap_proven", null]) {
      expect(watchPromiseOf({ boardTotal: fromRow({ ...bass, observability_bucket: b, tracking_days: 89 }), token: "bassabatherapy" }), String(b)).toBe(false);
    }
    // Off the zero page the promise is the page's, unchanged.
    expect(buildLanderModel(input({ listTotal: 12, boardTotal: fromRow(curveRow(rowOf("eexs~us2~CX_19005"))) })).watchPromise).toBe(true);
  });

  it("the empty column prints the promise on BASS ABA and not on Delaney at the Green, in English, German and Spanish", async () => {
    const delaney = curveRow(rowOf("eexs~us2~CX_19005"));
    const bass = curveRow(rowOf("bassabatherapy"));
    const col = (row: ReturnType<typeof curveRow>, name: string) => {
      const { container, unmount } = render(<MemoryRouter><CompanyEmptyState model={zeroPage(row, { token: row.company_token, storedName: name })} token={row.company_token} boardReadAt={null} underHeader /></MemoryRouter>);
      const text = container.textContent ?? "";
      unmount();
      return text;
    };
    expect(col(bass, "BASS ABA Therapy")).toContain(WATCH_BODY);
    expect(col(delaney, "Delaney at the Green")).not.toContain(WATCH_BODY);
    for (const [lng, body] of [["de", "Beobachten Sie dieses Jobboard"], ["es", "Sigue este portal"]] as const) {
      await i18n.changeLanguage(lng);
      try {
        expect(col(bass, "BASS ABA Therapy"), lng).toContain(body);
        expect(col(delaney, "Delaney at the Green"), lng).not.toContain(body);
      } finally {
        await i18n.changeLanguage("en");
      }
    }
  });

  it("the page's watch toast drops its emailing sentence where the model withholds the promise (src/pages/Jobs.tsx)", () => {
    expect(JOBS).toMatch(/const watchCompany = async \(promise = true\) =>/);
    expect(JOBS).toMatch(/\.\.\.\(promise \? \{ description: t\("jobsPage\.watchSavedDescAlert"/);
    expect(JOBS).toMatch(/onWatch=\{\(\) => \{ void watchCompany\(landerModel\.watchPromise\); \}\}/);
  });
});

describe("the edges the round 3 review named", () => {
  it("each edge's inputs: a windowed visit after a complete read says the page's own line; the re-catalogue window is the one known edge", () => {
    for (const e of CORPUS.round3.edges) {
      const row = { company_token: `edge-${e.vendor}`, open_roles: 0, ...e.inputs };
      const line = zeroAnswer(t, zeroPage(row, { token: row.company_token }), "en");
      if (e.known_edge) expect(line, e.name).toBe(UNREAD_EN);
      else expect(line, e.name).toBe(OWN_LINE);
    }
  });
});

describe("the head (round 3): a zero page's title and description name no open roles", () => {
  const CLAIMS = /open roles|offenen Stellen|Live jobs|dated in the last|\bBrowse /;
  it("on every corpus row, named, generic or nameless, the title names no open roles and the description is the page's own line", () => {
    for (const r of CORPUS.rows) {
      for (const storedName of ["Delaney at the Green", "Corporate", null]) {
        const m = zeroPage(curveRow(r), { token: r[0], storedName });
        expect(m.variant).toBe("zero");
        const head = zeroPageHead(t, m, r[0]);
        expect(head.title, r[0]).not.toMatch(CLAIMS);
        expect(head.description, r[0]).not.toMatch(CLAIMS);
        expect(head.description, r[0]).toMatch(/no roles are listed on this page right now\.$/i);
      }
    }
    const named = zeroPageHead(t, zeroPage(curveRow(rowOf("eexs~us2~CX_19005")), { storedName: "Delaney at the Green" }), "eexs~us2~CX_19005");
    expect(named).toEqual({ title: "Delaney at the Green jobs", description: "Delaney at the Green: no roles are listed on this page right now." });
    expect(zeroPageHead(t, zeroPage(curveRow(rowOf("bassabatherapy")), { storedName: null }), "10kbi")).toEqual({ title: "Roles on the “10kbi” board", description: OWN_LINE });
  });

  it("in German and Spanish too", async () => {
    const m = zeroPage(curveRow(rowOf("eexs~us2~CX_19005")), { storedName: "Delaney at the Green" });
    for (const [lng, title, desc] of [["de", "Jobs bei Delaney at the Green", "Delaney at the Green: Auf dieser Seite sind gerade keine Stellen aufgeführt."], ["es", "Empleos en Delaney at the Green", "Delaney at the Green: ahora mismo no hay ninguna vacante en esta página."]] as const) {
      await i18n.changeLanguage(lng);
      try {
        expect(zeroPageHead(i18n.t.bind(i18n), m, "x"), lng).toEqual({ title, description: desc });
      } finally {
        await i18n.changeLanguage("en");
      }
    }
  });

  it("the page routes the zero variant to zeroPageHead ahead of the employer's head, and its live region says the page's own line", () => {
    // From landerSeo to the <SEO> it feeds; the employer's head is either the inline
    // jobsPage.companySeoTitle or seo/react's companyBoardHead builder (its last call).
    const from = JOBS.indexOf("const landerSeo");
    const seo = JOBS.slice(from, JOBS.indexOf("<SEO", from));
    const employerAt = Math.max(seo.indexOf("jobsPage.companySeoTitle"), seo.lastIndexOf("companyBoardHead("));
    expect(from, "landerSeo moved: RE-ANCHOR").toBeGreaterThan(0);
    expect(employerAt, "the employer's head moved: RE-ANCHOR").toBeGreaterThan(0);
    expect(seo).toMatch(/landerModel\.variant === "zero"\s*\?\s*zeroPageHead\(t, landerModel, landerCompany\)/);
    expect(seo.indexOf("zeroPageHead(")).toBeLessThan(employerAt);
    expect(JOBS).toMatch(/const a11yEmpty = landerModel\?\.variant === "zero"\s*\?\s*t\("companyProfile\.zero\.answer", "No roles are listed on this page right now\."\)\s*:\s*t\("jobsPage\.a11yNoResults"/);
    const live = JOBS.slice(JOBS.indexOf('role="status" aria-live="polite"'), JOBS.indexOf('t("jobsPage.a11yResults"'));
    expect(live, "the live region moved: RE-ANCHOR").toContain("a11yError");
    expect(live).toMatch(/: shownCount === 0\s*\?\s*a11yEmpty\s*:/);
  });
});

describe("what may still be said", () => {
  const BASS = curveRow(rowOf("bassabatherapy"));
  const hoursAgo = (h: number) => new Date(CORPUS_AT - h * 3_600_000).toISOString();

  it("'not read' where our own reads show no complete read and no total: no observation in seven days on a tracked board", () => {
    expect(zeroAnswer(t, zeroPage({ ...BASS, observability_bucket: null, tracking_days: 89 }), "en")).toBe(UNREAD_EN);
    expect(zeroAnswer(t, zeroPage({ ...BASS, observability_bucket: null, tracking_days: 89 }, { storedName: "Corporate" }), "en")).toBe("We have not read this whole board recently.");
  });

  it("a windowed bucket says the page's own line: one windowed visit after a complete read reads the same on a vendor that states no total (round 3)", () => {
    // A Teamtailor board read whole a day ago, then windowed once: job-board writes no feed_total for it, and the bucket is the newest visit's.
    for (const b of ["lap_pending", "unprovable"]) expect(zeroAnswer(t, zeroPage({ ...BASS, observability_bucket: b }), "en"), b).toBe(OWN_LINE);
    for (const tok of ["a232a7a1-770b-48a0-b05a-65d403177066~9201585048116_2", "recruiting~RED1001RMI~fa9d032b-b0dd-4c99-8ebe-c09d9352c68c"]) {
      const r = rowOf(tok);
      expect(r[2], tok).toBe("unprovable");
      expect(zeroPage(curveRow(r), { token: tok }).zeroReading, tok).toBeNull();
    }
  });

  it("never 'not read' beside a stated total, on a board read in full or through a lap, or on one too new to classify", () => {
    const stated = { feed_total: 31, feed_read_at: hoursAgo(80), feed_state: "ok", feed_capped: false };
    for (const row of [
      { ...BASS, observability_bucket: "lap_pending", ...stated },
      { ...BASS, observability_bucket: null, tracking_days: 89, ...stated },
      { ...BASS, observability_bucket: "full_read" },
      { ...BASS, observability_bucket: "lap_proven" },
      { ...BASS, observability_bucket: "lap_pending" },
      { ...BASS, observability_bucket: "unprovable" },
      { ...BASS, observability_bucket: "unobserved" },
      { ...BASS, observability_bucket: null, tracking_days: 0 },
      { ...BASS, observability_bucket: "a_bucket_this_build_does_not_know" },
    ]) {
      const line = zeroAnswer(t, zeroPage(row), "en");
      expect(line, JSON.stringify(row).slice(0, 160)).toBe(OWN_LINE);
    }
    expect(zeroReadingOf({ boardTotal: null, now: CORPUS_AT }), "a reader without the columns").toBeNull();
    expect(zeroReadingOf({ boardTotal: undefined }), "the curve not answered yet").toBeNull();
    expect(zeroReadingOf({ boardTotal: { total: null, readAt: null, state: null, capped: null }, now: CORPUS_AT }), "a reader without the bucket").toBeNull();
  });

  it("'empty' only where the board itself stated none at a fresh complete read", () => {
    // The read time prints relative to the real clock, so this row is dated from it.
    const m = zeroPage({ ...BASS, feed_total: 0, feed_read_at: new Date(Date.now() - 5 * 3_600_000).toISOString(), feed_state: "empty", feed_capped: false }, { now: Date.now() });
    expect(m.zeroReading).toBe("empty");
    expect(zeroAnswer(t, m, "en")).toBe("No roles on BASS ABA Therapy's job board when we read it 5 hr ago.");
    expect(zeroPage({ ...BASS, feed_total: 0, feed_read_at: hoursAgo(5), feed_state: "ok", feed_capped: false }).zeroReading).toBeNull();
    expect(zeroPage({ ...BASS, feed_total: 0, feed_read_at: hoursAgo(50), feed_state: "empty", feed_capped: false }).zeroReading).toBeNull();
  });
});

describe("the rendered page", () => {
  const DELANEY = curveRow(rowOf("eexs~us2~CX_19005"));
  const model = () => zeroPage(DELANEY, { token: DELANEY.company_token, storedName: "Delaney at the Green" });

  it("the header says the page's own line, with no read time and nothing a read found", () => {
    const { container } = render(<MemoryRouter><CompanyHeader model={model()} token={DELANEY.company_token} system={null} boardReadAt={new Date(CORPUS_AT - 300_000).toISOString()} onWatch={() => {}} /></MemoryRouter>);
    expect(container.querySelector("[data-company-answer]")?.textContent).toBe(OWN_LINE);
    expect(container.textContent ?? "").not.toMatch(REFUTED);
    expect(container.textContent ?? "").not.toMatch(NOT_READ);
  });

  it("the empty column's heading is the same line, with no 'board read' under it", () => {
    const { container } = render(<MemoryRouter><CompanyEmptyState model={model()} token={DELANEY.company_token} boardReadAt={new Date(CORPUS_AT - 300_000).toISOString()} underHeader /></MemoryRouter>);
    expect(container.querySelector("#company-empty-title")?.textContent).toBe(OWN_LINE);
    expect(container.textContent ?? "").not.toMatch(REFUTED);
  });

  it("German says the page's own line too", async () => {
    await i18n.changeLanguage("de");
    try {
      expect(zeroAnswer(i18n.t.bind(i18n), model(), "de")).toBe("Auf dieser Seite sind gerade keine Stellen aufgeführt.");
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});

describe("the line in nine languages", () => {
  const zeroOf = (l: string) => ((companyShard(l) as { companyProfile: { zero: Record<string, string> } }).companyProfile.zero);
  it("every locale carries zero.answer, translated, with no placeholder, digit, name or banned word", () => {
    for (const l of COMPANY_SHARD_LOCALES) {
      const v = zeroOf(l).answer;
      expect(v, l).toBeTruthy();
      expect(v, `${l}: a placeholder`).not.toMatch(/\{\{/);
      expect(v, `${l}: a digit typed into copy`).not.toMatch(/\d/);
      expect(v, l).not.toMatch(/verified|verifiziert|verificad|vérifié|geverifieerd|सत्यापित|filled/i);
      if (!l.startsWith("en")) expect(v, `${l}: still English`).not.toBe(zeroOf("en").answer);
    }
  });

  it("no locale keeps a sentence nothing can print any more", () => {
    for (const l of COMPANY_SHARD_LOCALES) {
      const keys = Object.keys(zeroOf(l));
      for (const gone of ["older_one", "older_other", "older_many", "olderBoard_one", "olderBoard_other", "olderBoard_many", "basis", "fullRead", "title", "titleBoard"]) {
        expect(keys, `${l}: ${gone}`).not.toContain(gone);
      }
      expect(Object.keys((companyShard(l) as { companyProfile: Record<string, unknown> }).companyProfile), `${l}: boardReadAgo`).not.toContain("boardReadAgo");
    }
  });
});

describe("TEETH", () => {
  it("a page mapping that drops the bucket loses 'not read' where our reads show it", () => {
    const dropped = JOBS.replace(/, bucket: hiringCurve\.observability_bucket/, "");
    expect(dropped, "the teeth mutation did not apply: RE-ANCHOR it").not.toBe(JOBS);
    const row = { ...curveRow(rowOf("bassabatherapy")), observability_bucket: null, tracking_days: 89 };
    expect(buildLanderModel(input({ boardTotal: fromRow(row) })).zeroReading).toBe("unread");
    expect(buildLanderModel(input({ boardTotal: pageMapping(dropped)(row) })).zeroReading).toBeNull();
  });

  it("the rule at 2e3bc5a1, run on the corpus, prints a refuted sentence on rows the fix does not", () => {
    // 2e3bc5a1's zeroReadingOf, as it was: a fresh total in state empty is older, any other fresh total says
    // nothing, and otherwise full_read is fullRead and the lap and unobserved rules follow.
    const before = (bt: BoardTotalInput, now: number): string | null => {
      const fresh = typeof bt.total === "number" && bt.total >= 0 && !!bt.readAt && (bt.state === "ok" || bt.state === "empty") && bt.capped === false
        && now - Date.parse(bt.readAt) <= 48 * 3_600_000;
      if (fresh) return bt.state === "empty" ? (Number(bt.total) > 0 ? "older" : "empty") : null;
      if (bt.bucket === "full_read") return "fullRead";
      if (bt.bucket === "lap_pending" || bt.bucket === "unprovable") return "unread";
      if (bt.bucket === null) return Number(bt.trackingDays) >= 1 ? "unread" : null;
      return null;
    };
    let fullRead = 0, older = 0, agree = 0;
    for (const r of CORPUS.rows) {
      const bt = fromRow(curveRow(r));
      const b = before(bt, CORPUS_AT);
      if (b === "fullRead") fullRead++;
      if (b === "older") older++;
      if (r[0] in CORPUS.wrong_2e3bc5a1 && CORPUS.wrong_2e3bc5a1[r[0]][0] === b) agree++;
      expect(zeroReadingOf({ boardTotal: bt, now: CORPUS_AT }), r[0]).not.toBe(b === "fullRead" || b === "older" ? b : "__never__");
    }
    expect({ fullRead, older }).toEqual({ fullRead: 10255, older: 1196 });
    expect(agree, "the recorded readings are the rule's own").toBe(352);
  });
});
