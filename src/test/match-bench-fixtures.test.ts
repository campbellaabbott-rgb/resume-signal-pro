// @vitest-environment node
/**
 * THE BENCH'S FIXTURES ARE WHAT THE SPEC SAYS THEY ARE (spec §19.1).
 *
 *   - the 24 dev résumés, their manifest and the PDF reads the BEFORE run used;
 *   - 60 held-out résumés, written blind (before their author read the title
 *     families, the gate or tier rules, or any retrieval), covering 15
 *     occupations in 6 countries at three levels, with the career changers,
 *     returners, new grads, non-English dates, two-column layouts, headers
 *     with no place, sponsorship needs and out-of-state licences §19.1 lists;
 *   - the frozen corpus, at most 4 MB, every row any shown list names, and
 *     NOTHING PERSONAL: the posting descriptions it keeps for the rubric carry
 *     no email, phone number or profile link, and every person in a résumé is
 *     invented (example.com mail, fictional phone ranges).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, loadCorpus } from "./fixtures/match-bench/corpus";
import { RESUMES } from "./fixtures/match-bench/dev/manifest";
import { HELDOUT } from "./fixtures/match-bench/heldout/manifest";
import { beforeRanked, protoTop20 } from "./fixtures/match-bench/metrics";
import { personalLeft, scrubPersonal } from "./fixtures/match-bench/scrub";

const count = <T>(xs: T[], f: (x: T) => boolean) => xs.filter(f).length;

describe("the dev set", () => {
  it("is the 24 résumés BEFORE measured, each with its text and its PDF read", () => {
    expect(RESUMES).toHaveLength(24);
    expect(new Set(RESUMES.map((r) => r.id)).size).toBe(24);
    for (const r of RESUMES) {
      expect(existsSync(join(FIXTURES, "dev", r.file)), r.file).toBe(true);
      expect(existsSync(join(FIXTURES, "dev", "parsed", `${r.id}.pdf.txt`)), r.id).toBe(true);
    }
    expect(beforeRanked().map((b) => b.id).sort()).toEqual(RESUMES.map((r) => r.id).sort());
  });
});

describe("the held-out set", () => {
  it("has 60 résumés none of which is a dev résumé", () => {
    expect(HELDOUT).toHaveLength(60);
    expect(new Set(HELDOUT.map((h) => h.id)).size).toBe(60);
    const dev = new Set(RESUMES.map((r) => r.id));
    expect(HELDOUT.filter((h) => dev.has(h.id))).toEqual([]);
    for (const h of HELDOUT) {
      expect(existsSync(join(FIXTURES, "heldout", h.file)), h.file).toBe(true);
      expect(existsSync(join(FIXTURES, "heldout", "parsed", `${h.id}.pdf.txt`)), h.id).toBe(true);
    }
  });

  it("covers what §19.1 lists", () => {
    const fields = new Map<string, number>();
    for (const h of HELDOUT) fields.set(h.field, (fields.get(h.field) ?? 0) + 1);
    expect(fields.size).toBe(15);
    expect([...fields.values()].every((n) => n === 4)).toBe(true);
    expect(new Set(HELDOUT.map((h) => h.country))).toEqual(new Set(["US", "CA", "GB", "DE", "AU", "IN"]));
    expect(new Set(HELDOUT.map((h) => h.level))).toEqual(new Set(["entry", "mid", "senior"]));
    expect(count(HELDOUT, (h) => h.careerChanger)).toBeGreaterThanOrEqual(8);
    expect(count(HELDOUT, (h) => h.gap)).toBeGreaterThanOrEqual(6);
    expect(count(HELDOUT, (h) => h.newGrad)).toBeGreaterThanOrEqual(6);
    expect(count(HELDOUT, (h) => h.dateFormat !== "en")).toBeGreaterThanOrEqual(6);
    expect(count(HELDOUT, (h) => h.layout === "two-column")).toBe(6);
    expect(count(HELDOUT, (h) => !h.headerHasLocation)).toBe(6);
    expect(count(HELDOUT, (h) => h.sponsorshipFuture)).toBe(4);
    expect(count(HELDOUT, (h) => h.licensedElsewhere)).toBe(4);
  });

  it("says in its manifest and the bench README that it was written blind", () => {
    const manifest = readFileSync(join(FIXTURES, "heldout", "manifest.ts"), "utf8");
    expect(manifest).toMatch(/Written blind on 2026-10-12/);
    const readme = readFileSync(join(FIXTURES, "../../../../scripts/match-bench/README.md"), "utf8");
    expect(readme).toMatch(/written blind/i);
  });

  it("lays two-column résumés out as two columns, which the parser's multi-column check sees", () => {
    for (const h of HELDOUT.filter((x) => x.layout === "two-column")) {
      expect(readFileSync(join(FIXTURES, "heldout", h.file), "utf8"), h.id).toMatch(/ \|\| /);
    }
  });
});

describe("nothing personal", () => {
  const resumeTexts = [
    ...RESUMES.map((r) => readFileSync(join(FIXTURES, "dev", r.file), "utf8")),
    ...HELDOUT.map((h) => readFileSync(join(FIXTURES, "heldout", h.file), "utf8")),
  ];

  it("gives every invented person an example.com address", () => {
    for (const t of resumeTexts) {
      const mails = t.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
      expect(mails.length).toBeGreaterThan(0);
      for (const m of mails) expect(m).toMatch(/@example\.com$/);
    }
  });

  it("keeps no email, phone number or profile link in any posting description", () => {
    const c = loadCorpus();
    const left: string[] = [];
    for (const id of c.rows.keys()) {
      const d = c.description(id);
      if (d) left.push(...personalLeft(d));
    }
    expect(left).toEqual([]);
  });

  it("scrubs contact details and leaves years and pay ranges alone", () => {
    expect(scrubPersonal("Email jane.doe@hospital.org or call (614) 555-0142.")).toBe("Email [email] or call [phone].");
    expect(scrubPersonal("See linkedin.com/in/jane-doe for more")).toBe("See [profile] for more");
    expect(scrubPersonal("Experience 2019 - 2024; pay 60 000 - 80 000")).toBe("Experience 2019 - 2024; pay 60 000 - 80 000");
  });
});

describe("the frozen corpus", () => {
  it("is at most 4 MB and names its version and freeze time", () => {
    expect(statSync(join(FIXTURES, "corpus.json.gz")).size).toBeLessThanOrEqual(4 * 1024 * 1024);
    const c = loadCorpus();
    expect(c.version).toMatch(/^match-bench-corpus\.2026-10-12\.\d+$/);
    expect(Number.isNaN(Date.parse(c.frozenAt))).toBe(false);
    expect(c.rows.size).toBeGreaterThan(4000);
    expect(c.descriptionCount).toBeGreaterThan(600);
  });

  it("holds every row the BEFORE measurement and the prototype show", () => {
    const c = loadCorpus();
    const ids = [
      ...beforeRanked().flatMap((b) => b.ranked.map((x) => x.row.id)),
      ...Object.values(protoTop20()).flatMap((p) => [...p.extract, ...p.oracle]),
    ];
    expect(ids.filter((id) => !c.rows.has(id))).toEqual([]);
  });

  it("cuts descriptions where fit-batch and the requirement reader cut them", () => {
    const c = loadCorpus();
    let longest = 0;
    for (const id of c.rows.keys()) longest = Math.max(longest, c.description(id)?.length ?? 0);
    expect(longest).toBeLessThanOrEqual(20_000);
  });
});
