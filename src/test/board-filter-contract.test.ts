import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type AppliedFilters,
  filterViolations,
  isUnfiltered,
  normalizeFilters,
} from "../../supabase/functions/job-board/filters.ts";

// These guards assert PROPERTIES of the filter contract, not the shape of the
// code that implements it. That distinction is the whole point: 1,010 tests were
// green while production served country=null on every row, because the test
// asserted "rowToJob emits country" — the last link of the chain — and never
// that the SELECT fetched it. It would have passed with the column absent from
// the database entirely.
const norm = (b: Record<string, unknown>) => normalizeFilters(b, 40_000);

describe("normalizeFilters — a filter is never silently ignored", () => {
  // The exact defect measured live on 2026-07-29: the gate inspected
  // `typeof body.experience === "string"`, so an ARRAY was never examined; the
  // query evaluated String(["bogus"]).split(",").filter(isExperienceBand) -> []
  // and bound no predicate. Returned bands were null 15 / entry 12 / mid 8 /
  // senior 4 / expert 1 — the unfiltered board dressed as a filtered one.
  it("reports an invalid experience band sent as an ARRAY", () => {
    const { applied, ignored } = norm({ experience: ["bogus"] });
    expect(ignored).toContain("experience");
    expect(applied.experience).toEqual([]);
  });

  it("reports a PARTIALLY invalid band list — the caller still gets senior, and still gets told", () => {
    const { applied, ignored } = norm({ experience: ["senior", "bogus"] });
    expect(applied.experience).toEqual(["senior"]);
    expect(ignored).toContain("experience");
  });

  it("accepts valid bands in both shapes clients actually send", () => {
    expect(norm({ experience: ["senior"] }).applied.experience).toEqual(["senior"]);
    expect(norm({ experience: "senior" }).applied.experience).toEqual(["senior"]);
    expect(norm({ experience: "senior,entry" }).applied.experience).toEqual(["senior", "entry"]);
    expect(norm({ experience: ["senior", "entry"] }).ignored).toEqual([]);
  });

  it("normalises casing rather than dropping the filter", () => {
    // category=Engineering is what published 587,793 over a filtered page.
    expect(norm({ category: "Engineering" }).applied.category).toBe("engineering");
    expect(norm({ workMode: "REMOTE" }).applied.workMode).toBe("remote");
    expect(norm({ country: "de" }).applied.country).toBe("DE");
    expect(norm({ category: "Engineering", workMode: "REMOTE", country: "de" }).ignored).toEqual([]);
  });

  it("names values it cannot honour", () => {
    expect(norm({ country: "USA" }).ignored).toContain("country");
    expect(norm({ category: "nonsense" }).ignored).toContain("category");
    expect(norm({ workMode: "hovering" }).ignored).toContain("workMode");
    expect(norm({ postedAfter: "not-a-date" }).ignored).toContain("postedAfter");
    expect(norm({ companies: [{ nope: 1 }] }).ignored).toContain("companies");
  });

  it("does NOT report the UI's off position as ignored", () => {
    // salaryFloor=0 and maxAgeDays=0 are how the controls say "no constraint".
    // Reporting them would hang a warning on every unfiltered page.
    expect(norm({ salaryFloor: 0 }).ignored).toEqual([]);
    expect(norm({ maxAgeDays: 0 }).ignored).toEqual([]);
    expect(norm({}).ignored).toEqual([]);
  });

  it("treats an unknown company token as a real filter matching nothing, not an error", () => {
    // A truthful empty result is the correct answer to "jobs at a company we
    // don't carry" — that is not the same as an invalid request.
    const { applied, ignored } = norm({ companies: ["not-a-real-token"] });
    expect(applied.companies).toEqual(["not-a-real-token"]);
    expect(ignored).toEqual([]);
  });

  it("clamps rather than trusts", () => {
    expect(norm({ maxAgeDays: 9999 }).applied.maxAgeDays).toBe(30);
    expect(norm({ salaryFloor: 99_999_999 }).applied.salaryFloor).toBe(2_000_000);
  });
});

