// @vitest-environment node
/**
 * THE v11 RE-SWEEP THROUGH THE BOARD HANDLER, ON THE WHOLE CORPUS (S12-019,
 * wave 4 fix rounds 3 and 4).
 *
 * Every corpus case with a stored salary becomes a row, and backfill-salary
 * runs over all of them as production would. Round 3's re-sweep wrote NULL
 * whenever the miner refused a stored figure, and its recheck found that
 * NULLed real pay (a pay-transparency template, contractor rates, "+ RSUs").
 * Now it rewrites a row only when the stored text is the old miner's business
 * figure AND the posting states a pay after it, and it writes that pay: no
 * row is set to NULL, and no row the corpus reads as pay is touched.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { bootBoardHandler, SVC, type BoardHandler } from "./helpers/board-handler";

interface Case { id: string; vendor: string | null; country: string | null; text: string; stored: string | null; extract: string | null; also: string[]; resweep: "keep" | { to: string | null } | null }
const CORPUS: { cases: Case[] } = JSON.parse(readFileSync(resolve(__dirname, "fixtures/w4b-fix3-salary/corpus.json"), "utf8"));
const figs = (s: string) => [...s.matchAll(/[$€£]\s?(\d[\d.,]*)\s?([kK])?/g)].map((m) => {
  const t = m[1].replace(/[.,]+$/, "");
  const v = /^\d{1,3}([.,]\d{3})+$/.test(t) ? Number(t.replace(/[.,]/g, "")) : /^\d+[.,]\d{1,2}$/.test(t) ? Number(t.replace(",", ".")) : Number(t.replace(/,/g, ""));
  return m[2] ? v * 1000 : v;
}).join("|");

describe("backfill-salary rewrites a business figure only to the pay stated after it", () => {
  let h: BoardHandler;
  beforeAll(async () => { h = await bootBoardHandler(); }, 120_000);

  it("on every corpus row with a stored salary: no NULL, no stored pay touched", async () => {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${SVC}:board-chain`));
    const chainKey = [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
    const withStored = CORPUS.cases.filter((c) => c.stored !== null);
    const rows = withStored.map((c) => ({
      id: `${c.vendor ?? "greenhouse"}:corpus:${c.id}`, source: c.vendor ?? "greenhouse", salary: c.stored, country: c.country ?? "US",
      title: "Role", description: c.text, employment_type: null, salary_min_annual: null, salary_max_annual: null, salary_period: null, salary_currency: null,
    }));
    expect(rows.length).toBeGreaterThan(700);
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
    const byId = new Map(withStored.map((c) => [c.id, c]));
    const wrong: string[] = [];
    for (const [id, salary] of rewritten) {
      const c = byId.get(id)!;
      if (salary === null) wrong.push(`${id}: NULLed`);
      else if (c.resweep === "keep") wrong.push(`${id}: stored pay ${c.stored} rewritten to ${salary}`);
      else if (![c.extract, ...c.also].filter((p): p is string => p !== null).some((p) => figs(p) === figs(String(salary)))) wrong.push(`${id}: rewritten to ${salary}, which is not the pay`);
    }
    expect(wrong).toEqual([]);
    expect(rewritten.size, "business figures with a stated pay after them are still corrected").toBeGreaterThanOrEqual(20);
  });
});
