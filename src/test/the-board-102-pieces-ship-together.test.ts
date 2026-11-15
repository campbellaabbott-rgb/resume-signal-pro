// @vitest-environment node
/**
 * THE BOARD-102 PIECES SHIP TOGETHER (job-board 2026-09-09.102, integration lane).
 *
 * .102 was built in three lanes: core (index.ts and its modules), normalize (the readers)
 * and catalogue (sources.ts, the aliases and two migrations). Each lane's tests pass on
 * its own branch. These five checks each join a piece of one lane to a piece of another,
 * so each fails on the base (fix/cost-wave) and on any single lane, and passes only where
 * the lanes are merged and the ledger orders their migrations.
 *
 * 1. The high-water clamp equals the catalogue the bundle carries. A mark above it blocks
 *    the orphan prune for good; one below it lets a stale bundle prune live boards.
 * 2. The Workable retry without details ships only with the three gig boards retired
 *    (OD1). The retry alone would start serving about 6-7k gig rows from boards that are
 *    dark today because their feeds are too big.
 * 3. The four renamed boards are named in the catalogue AND re-run by the name-sync lane,
 *    or the stored rows keep the old names while the catalogue prints the new ones.
 * 4. The ledger puts the closes_at columns before the function that writes them, and the
 *    high-water clamp and the pay heal after a slice of the build that needs them: an
 *    OPTIONS answer of .102 comes minutes before .101's last hop has finished.
 * 5. Every retired twin key is gone from the catalogue while its token is still carried
 *    under another vendor. Otherwise the arm either prunes a board still served, or the
 *    token-keyed orphan prune already reaches it and the arm is dead.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JOB_SOURCES } from "../../supabase/functions/job-board/sources";
import { codeOf } from "./helpers/strip-comments";
import * as L from "../../scripts/deploy-ledger.mjs";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const MIGRATIONS = readdirSync(resolve(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
const fileOf = (stamp: string) => MIGRATIONS.find((f) => f.startsWith(`${stamp}_`)) ?? null;
const CODE = codeOf(read("supabase/functions/job-board/index.ts"));
const KEYS = new Set(JOB_SOURCES.map((s) => `${s.source}:${s.token}`));
const TOKENS = new Set(JOB_SOURCES.map((s) => s.token));
const tokenOf = (key: string) => key.slice(key.indexOf(":") + 1);

/** A `const NAME ... = [ "a", "b" ]` string list, read from index.ts with comments blanked; null when there is none. */
function stringList(name: string): string[] | null {
  const m = new RegExp(`const ${name}\\b[^=]*=\\s*\\[([\\s\\S]*?)\\];`).exec(CODE);
  return m ? [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]) : null;
}

/** A high-water clamp's literals, comment lines dropped (the same reading a-demo-board-is-not-an-employer makes). */
const clampsOf = (file: string) =>
  [...read(`supabase/migrations/${file}`).split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")
    .matchAll(/LEAST\(\(v->>'size'\)::int,\s*(\d+)\)/g)].map((m) => Number(m[1]));

