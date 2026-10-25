/**
 * THE ZERO PAGE NEVER SAYS "NOT READ" OF A BOARD READ IN FULL
 * (profiles+design hotfix, verify triage 2026-10-24, blocker 2).
 *
 * The zero page printed companyProfile.zero.unread, "We have not read BASS
 * ABA Therapy's whole board recently", whenever the curve stated no board
 * total. The collector never states one for a feed it reads whole in one
 * visit, so the sentence was false on every zero page of those boards: BASS
 * ABA's live curve row on 2026-10-24 reads observability_bucket full_read,
 * tracking_days 89, open_roles 0, every feed column null, and the page told
 * readers we had not read it.
 *
 * THE TRUTH TABLE (a zero page: the list answered, nothing dated in the last
 * 30 days, no visitor filter). "fact" is boardTotalFact: a complete read
 * (state ok or empty) that stated a total, no older than 48 hours, uncapped.
 *
 *   curve answered? | fact             | bucket                  | tracking | reading  | sentence
 *   no              | -                | -                       | -        | null     | "No roles dated in the last 30 days" (the list's own)
 *   yes             | empty, total > 0 | any                     | any      | older    | "None of the N roles ... (read DATE)."
 *   yes             | empty, total = 0 | any                     | any      | empty    | "No roles on ... when we read it AGO."
 *   yes             | ok, any total    | any                     | any      | null     | the list's own (that read kept roles in our window
 *                   |                  |                         |          |          | that this page does not list)
 *   yes             | none             | full_read               | any      | fullRead | "As of our latest full read, no role on this board is dated in the last 30 days."
 *   yes             | none             | lap_pending, unprovable | any      | unread   | "We have not read ...'s whole board recently."
 *   yes             | none             | null (none in 7 days)   | >= 1     | unread   | same
 *   yes             | none             | null                    | 0 / none | null     | the list's own (too new to classify)
 *   yes             | none             | lap_proven, unobserved, | any      | null     | the list's own (a lap we cannot date; a failed newest
 *                   |                  | a bucket we don't know  |          |          | visit with a whole read possibly the day before)
 *   yes             | none             | absent (older reader)   | -        | unread   | the rule before the bucket, unchanged
 *
 * Why no read date on fullRead: the curve dates only a read that stated a
 * total (feed_read_at), and a whole-feed vendor states none, so there is no
 * date we may print; the sentence says "as of our latest full read" and
 * claims nothing about when. The vendor kind (whole feed or paged) is not an
 * input of its own: a paged board read to its end is full_read too, and a
 * windowed one is a lap bucket, so the bucket already says what kind of read
 * it was. A stale stated total on a full_read board is fullRead, never
 * "not read": the newer complete read may simply have stated nothing (an
 * emptied board writes no total).
 *
 * Why a fresh total from a read in state ok is not "older" (fix round,
 * 2026-10-24): job-board writes state ok only when the read kept at least one
 * role inside our 30-day window or undated (servedThisVisit, counted before
 * the Oracle sub-site dedupe moves a requisition to a better-ranked sibling
 * site), and empty only when it kept none. So on a zero page an ok read means
 * the board does carry roles in our window that this page does not list:
 * Delaney at the Green (eexs~us2~CX_19005, an Oracle career sub-site) stated
 * 3 on a read at 22:56Z, its own feed dates all three this month, and all
 * three are served under its tenant's "All" site. "None of the 3 roles ... is
 * dated in the last 30 days" was false there; the page now says only what the
 * list says. A total only job-board's empty state can carry is "older".
 *
 * The page's own mapping from the curve row (src/pages/Jobs.tsx, the
 * lander's boardTotal input) is read out of the source and run on the
 * recorded rows, so a merge that drops the bucket from it fails here.
 */
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { COMPANY_SHARD_LOCALES, companyShard, loadCompanyShard } from "./helpers/company-shard";
import { buildLanderModel, zeroReadingOf, type BoardTotalInput, type LanderInput } from "@/lib/company/lander-model";
import { CompanyHeader, zeroAnswer } from "@/components/jobs/company/CompanyHeader";

