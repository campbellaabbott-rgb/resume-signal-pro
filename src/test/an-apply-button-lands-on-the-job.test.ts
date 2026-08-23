import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeGreenhouse } from "../../supabase/functions/job-board/normalize";

/**
 * THE 11,202 "SHARED APPLY URLS" WERE AN AUDIT ARTIFACT — AND THE GUARD
 * SURVIVED BECAUSE IT REFUSED TO REPEAT THE ARTIFACT.
 *
 * An audit reported 270 apply URLs shared by five or more distinct titles,
 * 11,202 postings, "BAYADA alone: 1,601 postings behind jobs.bayada.com/en/
 * jobs". Post-deploy verification read the stored rows: every one of the
 * named offenders — BAYADA, Carvana, EquipmentShare, Stripe, Databricks,
 * Elastic — carries a UNIQUE ?gh_jid= query parameter. They are Greenhouse
 * embedded-board deep links that open the specific job. The audit had grouped
 * URLs after stripping query strings, then reported its own normalization as
 * a defect. There was nothing to fix.
 *
 * Both halves of the fix keyed on the FULL URL, so both were no-ops against
 * the real data: the migration's GROUP BY matched nothing, and the ingest
 * counter sees each gh_jid link as distinct. Had either stripped query
 * strings the way the audit did, they would have rewritten eleven thousand
 * WORKING employer-branded links — the "fix" would have been the defect.
 *
 * The detection stays, dormant, because the shape it defends against is real
 * even though no employer currently exhibits it: a URL shared VERBATIM by
 * five different titles is a board index, and a reader deserves the job page.
 *
 * AND THE SIBLING DEFECT ON WORKDAY: one requisition appearing on several of
 * a tenant's career sites under Workday's own "-1"/"-2" discriminator — 9,246
 * redundant postings, up to 54% of one employer's board. The suffixed copy is
 * the duplicate; the ingest skip and the migration below both lean on the
 * digit-stem guard, because a naive strip turns JR-134112 into "JR" and
 * over-merges sixty thousand rows.
 */
const ROOT = resolve(__dirname, "../..");
const FN = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");

const gh = (jobs: Array<{ id: number; title: string; url: string }>) =>
  normalizeGreenhouse(
    { jobs: jobs.map((j) => ({ id: j.id, title: j.title, absolute_url: j.url })) as never },
    "Acme", "acme",
  );

describe("an apply button lands on the job", () => {
  it("five titles behind one URL is a board index — every job gets its own page", () => {
    const out = gh([1, 2, 3, 4, 5, 6].map((i) => ({ id: i, title: `Role ${i}`, url: "https://jobs.acme.com/en/jobs" })));
    for (const j of out) {
      expect(j.applyUrl).toBe(`https://job-boards.greenhouse.io/acme/jobs/${j.id.split(":")[2]}`);
    }
  });

  it("a role reposted two or three times keeps the employer's URL", () => {
    // Two or three CAN be one genuine role listed twice; five distinct titles
    // cannot. The threshold is the audit's, not a round number.
    const out = gh([
      { id: 1, title: "Nurse", url: "https://jobs.acme.com/nurse" },
      { id: 2, title: "Nurse", url: "https://jobs.acme.com/nurse" },
      { id: 3, title: "Chef", url: "https://jobs.acme.com/chef" },
    ]);
    expect(out[0].applyUrl).toBe("https://jobs.acme.com/nurse");
    expect(out[2].applyUrl).toBe("https://jobs.acme.com/chef");
  });

  it("ordinary per-job URLs pass through untouched", () => {
    const out = gh([{ id: 9, title: "Baker", url: "https://boards.greenhouse.io/acme/jobs/9" }]);
    expect(out[0].applyUrl).toBe("https://boards.greenhouse.io/acme/jobs/9");
  });

  it("the workday cross-site skip never routes a stored row into the prune", () => {
    // Filtering an already-stored row makes it feed-absent, and the absence
    // machinery would two-pass it into missing_since AND write a closure event
    // — 9,246 fictional takedowns into the lifecycle log. The skip must apply
    // only to rows never stored; the migration deletes the rest silently.
    expect(FN).toMatch(/if \(alreadyStored\.has\(j\.id\)\) return true;/);
    expect(FN).toMatch(/workday cross-site dedupe/);
    // The digit-stem guard, on the ingest side.
    expect(FN).toMatch(/\/\\d\{3\}\/\.test\(req\.slice\(0, m\.index\)\)/);
  });

  it("the migration carries the same guard and never touches the closure machinery", () => {
    const dir = resolve(ROOT, "supabase/migrations");
    const raw = readFileSync(resolve(dir, readdirSync(dir).find((f) => f.includes("one_requisition_is_one_posting"))!), "utf8");
    // SQL comments stripped first: the header EXPLAINS why the delete avoids
    // the closure machinery, so the explanation names the column — and an
    // unstripped negative assertion reads its own justification and fails.
    // Seventh occurrence of this trap in the repo; see project memory.
    const mig = raw.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
    expect(mig).toMatch(/regexp_replace\(d\.req, '-\\d\{1,2\}\$', ''\) ~ '\\d\{3\}'/);
    expect(mig).toMatch(/DELETE FROM public\.job_board_postings/);
    expect(mig).not.toMatch(/missing_since/i);
  });
});
