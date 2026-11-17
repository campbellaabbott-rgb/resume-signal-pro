// @vitest-environment node
/**
 * Board .102, retired-twin prune arm: the pass-end orphan prune finds boards
 * by TOKEN (a facets company whose token no catalogue entry carries). A board
 * retired from one vendor while its token stays catalogued under another
 * (pinpoint:helsing beside greenhouse:helsing, and the old vendor of the seven
 * kept-token repoints: greenhouse:wayve, greenhouse:clickhouse,
 * lever:swordhealth, greenhouse:lovable, greenhouse:kalshi, greenhouse:webflow,
 * greenhouse:worldlabs) is never an orphan by token, so its rows were served
 * forever. RETIRED_TWIN_KEYS names them; the arm runs inside the orphan prune,
 * after its high-water check, and removes each through
 * pruneWholeBoard(client, token, "untracked", source): only that vendor's rows,
 * logged first. A key the catalogue carries again is never touched.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const a = FN.indexOf("  const validTokens = new Set(JOB_SOURCES.map((s) => s.token));");
const z = FN.indexOf('await breadcrumb(client, "pass-end-pruned"', a);
if (a < 0 || z < 0) throw new Error("the orphan prune moved; re-point this test");
const SPAN = FN.slice(a, FN.indexOf("\n  }\n", z) + "\n  }\n".length);
const KEYS = JSON.parse(`[${/const RETIRED_TWIN_KEYS: readonly string\[\] = \[([^\]]*)\];/.exec(FN)![1]}]`) as string[];

type Src = { source: string; token: string };
const AFTER_CATALOGUE: Src[] = [
  { source: "greenhouse", token: "helsing" }, { source: "ashby", token: "wayve" }, { source: "ashby", token: "clickhouse" },
  { source: "greenhouse", token: "swordhealth" }, { source: "ashby", token: "lovable" }, { source: "ashby", token: "kalshi" },
  { source: "ashby", token: "webflow" }, { source: "ashby", token: "worldlabs" }, { source: "lever", token: "acme" },
];

async function pass(o: { sources: Src[]; highwater: number; facetsOk?: boolean; companies?: Array<{ token: string }> }) {
  const pruned: Array<[string, string, string | null]> = [];
  const crumbs: Array<Record<string, unknown>> = [];
  const client = {
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq"]) q[m] = () => q;
      q.maybeSingle = async () => ({ data: { v: { size: o.highwater } } });
      q.upsert = async () => ({ error: null });
      return q;
    },
  };
  const js = ts.transpileModule(`return (async () => {\n${SPAN}\nreturn companies; })();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  await new Function("client", "JOB_SOURCES", "RETIRED_TWIN_KEYS", "WORKABLE_OVERSIZE_HELD", "facetsOk", "companies", "pruneWholeBoard", "breadcrumb", "sliceWallStart", "console", js)(
    client, o.sources, KEYS, new Set<string>(), o.facetsOk ?? true, o.companies ?? [],
    async (_c: unknown, token: string, reason: string, source: string | null) => { pruned.push([token, reason, source]); return { logged: 3, complete: true }; },
    async (_c: unknown, _m: string, v: Record<string, unknown>) => { crumbs.push(v); }, Date.now(), { log: () => {}, warn: () => {} },
  );
  return { pruned, crumbs };
}

describe("a retired twin leaves with its own vendor", () => {
  it("names the eight boards the spec retires, each as source:token", () => {
    expect(KEYS).toEqual(["pinpoint:helsing", "greenhouse:wayve", "greenhouse:clickhouse", "lever:swordhealth", "greenhouse:lovable", "greenhouse:kalshi", "greenhouse:webflow", "greenhouse:worldlabs"]);
  });

  it("after the catalogue retires them, each is pruned by its own vendor and token, as untracked, and the count is recorded", async () => {
    const { pruned, crumbs } = await pass({ sources: AFTER_CATALOGUE, highwater: AFTER_CATALOGUE.length });
    expect(pruned).toEqual(KEYS.map((k) => [k.split(":")[1], "untracked", k.split(":")[0]]));
    expect(crumbs[0]?.twinsLogged).toBe(3 * KEYS.length);
  });

  it("is skipped while the high-water blocks the orphan prune, and when facets were carried", async () => {
    expect((await pass({ sources: AFTER_CATALOGUE, highwater: AFTER_CATALOGUE.length + 1 })).pruned).toEqual([]);
    expect((await pass({ sources: AFTER_CATALOGUE, highwater: 0, facetsOk: false })).pruned).toEqual([]);
  });

  it("a key the catalogue carries again is never touched", async () => {
    const back = [...AFTER_CATALOGUE, { source: "greenhouse", token: "lovable" }, { source: "pinpoint", token: "helsing" }];
    const { pruned } = await pass({ sources: back, highwater: 0 });
    expect(pruned.map(([t, , s]) => `${s}:${t}`)).not.toContain("greenhouse:lovable");
    expect(pruned.map(([t, , s]) => `${s}:${t}`)).not.toContain("pinpoint:helsing");
    expect(pruned).toHaveLength(KEYS.length - 2);
  });

  it("pruneWholeBoard with a source deletes only rows with that source and token", async () => {
    const at = FN.indexOf("\nasync function pruneWholeBoard(");
    const src = FN.slice(at + 1, FN.indexOf("\n}\n", at) + 2);
    const filters: Array<[string, string]> = [];
    const client = {
      from: () => {
        const q: Record<string, unknown> = {};
        q.delete = () => q;
        q.eq = (c: string, v: string) => { filters.push([c, v]); return q; };
        q.then = (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res);
        return q;
      },
    };
    const js = ts.transpileModule(`${src}\nreturn pruneWholeBoard;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const fn = new Function("logWholeBoardExit", "dropTombstones", "console", js)(
      async () => ({ logged: 2, complete: true, loggedIds: ["greenhouse:wayve:1", "greenhouse:wayve:2"] }), () => {}, { warn: () => {} },
    ) as (c: unknown, t: string, r: string, s: string | null) => Promise<unknown>;
    await fn(client, "wayve", "untracked", "greenhouse");
    expect(filters).toEqual([["company_token", "wayve"], ["source", "greenhouse"]]);
  });
});
