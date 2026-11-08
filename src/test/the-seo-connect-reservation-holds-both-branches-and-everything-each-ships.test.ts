// @vitest-environment node
/**
 * THE SEO-CONNECT RESERVATION HOLDS BOTH BRANCHES AND EVERYTHING EACH SHIPS
 * (the fix round of 2026-11-08).
 *
 * fix/seo-connect-fe and fix/connect-mcp each added a "seo-connect"
 * reservation to docs/deploy-ledger.json at the same spot with different
 * contents, so whichever merged second conflicted, and a one-sided resolution
 * lost a branch, a verify section or the function build note. The connect
 * side's status also deferred a save-from-link prompt this branch ships.
 *
 * This branch now carries the one entry both can resolve to: both branches,
 * the union of their verify sections, the two functions the connect track
 * builds, the fe track's one migration, and no stale deferral.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const ledger = JSON.parse(readFileSync(resolve(ROOT, "docs/deploy-ledger.json"), "utf8"));
const r = ledger.reservations["seo-connect"];
const STALE_DEFERRAL = "the save=1 link (the board has no save-on-open)";

describe("the seo-connect reservation", () => {
  it("names both branches", () => {
    expect(r.branches).toEqual(expect.arrayContaining(["fix/seo-connect-fe", "fix/connect-mcp"]));
  });
  it("lists every verify section either branch added", () => {
    expect(r.verifySections).toEqual(expect.arrayContaining(["98-seo-r2.sh", "98-seo-speed.sh", "99zzzz-ca3-apply.sh"]));
  });
  it("names the two functions the connect track builds, and no fe function", () => {
    expect(r.fnBuildDate).toMatch(/agent-mcp at 2026-11-08\.1/);
    expect(r.fnBuildDate).toMatch(/public-api at 2026-11-08\.1/);
    expect(r.fnBuildDate).toMatch(/the fe track changes no edge function/);
  });
  it("names the fe track's one migration here and in the next free range", () => {
    expect(r.migrations).toMatch(/20261108100000/);
    expect(ledger.reservations.next.migrations).toMatch(/seo-connect's: 20261108100000 on fix\/seo-connect-fe; agent-mcp and public-api at 2026-11-08\.1/);
  });
  it("carries both tracks' status and no deferral of the save-from-link prompt this branch ships", () => {
    expect(r.status).toMatch(/The fe track \(fix\/seo-connect-fe\)/);
    expect(r.status).toMatch(/The connect track \(fix\/connect-mcp\)/);
    expect(existsSync(resolve(ROOT, "src/components/jobs/SaveFromLinkPrompt.tsx"))).toBe(true);
    expect(r.status).not.toContain(STALE_DEFERRAL);
  });
});
