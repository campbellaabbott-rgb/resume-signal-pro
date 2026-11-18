// @vitest-environment node
/**
 * SEO AUDIT 2026-11-18: THE THREE BRANCHES HAVE A RESERVATION OF THEIR OWN.
 *
 * The audit's plan (mergeWindow) says its branches take a deploy-ledger
 * reservation for seo/1118-*, with no migration and no function, its verify
 * sections listed, merging in ledger order after bug round B, board-102's
 * names deploy and job-board .103. seo-round named the bare seo/ prefix, and
 * workstreamOf takes the first reservation that names a branch, so without a
 * change there the three branches would read as the round of 2026-10-12.
 *
 * Judged through workstreamOf, the reader scripts/deploy-ledger.mjs uses,
 * never by looking for a line.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { workstreamOf } from "../../scripts/deploy-ledger.mjs";

const ROOT = resolve(__dirname, "../..");
type Reservation = { branches?: string[]; migrations?: string; jobBoard?: string; fnBuildDate?: string; verifySections?: string[]; status?: string; deployOrder?: number };
const LEDGER = JSON.parse(readFileSync(resolve(ROOT, "docs/deploy-ledger.json"), "utf8")) as { reservations: Record<string, Reservation> };
const R = LEDGER.reservations["seo-1118"] ?? {};
const BRANCHES = ["seo/1118-postings", "seo/1118-rendered", "seo/1118-crawl-config"];
/** The one section lane A adds on its own branch, so it is not on this one. */
const LANE_A_NEW = "98zzz-seo-1118-bake.sh";
/** board-103's deployOrder on grow/103-integration, which this branch was not cut from. */
const BOARD_103_ORDER = 4.7;

describe("the seo-1118 reservation", () => {
  it("names the three lane branches, and workstreamOf reads each of them as seo-1118", () => {
    expect(R.branches).toEqual(BRANCHES);
    for (const b of BRANCHES) expect(workstreamOf(LEDGER, b)).toBe("seo-1118");
    for (const b of BRANCHES) expect(workstreamOf(LEDGER, `origin/${b}`)).toBe("seo-1118");
  });

  it("takes no migration, no function build and no job-board version", () => {
    expect(R).toMatchObject({ migrations: "none", jobBoard: "none", fnBuildDate: "none" });
  });

  it("lists its verify sections: lane C's 98zz, lane A's three readers here, and lane A's new section by name", () => {
    expect(R.verifySections).toEqual(expect.arrayContaining(["98zz-seo-non-posting-pages.sh", "98-seo-r2.sh", "98-seo-speed.sh", "98-seo-round.sh", LANE_A_NEW]));
    const missing = (R.verifySections ?? []).filter((s) => !existsSync(resolve(ROOT, "scripts/verify-deploy.d", s)));
    expect(missing).toEqual([LANE_A_NEW]);
    expect(R.status).toContain(LANE_A_NEW);
  });

  it("deploys after bug round B, board-102's names and .103", () => {
    const order = R.deployOrder ?? 0;
    expect(order).toBeGreaterThan(LEDGER.reservations["bug-round"].deployOrder ?? Infinity);
    expect(order).toBeGreaterThan(LEDGER.reservations["board-102"].deployOrder ?? Infinity);
    expect(order).toBeGreaterThan(BOARD_103_ORDER);
    expect(R.status).toMatch(/board\/102-names/);
  });

  it("seo-round keeps its own merged branches, and no other reservation claims a seo/1118 branch", () => {
    for (const b of ["seo/integration", "seo/bake", "seo/react", "seo/speed", "seo/early-images", "seo/fixes-2026-11-15"]) expect(workstreamOf(LEDGER, b)).toBe("seo-round");
    const claims = Object.entries(LEDGER.reservations)
      .filter(([k]) => k !== "seo-1118")
      .filter(([, r]) => (r.branches ?? []).some((b) => BRANCHES.some((x) => (b.endsWith("/") ? x.startsWith(b) : x === b))))
      .map(([k]) => k);
    expect(claims).toEqual([]);
  });

  it("teeth: the bare seo/ prefix back on seo-round reads the three branches as seo-round", () => {
    const before = { reservations: { ...LEDGER.reservations, "seo-round": { ...LEDGER.reservations["seo-round"], branches: ["seo/"] } } };
    expect(BRANCHES.map((b) => workstreamOf(before, b))).toEqual(["seo-round", "seo-round", "seo-round"]);
  });
});