// get_company_fill_curve, anon, recorded by verify section 81 at 2026-10-24T20:34:57Z.
const BASS = {"company_token":"bassabatherapy","n_at_risk_14":35,"fills_le_14":0,"fill_rate_14":0,"fill_rate_14_lo":0,"fill_rate_14_hi":0,"relist_rate_14":0.0811,"still_open_14":0.9189,"fill_rate_7":0,"fill_rate_30":0,"median_days_to_fill":null,"median_censored":true,"dated_coverage":0.5753,"dated_n":42,"undated_n":31,"open_roles":0,"fills_90d":0,"relists_90d":12,"ageouts_90d":61,"fill_through":0,"churn":1,"absorption":-1,"tracking_days":89,"sufficient":false,"observability_bucket":"full_read","still_open_30":0.8108,"still_open_30_lo":0.6437,"still_open_30_hi":0.905,"taken_down_30":0,"relist_rate_30":0.1892,"n_at_risk_30":30,"ageouts_at_30":30,"sum_check_30":1,"cohort_from":"2026-08-07","cohort_to":"2026-09-24","sufficient_30":false,"events_30":7,"fills_30":0,"relists_30":7,"watched_from":"2026-08-02","insufficient_reason_30":"fills","filled_roles_90d":0,"relisted_roles_90d":12,"multi_site_title_share":null,"multi_site_n":0,"feed_total":null,"feed_read_at":null,"feed_state":null,"feed_capped":null,"late_sighted_30":0,"undated_open":0};
const CANVA = {"company_token":"Canva","n_at_risk_14":231,"fills_le_14":85,"fill_rate_14":0.2315,"fill_rate_14_lo":0.2015,"fill_rate_14_hi":0.2645,"relist_rate_14":0.1295,"still_open_14":0.639,"fill_rate_7":0.1289,"fill_rate_30":0.4505,"median_days_to_fill":null,"median_censored":true,"dated_coverage":0.7282,"dated_n":450,"undated_n":168,"open_roles":36,"fills_90d":207,"relists_90d":87,"ageouts_90d":288,"fill_through":0.3491,"churn":0.2959,"absorption":-0.75,"tracking_days":90,"sufficient":true,"observability_bucket":"full_read","still_open_30":0.366,"still_open_30_lo":0.3113,"still_open_30_hi":0.4208,"taken_down_30":0.4372,"relist_rate_30":0.1968,"n_at_risk_30":114,"ageouts_at_30":108,"sum_check_30":1,"cohort_from":"2026-08-07","cohort_to":"2026-09-24","sufficient_30":true,"events_30":187,"fills_30":129,"relists_30":58,"watched_from":"2026-08-02","insufficient_reason_30":null,"filled_roles_90d":207,"relisted_roles_90d":87,"multi_site_title_share":0.1944,"multi_site_n":36,"feed_total":97,"feed_read_at":"2026-10-24T17:02:32.894+00:00","feed_state":"ok","feed_capped":false,"late_sighted_30":0,"undated_open":0};
const STRIPE = {"company_token":"stripe","open_roles":220,"tracking_days":90,"observability_bucket":"full_read","feed_total":null,"feed_read_at":null,"feed_state":null,"feed_capped":null};
const RECORDED_AT = Date.parse("2026-10-24T20:34:57Z");
// get_company_fill_curve, anon GET, 2026-10-24T23:59:13Z: two Oracle career sub-sites whose
// requisitions are served under a sibling site, and one whose own feed emptied after a stated total.
const DELANEY = {"company_token":"eexs~us2~CX_19005","open_roles":0,"tracking_days":49,"observability_bucket":"full_read","feed_total":3,"feed_read_at":"2026-10-24T22:56:01.925+00:00","feed_state":"ok","feed_capped":false};
const HEARST_UK = {"company_token":"eevd~us6~CX_1001","open_roles":0,"tracking_days":50,"observability_bucket":"full_read","feed_total":20,"feed_read_at":"2026-10-24T22:53:57.299+00:00","feed_state":"ok","feed_capped":false};
const HDRC = {"company_token":"hdrc~ca3~CX_1","open_roles":0,"tracking_days":0,"observability_bucket":"full_read","feed_total":1,"feed_read_at":"2026-10-22T22:31:07.843+00:00","feed_state":"ok","feed_capped":false};
const RECORDED_AT_ORACLE = Date.parse("2026-10-24T23:59:13Z");

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

