import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { searchName, searchToQuery } from "../lib/job-search-params";

/**
 * Reopening a saved search landed you on a DIFFERENT search.
 *
 * saveCurrentSearch already stored work mode, country, the freshness window,
 * agent-only and the uncategorised toggle — its own comment says "a saved search
 * is a promise to mail THIS query" — but the shared module that Account uses to
 * reopen and to NAME them knew only seven fields. So the extra filters were
 * dropped on the way back, and two searches differing only by those produced the
 * same name and read as duplicates.
 */
const BOARD = readFileSync(resolve(__dirname, "../pages/Jobs.tsx"), "utf8");

describe("a saved search is a promise to mail this query", () => {
  it("carries work mode, country, freshness and agent-only back to the board", () => {
    const qs = searchToQuery({
      q: "nurse", country: "US,GB", workMode: "remote,hybrid",
      maxAgeDays: 7, sendableOnly: true, category: "healthcare", includeUncategorised: true,
    });
    const p = new URLSearchParams(qs.split("?")[1]);
    expect(p.get("q")).toBe("nurse");
    expect(p.get("country")).toBe("US,GB");
    expect(p.get("mode")).toBe("remote,hybrid");
    expect(p.get("fresh")).toBe("7");
    expect(p.get("agentOnly")).toBe("1");
    expect(p.get("inclUncat")).toBe("1");
  });

  it("spells every parameter the way the board reads it", () => {
    // A link that spells a parameter the board does not read reopens WITHOUT
    // that filter, silently — which is exactly how this defect looked. `mode`,
    // not `workMode`; `fresh`, not `freshness`; `agentOnly`, not `sendableOnly`.
    const emitted = [...(readFileSync(resolve(__dirname, "../lib/job-search-params.ts"), "utf8")
      .matchAll(/qs\.set\("([^"]+)"/g))].map((m) => m[1]);
    expect(emitted.length).toBeGreaterThan(8);
    for (const name of emitted) {
      const read = BOARD.includes(`initial.get("${name}")`) || BOARD.includes(`p.set("${name}"`);
      expect(read, `the board never reads "${name}" — that filter is silently dropped on reopen`).toBe(true);
    }
  });

  it("gives two genuinely different searches two different names", () => {
    const a = searchName({ q: "engineer", country: "US", workMode: "remote" });
    const b = searchName({ q: "engineer", country: "DE", workMode: "onsite" });
    expect(a).not.toBe(b);
    // And the name says what actually distinguishes them.
    expect(a).toContain("US");
    expect(b).toContain("on-site");
  });

  it("still names an empty search, and still reads well for a simple one", () => {
    expect(searchName({})).toBe("All jobs");
    expect(searchName({ q: "nurse", remote: true })).toBe("nurse · remote");
  });

  it("keeps a multi-mode selection readable rather than raw", () => {
    // "workMode.remote,hybrid" is not an i18n key and the raw comma-joined value
    // is not a phrase — the chip row hit exactly this.
    expect(searchName({ q: "dev", workMode: "remote,hybrid" })).toBe("dev · remote/hybrid");
  });
});
