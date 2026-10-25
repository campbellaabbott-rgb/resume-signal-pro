// @vitest-environment node
/**
 * THE ACCURACY VERIFIER CAN FAIL EVERY CLAIM IT MAKES.
 *
 * Section 81 of verify-deploy judges the profiles + design accuracy round:
 * Track 1 on named live company pages (81a-81e) and the lock on the four
 * company tables (81f, 81g). Its judging block runs here against fixture
 * files, the way section 91's does in
 * the-phase-zero-verifier-can-fail-every-claim-it-makes.test.ts: the
 * /tmp/vd_81_ prefix is pointed at a temp dir and the printed lines are the
 * behaviour.
 *
 * The README's rule: a PASS needs something that could have made it FAIL. So
 * every claim FAILs on what the section read from production on 2026-10-12
 * before this round (fixtures/verify-81-before-2026-10-12.json, with the
 * served copy of that day reduced to the strings the section looks for) and
 * PASSes on a fixture of what the deploy serves.
 *
 * The model the judge reads (/tmp/vd_81_model.json) is built here by the
 * section's OWN tsx loop, cut out of the script and run on the fixture rows,
 * so the input it hands the lander model is the one under test (the
 * profiles+design hotfix review, 2026-10-24: the loop built the zero page's
 * input without the read bucket, so 81c printed "not read" for BASS ABA while
 * the page printed the full-read sentence, and nothing could fail on it).
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { hiringRecordGate, type HiringRecordRow } from "@/lib/hiring-record-gate";
import { boardTotalFact, zeroReadingOf } from "@/lib/company/lander-model";

const ROOT = resolve(__dirname, "../..");
const SH = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/81-profiles-design-accuracy.sh"), "utf8");
const blocks = [...SH.matchAll(/node -e '([^']*)'/g)].map((m) => m[1]);
const judge = blocks.find((b) => b.includes("/tmp/vd_81_curves.json") && b.includes("const out = ")) ?? "";

type Row = HiringRecordRow & { company_token: string; [k: string]: unknown };
const BEFORE_READ = JSON.parse(readFileSync(resolve(__dirname, "fixtures/verify-81-before-2026-10-12.json"), "utf8")) as {
  curves: { status: number; body: Row[] };
  ext: unknown; lock: unknown; readers: unknown; meta: unknown;
};

/** The section's tsx block, and the loop in it that turns each live row into the gate and the model the judge reads. */
const TSX = (/npx --no-install tsx -e '([^']*)'/.exec(SH) ?? [])[1] ?? "";
const LOOP = /for \(const r of rows\) \{\n([\s\S]*?)\n {2}\}\n/;
function loopOf(tsx: string) {
  const m = LOOP.exec(tsx);
  if (!m) throw new Error("section 81's tsx loop over the curve rows moved: RE-ANCHOR this test on it");
  return new Function("g", "m", "rows", "gate", "model", `for (const r of rows) {\n${m[1]}\n}`) as
    (g: unknown, m: unknown, rows: Row[], gate: Record<string, unknown>, model: Record<string, unknown>) => void;
}
function derived(rows: Row[], tsx = TSX) {
  const gate: Record<string, unknown> = {};
  const model: Record<string, unknown> = {};
  loopOf(tsx)({ hiringRecordGate }, { boardTotalFact, zeroReadingOf }, rows, gate, model);
  return { gate: JSON.stringify(gate), model: JSON.stringify(model) };
}

