// @vitest-environment node
/**
 * BOARD .103 REVIEW (search-pay lens): THE DESCRIPTION BACKFILL OVERWROTE THE
 * BOARD'S STATED PAY WITH THE MINER'S.
 *
 * A refresh reads Greenhouse with pay_transparency and prefers the board's own
 * stated range over anything mined from the description. backfill-desc fetched
 * the posting without it and wrote the miner's figure whenever it found one,
 * so a row flipped between the two readings visit by visit. It now mines pay
 * only for a row that holds none, as a refresh does.
 *
 * Runs the real backfill-desc block, lifted from job-board/index.ts.
 */
import { describe, expect, it } from "vitest";
import { compile, ifBlock, op, stubClient, type Call } from "./helpers/lift-index";
import { extractSalary, parseSalaryStructured } from "../../supabase/functions/_shared/salary-extract";

const BLOCK = ifBlock('action === "backfill-desc"');
const CONTENT = "<p>Build things.</p><p>The base salary range for this role is $150,000 - $190,000 per year.</p>";

async function backfill(rows: Array<{ id: string; country: string | null; title: string; salary?: string | null }>) {
  const updates: Array<Record<string, unknown>> = [];
  const selects: string[] = [];
  const client = stubClient((c: Call) => {
    if (c.table === "job_board_postings" && op(c, "update")) { updates.push(op(c, "update")![1][0] as Record<string, unknown>); return { error: null }; }
    if (c.table === "job_board_postings" && op(c, "select")) {
      const cols = String(op(c, "select")![1][0]);
      selects.push(cols);
      // The stub answers what the block asked for: a column it did not select is not in the row.
      const want = cols.split(",").map((x) => x.trim());
      return { data: rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => want.includes(k)))), error: null };
    }
    return { data: null, error: null };
  });
  const scope: Record<string, unknown> = {
    body: { action: "backfill-desc", chainKey: "k", ti: 0 },
    client,
    json: (b: unknown) => b,
    chainKey: async () => "k",
    loadDynamicLight: async () => {},
    descBackfillBoards: () => [{ token: "acme", source: "greenhouse" }],
    greenhouseApi: (t: string) => ({ host: "boards-api.greenhouse.io", token: t }),
    fetchWithTimeout: async () => new Response(JSON.stringify({ content: CONTENT })),
    htmlToText: (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "),
    RAW_HTML_CAP: 100_000, STORED_DESC_CAP: 20_000,
    extractSalary, parseSalaryStructured,
    Deno: { env: { get: () => "https://example.test" } },
    waitUntil: () => {}, discardBody: () => {}, fetch: async () => new Response("{}"),
  };
  await compile(BLOCK, "return null;")(scope);
  return { updates, selects };
}

describe("backfill-desc", () => {
  it("keeps a row's stated pay: it writes the description, not the miner's figure", async () => {
    const { updates, selects } = await backfill([{ id: "greenhouse:acme:1", country: "US", title: "Engineer", salary: "USD 160,000.00 – 200,000.00 per year" }]);
    expect(selects[0], "the block must read the row's salary to know it has one").toContain("salary");
    expect(updates).toHaveLength(1);
    expect(updates[0].description).toContain("Build things.");
    expect(updates[0], "the miner's figure replaced the board's stated range").not.toHaveProperty("salary");
  });

  it("still mines the pay of a row that holds none", async () => {
    const { updates } = await backfill([{ id: "greenhouse:acme:2", country: "US", title: "Engineer", salary: null }]);
    expect(updates).toHaveLength(1);
    expect(updates[0].salary).toBe("$150,000 - $190,000 per year");
    expect(updates[0].salary_min_annual).toBe(150_000);
  });
});