const t = i18n.t.bind(i18n);
const input = (o: Partial<LanderInput> = {}): LanderInput => ({
  token: "bassabatherapy", storedName: "BASS ABA Therapy", bakedName: null, cachedName: null,
  listTotal: 0, listFloor: false, feedTotal: 0, feedFloor: false, feedAsOf: null,
  boardReadAt: null, source: null, agency: false, collision: null, isUsajobs: false,
  loading: false, error: false, budgetRefusal: false, gated: { verdict: "unknown", withheld: null },
  verdict: "unknown", growth: "unknown", layoffRows: 0, visitorFilters: [], now: RECORDED_AT, ...o,
});
const zeroPage = (row: unknown, o: Partial<LanderInput> = {}) => buildLanderModel(input({ boardTotal: fromRow(row), ...o }));
const NOT_READ = /not read|have not read/i;
const FULL_READ_EN = "As of our latest full read, no role on this board is dated in the last 30 days.";
const UNREAD_EN = "We have not read BASS ABA Therapy's whole board recently.";
const LIST_EN = "No roles dated in the last 30 days";

beforeAll(() => { loadCompanyShard(); });

describe("BASS ABA, read in full every lap, is never 'not read'", () => {
  it("the page's own mapping carries the read bucket and the tracking days", () => {
    expect(fromRow(BASS)).toEqual({ total: null, readAt: null, state: null, capped: null, bucket: "full_read", trackingDays: 89 });
  });

  it("its live row (full_read, 89 days, 0 open, no stated total) is a zero page whose answer says what the full read saw", () => {
    const m = zeroPage(BASS);
    expect(m.variant).toBe("zero");
    expect(m.boardTotal, "no stated total, so none is printed").toBeNull();
    expect(m.zeroReading).toBe("fullRead");
    const line = zeroAnswer(t, m, "en");
    expect(line).toBe(FULL_READ_EN);
    expect(line).not.toMatch(NOT_READ);
  });

  it("the rendered header says it too, and no 'not read' anywhere in the header", () => {
    const m = zeroPage(BASS);
    const { container } = render(<MemoryRouter><CompanyHeader model={m} token="bassabatherapy" system={null} boardReadAt={null} onWatch={() => {}} /></MemoryRouter>);
    expect(container.querySelector("[data-company-answer]")?.textContent).toBe(FULL_READ_EN);
    expect(container.textContent ?? "").not.toMatch(NOT_READ);
  });

  it("the other whole-feed boards the triage named (stripe's row shape) read the same way", () => {
    expect(zeroReadingOf({ boardTotal: fromRow(STRIPE), now: RECORDED_AT })).toBe("fullRead");
  });

  it("a generic board label gets the same sentence, which names no employer and takes no possessive", () => {
    const m = zeroPage(BASS, { storedName: "Corporate" });
    expect(zeroAnswer(t, m, "en")).toBe(FULL_READ_EN);
  });

  it("a stale stated total on a board whose newest read was complete is fullRead, never 'not read'", () => {
    const stale = { ...BASS, feed_total: 31, feed_read_at: new Date(RECORDED_AT - 80 * 3_600_000).toISOString(), feed_state: "ok", feed_capped: false };
    expect(zeroPage(stale).zeroReading).toBe("fullRead");
    expect(zeroAnswer(t, zeroPage(stale), "en")).not.toMatch(NOT_READ);
  });
});

describe("a board genuinely not read keeps the unread sentence", () => {
  it("a tracked board with no observation in seven days (bucket null, 89 tracking days)", () => {
    const m = zeroPage({ ...BASS, observability_bucket: null });
    expect(m.zeroReading).toBe("unread");
    expect(zeroAnswer(t, m, "en")).toBe(UNREAD_EN);
  });

  it("a windowed board with no complete pass (lap_pending, unprovable)", () => {
    for (const b of ["lap_pending", "unprovable"]) {
      expect(zeroPage({ ...BASS, observability_bucket: b }).zeroReading, b).toBe("unread");
      expect(zeroAnswer(t, zeroPage({ ...BASS, observability_bucket: b }), "en"), b).toBe(UNREAD_EN);
    }
    expect(zeroAnswer(t, zeroPage({ ...BASS, observability_bucket: "lap_pending" }, { storedName: "Corporate" }), "en")).toBe("We have not read this whole board recently.");
  });

  it("a reader without the bucket keeps the rule before it (no total: unread)", () => {
    expect(zeroReadingOf({ boardTotal: { total: null, readAt: null, state: null, capped: null }, now: RECORDED_AT })).toBe("unread");
    expect(zeroReadingOf({ boardTotal: null, now: RECORDED_AT })).toBe("unread");
  });
});

