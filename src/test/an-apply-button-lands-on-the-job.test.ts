import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeGreenhouse } from "../../supabase/functions/job-board/normalize";

/**
 * 1,601 APPLY BUTTONS POINTED AT THE SAME SEARCH PAGE.
 *
 * Greenhouse lets an employer set absolute_url per posting, and some point
 * every posting at their careers landing page. Measured 2026-08-23: 270 apply
 * URLs on the board were shared by five or more DISTINCT titles, carrying
 * 11,202 postings — BAYADA alone hung 1,601 postings (944 titles) off
 * jobs.bayada.com/en/jobs. Every posting has SOME apply_url, zero nulls, so
 * the button looked fine and landed the reader on a search page with 944 jobs
 * to hunt through.
 *
 * The per-job page is reconstructible from the id already in hand —
 * job-boards.greenhouse.io/{token}/jobs/{id}, verified live — and the whole
 * board arrives in one payload, so counting distinct titles per URL is free.
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
