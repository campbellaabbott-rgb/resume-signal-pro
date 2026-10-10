/**
 * WHEN A GUARD ON BUILT OUTPUT MAY SKIP.
 *
 * A handful of suites read dist/ -- the sitemap, the prerendered pages, the
 * preload hints -- and dist/ exists only after `npm run build`. Locally they
 * skip without it, which is right: a developer running one test file has not
 * built. But CI ran vitest BEFORE its build, so on every run until 2026-10-10
 * they skipped there too, and the soft-404 sitemap guards had never executed
 * anywhere. A skip is not a pass, and a gate that skips every time is no gate.
 *
 * So the CI job that builds first sets RB_REQUIRE_DIST=1, and under it a
 * missing dist/ is NOT a reason to skip: the suite runs and fails on the
 * absent file, by name. Every suite that reads dist/ skips through this
 * helper, and the `built-output` job in .github/workflows/ci.yml selects its
 * suites by that skip call, so a new dist/ guard joins the job by using it.
 */
export const DIST_REQUIRED = process.env.RB_REQUIRE_DIST === "1";

/** For `describe.skipIf(...)` / `it.skipIf(...)`: skip only when the output is absent AND nobody required it. */
export function skipWithoutDist(present: boolean, required: boolean = DIST_REQUIRED): boolean {
  return !present && !required;
}