describe("a board with a printable total prints the total sentence only when that read kept nothing in our window", () => {
  it("a complete read that kept nothing in our window (state empty) and stated 31: none of them is dated in the window", () => {
    const m = zeroPage({ ...BASS, feed_total: 31, feed_read_at: new Date(RECORDED_AT - 5 * 3_600_000).toISOString(), feed_state: "empty", feed_capped: false });
    expect(m.zeroReading).toBe("older");
    expect(zeroAnswer(t, m, "en")).toMatch(/^None of the 31 roles on BASS ABA Therapy's board is dated in the last 30 days \(read [^)]+\)\. We show roles dated in the last 30 days\.$/);
  });

  it("the 48-hour edge: 47 hours is the total, 49 hours on a full read is fullRead, on a windowed board unread", () => {
    const at = (h: number, bucket: string | null, state = "empty") => ({ ...BASS, observability_bucket: bucket, feed_total: 31, feed_read_at: new Date(RECORDED_AT - h * 3_600_000).toISOString(), feed_state: state, feed_capped: false });
    expect(zeroPage(at(47, "full_read")).zeroReading).toBe("older");
    expect(zeroPage(at(49, "full_read")).zeroReading).toBe("fullRead");
    expect(zeroPage(at(49, "lap_pending")).zeroReading).toBe("unread");
    expect(zeroPage(at(47, "full_read", "ok")).zeroReading, "a fresh ok read kept roles in our window").toBeNull();
    expect(zeroPage(at(49, "full_read", "ok")).zeroReading, "a stale ok read under a newer full read").toBe("fullRead");
  });

  it("a complete read that stated zero is the empty sentence, with its read time", () => {
    const m = zeroPage({ ...BASS, feed_total: 0, feed_read_at: new Date(RECORDED_AT - 5 * 3_600_000).toISOString(), feed_state: "empty", feed_capped: false });
    expect(m.zeroReading).toBe("empty");
  });
});

describe("a fresh total from a read that kept roles in our window (state ok) is never 'older' on a zero page", () => {
  const oracle = (row: typeof DELANEY, name: string) =>
    zeroPage(row, { token: row.company_token, storedName: name, now: RECORDED_AT_ORACLE });

  it("Delaney at the Green's live row (Oracle sub-site, 3 stated at 22:56Z, all 3 served under its tenant's All site) says only what the list says", () => {
    const m = oracle(DELANEY, "Delaney at the Green");
    expect(m.variant).toBe("zero");
    expect(m.boardTotal, "the total is still a fact the model holds").toEqual({ total: 3, readAt: DELANEY.feed_read_at });
    expect(m.zeroReading).toBeNull();
    expect(zeroAnswer(t, m, "en")).toBe(LIST_EN);
  });

  it("the rendered header never says none of the 3 roles is dated in our window", () => {
    const m = oracle(DELANEY, "Delaney at the Green");
    const { container } = render(<MemoryRouter><CompanyHeader model={m} token={DELANEY.company_token} system={null} boardReadAt={null} onWatch={() => {}} /></MemoryRouter>);
    const text = container.textContent ?? "";
    expect(container.querySelector("[data-company-answer]")?.textContent).toBe(LIST_EN);
    expect(text).not.toMatch(/None of the 3 roles|is dated in the last 30 days \(read/);
    expect(text).not.toMatch(NOT_READ);
  });

  it("German says only the list's line too", async () => {
    await i18n.changeLanguage("de");
    try {
      const line = zeroAnswer(i18n.t.bind(i18n), oracle(DELANEY, "Delaney at the Green"), "de");
      expect(line).toBe(i18n.t("companyProfile.zero.answer", { days: 30 }));
      expect(line).not.toMatch(/\b3\b/);
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("Hearst UK's live row (20 stated, state ok, nothing listed) reads the same way", () => {
    expect(oracle(HEARST_UK, "Hearst UK").zeroReading).toBeNull();
    expect(zeroAnswer(t, oracle(HEARST_UK, "Hearst UK"), "en")).toBe(LIST_EN);
  });

  it("a stale ok total under a newer full read keeps fullRead (hdrc~ca3~CX_1: its own feed answers 0 now)", () => {
    expect(oracle(HDRC, "Hdrc").zeroReading).toBe("fullRead");
  });

  it("Canva's live row (97 stated on an ok read) is never 'older' when nothing is listed", () => {
    expect(zeroPage(CANVA, { token: "Canva", storedName: "Canva" }).zeroReading).toBeNull();
  });
});

describe("where neither may be said, the page says only what the list says", () => {
  it("a lap we cannot date, a failed newest visit, a board too new to classify, a bucket this build does not know", () => {
    for (const row of [
      { ...BASS, observability_bucket: "lap_proven" },
      { ...BASS, observability_bucket: "unobserved" },
      { ...BASS, observability_bucket: null, tracking_days: 0 },
      { ...BASS, observability_bucket: null, tracking_days: null },
      { ...BASS, observability_bucket: "a_bucket_this_build_does_not_know" },
    ]) {
      const m = zeroPage(row);
      expect(m.zeroReading, JSON.stringify([row.observability_bucket, row.tracking_days])).toBeNull();
      expect(zeroAnswer(t, m, "en")).toBe(LIST_EN);
    }
  });

  it("the curve not answered yet says nothing about the read", () => {
    expect(zeroReadingOf({ boardTotal: undefined })).toBeNull();
  });
});

describe("the sentence in nine languages", () => {
  const zeroOf = (l: string) => ((companyShard(l) as { companyProfile: { zero: Record<string, string> } }).companyProfile.zero);
  it("every locale carries zero.fullRead with the window placeholder and no name, digit or banned word", () => {
    for (const l of COMPANY_SHARD_LOCALES) {
      const v = zeroOf(l).fullRead;
      expect(v, l).toBeTruthy();
      expect(v, l).toContain("{{days}}");
      expect(v.replace(/\{\{[^}]*\}\}/g, ""), `${l}: a digit typed into copy`).not.toMatch(/\d/);
      expect(v, l).not.toMatch(/\{\{\s*(company|companyPossessive|name)\s*\}\}/);
      expect(v, l).not.toMatch(/verified|verifiziert|verificad|vérifié|geverifieerd|सत्यापित|filled/i);
      if (!l.startsWith("en")) expect(v, `${l}: still English`).not.toBe(zeroOf("en").fullRead);
    }
  });

  it("German renders it for BASS ABA's row", async () => {
    await i18n.changeLanguage("de");
    try {
      expect(zeroAnswer(i18n.t.bind(i18n), zeroPage(BASS), "de")).toBe("Laut unserem letzten vollständigen Lesen trägt keine Stelle auf diesem Jobboard ein Datum aus den letzten 30 Tagen.");
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});

describe("TEETH", () => {
  it("a page mapping that drops the bucket prints 'not read' for BASS ABA again", () => {
    const dropped = JOBS.replace(/, bucket: hiringCurve\.observability_bucket/, "");
    expect(dropped, "the teeth mutation did not apply: RE-ANCHOR it").not.toBe(JOBS);
    const m = buildLanderModel(input({ boardTotal: pageMapping(dropped)(BASS) }));
    expect(zeroAnswer(t, m, "en")).toMatch(NOT_READ);
  });

  it("the rule before the fix round (any fresh total is older) fails the Delaney assertion", () => {
    const before = (row: typeof DELANEY) => (fromRow(row).state === "ok" ? "older" : null);
    expect(before(DELANEY)).toBe("older");
    expect(zeroReadingOf({ boardTotal: fromRow(DELANEY), now: RECORDED_AT_ORACLE })).not.toBe(before(DELANEY));
  });

  it("the rule before the fix (no total means unread) fails the BASS ABA assertion", () => {
    const before = (bt: BoardTotalInput) => (zeroReadingOf({ boardTotal: { ...bt, bucket: undefined }, now: RECORDED_AT }));
    expect(before(fromRow(BASS))).toBe("unread");
    expect(zeroReadingOf({ boardTotal: fromRow(BASS), now: RECORDED_AT })).not.toBe(before(fromRow(BASS)));
  });
});
