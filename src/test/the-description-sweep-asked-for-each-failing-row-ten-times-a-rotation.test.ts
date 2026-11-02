// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { DETAIL_DESC_SOURCES } from "../../supabase/functions/job-board/descriptions";

/**
 * THE DESCRIPTION SWEEP ASKED FOR EACH FAILING ROW TEN TIMES A ROTATION (S13-113).
 *
 * The per-posting phase walks every detail vendor's null-description rows
 * newest-first on a first_seen watermark (n246, n792). The vendor slot no
 * longer selects anything, but a rotation still advanced it once per finished
 * walk, so it walked the whole backlog once per vendor: ten walks, and every
 * row whose fetch fails (live on .96, 2026-11-01: ~8,400 null rows, oracle
 * 3,797 and paylocity 3,181 of them) was asked for ten times. And the cursor
 * was first_seen alone, `< cursor`, while one insert statement stamps every
 * row it writes with the same first_seen: a page that ended inside such a
 * batch skipped the rest of it.
 *
 * This runs the SHIPPED hop (index.ts, from `let vi =` to its reply) over an
 * in-memory table, chaining each hop into the next exactly as the hop hands
 * itself on, until the rotation leaves the per-posting phase.
 */
const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const span = (() => {
  const a = FN.indexOf("      let vi = Math.max(0, Number(body.vi) || 0);\n");
  const z = FN.indexOf("return json({ ok: true, vendor, scanned", a);
  expect(a, "the desc-sweep hop moved; re-point this test").toBeGreaterThan(-1);
  expect(z).toBeGreaterThan(a);
  return FN.slice(a, FN.indexOf("\n", z) + 1);
})();
const constant = (name: string) => Number(new RegExp(`const ${name} = (\\d+);`).exec(FN)?.[1]);
const PER_HOP = constant("DESC_SWEEP_PER_HOP");

type Row = { id: string; source: string; company_token: string; first_seen: string; description: string | null; missing_since: string | null; apply_url: null };
type Term = [op: string, col: string, v: unknown];
/** The PostgREST subset the hop uses, over one in-memory table. */
function table(rows: Row[]) {
  const holds = (r: Row, [op, col, v]: Term): boolean => {
    const x = (r as Record<string, unknown>)[col] as string | null;
    if (op === "in") return (v as unknown[]).includes(x);
    if (op === "is") return x === v;
    if (op === "eq") return x === v;
    if (x === null) return false;
    if (op === "lt") return x < (v as string);
    if (op === "lte") return x <= (v as string);
    if (op === "gt") return x > (v as string);
    if (op === "or") return (v as Term[]).some((t) => holds(r, t));
    throw new Error(`unsupported filter ${op}`);
  };
  const orTerms = (s: string): Term[] => [...s.matchAll(/([a-z_]+)\.(lt|lte|gt|eq)\.("((?:[^"\\]|\\.)*)"|[^,]*)/g)]
    .map((m) => [m[2], m[1], m[4] !== undefined ? m[4].replace(/\\(.)/g, "$1") : m[3]]);
  const from = (name: string) => {
    const terms: Term[] = [];
    const orders: Array<[string, boolean]> = [];
    let op = "select";
    let patch: Record<string, unknown> = {};
    let lim = Infinity;
    const b: Record<string, unknown> = {
      select() { return b; },
      upsert() { op = "upsert"; return b; },
      update(p: Record<string, unknown>) { op = "update"; patch = p; return b; },
      in(c: string, v: unknown) { terms.push(["in", c, v]); return b; },
      is(c: string, v: unknown) { terms.push(["is", c, v]); return b; },
      eq(c: string, v: unknown) { terms.push(["eq", c, v]); return b; },
      lt(c: string, v: unknown) { terms.push(["lt", c, v]); return b; },
      lte(c: string, v: unknown) { terms.push(["lte", c, v]); return b; },
      gt(c: string, v: unknown) { terms.push(["gt", c, v]); return b; },
      or(s: string) { terms.push(["or", "", orTerms(s)]); return b; },
      order(c: string, o: { ascending?: boolean }) { orders.push([c, o?.ascending !== false]); return b; },
      limit(n: number) { lim = n; return b; },
      then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
        if (name !== "job_board_postings" || op === "upsert") return Promise.resolve({ data: null, error: null }).then(res, rej);
        const hit = rows.filter((r) => terms.every((t) => holds(r, t)));
        if (op === "update") { for (const r of hit) Object.assign(r, patch); return Promise.resolve({ data: null, error: null }).then(res, rej); }
        // Postgres orders ties however it likes; insertion order stands in for that here.
        const sorted = hit.map((r, i) => ({ r, i })).sort((p, q) => {
          for (const [c, asc] of orders) {
            const a = (p.r as Record<string, unknown>)[c] as string, z = (q.r as Record<string, unknown>)[c] as string;
            if (a !== z) return (a < z ? -1 : 1) * (asc ? 1 : -1);
          }
          return p.i - q.i;
        }).map((x) => ({ ...x.r }));
        return Promise.resolve({ data: sorted.slice(0, lim), error: null }).then(res, rej);
      },
    };
    return b;
  };
  return { from };
}

