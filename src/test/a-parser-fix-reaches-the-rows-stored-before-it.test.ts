// @vitest-environment node
/**
 * A PARSER FIX REACHES THE ROWS STORED BEFORE IT (S12-013, job-board .93,
 * wave 4 round 2).
 *
 * The L8-15 and L7-09 fixes ("a minimum age is not experience", "135 years is
 * not 35") changed parseMinYears and nothing else. The refresh never rewrites
 * a stored row, and backfill-experience only filled rows whose band was NULL,
 * so every posting ingested before the fix kept "18+ yrs": 0 of 24 stored
 * minimum-age figures reproduced under the current parser, Domino's served
 * 4,018 Expert rows against 1,359 Entry, and "delivery driver" under Entry
 * missed them all. EXPERIENCE_VERSION 2 re-derives every row and writes the
 * ones that changed, a NULL band ("unspecified", min_years NULL) included.
 *
 * Driven through the shipped handler (edge-harness bundles the real index.ts;
 * only the database is faked), so the test is the code that deploys.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { bootBoardHandler, SVC, type BoardHandler } from "./helpers/board-handler";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

/** passEndKicks as shipped, lifted with the TypeScript parser; every free name it reads comes from `scope` or throws. */
const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const SF = ts.createSourceFile("index.ts", FN, ts.ScriptTarget.ES2022, true);
function lifted(name: string): (scope: Record<string, unknown>) => Promise<unknown> {
  const f = SF.statements.find((st) => ts.isFunctionDeclaration(st) && st.name?.text === name)!;
  const js = ts.transpileModule(`${f.getText(SF)}\nreturn ${name};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const make = new Function("__scope", `with (__scope) { return (function(){ ${js} })(); }`);
  return (deps) => {
    const scope = new Proxy(deps, {
      has: (_t, k) => typeof k === "string" && (k in deps || !(k in globalThis)),
      get: (_t, k) => {
        if (k === Symbol.unscopables) return undefined;
        if (typeof k === "string" && k in deps) return deps[k];
        throw new Error(`the lifted code reads \`${String(k)}\`, which this test does not bind`);
      },
    });
    return (make(scope) as (c: unknown) => Promise<unknown>)(deps.client);
  };
}
const passEndKicks = lifted("passEndKicks");

