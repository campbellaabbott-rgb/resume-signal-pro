// @vitest-environment node
/**
 * EACH OF THE BENCHMARK'S FIFTEEN FAILING INPUTS FILLS ITS PAGE WHEN THE
 * BOARD HOLDS ENOUGH SERVABLE ROWS, AND NEVER HANDS ON A WITHHELD SOURCE
 * (lane fix/1121-connector-errors, the replay as a test).
 *
 * Datacircle scored the connector 80.2 on 2026-11-11 with 22 of 200 slots
 * unfilled; a slot left empty counts as wrong (score = matches / (10 -
 * unconfirmed)). The fifteen inputs below are its own calls, as sent
 * ({query: <word>, country: <ISO code>, limit: 10}), copied from
 * datacircle-2026-11-21/replay-inputs.json. The board is stubbed: for each
 * input it holds 30 rows of that word in that country, with SmartRecruiters
 * rows and unlabelled USAJOBS rows scattered through the first fifteen the
 * way the live pages measured (up to five withheld in the first fifteen).
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const INPUTS: Array<{ n: number; query: string; country: string }> = [
  { n: 1, query: "Recruiter", country: "IE" }, { n: 2, query: "Manager", country: "IT" }, { n: 3, query: "Marketing", country: "ES" },
  { n: 4, query: "Data", country: "PL" }, { n: 5, query: "Finance", country: "BE" }, { n: 6, query: "Cloud", country: "AU" },
  { n: 7, query: "Consultant", country: "CH" }, { n: 8, query: "Project", country: "US" }, { n: 9, query: "Software", country: "SE" },
  { n: 10, query: "Support", country: "GB" }, { n: 11, query: "Developer", country: "IN" }, { n: 12, query: "Engineer", country: "JP" },
  { n: 13, query: "Operations", country: "BR" }, { n: 14, query: "Sales", country: "NL" }, { n: 15, query: "Analyst", country: "DE" },
];
const WITHHELD = ["smartrecruiters", "usajobs"];

/** Up to five withheld rows in the first fifteen, at positions that differ by input. */
function rowsFor(n: number, query: string, country: string) {
  const held = new Map<number, string>();
  const k = n % 6; // 0 to 5 withheld rows
  for (let i = 0; i < k; i++) held.set((n * 3 + i * 4) % 15, i % 2 === 0 ? "smartrecruiters" : "usajobs");
  return Array.from({ length: 30 }, (_, i) => {
    const source = held.get(i) ?? "greenhouse";
    return { id: `${source}:emp${n}:${i}`, source, token: `emp${n}`, company: `Employer ${n}`, title: `${query} ${i}`, country, matchScope: "title" };
  });
}

let m: KeylessMcp;
beforeAll(async () => {
  m = await bootKeylessMcp();
}, 120_000);

describe("the fifteen benchmark inputs, replayed against a stubbed board", () => {
  it.each(INPUTS)("input $n ($query in $country) answers ten rows, none from a withheld source", async ({ n, query, country }) => {
    const rows = rowsFor(n, query, country);
    m.board = (b) => {
      if (b.countOnly) return new Response(JSON.stringify({ total: rows.filter((r) => r.source === b.vendor).length }), { status: 200 });
      expect(b).toMatchObject({ q: query, country });
      const offset = Number(b.offset ?? 0);
      const limit = Number(b.limit ?? 20);
      return new Response(JSON.stringify({ jobs: rows.slice(offset, offset + limit), total: 30, hasMore: offset + limit < 30, nextOffset: offset + limit }), { status: 200 });
    };
    const r = await m.call({ query, country, limit: 10 });
    expect(r.isError).toBe(false);
    const body = JSON.parse(r.text) as { jobs: Array<{ id: string; country?: string }>; pageShortBecause?: string };
    expect(body.jobs.map((j) => j.id.split(":")[0]).filter((v) => WITHHELD.includes(v))).toEqual([]);
    expect(body.jobs).toHaveLength(10);
    expect(body.pageShortBecause).toBeUndefined();
    for (const j of body.jobs) expect(j.country ?? country).toBe(country);
  });
});
