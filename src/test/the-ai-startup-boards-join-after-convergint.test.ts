// @vitest-environment node
/**
 * THE AI-STARTUP BOARDS JOIN AFTER CONVERGINT (job-board 2026-09-09.103, row A).
 *
 * The owner asked on 2026-11-17 for more jobs that need nobody's permission, and for more of what
 * visitors search ("ai engineer" was thin). Row A is the jobs-clear list's AI-startup boards on vendors
 * whose robots and terms allow the read, plus two Lever boards now that .103 paces Lever. Every number
 * here comes from src/test/fixtures/board-103-row-a-2026-11-17.json:
 *
 *  - ADDED. Each board was read once on the endpoint the reader uses, robots.txt first, on 2026-11-18
 *    from 01:51Z. It still lists postings, at least one inside the 30-day window, and they print the
 *    employer's name, quoted in the fixture. The catalogue carries the name its postings print.
 *  - APPENDED. The refresh cursor is positional, so the six go after Convergint, the last board .102
 *    appended, and no other board's place moves.
 *  - HELD. The eleven Ashby boards wait for the owner's OD14(b) answer. Ashby's robots file forbids the
 *    application-questions call that job-board and /v1 still make, and every Ashby board added widens
 *    it (jobs-clear spec-final, L-M4). Their reads were not made.
 *  - LEVER RIDES THE GATE. api.lever.co asks for a one-second Crawl-delay. The two Lever boards are
 *    valid only in a build whose shared host gate paces that host at 1,000 ms or more (item 18).
 *    grow/103-integration carries the gate; this branch's BUILD_VERSION is still .102's.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JOB_SOURCES } from "../../supabase/functions/job-board/sources";
import { isUnreviewedTenantName } from "../lib/company-display";
import { censusNameReason } from "../../scripts/census-names.mjs";
import { codeOf } from "./helpers/strip-comments";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
type Req = { url: string; at: string; status: number; bytes: number; sha256_16: string };
type Added = { key: string; name: string; robots: Req & { host: string; rule: string }; read: Req; nameFrom: string; evidence: string; quoteFrom: string; total: number; inWindow: number; millHits: number; termsRead?: { verdict: string } };
const FIX = JSON.parse(read("src/test/fixtures/board-103-row-a-2026-11-17.json")) as {
  window: { days: number; cutoff: string };
  appendedAfter: string;
  added: Added[];
  held: Array<{ key: string; name: string; reason: string }>;
};
const DEAD = JSON.parse(read("src/test/fixtures/board-103-catalogue-2026-11-17.json")) as {
  pruned: Array<[string, string, string]>; retired: string[]; held: Array<{ key: string }>;
};

const key = (s: { source: string; token: string }) => `${s.source}:${s.token}`;
const tokenOf = (k: string) => k.slice(k.indexOf(":") + 1);
const KEYS = JOB_SOURCES.map(key);
const ROW_A = FIX.added.map((a) => a.key);

describe("row A is carried, after Convergint, under the names its postings print", () => {
  it("the six boards sit right after Convergint, in the fixture's order, and nothing follows them", () => {
    expect(ROW_A).toEqual(["greenhouse:castelioncorporation", "greenhouse:aidocmedical", "greenhouse:dropzoneai", "teamtailor:sipearl", "lever:upscale-ai", "lever:mythic-ai.com"]);
    const at = KEYS.indexOf(FIX.appendedAfter);
    expect(at, `${FIX.appendedAfter} is not catalogued`).toBeGreaterThan(0);
    expect(KEYS.slice(at + 1)).toEqual(ROW_A);
    for (const a of FIX.added) expect(JOB_SOURCES[KEYS.indexOf(a.key)].name, a.key).toBe(a.name);
  });

  it("each token is carried once, by one vendor, so no board name is shared with another employer's", () => {
    for (const a of FIX.added) {
      expect(JOB_SOURCES.filter((s) => s.token.toLowerCase() === tokenOf(a.key).toLowerCase()).map(key), a.key).toEqual([a.key]);
    }
  });

  it("each name is the one its board prints, quoted from that board's own response", () => {
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const a of FIX.added) {
      expect(new RegExp(`(^|[^A-Za-z0-9])${esc(a.name)}([^A-Za-z0-9]|$)`).test(a.evidence), `${a.key} is carried as ${a.name}: ${a.evidence}`).toBe(true);
      expect(new URL(a.quoteFrom).protocol, a.key).toBe("https:");
    }
    // Greenhouse states the employer in a field; Lever's list has none, so its names come from the text.
    for (const a of FIX.added.filter((x) => x.key.startsWith("greenhouse:"))) expect(a.evidence, a.key).toContain(`company_name "${a.name}"`);
  });

  it("each name passes the census screen and gets posting pages: no junk, staffing or label shape, and not the token title-cased", () => {
    for (const a of FIX.added) {
      expect(censusNameReason(a.name), a.key).toBeNull();
      expect(isUnreviewedTenantName(tokenOf(a.key), a.name), a.key).toBe(false);
      expect(/\b(staffing|recruit(ing|ment|er)?s?|headhunt|personnel|manpower|demo|test|sample|sandbox|placeholder)\b/i.test(a.name), a.key).toBe(false);
    }
  });
});

describe("each board was read live, robots first, and is worth reading", () => {
  it("robots before the board on the same host, both answered 200, the board lists at least 3 postings and one inside the window", () => {
    for (const a of FIX.added) {
      expect(new URL(a.read.url).host, a.key).toBe(a.robots.host);
      expect(a.robots.at < a.read.at, `${a.key}: robots was not read first`).toBe(true);
      expect([a.robots.status, a.read.status], a.key).toEqual([200, 200]);
      expect(a.total, `${a.key}: merge-all's three-posting floor`).toBeGreaterThanOrEqual(3);
      expect(a.inWindow, `${a.key}: nothing inside the window`).toBeGreaterThanOrEqual(1);
      expect(a.inWindow, a.key).toBeLessThanOrEqual(a.total);
      expect(a.millHits, `${a.key}: placement language in its postings`).toBe(0);
    }
    expect(FIX.window).toMatchObject({ days: 30 });
    // 110 recent postings of 396 listed at the read.
    expect([FIX.added.reduce((n, a) => n + a.total, 0), FIX.added.reduce((n, a) => n + a.inWindow, 0)]).toEqual([396, 110]);
  });

  it("SiPearl's careers site was read for terms that bar automated reading, and has none", () => {
    expect(FIX.added.find((a) => a.key === "teamtailor:sipearl")?.termsRead?.verdict).toBe("not barred");
  });

  it("no row A board left the catalogue in this build or an earlier one: not pruned, retired or held", () => {
    const gone = new Set([...DEAD.pruned.map(([k]) => k), ...DEAD.retired, ...DEAD.held.map((h) => h.key)]);
    const twins = JSON.parse(`[${/const RETIRED_TWIN_KEYS: readonly string\[\] = \[([^\]]*)\];/.exec(codeOf(read("supabase/functions/job-board/index.ts")))?.[1] ?? ""}]`) as string[];
    expect(twins.length).toBeGreaterThan(0);
    for (const k of ROW_A) {
      expect(gone.has(k), k).toBe(false);
      expect(twins.map(tokenOf), k).not.toContain(tokenOf(k));
    }
  });
});

describe("the Ashby boards wait for OD14(b)", () => {
  it("none of the eleven is carried, under any vendor", () => {
    expect(FIX.held).toHaveLength(11);
    const tokens = new Set(JOB_SOURCES.map((s) => s.token.toLowerCase()));
    for (const h of FIX.held) {
      expect(h.key.startsWith("ashby:"), h.key).toBe(true);
      expect(h.reason, h.key).toMatch(/OD14\(b\)/);
      expect(tokens.has(tokenOf(h.key).toLowerCase()), `${h.key} is carried before the owner's OD14(b) answer`).toBe(false);
    }
  });
});

/**
 * The two Lever boards need the shared gate. A build of .103 or later must carry _shared/host-gate.ts
 * with api.lever.co at 1,000 ms or more; this lane's own branch is still .102's and never ships alone,
 * since build-version-guard makes the catalogue change move BUILD_VERSION.
 */
