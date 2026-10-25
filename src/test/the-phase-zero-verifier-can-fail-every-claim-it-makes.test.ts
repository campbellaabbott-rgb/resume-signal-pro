// @vitest-environment node
/**
 * THE PHASE-ZERO VERIFIER CAN FAIL EVERY CLAIM IT MAKES.
 *
 * Section 91 of verify-deploy judges the company-profiles phase-0 deploy:
 * V7 (lap boards print no 14-day share, median or 30-day share; Domino's no
 * 90-day count), V7b (Eurofins prints no "not re-listed" count), V3 (a page two
 * vendors share hides its employer-level blocks), V3b (no BX on 'blackstone',
 * no CSGP on 'costar'), plus the LCA line, the headcount column and llms.txt.
 * Its judging block is run here against fixture files, the way section 89's is
 * in a-verifier-credits-only-what-the-deploy-stored.test.ts: the /tmp/vd_91_
 * prefix is pointed at a temp dir and the printed lines are the behaviour.
 *
 * The README's rule: a PASS needs something that could have made it FAIL. So
 * every claim is shown FAILing on today's production (the fixture is what the
 * section read live on 2026-10-11 before the deploy) and PASSing on a fixture
 * of what the deploy serves.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { hiringRecordGate } from "@/lib/hiring-record-gate";

const ROOT = resolve(__dirname, "../..");
const SH = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/91-profiles-gate-and-fixes.sh"), "utf8");
const blocks = [...SH.matchAll(/node -e '([^']*)'/g)].map((m) => m[1]);
const judge = blocks.find((b) => b.includes("/tmp/vd_91_curves.json") && b.includes("const out = ")) ?? "";

function run(files: Record<string, string>): string[] {
  const dir = mkdtempSync(join(tmpdir(), "vd-91-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  const code = judge.split("/tmp/vd_91_").join(join(dir, "vd_91_"));
  return execFileSync(process.execPath, ["-e", code], { encoding: "utf8" }).split("\n").filter(Boolean);
}

/** get_company_fill_curve as it answered on 2026-10-11 (UTC). */
const ROWS = [
  { company_token: "dominos", observability_bucket: "lap_proven", tracking_days: 10, sufficient: true, fill_rate_14: 0.0053, median_days_to_fill: null, median_censored: true, sufficient_30: false, insufficient_reason_30: "lap", filled_roles_90d: 13347, relisted_roles_90d: 0, dated_coverage: 0.9979 },
  { company_token: "oreillyauto~wd1~oreilly", observability_bucket: "lap_proven", tracking_days: 10, sufficient: true, fill_rate_14: 0.0135, median_days_to_fill: null, median_censored: true, sufficient_30: false, insufficient_reason_30: "lap", filled_roles_90d: 509, relisted_roles_90d: 2, dated_coverage: 0.87 },
  { company_token: "dollartree~wd5~dollartreeus", observability_bucket: "lap_proven", tracking_days: 8, sufficient: true, fill_rate_14: 0.0347, median_days_to_fill: null, median_censored: true, sufficient_30: false, insufficient_reason_30: "lap", filled_roles_90d: 1065, relisted_roles_90d: 19, dated_coverage: 0.9496 },
  { company_token: "Eurofins", observability_bucket: "lap_proven", tracking_days: 87, sufficient: true, fill_rate_14: 0.3047, median_days_to_fill: 25, median_censored: false, sufficient_30: false, insufficient_reason_30: "lap", filled_roles_90d: 1293, relisted_roles_90d: 0, dated_coverage: 0.8631 },
];
const gateOf = (rows: typeof ROWS) => JSON.stringify(Object.fromEntries(rows.map((r) => [r.company_token, hiringRecordGate(r)])));
const COMPANIES_HTML = (n: number) => Array.from({ length: n }, (_, i) => `<li><a href="/jobs/company/e${i}" class="text-primary hover:underline">E${i}</a></li>`).join("\n");