describe("isUnfiltered — derived, so a new filter cannot be forgotten", () => {
  it("is true only for a request with no constraint at all", () => {
    expect(isUnfiltered(norm({}).applied)).toBe(true);
    expect(isUnfiltered(norm({ salaryFloor: 0, maxAgeDays: 0 }).applied)).toBe(true);
  });

  // The property that matters. Rather than listing the filters we know about —
  // which is exactly the hand-maintained conjunction that published the whole
  // board's total over a filtered page — set each field of a FILLED applied
  // object in turn and assert every one of them is counted. A field added to
  // AppliedTypes later is covered by this test the moment it exists, with no
  // edit here.
  it("counts EVERY field of AppliedFilters, including ones added later", () => {
    const filled: AppliedFilters = {
      q: "nurse",
      location: "Berlin",
      country: "DE",
      remote: true,
      workMode: "remote",
      category: "engineering",
      experience: ["senior"],
      salaryFloor: 100_000,
      companies: ["tok"],
      maxAgeDays: 7,
      postedAfter: "2026-07-01T00:00:00Z",
    };
    const empty = norm({}).applied as unknown as Record<string, unknown>;
    const keys = Object.keys(filled) as Array<keyof AppliedFilters>;
    expect(keys.length).toBeGreaterThanOrEqual(11);
    for (const k of keys) {
      const one = { ...empty, [k]: (filled as Record<string, unknown>)[k] } as unknown as AppliedFilters;
      expect(isUnfiltered(one), `field "${String(k)}" is not counted as a filter`).toBe(false);
    }
  });
});

describe("filterViolations — the per-request self-check", () => {
  const base = norm({}).applied;

  it("flags a row that does not satisfy the filter we said we applied", () => {
    const a = { ...base, country: "DE" };
    expect(filterViolations([{ country: "DE" }], a)).toEqual([]);
    expect(filterViolations([{ country: "FR" }], a)[0]?.field).toBe("country");
    // The regression that shipped this morning: the column stopped being
    // fetched, so every row carried undefined. A mapper-level test passed.
    expect(filterViolations([{ title: "x" }], a)[0]?.field).toBe("country");
  });

  it("flags an out-of-band experience row and an undated row under maxAgeDays", () => {
    expect(filterViolations([{ experienceBand: "entry" }], { ...base, experience: ["senior"] })[0]?.field)
      .toBe("experience");
    // maxAgeDays excludes undated postings at the database, so an undated row
    // arriving under that filter is itself the defect.
    expect(filterViolations([{ postedAt: null }], { ...base, maxAgeDays: 7 })[0]?.field).toBe("maxAgeDays");
    const fresh = new Date(Date.now() - 2 * 86_400_000).toISOString();
    expect(filterViolations([{ postedAt: fresh }], { ...base, maxAgeDays: 7 })).toEqual([]);
  });

  it("does NOT flag q or location — a literal check would fail correct behaviour", () => {
    // `swe` legitimately returns "Software Engineer" via alias expansion. An
    // audit metric that looked for the literal token scored that working alias
    // 0/10 earlier today; encoding the same mistake here would make the board
    // report violations on every correct alias hit.
    expect(filterViolations([{ title: "Software Engineer" }], { ...base, q: "swe" })).toEqual([]);
    expect(filterViolations([{ location: "Remote - EU" }], { ...base, location: "Berlin" })).toEqual([]);
  });

  it("is silent on a clean page", () => {
    const a = { ...base, country: "DE", category: "engineering", remote: true };
    const rows = Array.from({ length: 60 }, () => ({ country: "DE", category: "engineering", remote: true }));
    expect(filterViolations(rows, a)).toEqual([]);
  });
});

describe("structural: the list action has ONE filter derivation", () => {
  const index = readFileSync(
    resolve(__dirname, "../../supabase/functions/job-board/index.ts"),
    "utf8",
  );
  const code = index
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");

  // The guard that actually prevents this bug class returning. Every filter
  // defect this board has shipped was two sites computing the same filter
  // differently; there were FIVE such sites before filters.ts. Re-deriving a
  // filter from the raw body inside the list action is how the next one starts.
  it("never re-derives a filter from the raw request body", () => {
    const offenders = [
      "body.country",
      "body.category",
      "body.experience",
      "body.workMode",
      "body.salaryFloor",
      "body.companies",
      "body.maxAgeDays",
      "body.postedAfter",
    ].filter((p) => code.includes(p));
    expect(offenders, `re-derived from the raw body instead of \`applied\`: ${offenders.join(", ")}`)
      .toEqual([]);
  });

  it("wires the normaliser and the self-check into the response", () => {
    expect(code).toContain("normalizeFilters(body");
    expect(code).toContain("isUnfiltered(applied)");
    expect(code).toContain("filterViolations(grouped.jobs, applied)");
    expect(code).toContain("filterIntegrity");
  });
});