function leverGateHolds(buildVersion: string, gate: string | null): boolean | "not-a-103-build" {
  const m = /^2026-09-09\.(\d+)$/.exec(buildVersion);
  if (!m || Number(m[1]) < 103) return /^2026-09-09\.\d+$/.test(buildVersion) ? "not-a-103-build" : false;
  const ms = gate ? /"api\.lever\.co":\s*([\d_]+)/.exec(codeOf(gate))?.[1] : undefined;
  return ms !== undefined && Number(ms.replace(/_/g, "")) >= 1_000;
}

describe("Lever rides the shared host gate", () => {
  it("a .103-or-later build carries the gate pacing api.lever.co at a second or more", () => {
    const build = /const BUILD_VERSION = "([^"]+)"/.exec(read("supabase/functions/job-board/index.ts"))?.[1] ?? "";
    const gatePath = resolve(ROOT, "supabase/functions/_shared/host-gate.ts");
    const verdict = leverGateHolds(build, existsSync(gatePath) ? readFileSync(gatePath, "utf8") : null);
    expect(FIX.added.filter((a) => a.key.startsWith("lever:")).length).toBe(2);
    expect(verdict, `job-board ${build} carries Lever boards row A added, without a one-second gate on api.lever.co`).not.toBe(false);
  });

  it("has teeth: no gate, a faster gate or a commented-out row fails a .103 build", () => {
    const gate = `export const HOST_DELAY_MS = {\n  "api.lever.co": 1_000,\n  "api.eu.lever.co": 1_000,\n};`;
    expect(leverGateHolds("2026-09-09.103", gate)).toBe(true);
    expect(leverGateHolds("2026-09-09.104", gate)).toBe(true);
    expect(leverGateHolds("2026-09-09.103", null)).toBe(false);
    expect(leverGateHolds("2026-09-09.103", gate.replace('"api.lever.co": 1_000', '"api.lever.co": 500'))).toBe(false);
    expect(leverGateHolds("2026-09-09.103", gate.replace('  "api.lever.co": 1_000,', '  // "api.lever.co": 1_000,'))).toBe(false);
    expect(leverGateHolds("2026-09-09.102", null)).toBe("not-a-103-build");
    expect(leverGateHolds("", gate)).toBe(false);
  });
});