/** Run one rotation's per-posting phase; returns how often each row was asked for. */
async function rotation(rows: Row[], o: { fills?: (id: string) => boolean; duringHop?: (hop: number, rows: Row[]) => void } = {}) {
  const asked = new Map<string, number>();
  let next: Record<string, unknown> | null = null;
  const deps: Record<string, unknown> = {
    client: table(rows), DETAIL_DESC_SOURCES, DESC_SWEEP_PER_HOP: PER_HOP, DESC_SWEEP_CONCURRENCY: constant("DESC_SWEEP_CONCURRENCY"),
    JOB_SOURCES: DETAIL_DESC_SOURCES.map((v) => ({ source: v, token: "t" })), BOARD_DESC_SOURCES: [],
    fetchVendorDetail: async (_s: unknown, id: string) => {
      asked.set(id, (asked.get(id) ?? 0) + 1);
      return { text: o.fills?.(id) ? "A description long enough to store." : null };
    },
    placeWrite: () => ({}), parseSalaryStructured: () => null, extractSalary: () => null, STORED_DESC_CAP: 50_000,
    detectExperience: () => ({ band: null }), detectWorkMode: () => null, fetchBoard: async () => null, listPayloadDescriptions: () => new Map(),
    Deno: { env: { get: () => "http://board" } }, discardBody: () => {}, chainKey: async () => "k",
    fetch: async (_u: string, init: { body: string }) => { next = JSON.parse(init.body); return {}; },
    json: (x: unknown) => x,
  };
  const pending: Promise<unknown>[] = [];
  deps.waitUntil = (p: Promise<unknown>) => { pending.push(p); };
  const js = ts.transpileModule(`return (async () => {\n${span}\n})();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const hop = new Function("body", ...Object.keys(deps), js) as (...a: unknown[]) => Promise<unknown>;
  let body: Record<string, unknown> = { action: "desc-sweep", vi: 3, vstart: 3 };
  let hops = 0;
  for (; hops < 2_000; hops++) {
    if (Number(body.vi) >= DETAIL_DESC_SOURCES.length) break; // the boards phase: the per-posting rotation is over
    o.duringHop?.(hops, rows);
    next = null;
    await hop(body, ...Object.values(deps));
    await Promise.all(pending.splice(0));
    expect(next, "a hop did not hand itself on").toBeTruthy();
    body = next!;
  }
  return { asked, hops };
}

const at = (minute: number) => new Date(Date.parse("2026-10-30T11:00:00Z") + minute * 60_000).toISOString().replace("Z", "+00:00");
const row = (n: number, source: string, firstSeen: string): Row => ({ id: `${source}:t:${String(n).padStart(5, "0")}`, source, company_token: "t", first_seen: firstSeen, description: null, missing_since: null, apply_url: null });

describe("one rotation asks for each null-description row once, and skips none (S13-113)", () => {
  it("a backlog whose fetches all fail is asked for once per rotation, not once per vendor", async () => {
    const rows = Array.from({ length: 300 }, (_, n) => row(n, DETAIL_DESC_SOURCES[n % DETAIL_DESC_SOURCES.length], at(n)));
    const { asked } = await rotation(rows);
    expect(asked.size).toBe(300);
    const counts = [...new Set(asked.values())];
    expect(counts, `each failing row was asked for ${counts.join("/")} times in one rotation`).toEqual([1]);
  });

  it("rows one insert stamped with the same first_seen are all reached across a page boundary", async () => {
    const batch = Array.from({ length: PER_HOP * 2 + 37 }, (_, n) => row(n, "oracle", at(500)));
    const rows = [...batch, ...Array.from({ length: 40 }, (_, n) => row(1_000 + n, "workday", at(100 + n)))];
    const { asked } = await rotation(rows);
    const missed = rows.filter((r) => !asked.has(r.id)).length;
    expect(missed, "rows sharing the page-boundary first_seen were skipped").toBe(0);
    expect(Math.max(...asked.values())).toBe(1);
  });

  it("a row the feed adds mid-rotation is still reached in the same rotation, as on main", async () => {
    const rows = Array.from({ length: PER_HOP + 10 }, (_, n) => row(n, "workday", at(n)));
    const late = row(9_999, "paylocity", at(5_000));
    const { asked } = await rotation(rows, { duringHop: (h, rs) => { if (h === 1) rs.push(late); } });
    expect(asked.get(late.id), "a posting inserted during the walk waited for the next rotation").toBe(1);
    expect(Math.max(...[...asked.entries()].filter(([id]) => id !== late.id).map(([, n]) => n))).toBe(1);
  });

  it("a filled row leaves the backlog; a failing one waits for the next rotation", async () => {
    const rows = Array.from({ length: 50 }, (_, n) => row(n, "breezy", at(n)));
    const { asked } = await rotation(rows, { fills: (id) => id.endsWith("0") });
    expect(rows.filter((r) => r.description !== null)).toHaveLength(5);
    expect([...asked.values()].every((n) => n === 1)).toBe(true);
    const again = await rotation(rows);
    expect(again.asked.size, "the next rotation asks only for the rows still null").toBe(45);
  });
});