let h: BoardHandler;
async function chainKey(): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${SVC}:board-chain`));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

const STORED = [
  // Ingested under the old parser: a minimum age read as 18 years.
  { id: "greenhouse:dominos:1", title: "Delivery Driver", description: "Must be 18 years or older and able to work weekends.", experience_band: "expert", min_years: 18 },
  // Already what the current rules say: no write.
  { id: "greenhouse:dominos:2", title: "Store Manager", description: "3+ years of restaurant management experience required.", experience_band: "mid", min_years: 3 },
  // "135 years" read as 35-capped noise under v1; now the real requirement.
  { id: "greenhouse:bank:3", title: "Analyst", description: "For more than 135 years of financial experience, we have served clients. Requires 5-7 years of experience.", experience_band: "expert", min_years: 20 },
  // A title-only band that was never written (NULL before the column existed).
  { id: "greenhouse:acme:4", title: "Senior Engineer", description: null, experience_band: null, min_years: null },
];

beforeAll(async () => { h = await bootBoardHandler(); }, 120_000);

describe("backfill-experience re-derives every stored row (S12-013)", () => {
  it("writes the rows whose band or minimum changed, a NULL included, and stamps the version when the table is walked", async () => {
    h.reset();
    h.answer((q) => {
      if (q.table === "job_board_postings" && q.calls.some(([m]) => m === "select")) return { data: STORED, error: null };
      return undefined;
    });
    const r = await h.post({ action: "backfill-experience", chainKey: await chainKey(), rulesVersion: 2 });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, done: true, scanned: 4, updated: 3 });

    const select = h.db.on("job_board_postings", "select")[0];
    expect(select.calls.some(([m]) => m === "is"), "every row is read, not only the NULL bands").toBe(false);
    expect(String(select.calls.find(([m]) => m === "select")?.[1][0])).toContain("experience_band,min_years");

    const writes = h.db.on("job_board_postings", "update").map((q) => ({
      patch: q.calls.find(([m]) => m === "update")?.[1][0] as Record<string, unknown>,
      ids: q.calls.find(([m]) => m === "in")?.[1][1] as string[],
    }));
    const byId = new Map(writes.flatMap((w) => w.ids.map((id) => [id, w.patch] as const)));
    expect(byId.get("greenhouse:dominos:1"), "the minimum age is cleared to unspecified/NULL").toEqual({ experience_band: "unspecified", min_years: null });
    expect(byId.get("greenhouse:bank:3")).toEqual({ experience_band: "mid", min_years: 5 });
    expect(byId.get("greenhouse:acme:4")).toEqual({ experience_band: "senior", min_years: null });
    expect(byId.has("greenhouse:dominos:2"), "a row already right is not rewritten").toBe(false);

    const upserts = h.db.on("job_board_meta", "upsert").map((q) => q.calls.find(([m]) => m === "upsert")?.[1][0] as { k: string; v: Record<string, unknown> });
    const stamp = upserts.find((u) => u.k === "experience_version");
    expect(stamp?.v.version, "the version is stamped only by the hop that reached the end").toBe(2);
    const done = upserts.filter((u) => u.k === "experience_backfill").pop();
    expect(typeof done?.v.doneAt).toBe("string");
    expect(done?.v.startedUnder).toBe(2);
  });

  it("a hop with more pages hands its frontier to the next hop and stamps nothing", async () => {
    h.reset();
    const page = Array.from({ length: 1000 }, (_, i) => ({ id: `greenhouse:acme:${String(i).padStart(4, "0")}`, title: "Cook", description: null, experience_band: "unspecified", min_years: null }));
    h.answer((q) => (q.table === "job_board_postings" && q.calls.some(([m]) => m === "select") ? { data: page, error: null } : undefined));
    const r = await h.post({ action: "backfill-experience", chainKey: await chainKey(), rulesVersion: 2 });
    expect(r.nextCursor).toBe("greenhouse:acme:0999");
    const upserts = h.db.on("job_board_meta", "upsert").map((q) => q.calls.find(([m]) => m === "upsert")?.[1][0] as { k: string; v: Record<string, unknown> });
    expect(upserts.some((u) => u.k === "experience_version"), "an unfinished walk claims nothing").toBe(false);
    expect(upserts.filter((u) => u.k === "experience_backfill").pop()?.v.cursor, "the frontier is kept where a re-kick resumes from it").toBe("greenhouse:acme:0999");
  });

  it("a hop of older rules stands down, and nobody without the chain key may start one", async () => {
    h.reset();
    expect(await h.post({ action: "backfill-experience", chainKey: await chainKey(), rulesVersion: 1 })).toMatchObject({ ok: false, superseded: true, current: 2 });
    expect(h.db.on("job_board_postings").length).toBe(0);
    expect((await h.post({ action: "backfill-experience", chainKey: "nope" })).error).toMatch(/maintenance action/);
  });

  it("the pass-end kick resumes a dead chain from its frontier, and leaves a live one alone", async () => {
    const kicks: Array<Record<string, unknown>> = [];
    const run = async (row: { v: Record<string, unknown>; updated_at: string } | null) => {
      kicks.length = 0;
      const bg: Promise<unknown>[] = [];
      await passEndKicks({
        client: {
          from: () => {
            let k = "";
            const chain: Record<string, unknown> = {
              select: () => chain,
              eq: (_c: string, v: string) => { k = v; return chain; },
              maybeSingle: async () => ({ data: k === "experience_backfill" ? row : null }),
            };
            return chain;
          },
        },
        EXPERIENCE_VERSION: 2, COUNTRY_VERSION: 1, SALARY_PARSE_VERSION: 10, POSTED_BACKFILL_VERSION: 1,
        MAINTENANCE_STALL_MS: 12 * 60_000,
        Deno: { env: { get: () => "https://h.supabase.co" } },
        waitUntil: (p: Promise<unknown>) => { bg.push(p); },
        chainKey: async () => "k",
        fetch: async (_u: string, init: { body: string }) => { kicks.push(JSON.parse(init.body)); return new Response("{}"); },
        discardBody: async () => {},
        undatedBacklog: async () => 0,
        postedBackfillDue: () => false,
      });
      await Promise.all(bg);
      return kicks.find((b) => b.action === "backfill-experience");
    };
    const stale = new Date(Date.now() - 60 * 60_000).toISOString();
    expect(await run({ v: { startedUnder: 2, cursor: "lever:acme:77" }, updated_at: stale })).toMatchObject({ cursor: "lever:acme:77", rulesVersion: 2 });
    expect((await run({ v: { startedUnder: 1, cursor: "lever:acme:77" }, updated_at: stale }))?.cursor, "a frontier cut by older rules is not trusted").toBeUndefined();
    expect(await run({ v: { startedUnder: 2, cursor: "lever:acme:77" }, updated_at: new Date().toISOString() }), "a live chain is left alone").toBeUndefined();
    expect(await run(null)).toMatchObject({ action: "backfill-experience", rulesVersion: 2 });
  });
});
