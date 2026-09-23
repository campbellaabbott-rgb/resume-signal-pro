// @vitest-environment node
/**
 * THE EMPLOYER NAME NORMALISER IS ONE RULE IN TWO RUNTIMES.
 *
 * WHAT THIS GUARDS. An employer name becomes a board token by being stripped
 * and compared for equality. The stripping happens in two places:
 *
 *   * public.layoff_norm, in SQL, which computed every display_norm in the
 *     live layoff_board_names mirror, and
 *   * keyNorm, in supabase/functions/layoff-filings/normalize.ts, which
 *     scripts/load-oflc-lca.mjs imports rather than writing a second one.
 *
 * One rule, two implementations. If they drift, the LCA loader joins an
 * employer to a board the filings matcher would refuse -- one employer, two
 * answers, and a wage line under a name the rest of the product does not
 * accept. That is the drift class that has bitten this repository before: a
 * claim that stays true only while the thing it describes sits in one runtime.
 *
 * MEASURED, NOT ASSERTED. The guard boots a real Postgres (pglite), applies
 * the migration that defines the SQL normaliser, and runs BOTH implementations
 * over every distinct name in today's catalogue and alias ledger -- tens of
 * thousands of real employer names, not a fixture. It then requires:
 *
 *   1. Every name the loader's parity gate ACCEPTS normalises identically in
 *      both runtimes. Not "mostly". Zero.
 *   2. The names where they DO differ are all refused by that gate -- and the
 *      set is not empty, because a gate that never refuses anything is not a
 *      gate and this assertion would be vacuous. (The divergences are names
 *      carrying a ligature, a trademark sign, a superscript digit or a letter
 *      outside the SQL fold table: keyNorm folds with NFKD, which decomposes
 *      those, and the SQL folds with a translate table, which does not.)
 *
 * TEETH. A copy of the loader whose parity gate accepts everything is imported
 * and asked the same question. It must let a divergent board name into the
 * index and JOIN an employer the SQL side would never have matched -- proving
 * the gate is what stands between the two runtimes and a wrong answer. The
 * copy is deleted afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CATALOG } from "./helpers/catalog";
import { EMPLOYER_ALIASES } from "../../supabase/functions/job-board/employer-aliases";
import { keyNorm } from "../../supabase/functions/layoff-filings/normalize";

const ROOT = resolve(__dirname, "../..");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");
const LOADER = resolve(ROOT, "scripts/load-oflc-lca.mjs");
/** The migration that defines the SQL normaliser both sides of every comparison are stripped by. */
const NORM_MIGRATION = "20260918100100";
/** A parity run over a handful of names is a blind parse agreeing with itself. */
const MIN_NAMES = 20_000;

const MUTANTS: string[] = [];
afterAll(() => { for (const m of MUTANTS) { try { rmSync(m); } catch { /* best effort */ } } });

type Loader = typeof import("../../scripts/load-oflc-lca.mjs");
const loadReal = async (): Promise<Loader> => (await import("../../scripts/load-oflc-lca.mjs")) as unknown as Loader;

async function loadMutant(find: string, replace: string): Promise<Loader> {
  const src = readFileSync(LOADER, "utf8");
  expect(src.includes(find), `the loader no longer contains ${JSON.stringify(find)} -- this mutation proves nothing`).toBe(true);
  const mutated = src
    .split(find).join(replace)
    .split('"../supabase/functions/layoff-filings/normalize.ts"').join('"../../supabase/functions/layoff-filings/normalize.ts"')
    .split('"./layoff-board-names-mirror.mjs"').join('"../../scripts/layoff-board-names-mirror.mjs"');
  const path = resolve(__dirname, `.norm-mutant-${MUTANTS.length}.mjs`);
  writeFileSync(path, mutated);
  MUTANTS.push(path);
  return (await import(/* @vite-ignore */ path)) as unknown as Loader;
}

let db: PGlite;
let L: Loader;
/** Every distinct display name the mirror carries today: the catalogue's plus the alias file's. */
let NAMES: string[];
let sqlNorm: Map<string, string>;

