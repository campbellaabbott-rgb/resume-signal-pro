// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

/**
 * EXISTS CALLED A POSTING OPEN THAT DETAIL DECLINED (S13-076).
 *
 * `exists` (behind the MCP check_jobs_open) read `select("id").in("id", ...)`:
 * a row the feed had already dropped (missing_since stamped, waiting out the
 * grace or the 6 h shrink ratchet) and a row past the 30-day serving fence
 * both read open, while `detail` (behind get_job) declined the first and
 * answered the second agedOut. One posting, two answers from one board.
 *
 * This runs the SHIPPED exists block (lifted from index.ts and transpiled)
 * over an in-memory table that honours the filters the block sends.
 */
const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const block = (start: string, end: string) => {
  const a = FN.indexOf(start);
  expect(a, `${start} moved; re-point this test`).toBeGreaterThan(-1);
  const z = FN.indexOf(end, a);
  expect(z).toBeGreaterThan(a);
  return FN.slice(a, z + end.length);
};
const EXISTS = block('    if (action === "exists") {', "return json({ open: openMap, rowTest: \"served\" });\n    }\n");
const DETAIL = block('    if (action === "detail") {', "const stored = (jobRow?.description");
/** Any top-level helper the block calls, lifted beside it (none on main). */
const helpers = [...FN.matchAll(/\nfunction (\w+)\(/g)].map((m) => m[1]).filter((n) => new RegExp(`\\b${n}\\(`).test(EXISTS))
  .map((n) => { const at = FN.indexOf(`\nfunction ${n}(`); return FN.slice(at + 1, FN.indexOf("\n}\n", at) + 2); });

type Row = { id: string; missing_since: string | null; effective_posted: string | null; posted_at: string | null; first_seen: string };
function run(rows: Row[], ids: string[]) {
  const reads: Array<Array<[string, unknown[]]>> = [];
  const client = {
    from: () => {
      const calls: Array<[string, unknown[]]> = [];
      let cols = "*";
      const b: Record<string, unknown> = {
        select(c: string) { cols = c; return b; },
        in(...a: unknown[]) { calls.push(["in", a]); return b; },
        is(...a: unknown[]) { calls.push(["is", a]); return b; },
        eq(...a: unknown[]) { calls.push(["eq", a]); return b; },
        then(res: (v: unknown) => unknown) {
          reads.push(calls);
          const hit = rows.filter((r) => calls.every(([m, [c, v]]) => m === "in" ? (v as unknown[]).includes((r as Record<string, unknown>)[c as string])
            : (r as Record<string, unknown>)[c as string] === v));
          const pick = cols.split(",").map((c) => c.trim());
          return Promise.resolve({ data: hit.map((r) => Object.fromEntries(pick.map((c) => [c, (r as Record<string, unknown>)[c]]))), error: null }).then(res);
        },
      };
      return b;
    },
  };
  const js = ts.transpileModule(`${helpers.join("\n")}\nreturn (async () => {\n${EXISTS}\n})();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const go = new Function("action", "body", "client", "json", "EXISTS_ID_MAX", "FRESH_WINDOW_DAYS", js);
  return (go("exists", { ids }, client, (x: unknown) => x, 300, 30) as Promise<{ open: Record<string, boolean>; rowTest?: string }>).then((r) => ({ open: r.open, rowTest: r.rowTest, reads }));
}

const NOW = Date.now();
const ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const ROWS: Row[] = [
  { id: "greenhouse:acme:live", missing_since: null, effective_posted: ago(3), posted_at: ago(3), first_seen: ago(3) },
  { id: "greenhouse:acme:dropped", missing_since: ago(0.1), effective_posted: ago(4), posted_at: ago(4), first_seen: ago(4) },
  { id: "greenhouse:acme:aged", missing_since: null, effective_posted: ago(31), posted_at: ago(31), first_seen: ago(20) },
  { id: "greenhouse:acme:undated", missing_since: null, effective_posted: null, posted_at: null, first_seen: ago(2) },
];

describe("exists answers open on the predicate detail serves by (S13-076)", () => {
  it("a row the feed dropped (missing_since stamped) is not open", async () => {
    const { open } = await run(ROWS, ["greenhouse:acme:dropped"]);
    expect(open["greenhouse:acme:dropped"], "check_jobs_open called a dropped posting open while get_job declined it").toBe(false);
  });

  it("a row past the 30-day serving fence is not open; detail answers it agedOut", async () => {
    const { open } = await run(ROWS, ["greenhouse:acme:aged"]);
    expect(open["greenhouse:acme:aged"]).toBe(false);
  });

  it("a live row, and one dated only by first_seen inside the fence, stay open; an unknown id is not", async () => {
    const { open } = await run(ROWS, ["greenhouse:acme:live", "greenhouse:acme:undated", "greenhouse:acme:nope"]);
    expect(open).toEqual({ "greenhouse:acme:live": true, "greenhouse:acme:undated": true, "greenhouse:acme:nope": false });
  });

  it("the answer names the row test it ran, so a caller can tell this build from one that asked only for a row (n1464)", async () => {
    expect((await run(ROWS, ["greenhouse:acme:live"])).rowTest).toBe("served");
    expect((await run(ROWS, [])).rowTest).toBe("served");
  });

  it("the stamp is fenced in the read itself, and on every row exists and detail agree", async () => {
    const { reads, open } = await run(ROWS, ROWS.map((r) => r.id));
    expect(reads[0].some(([m, a]) => m === "is" && a[0] === "missing_since" && a[1] === null)).toBe(true);
    // detail's own fence, lifted: the read drops a stamped row, then the age test answers agedOut.
    expect(DETAIL).toMatch(/\.eq\("id", id\)\.is\("missing_since", null\)/);
    const a = DETAIL.indexOf("const eff = ");
    const z = DETAIL.indexOf("if (Number.isFinite(effMs) && effMs < detailCutoffMs)", a);
    expect(a).toBeGreaterThan(-1);
    expect(z).toBeGreaterThan(a);
    const detailAged = new Function("jobRow", "detailCutoffMs",
      `${ts.transpileModule(DETAIL.slice(a, z), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText}\nreturn Number.isFinite(effMs) && effMs < detailCutoffMs;`,
    ) as (r: Row, c: number) => boolean;
    const cutoff = NOW - 30 * 86_400_000;
    for (const r of ROWS) expect(open[r.id], r.id).toBe(r.missing_since === null && !detailAged(r, cutoff));
  });
});