describe("the board-102 lanes ship as one build", () => {
  it("1. the catalogue high-water migration clamps to exactly the boards the bundle carries, and is the newest clamp", () => {
    const file = fileOf("20261111120000");
    expect(file, "no migration 20261111120000: nothing lowers the high-water after the retirements, so the orphan prune stays blocked").not.toBeNull();
    expect(clampsOf(file!), `${file} must clamp the mark to JOB_SOURCES.length`).toEqual([JOB_SOURCES.length]);
    const newest = MIGRATIONS.filter((f) => clampsOf(f).length > 0).pop();
    expect(newest, "a later migration clamps the high-water again, so this clamp is not the one production keeps").toBe(file);
  });

  it("2. the Workable retry without details ships only with the three gig boards retired", () => {
    const retry =
      /async function readWorkableBare\([\s\S]*?listUrl\(s,\s*0,\s*false\)/.test(CODE) &&
      /failReason\.startsWith\("oversize"\)\s*&&\s*s\.source\s*===\s*"workable"[\s\S]{0,450}?readWorkableBare\(s\)/.test(CODE) &&
      /s\.source\s*===\s*"workable"[\s\S]{0,200}?\?details=\$\{details\}/.test(CODE);
    const gigStillCatalogued = ["workable:toloka-ai", "workable:clients-blackbox-inc", "workable:huzzle"].filter((k) => KEYS.has(k));
    expect(
      { retry, gigStillCatalogued },
      "the oversize Workable retry (core) and the OD1 gig retirements (catalogue) must ship together: either alone serves the wrong boards or nothing",
    ).toEqual({ retry: true, gigStillCatalogued: [] });
  });

  it("3. the four renamed boards print their new names and the name-sync lane renames their stored rows", () => {
    const renamed = stringList("RENAMED_TOKENS");
    expect(renamed, "index.ts has no RENAMED_TOKENS list").not.toBeNull();
    const sync = Number(/const NAME_SYNC_VERSION\s*=\s*(\d+)/.exec(CODE)?.[1] ?? NaN);
    expect(sync, "NAME_SYNC_VERSION must move past 6, or the name-sync lane never re-runs for the four").toBeGreaterThanOrEqual(7);
    const WANT: Record<string, string> = {
      "ashby:creatoriq": "CreatorIQ",
      "ashby:harmattan-ai": "Harmattan AI",
      "personio:deag-deutsche-entertainment-ag": "DEAG Deutsche Entertainment AG",
      "lever:americaatwork": "America At Work",
    };
    for (const [key, name] of Object.entries(WANT)) {
      const board = JOB_SOURCES.find((s) => `${s.source}:${s.token}` === key);
      expect({ key, inRenamedTokens: renamed!.includes(tokenOf(key)), name: board?.name ?? null }).toEqual({ key, inRenamedTokens: true, name });
    }
  });

  it("4. the ledger applies the closes_at columns and the four names' evidence before job-board, and the pay heal and the high-water clamp after a slice of .102, not an OPTIONS answer", () => {
    const stamps = { closesAt: "20261111100000", names: "20261111130000", heal: "20261111110000", highWater: "20261111120000" };
    const files = Object.fromEntries(Object.entries(stamps).map(([k, s]) => [k, fileOf(s)]));
    expect(Object.values(files).filter((f) => !f), "a board-102 migration file is missing").toEqual([]);
    const ledger = JSON.parse(read("docs/deploy-ledger.json"));
    const rows = [
      { fn: "job-board", want: "job-board.2026-09-09.102", have: "job-board.2026-09-09.101", state: "deploy" },
      { fn: "layoff-filings", want: "layoff-filings.2026-11-11.1", have: "layoff-filings.2026-10-26.1", state: "deploy" },
    ];
    const phases = L.migrationPhases(Object.values(files) as string[], ledger, rows, MIGRATIONS);
    expect(phases.errors).toEqual([]);
    const stepOf = (f: string | null) => {
      const hit = (["pre", "afterFunctions", "afterFrontend"] as const).find((k) => (phases[k] as Array<{ file: string }>).some((m) => m.file === f));
      const note = hit ? (phases[hit] as Array<{ file: string; note: string }>).find((m) => m.file === f)!.note : "";
      return { step: hit ?? "none", waits: /before job-board/.test(note) ? "before job-board" : /once the job-board status action's sliceStats\.build reads 2026-09-09\.102 or later/.test(note) ? "after a slice of job-board .102" : /once job-board answers/.test(note) ? "after an OPTIONS answer" : "nothing" };
    };
    expect({
      closesAt: stepOf(files.closesAt),
      names: stepOf(files.names),
      heal: stepOf(files.heal),
      highWater: stepOf(files.highWater),
    }).toEqual({
      closesAt: { step: "pre", waits: "before job-board" },
      names: { step: "pre", waits: "before job-board" },
      heal: { step: "afterFunctions", waits: "after a slice of job-board .102" },
      highWater: { step: "afterFunctions", waits: "after a slice of job-board .102" },
    });
  });

  it("5. every retired twin key has left the catalogue while its token is still carried under another vendor", () => {
    const twins = stringList("RETIRED_TWIN_KEYS");
    expect(twins, "index.ts has no RETIRED_TWIN_KEYS list, so a kept-token repoint's old rows serve until they age out").not.toBeNull();
    expect(twins!.length).toBeGreaterThan(0);
    const wrong = twins!
      .map((k) => ({ key: k, stillCatalogued: KEYS.has(k), tokenCarried: TOKENS.has(tokenOf(k)) }))
      .filter((t) => t.stillCatalogued || !t.tokenCarried);
    expect(wrong, "a twin key the catalogue still carries would be pruned while served; one whose token left is already the orphan prune's").toEqual([]);
  });

  it("6. the message reads the oneshot pre-check first, a stopped heal never strands the clamp, and the board's shared files name board-102, not a finished wave", () => {
    const ledger = JSON.parse(read("docs/deploy-ledger.json"));
    const order = ledger.migrationOrder as Record<string, { note?: string }>;
    expect(order["20261111100000"].note).toMatch(/^before applying it, run get_cron_health: while it lists a oneshot-drop-\* job/);
    expect(order["20261111110000"].note).toMatch(/apply 20261111120000 anyway/);
    // The bug round's named overlap (spec-102 section 8) is reported against board-102, the workstream that holds these files now.
    const paths = ["supabase/functions/job-board/index.ts", "supabase/functions/job-board/sources.ts", "supabase/functions/job-board/normalize.ts",
      "supabase/functions/job-board/slim-stream.ts", "supabase/functions/layoff-filings/index.ts", "supabase/functions/layoff-filings/board-sources.ts",
      "fn:job-board", "fn:layoff-filings"];
    expect(Object.fromEntries(paths.map((p) => [p, L.sharedOwner(ledger.sharedFiles, p)]))).toEqual(Object.fromEntries(paths.map((p) => [p, "board-102"])));
    const r = L.overlapReport([
      { ref: "board/102-integration", files: ["supabase/functions/layoff-filings/index.ts"], functions: ["layoff-filings"] },
      { ref: "bugs/next", files: ["supabase/functions/layoff-filings/index.ts"], functions: ["layoff-filings"] },
    ], ledger);
    expect(r.files.map((f: { path: string; owner: string }) => [f.path, f.owner])).toEqual([["supabase/functions/layoff-filings/index.ts", "board-102"]]);
    expect(r.functions.map((f: { fn: string; owner: string }) => [f.fn, f.owner])).toEqual([["layoff-filings", "board-102"]]);
  });
});
