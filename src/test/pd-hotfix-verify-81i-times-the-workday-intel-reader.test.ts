// @vitest-environment node
/**
 * PD HOTFIX 2026-10-24: VERIFY 81i TIMES THE COMPANY READER ON WORKDAY TOKENS.
 *
 * 81g asked get_company_intel one question, about stripe, and stayed green
 * while every Workday token answered 500 57014 after 15 seconds. 81i asks it
 * about three Workday company pages the sitemap listed and one made-up
 * Workday token, and passes only a 200 carrying the reader object within
 * 3 seconds. Its judging block runs here against fixture files (the
 * /tmp/vd_81_ prefix pointed at a temp dir), the way
 * the-accuracy-verifier-can-fail-every-claim-it-makes.test.ts runs 81a-81h:
 * every line FAILs on what production answered on 2026-10-24 at 22:21Z and
 * PASSes on a fixture of what the fix serves, and each way to half-pass
 * (slow, wrong shape, not probed) is its own FAIL.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const SH = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/81-profiles-design-accuracy.sh"), "utf8");
const blocks = [...SH.matchAll(/node -e '([^']*)'/g)].map((m) => m[1]);
const probe = blocks.find((b) => b.includes("/tmp/vd_81_workday.json") && b.includes("writeFileSync")) ?? "";
const judge = blocks.find((b) => b.includes("/tmp/vd_81_workday.json") && b.includes("const out = ")) ?? "";

const REAL = ["cat~wd5~caterpillarcareers", "nvidia~wd5~NVIDIAExternalCareerSite", "dollartree~wd5~dollartreeus"];
const MADE_UP = "zzzz-none~wd1~Careers";
const TIMEOUT = `{"code":"57014","details":null,"hint":null,"message":"canceling statement due to statement timeout"}`;
const READER = (usd: number) =>
  JSON.stringify({ usd_n: usd, net_7d: usd ? -3 : null, countries: usd ? [{ n: usd, country: "US" }] : [], categories: [], open_by_source: usd ? { workday: usd } : {} });

type Probe = { token: string; madeUp: boolean; status: number; ms: number; body: string; inSitemap: boolean | null };
const probeOf = (token: string, status: number, ms: number, body: string, inSitemap: boolean | null = true): Probe =>
  ({ token, madeUp: token === MADE_UP, status, ms, body, inSitemap: token === MADE_UP ? null : inSitemap });

function run(file: object | null): string[] {
  expect(judge.length, "the 81i judging block was not found").toBeGreaterThan(500);
  const dir = mkdtempSync(join(tmpdir(), "vd-81i-"));
  if (file) writeFileSync(join(dir, "vd_81_workday.json"), JSON.stringify(file));
  const code = judge.split("/tmp/vd_81_").join(join(dir, "vd_81_"));
  return execFileSync(process.execPath, ["-e", code], { encoding: "utf8" }).split("\n").filter(Boolean);
}
const show = (lines: string[]) => lines.join("\n");

// What production answered on 2026-10-24 at 22:21Z (the 81i probe, run live).
const BEFORE = {
  at: "2026-10-24T22:21:55Z",
  probes: [
    probeOf(REAL[0], 500, 15190, TIMEOUT), probeOf(REAL[1], 500, 15300, TIMEOUT),
    probeOf(REAL[2], 500, 15130, TIMEOUT), probeOf(MADE_UP, 500, 15120, TIMEOUT),
  ],
};
const AFTER = {
  at: "2026-10-25T00:00:00Z",
  probes: [
    probeOf(REAL[0], 200, 640, READER(212)), probeOf(REAL[1], 200, 410, READER(1800)),
    probeOf(REAL[2], 200, 520, READER(95)), probeOf(MADE_UP, 200, 300, READER(0)),
  ],
};

describe("81i: get_company_intel answers Workday tokens within 3 seconds", () => {
  it("both blocks were found, and the probe is read-only (GETs: no method, no request body)", () => {
    expect(probe.length).toBeGreaterThan(500);
    expect(probe).not.toMatch(/method\s*:/);
    const fetchOptions = [...probe.matchAll(/fetch\([^,]+,\s*\{([^}]*)\}/g)].map((m) => m[1]);
    expect(fetchOptions.length, "the sitemap GET and the reader GET").toBe(2);
    for (const o of fetchOptions) expect(o.replace(/\s+/g, " ").trim(), "fetch options carry headers and a timeout only").toMatch(/^(headers: H, )?signal: AbortSignal\.timeout\(\d+\)$/);
    expect(probe).toMatch(/rpc\/get_company_intel\?p_token=\$\{encodeURIComponent\(token\)\}/);
    for (const t of [...REAL, MADE_UP]) expect(probe, t).toContain(`"${t}"`);
    expect(probe, "a reply slower than the 15 s statement cap is still timed").toMatch(/AbortSignal\.timeout\(30000\)/);
  });

  it("FAILs on what production answered on 2026-10-24: each line names the token, the status, the code and the time", () => {
    const lines = run(BEFORE);
    expect(lines.filter((l) => l.startsWith("PASS")), show(lines)).toEqual([]);
    expect(lines.filter((l) => l.startsWith("FAIL")).length, show(lines)).toBe(4);
    expect(lines, show(lines)).toContain(
      "FAIL  81i cat~wd5~caterpillarcareers: get_company_intel answered HTTP 500 57014 in 15.19 s, want 200 within 3 s: a statement timeout, the hosting-tenant test running once per row (is 20261012137000 applied?)",
    );
    expect(lines.some((l) => l.startsWith("FAIL") && l.includes(`${MADE_UP} (made up`) && l.includes("HTTP 500 57014 in 15.12 s")), show(lines)).toBe(true);
  });

  it("PASSes on what the fix serves, printing what each reply read", () => {
    const lines = run(AFTER);
    expect(lines.filter((l) => !l.startsWith("PASS")), show(lines)).toEqual([]);
    expect(lines.length).toBe(4);
    expect(lines[0]).toBe("PASS  81i cat~wd5~caterpillarcareers: get_company_intel answered 200 in 0.64 s, within 3 s [usd_n 212, 1 countries, 0 fields, net_7d -3]");
    expect(lines[3]).toMatch(/^PASS {2}81i zzzz-none~wd1~Careers \(made up: no postings, no override\): get_company_intel answered 200 in 0\.30 s/);
  });

  it("a 200 slower than 3 seconds FAILs (the reader answered, but a reader waits that long for it)", () => {
    const lines = run({ ...AFTER, probes: [probeOf(REAL[1], 200, 3400, READER(1800))] });
    expect(lines, show(lines)).toEqual(["FAIL  81i nvidia~wd5~NVIDIAExternalCareerSite: get_company_intel answered HTTP 200 in 3.40 s, want 200 within 3 s"]);
  });

  it("a fast 200 without the reader object FAILs (an empty array or an error body is not the panel)", () => {
    for (const body of ["[]", "null", `{"message":"ok"}`]) {
      const lines = run({ ...AFTER, probes: [probeOf(REAL[2], 200, 200, body)] });
      expect(lines.length, body).toBe(1);
      expect(lines[0], body).toMatch(/^FAIL {2}81i dollartree~wd5~dollartreeus: get_company_intel answered 200 in 0\.20 s but not with the reader object/);
    }
  });

  it("a probe that never answered FAILs with status 0, and no probe file at all FAILs as not probed", () => {
    const lines = run({ ...AFTER, probes: [probeOf(REAL[0], 0, 30010, "TimeoutError")] });
    expect(lines, show(lines)).toEqual(["FAIL  81i cat~wd5~caterpillarcareers: get_company_intel answered HTTP 0 in 30.01 s, want 200 within 3 s"]);
    expect(run(null)).toEqual(["FAIL  81i get_company_intel on Workday tokens: not probed"]);
    expect(run({ at: "x", probes: [] })).toEqual(["FAIL  81i get_company_intel on Workday tokens: not probed"]);
  });

  it("a token the sitemap no longer lists is still judged, and the section says to swap it", () => {
    const lines = run({ ...AFTER, probes: [probeOf(REAL[0], 200, 500, READER(10), false)] });
    expect(lines[0]).toMatch(/^PASS/);
    expect(lines[1]).toMatch(/^INFO {2}81i cat~wd5~caterpillarcareers is no longer in the live sitemap/);
  });
});
