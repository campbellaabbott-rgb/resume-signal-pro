// @vitest-environment node
/**
 * Board .102, oversize registry prune: an entry left meta oversize_boards only
 * when its board read under the bound (clearOversize) or when it aged past
 * OVERSIZE_CAP. A board the catalogue retired is never visited again, so it
 * could do neither: the three Workable boards this build retires would have
 * sat in the registry, in status.oversizeBoards and in the freshness sweep's
 * exclusions, indefinitely. Loading the registry now drops every key whose
 * board is not in the catalogue, and writes the registry back when it did.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { loadOversizeEntries, type OversizeEntry } from "../../supabase/functions/job-board/oversize-registry";

const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const at = FN.indexOf("\nasync function loadOversizeBoards(");
if (at < 0) throw new Error("loadOversizeBoards moved; re-point this test");
const LOAD = FN.slice(at + 1, FN.indexOf("\n}\n", at) + 2);

const E = (source: string, mb = 9) => ({ source, mb, at: "2026-11-01T00:00:00.000Z" });
const SHARED = new Set(["helsing"]);

describe("a board the catalogue dropped leaves the oversize list", () => {
  it("loadOversizeEntries keeps catalogued boards and drops the rest, counting them", () => {
    const reg = new Map<string, OversizeEntry>();
    const n = loadOversizeEntries(reg, { "big-co": E("workable"), "nogigiddy": E("workable"), "greenhouse:helsing": E("greenhouse"), "pinpoint:helsing": E("pinpoint") },
      SHARED, new Set(["big-co", "greenhouse:helsing"]));
    expect(n).toBe(2);
    expect([...reg.keys()]).toEqual(["big-co", "greenhouse:helsing"]);
  });

  it("with no catalogue given it keeps everything, as before", () => {
    const reg = new Map<string, OversizeEntry>();
    expect(loadOversizeEntries(reg, { a: E("lever"), b: E("lever") }, SHARED)).toBe(0);
    expect(reg.size).toBe(2);
  });

  const run = async (boards: Record<string, unknown>, read = true) => {
    const reg = new Map<string, OversizeEntry>();
    let persisted = 0;
    const deps = {
      readMetaRow: async () => (read ? { read: true, v: { boards } } : { read: false, why: "timeout" }),
      META_READ: { oversize: false },
      loadOversizeEntries,
      persistOversizeBoards: async () => { persisted++; },
      OVERSIZE_BOARDS: reg,
      SHARED_TOKENS: SHARED,
      CATALOGUE_KEYS: new Set(["big-co"]),
      console: { warn: () => {} },
    };
    const js = ts.transpileModule(`${LOAD}\nreturn loadOversizeBoards;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    await (new Function(...Object.keys(deps), js)(...Object.values(deps)) as (c: unknown) => Promise<void>)({});
    return { reg, persisted };
  };

  it("loadOversizeBoards writes the registry back once when it dropped a board, and not otherwise", async () => {
    const dropped = await run({ "big-co": E("workable"), "weekday-1": E("workable") });
    expect([...dropped.reg.keys()]).toEqual(["big-co"]);
    expect(dropped.persisted).toBe(1);
    expect((await run({ "big-co": E("workable") })).persisted).toBe(0);
  });

  it("an unread registry is neither pruned nor written", async () => {
    const r = await run({ "weekday-1": E("workable") }, false);
    expect(r.persisted).toBe(0);
  });

  it("the catalogue it is judged against is the one every board key comes from", () => {
    expect(FN).toMatch(/const CATALOGUE_KEYS: ReadonlySet<string> = new Set\(JOB_SOURCES\.map\(boardKeyOf\)\);/);
  });
});
