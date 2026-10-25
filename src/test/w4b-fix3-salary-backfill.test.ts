// @vitest-environment node
/**
 * THE v11 RE-SWEEP THROUGH THE BOARD HANDLER, ON THE WHOLE CORPUS (S12-019,
 * wave 4 round 3).
 *
 * Every corpus case with a stored salary becomes a row, and backfill-salary
 * runs over all of them as production would. The rows whose salary text it
 * rewrites must be exactly the ones the corpus labels as the miner's business
 * figure, each rewritten to the labelled answer (null where the posting
 * states no pay), and no row the corpus reads as pay may be touched.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { bootBoardHandler, SVC, type BoardHandler } from "./helpers/board-handler";

interface Case { id: string; vendor: string | null; country: string | null; text: string; stored: string | null; resweep: "keep" | { to: string | null } | null }
const CORPUS: { cases: Case[] } = JSON.parse(readFileSync(resolve(__dirname, "fixtures/w4b-fix3-salary/corpus.json"), "utf8"));

describe("backfill-salary rewrites only the miner's business figures", () => {
  let h: BoardHandler;
  beforeAll(async () => { h = await bootBoardHandler(); }, 120_000);

  it("on every corpus row with a stored salary", async () => {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${SVC}:board-chain`));
    const chainKey = [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
    const rows = CORPUS.cases.filter((c) => c.stored !== null).map((c) => ({
      id: `${c.vendor ?? "greenhouse"}:corpus:${c.id}`, source: c.vendor ?? "greenhouse", salary: c.stored, country: c.country ?? "US",
      title: "Role", description: c.text, employment_type: null, salary_min_annual: null, salary_max_annual: null, salary_period: null, salary_currency: null,
    }));
    expect(rows.length).toBeGreaterThan(400);
    h.reset();
    h.answer((q) => (q.table === "job_board_postings" && q.calls.some(([m]) => m === "select") ? { data: rows, error: null } : undefined));
    const r = await h.post({ action: "backfill-salary", chainKey });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, done: true });
    const rewritten = new Map<string, unknown>();
    for (const q of h.db.on("job_board_postings", "update")) {
      const patch = q.calls.find(([m]) => m === "update")?.[1][0] as Record<string, unknown> | undefined;
      if (!patch || !("salary" in patch)) continue;
      const id = q.calls.find(([m]) => m === "eq")?.[1][1] as string;
      rewritten.set(id.split(":").at(-1) as string, patch.salary);
    }
    const want = new Map(CORPUS.cases.filter((c) => c.stored !== null && c.resweep !== "keep").map((c) => [c.id, (c.resweep as { to: string | null }).to]));
    expect(Object.fromEntries(rewritten)).toEqual(Object.fromEntries(want));
    expect(want.size, "the corpus holds business figures to re-mine, NULLs among them").toBeGreaterThanOrEqual(10);
    expect([...want.values()].filter((v) => v === null).length).toBeGreaterThanOrEqual(5);
  });
});