/** What section 91 read from production before the deploy. */
const BEFORE: Record<string, string> = {
  "vd_91_curves.json": JSON.stringify({ status: 200, body: ROWS }),
  "vd_91_gate.json": gateOf(ROWS),
  "vd_91_meta.json": JSON.stringify({ main: "/assets/index-BLK0Qpbp.js", jobsChunk: "Jobs-CWSUPiVD.js" }),
  "vd_91_bundle.txt": `t("jobsPage.hhFillRateDated","Up to");t("jobsPage.h1b.chip","Declared wages");t("jobsPage.intel.employees","x")`,
  "vd_91_financials.json": JSON.stringify({
    blackstone: { status: 200, body: { ticker: "BX", sec_name: "Blackstone Inc." } },
    costar: { status: 200, body: { ticker: "CSGP", sec_name: "COSTAR GROUP, INC." } },
    clear: { status: 200, body: null },
  }),
  "vd_91_clear.json": JSON.stringify({ sources: ["bamboohr", "greenhouse"] }),
  "vd_91_profiles.json": JSON.stringify({ status: 400, body: "{\"code\":\"42703\",\"message\":\"column company_profiles.as_of does not exist\"}" }),
  "vd_91_pages.json": JSON.stringify({
    llms: "- [Companies on the board](https://resumebooster.work/companies): The employers with a page of their own, A–Z, each with its live count; the board itself carries far more.",
    llmsStatus: 200, companies: COMPANIES_HTML(471), companiesStatus: 200,
    eurofins: "<title>Eurofins Jobs — 1,106 Verified Openings</title><p>Open roles at Eurofins</p>", eurofinsStatus: 200, homeTitle: "Resume Booster",
  }),
};

/** What the deploy serves. */
const AFTER: Record<string, string> = {
  ...BEFORE,
  "vd_91_bundle.txt": [
    `t("jobsPage.hhGate.lap",x.lap)`, `t("jobsPage.hhGate.relist",x.relist)`, `t("jobsPage.hhGate.countsTrackingLap",x.c)`,
    `t("jobsPage.hhGate.withheldBadge",x.w)`, `t("jobsPage.lcaWhyThisCellEmployer","x")`, `t("jobsPage.intel.asOf","as of")`,
    `const isCollision=r.collision===true`,
  ].join(";"),
  "vd_91_financials.json": JSON.stringify({ blackstone: { status: 200, body: null }, costar: { status: 200, body: null }, clear: { status: 200, body: null } }),
  "vd_91_profiles.json": JSON.stringify({ status: 200, body: "[]" }),
  "vd_91_pages.json": JSON.stringify({
    ...JSON.parse(BEFORE["vd_91_pages.json"]),
    llms: "- [Companies with a page of their own](https://resumebooster.work/companies): The 471 employers this site gives a page of their own, A–Z, each with the open-role count measured when the index was built.",
  }),
};

const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const line = (lines: string[], re: RegExp) => lines.filter((l) => re.test(l));

