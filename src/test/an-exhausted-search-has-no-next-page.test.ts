// @vitest-environment node
/**
 * BR-04 (board .102): a list that had nothing after it still answered
 * hasMore false beside a numeric nextOffset, and a client that paged on
 * nextOffset asked again for a page that could not exist. Every job-board
 * answer now goes out through one rule: hasMore false means nextOffset null.
 * The key stays, so a reader that checks for it still finds it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transformSync } from "esbuild";

const RAW = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const line = (re: RegExp) => { const m = re.exec(RAW); if (!m) throw new Error(`${re} moved in index.ts`); return m[0]; };
const src = [line(/^const corsHeaders = \{[\s\S]*?\n\};/m), line(/^const lastPage = [^\n]*\n/m), line(/^const json = \(body: unknown, status = 200\) =>\n[^\n]*\n/m)].join("\n");
const json = new Function(`${transformSync(src, { loader: "ts" }).code}\nreturn json;`)() as (b: unknown, s?: number) => Response;
const sent = async (b: unknown) => (await json(b).json()) as Record<string, unknown>;

describe("an exhausted search has no next page", () => {
  it("hasMore false sends nextOffset null, and keeps the key", async () => {
    const r = await sent({ jobs: [{ id: "a" }], total: 1, hasMore: false, nextOffset: 1 });
    expect(r).toHaveProperty("nextOffset", null);
    expect(r.jobs).toEqual([{ id: "a" }]);
  });

  it("hasMore true keeps the offset; an answer with no paging is sent as written", async () => {
    expect(await sent({ jobs: [], hasMore: true, nextOffset: 50 })).toMatchObject({ nextOffset: 50 });
    expect(await sent({ ok: true, hasMore: false })).toEqual({ ok: true, hasMore: false });
    expect(await sent({ error: "x" })).toEqual({ error: "x" });
    expect(await sent([1, 2])).toEqual([1, 2]);
    expect(await sent(null)).toBeNull();
  });

  it("every list exit answers through json, so the rule reaches all of them", () => {
    const exits = [...RAW.matchAll(/return json\(\{/g)].map((m) => {
      let depth = 0, j = m.index! + "return json(".length;
      do { depth += RAW[j] === "{" ? 1 : RAW[j] === "}" ? -1 : 0; j++; } while (depth > 0);
      return RAW.slice(m.index!, j);
    }).filter((b) => /\bhasMore\b/.test(b) && /^\s*jobs[,:]/m.test(b));
    expect(exits.length, "the list exits were not found").toBeGreaterThanOrEqual(10);
    for (const b of exits) expect(b, b.slice(0, 80)).toMatch(/\bnextOffset\b/);
    expect(RAW, "no answer carrying a page offset bypasses json").not.toMatch(/new Response\(JSON\.stringify\(\{[^)]*nextOffset/);
  });
});