beforeAll(async () => {
  L = await loadReal();
  const f = readdirSync(MIGRATIONS).find((x) => x.startsWith(NORM_MIGRATION) && x.endsWith(".sql"));
  if (!f) throw new Error(`no migration starts with ${NORM_MIGRATION}`);
  db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
  await db.exec(readFileSync(resolve(MIGRATIONS, f), "utf8"));

  NAMES = [...new Set([...CATALOG.map((e) => e.name), ...Object.values(EMPLOYER_ALIASES).map((a) => a.name)])];
  sqlNorm = new Map();
  for (let i = 0; i < NAMES.length; i += 2000) {
    const slice = NAMES.slice(i, i + 2000);
    const r = await db.query<{ raw: string; n: string }>("SELECT x AS raw, public.layoff_norm(x) AS n FROM unnest($1::text[]) AS x", [slice]);
    for (const row of r.rows) sqlNorm.set(row.raw, row.n);
  }
}, 120_000);

afterAll(async () => { await db?.close(); });

describe("one rule, two runtimes, measured over the real catalogue", () => {
  it("reads enough names for the comparison to mean anything", () => {
    expect(NAMES.length).toBeGreaterThan(MIN_NAMES);
    expect(sqlNorm.size).toBe(NAMES.length);
  });

  it("every name the parity gate accepts normalises identically in both runtimes", () => {
    const accepted = NAMES.filter((n) => L.isParitySafe(n));
    expect(accepted.length, "the gate rejected essentially everything").toBeGreaterThan(MIN_NAMES);
    const disagreed = accepted.filter((n) => keyNorm(n) !== sqlNorm.get(n));
    expect(
      disagreed.slice(0, 10).map((n) => [n, keyNorm(n), sqlNorm.get(n)]),
      `${disagreed.length} accepted name(s) strip differently in SQL and in JS`,
    ).toEqual([]);
  });

  it("every name the two runtimes disagree on is refused by the gate, and the refused set is not empty", () => {
    const divergent = NAMES.filter((n) => keyNorm(n) !== sqlNorm.get(n));
    expect(divergent.length, "no name in the catalogue diverges -- this gate is now vacuous and the assertion above proves nothing").toBeGreaterThan(0);
    const leaked = divergent.filter((n) => L.isParitySafe(n));
    expect(leaked, "a divergent name got through the parity gate").toEqual([]);
    // ...and every one of them is off ASCII, which is the class the gate names.
    for (const n of divergent) expect([...n].some((ch) => ch.codePointAt(0)! > 127), n).toBe(true);
  });

  it("a held name is counted, never silently dropped", () => {
    const divergent = NAMES.filter((n) => keyNorm(n) !== sqlNorm.get(n));
    const rows = divergent.map((name, i) => ({ vendor: "greenhouse", company_token: `held-${i}`, display_name: name }));
    const index = L.indexMirror(rows);
    expect(index.heldNonAscii).toBe(divergent.length);
    expect(index.byNorm.size).toBe(0);
  });
});

describe("the gate is what stands between the runtimes and a wrong answer", () => {
  /** A real divergent board name from the catalogue, picked by measurement rather than by hand. */
  function divergentTwoTokenName(): string {
    const found = NAMES.find((n) => keyNorm(n) !== sqlNorm.get(n) && keyNorm(n).split(" ").filter((t) => t.length >= 2).length >= 2);
    if (!found) throw new Error("no divergent multi-token catalogue name to build the case on");
    return found;
  }

  it("the sealed loader refuses to join an employer name to a board whose two normalisations differ", () => {
    const boardName = divergentTwoTokenName();
    const index = L.indexMirror([{ vendor: "greenhouse", company_token: "divergent-board", display_name: boardName }]);
    // The employer as the disclosure file would spell it: the same words, plain ASCII.
    const filerSpelling = keyNorm(boardName);
    expect(L.matchEmployer(filerSpelling, index)).toEqual({ refused: "unmatched" });
  });

  it("teeth: a copy whose gate accepts everything joins an employer the SQL side would never match", async () => {
    const M = await loadMutant(
      "  for (let i = 0; i < raw.length; i++) if (raw.charCodeAt(i) > 127) return false;",
      "  // gate removed for the mutation",
    );
    const boardName = divergentTwoTokenName();
    const index = M.indexMirror([{ vendor: "greenhouse", company_token: "divergent-board", display_name: boardName }]);
    const filerSpelling = keyNorm(boardName);
    expect(M.matchEmployer(filerSpelling, index)).toEqual({ tokens: ["divergent-board"], norm: filerSpelling });
    // ...and the live mirror holds the OTHER spelling for that board, so the
    // filings matcher, comparing against it, would have refused the same pair.
    expect(sqlNorm.get(boardName)).not.toBe(filerSpelling);
  });
});