function run(files: Record<string, string>): string[] {
  expect(judge.length, "the judging block of section 81 was not found").toBeGreaterThan(1000);
  const dir = mkdtempSync(join(tmpdir(), "vd-81-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  const code = judge.split("/tmp/vd_81_").join(join(dir, "vd_81_"));
  return execFileSync(process.execPath, ["-e", code], { encoding: "utf8" }).split("\n").filter(Boolean);
}
const line = (lines: string[], status: string, re: RegExp) => lines.some((l) => l.startsWith(status) && re.test(l));
const show = (lines: string[]) => lines.join("\n");

// The served copy of 2026-10-12, reduced to the strings section 81 reads.
const OLD_BUNDLE = [
  `repostTipRoles:"In the last {{days}} days at least {{n}} of this company's roles that we watched come off the board came back. We only see a role come back under its own posting, so the real number can be higher. Worth knowing before you invest in an application."`,
  `verdictChurnFloor:"re-lists roles often (at least {{n}}×) — responses may be slow"`,
  `repostChipFloor:"Re-lists roles often ({{n}}×+)"`,
  `companyNotHiring:"Not right now — {{company}} has no open roles on their job board at the moment."`,
  `verdictSlowFill:"we never see half its roles come down inside {{d}} days"`,
  `t("jobsPage.hhGate.lap",x.lap)`, `t("jobsPage.hhGate.relist",x.relist)`,
].join(";");
// What the deploy serves.
const NEW_BUNDLE = [
  `repostTipRoles:"In the last {{days}} days, {{n}} roles we watched come down here came back under the same posting or had another posting with the same title live when they came down; {{f}} came down and have not come back."`,
  `repostChipFloor:"Back or same title live ({{n}}×+)"`,
  `companyNotHiring:"We show roles dated in the last 30 days, and the {{company}} job board has none right now."`,
  `verdictSlowFill:"we never see half its roles come down and stay down inside {{d}} days"`,
  `t("jobsPage.hhGate.lap",x.lap)`, `t("jobsPage.hhGate.unprovenRead",x.u)`, `t("jobsPage.hhGate.otherSites",x.o)`,
  `t("companyProfile.zero.older",{count:n})`,
  `t("companyProfile.zero.fullRead",{days:30})`,
  // The Jobs chunk's lander input, as the production build minifies it (esbuild on src/pages/Jobs.tsx).
  `boardTotal:to===null?void 0:H?{total:H.feed_total,readAt:H.feed_read_at,state:H.feed_state,capped:H.feed_capped,bucket:H.observability_bucket,trackingDays:H.tracking_days}:null`,
].join(";");
/** What the 2026-10-18 publish serves: the zero copy before the hotfix (no full-read key, no bucket in the Jobs chunk's input). */
const PD_BUNDLE = NEW_BUNDLE
  .replace(`t("companyProfile.zero.fullRead",{days:30})`, "")
  .replace(",bucket:H.observability_bucket,trackingDays:H.tracking_days", "");

const beforeRows = BEFORE_READ.curves.body;
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
/** The deploy's reader: the same rows with the columns 20261012121000 appends and its interval clamp. */
const afterRows: Row[] = beforeRows.map((r) => {
  const base: Row = { ...r, multi_site_title_share: 0.05, multi_site_n: 100, feed_total: null, feed_read_at: null, feed_state: null, feed_capped: null, undated_open: 0 };
  if (r.company_token === "centriaautism") return { ...base, multi_site_title_share: 0.97, fill_rate_14: 0.0069 };
  if (r.company_token === "bayada") return { ...base, multi_site_title_share: 0.44 };
  // BASS ABA as the curve answers it live (2026-10-24): a Greenhouse board read whole in one visit, so job-board states no total.
  if (r.company_token === "bassabatherapy") return { ...base, observability_bucket: "full_read", tracking_days: 89 };
  if (r.company_token === "stripe") return { ...base, feed_total: 727, feed_read_at: hoursAgo(1), feed_state: "ok", feed_capped: false };
  return base;
});

const files = (rows: Row[], bundle: string, over: Record<string, unknown> = {}): Record<string, string> => {
  const d = derived(rows);
  return {
    "vd_81_curves.json": JSON.stringify({ status: 200, body: rows }),
    "vd_81_gate.json": d.gate,
    "vd_81_model.json": d.model,
    "vd_81_meta.json": JSON.stringify(BEFORE_READ.meta),
    "vd_81_bundle.txt": bundle,
    "vd_81_ext.json": JSON.stringify(over.ext ?? BEFORE_READ.ext),
    "vd_81_lock.json": JSON.stringify(over.lock ?? BEFORE_READ.lock),
    "vd_81_readers.json": JSON.stringify(over.readers ?? BEFORE_READ.readers),
    "vd_81_similar.json": JSON.stringify(over.similar ?? SIMILAR_BEFORE),
  };
};
// get_similar_companies as it answered on 2026-10-18 (reduced), and after 20261012136000.
const SIMILAR_BEFORE = {
  "cvshealth~wd1~CVS_Health_Careers": { status: 200, body: [{ company: "Veterans Health Administration", company_token: "usajobs", category: "healthcare", open_roles: 3061 }] },
  Eurofins: { status: 200, body: [{ company: "Veterans Health Administration", company_token: "usajobs", category: "science", open_roles: 412 }] },
};
const SIMILAR_AFTER = {
  "cvshealth~wd1~CVS_Health_Careers": { status: 200, body: [{ company: "HCA Healthcare", company_token: "hcahealthcare~wd1~HCA", category: "healthcare", open_roles: 2100 }] },
  Eurofins: { status: 200, body: [] },
};
const LOCKED = Object.fromEntries([["showcase_excluded", "company_token"], ["company_profiles", "company_token"], ["company_financials", "slug"], ["company_name_overrides", "slug"]]
  .map(([t, col]) => [t, { col, status: 401, body: `{"code":"42501","details":null,"hint":null,"message":"permission denied for table ${t}"}` }]));

describe("before the deploy (production, 2026-10-12): every Track 1 and lock claim fails", () => {
  const lines = run(files(beforeRows, OLD_BUNDLE));
  it("81a: the four lap_pending boards", () => {
    for (const l of ["AutoZone", "Marriott", "Kroger", "Kotak"]) expect(line(lines, "FAIL", new RegExp(`81a ${l}:`)), show(lines)).toBe(true);
  });
  it("81b: the old caution, its phrases, and no multi-site column on Centria and BAYADA", () => {
    expect(line(lines, "FAIL", /81b the served English copy lacks the neutral/), show(lines)).toBe(true);
    expect(line(lines, "FAIL", /81b the served bundle still carries 4 removed phrase/), show(lines)).toBe(true);
    expect(line(lines, "FAIL", /81b Centria Autism: the reply carries no multi_site_title_share/), show(lines)).toBe(true);
    expect(line(lines, "FAIL", /81b BAYADA: the reply carries no multi_site_title_share/), show(lines)).toBe(true);
  });
  it("81c-81e: the zero sentence, BASS ABA, Stripe, the old bound and Centria's escaped share", () => {
    expect(line(lines, "FAIL", /81c the served copy still says an employer has no open roles/), show(lines)).toBe(true);
    expect(line(lines, "FAIL", /81c the served chunks lack companyProfile\.zero\.older/), show(lines)).toBe(true);
    expect(line(lines, "FAIL", /81c BASS ABA: the reply carries no feed_total/), show(lines)).toBe(true);
    expect(line(lines, "FAIL", /81c Stripe: the reply carries no feed_total/), show(lines)).toBe(true);
    expect(line(lines, "FAIL", /81d Databricks: the served copy is the old bound/), show(lines)).toBe(true);
    expect(line(lines, "FAIL", /81e 1 of \d+ rows publish a 14-day share outside its own interval.*centriaautism/), show(lines)).toBe(true);
  });
  it("81f: all four tables answer an anon read; 81g: the readers answer", () => {
    for (const t of ["showcase_excluded", "company_profiles", "company_financials", "company_name_overrides"]) {
      expect(line(lines, "FAIL", new RegExp(`81f ${t}: an anon read of \\w+ answered 200`)), show(lines)).toBe(true);
    }
    expect(lines.filter((l) => /^PASS +81g/.test(l))).toHaveLength(3);
  });
  it("81h: the similar-employers list names USAJOBS after an agency", () => {
    expect(line(lines, "FAIL", /81h cvshealth~wd1~CVS_Health_Careers: the list names the USAJOBS board as "Veterans Health Administration"/), show(lines)).toBe(true);
    expect(line(lines, "FAIL", /81h Eurofins: the list names the USAJOBS board/), show(lines)).toBe(true);
  });
});

describe("after the deploy: every claim passes", () => {
  const lines = run(files(afterRows, NEW_BUNDLE, { lock: LOCKED, similar: SIMILAR_AFTER }));
  it("no line fails", () => {
    expect(lines.filter((l) => l.startsWith("FAIL")), show(lines)).toEqual([]);
  });
  it("each claim prints its PASS", () => {
    for (const l of ["AutoZone", "Marriott", "Kroger", "Kotak"]) expect(line(lines, "PASS", new RegExp(`81a ${l}: no 14-day share`)), show(lines)).toBe(true);
    expect(line(lines, "PASS", /81b the served English copy carries the neutral/), show(lines)).toBe(true);
    expect(line(lines, "PASS", /81b none of the 4 removed phrases is served/), show(lines)).toBe(true);
    expect(line(lines, "PASS", /81b Centria Autism: no 90-day counts/), show(lines)).toBe(true);
    expect(line(lines, "PASS", /81b BAYADA: no 90-day counts/), show(lines)).toBe(true);
    expect(line(lines, "PASS", /81c the served copy names the 30-day window/), show(lines)).toBe(true);
    expect(line(lines, "PASS", /81c BASS ABA: nothing served in the window and its newest read was complete \(bucket full_read, 89 tracking days, no stated total\): the page says that as of our latest full read no role is dated in the last 30 days/), show(lines)).toBe(true);
    expect(line(lines, "PASS", /81c the served chunks carry the full-read zero sentence \(companyProfile\.zero\.fullRead\)/), show(lines)).toBe(true);
    expect(line(lines, "PASS", /81c the served Jobs chunk hands the zero page the curve's read bucket and tracking days/), show(lines)).toBe(true);
    expect(line(lines, "PASS", /81c Stripe: board total 727 .* within 10% of its Greenhouse feed \(722\)/), show(lines)).toBe(true);
    expect(line(lines, "PASS", /81d Databricks: no "never half"/), show(lines)).toBe(true);
    expect(line(lines, "PASS", /81e all \d+ rows publish their 14-day share inside its own interval/), show(lines)).toBe(true);
    expect(lines.filter((l) => /^PASS +81f .*refused \(HTTP 401, 42501\)/.test(l))).toHaveLength(4);
    expect(lines.filter((l) => /^PASS +81h .*none of them the USAJOBS board/.test(l))).toHaveLength(2);
  });
});

describe("81c judges the zero page as the page builds it (profiles+design hotfix, 2026-10-24)", () => {
  const bassLine = (lines: string[]) => lines.find((l) => /81c BASS ABA/.test(l)) ?? "";
  const LOCKED_AFTER = { lock: LOCKED, similar: SIMILAR_AFTER };

  it("the section's model input is the page's own mapping from the curve row (src/pages/Jobs.tsx)", () => {
    const jobs = readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8");
    const page = /boardTotal: curveAnsweredAt === null \? undefined : hiringCurve\s*\?\s*(\{[^{}]*\})\s*:\s*null,/.exec(jobs);
    const ours = /const bt = has \? (\{[^{}]*\}) : null;/.exec(TSX);
    expect(page, "the page's mapping moved: RE-ANCHOR").toBeTruthy();
    expect(ours, "section 81's bt moved: RE-ANCHOR").toBeTruthy();
    const pageOf = new Function("hiringCurve", `return (${page![1]});`);
    const oursOf = new Function("r", `return (${ours![1]});`);
    for (const r of afterRows) expect(oursOf(r), r.company_token).toEqual(pageOf(r));
  });

  it("the 2026-10-18 publish (no full-read key, no bucket in the Jobs chunk) FAILs both bundle lines", () => {
    const lines = run(files(afterRows, PD_BUNDLE, LOCKED_AFTER));
    expect(line(lines, "FAIL", /81c the served chunks lack companyProfile\.zero\.fullRead/), show(lines)).toBe(true);
    expect(line(lines, "FAIL", /81c the served Jobs chunk does not hand the zero page the curve's observability_bucket and tracking_days/), show(lines)).toBe(true);
  });

  it("a model fed without the bucket (the loop before the hotfix) reads BASS ABA as not read, and 81c FAILs", () => {
    const dropped = TSX.replace(", bucket: r.observability_bucket, trackingDays: r.tracking_days", "");
    expect(dropped, "the teeth mutation did not apply: RE-ANCHOR it").not.toBe(TSX);
    const d = derived(afterRows, dropped);
    const lines = run({ ...files(afterRows, NEW_BUNDLE, LOCKED_AFTER), "vd_81_model.json": d.model });
    expect(bassLine(lines), show(lines)).toMatch(/^FAIL {2}81c BASS ABA: this checkout's lander model says we have not read a board whose newest read was complete \(bucket full_read, 89 tracking days, no stated total\)/);
  });

  it("a read that kept nothing in our window and stated 31 still PASSes as older roles listed", () => {
    const rows = afterRows.map((r) => (r.company_token === "bassabatherapy" ? { ...r, feed_total: 31, feed_read_at: hoursAgo(2), feed_state: "empty", feed_capped: false } : r));
    const lines = run(files(rows, NEW_BUNDLE, LOCKED_AFTER));
    expect(bassLine(lines), show(lines)).toMatch(/^PASS {2}81c BASS ABA: nothing served in the window and its board listed 31 roles .* on a read that kept none in the window/);
  });

  it("a fresh total from a read that kept roles in our window says only the list's line, as INFO", () => {
    const rows = afterRows.map((r) => (r.company_token === "bassabatherapy" ? { ...r, feed_total: 3, feed_read_at: hoursAgo(1), feed_state: "ok", feed_capped: false } : r));
    const lines = run(files(rows, NEW_BUNDLE, LOCKED_AFTER));
    expect(bassLine(lines), show(lines)).toMatch(/^INFO {2}81c BASS ABA: no zero reading .* the page prints only the list's own line/);
  });

  it("a windowed board never read through keeps 'not read' as true, as INFO", () => {
    const rows = afterRows.map((r) => (r.company_token === "bassabatherapy" ? { ...r, observability_bucket: "lap_pending" } : r));
    const lines = run(files(rows, NEW_BUNDLE, LOCKED_AFTER));
    expect(bassLine(lines), show(lines)).toMatch(/^INFO {2}81c BASS ABA: zero reading "unread" \(bucket lap_pending/);
  });
});

describe("the lock's own failure modes", () => {
  it("a table that still answers 200 with no rows is not the lock", () => {
    const lines = run(files(afterRows, NEW_BUNDLE, { lock: { ...LOCKED, company_profiles: { col: "company_token", status: 200, body: "[]" } } }));
    expect(line(lines, "FAIL", /81f company_profiles: an anon read of company_token answered 200/), show(lines)).toBe(true);
  });
  it("a reader the lock took away from anon fails 81g", () => {
    const lines = run(files(afterRows, NEW_BUNDLE, { lock: LOCKED, readers: {
      get_company_intel: { status: 401, body: `{"code":"42501","message":"permission denied for function get_company_intel"}` },
      get_company_financials: { status: 200, body: "null" },
      get_similar_companies: { status: 200, body: "[]" },
    } }));
    expect(line(lines, "FAIL", /81g get_company_intel refuses anon \(42501\)/), show(lines)).toBe(true);
  });
  it("a probe that names a column the table lacks says so", () => {
    const lines = run(files(afterRows, NEW_BUNDLE, { lock: { ...LOCKED, company_financials: { col: "nope", status: 400, body: `{"code":"42703","message":"column company_financials.nope does not exist"}` } } }));
    expect(line(lines, "FAIL", /81f company_financials: HTTP 400 on nope/), show(lines)).toBe(true);
  });
});