describe("section 91's judging block", () => {
  it("is found, and every line it prints is PASS, FAIL or INFO", () => {
    expect(judge, "no node block reading /tmp/vd_91_curves.json").not.toBe("");
    for (const l of [...run(BEFORE), ...run(AFTER)]) expect(l).toMatch(/^(PASS|FAIL|INFO) /);
  });

  it("FAILs every claim on what production served before the deploy", () => {
    const out = run(BEFORE);
    for (const re of [
      /^FAIL +V7 Domino's: the served Jobs chunk lacks jobsPage\.hhGate\.lap/,
      /^FAIL +V7 O'Reilly: the served Jobs chunk lacks jobsPage\.hhGate\.lap/,
      /^FAIL +V7 Dollar Tree: the served Jobs chunk lacks jobsPage\.hhGate\.lap/,
      /^FAIL +V7 Domino's: the served Jobs chunk lacks the 90-day count refusals/,
      /^FAIL +V7b Eurofins: the served Jobs chunk lacks jobsPage\.hhGate\.relist/,
      /^FAIL +V3b blackstone: get_company_financials still answers BX/,
      /^FAIL +V3b costar: get_company_financials still answers CSGP/,
      /^FAIL +V3 clear: the served Jobs chunk carries no collision decision/,
      /^FAIL +LCA line: the served chunk still carries the dead H-1B card/,
      /^FAIL +headcount: company_profiles\.as_of answered HTTP 400/,
      /^FAIL +headcount: the served chunk lacks jobsPage\.intel\.asOf/,
      /^FAIL +llms\.txt: the \/companies line does not say how many employers/,
    ]) expect(line(out, re), `${re}\n${out.join("\n")}`).toHaveLength(1);
  });

  it("PASSes every claim on what the deploy serves, and FAILs nothing", () => {
    const out = run(AFTER);
    expect(fails(out), out.join("\n")).toEqual([]);
    for (const re of [
      /^PASS +V7 Domino's: no 14-day share and no median/,
      /^PASS +V7 O'Reilly: no 14-day share and no median/,
      /^PASS +V7 Dollar Tree: no 14-day share and no median/,
      /^PASS +V7 Domino's: no 30-day share/,
      /^PASS +V7 Domino's: no 90-day count \(gate: relist detection unproven/,
      /^PASS +V7b Eurofins: no "not re-listed" count on the employer page/,
      /^PASS +V7b Eurofins: the baked page prints no/,
      /^PASS +V3b blackstone: no BX card/,
      /^PASS +V3b costar: no CSGP card/,
      /^PASS +V3 clear: the served Jobs chunk carries the collision decision/,
      /^PASS +LCA line:/,
      /^PASS +headcount: company_profiles\.as_of exists/,
      /^PASS +headcount: the served chunk prints a count only beside its date/,
      /^PASS +llms\.txt: 471 employers with a page of their own, the number \/companies links/,
    ]) expect(line(out, re), `${re}\n${out.join("\n")}`).toHaveLength(1);
  });

  it("teeth: a gate that lets a lap row through, a lap board called sufficient at day 30, and a count llms.txt and /companies disagree on", () => {
    const leaky = JSON.parse(AFTER["vd_91_gate.json"]);
    leaky.dominos.share14 = { ok: true, reason: null };
    const rows = ROWS.map((r) => (r.company_token === "oreillyauto~wd1~oreilly" ? { ...r, sufficient_30: true } : r));
    const pages = { ...JSON.parse(AFTER["vd_91_pages.json"]), companies: COMPANIES_HTML(470) };
    const out = run({ ...AFTER, "vd_91_gate.json": JSON.stringify(leaky), "vd_91_curves.json": JSON.stringify({ status: 200, body: rows }), "vd_91_pages.json": JSON.stringify(pages) });
    expect(line(out, /^FAIL +V7 Domino's: this checkout's gate lets a lap_proven row print/)).toHaveLength(1);
    expect(line(out, /^FAIL +V7 O'Reilly: get_company_fill_curve calls the 30-day share sufficient on a lap_proven board/)).toHaveLength(1);
    expect(line(out, /^FAIL +llms\.txt says 471 employers have a page of their own; \/companies links 470/)).toHaveLength(1);
  });

  it("a baked Eurofins page that prints the count FAILs, and a board no longer under the control is INFO, not PASS", () => {
    const pages = { ...JSON.parse(AFTER["vd_91_pages.json"]), eurofins: "<title>Eurofins Jobs</title><p>1,293 roles taken down for good, not re-listed</p>" };
    const rows = ROWS.map((r) => (r.company_token === "Eurofins" ? { ...r, relisted_roles_90d: 40 } : r));
    const out = run({ ...AFTER, "vd_91_pages.json": JSON.stringify(pages), "vd_91_curves.json": JSON.stringify({ status: 200, body: rows }), "vd_91_gate.json": gateOf(rows as typeof ROWS) });
    expect(line(out, /^FAIL +V7b Eurofins: the baked page prints a taken-down-and-not-re-listed count/)).toHaveLength(1);
    expect(line(out, /^INFO +V7b Eurofins: re-listings are now seen on this board/)).toHaveLength(1);
  });

  it("an unreadable bundle or a missing gate is a FAIL, never a PASS over nothing", () => {
    const out = run({ ...AFTER, "vd_91_meta.json": JSON.stringify({ main: null, jobsChunk: null }), "vd_91_bundle.txt": "", "vd_91_gate.json": "" });
    expect(line(out, /^FAIL +could not read the served Jobs chunk/)).toHaveLength(1);
    expect(line(out, /^FAIL +this checkout could not run its own gate/)).toHaveLength(1);
    expect(line(out, /^PASS +V7 /), "a V7 PASS with no gate and no bundle").toHaveLength(0);
  });
});
