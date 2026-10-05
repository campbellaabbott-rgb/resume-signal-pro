import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { boardKey, dropBareSharedKeys, keySource, keyToken, updateBoardFailures } from "../../supabase/functions/job-board/dormancy";
import { tokensOf } from "../../supabase/functions/job-board/stale-lane";
import { isPlacelessLocation } from "../../supabase/functions/job-board/normalize";
import { JOB_SOURCES } from "../../supabase/functions/job-board/sources";
import { codeOf } from "./helpers/strip-comments";

/**
 * THE LEDGER BEFORE THE DELETE, ONE BOARD PER KEY, AND ONE READER PER FIELD (.89).
 *
 *  - L13-71 (old 2.29): the refresh's closure prune deleted a 200-row chunk
 *    even when its closure read or insert had failed, and the dormant/orphan
 *    prunes deleted a whole token when the exit log broke on page 1.
 *  - L13-49 (old 2.13): failure state was keyed by token although 139 tokens
 *    carry two or three vendors, so a reading twin cleared a dead twin's
 *    streak forever, and a prune deleted both vendors' rows.
 *  - L13-17 (old 1.33): the refresh wrote the Workday LIST payload's weaker
 *    readings (no work mode, "8 Locations") back over what the detail sweeps
 *    had filled, every rotation, logging each undo as an employer edit.
 */
const ROOT = resolve(__dirname, "../..");
const FN = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");
const CODE = codeOf(FN);

describe("the closure prune deletes only rows whose closure landed (L13-71)", () => {
  const loop = (() => {
    const at = CODE.indexOf("const keep = new Set<string>();");
    return at < 0 ? "" : CODE.slice(at, CODE.indexOf("} else if (vanished.length) {", at));
  })();

  it("a failed read keeps the whole chunk; a failed insert keeps the rows it was writing", () => {
    expect(loop, "the closure prune's keep set is gone").not.toBe("");
    expect(loop).toMatch(/if \(logRes\.error\) \{\s*for \(const id of chunk\) keep\.add\(id\);/);
    expect(loop).toMatch(/if \(clErr\) \{\s*for \(const r of rows\) keep\.add\(String\(r\.id\)\);/);
    expect(loop).toMatch(/catch \(e\) \{\s*for \(const id of chunk\) keep\.add\(id\);/);
  });

  it("the delete takes only what is not kept, and a removed-exit is written only beside a closure that landed", () => {
    expect(loop).toMatch(/const doomed = keep\.size > 0 \? chunk\.filter\(\(id\) => !keep\.has\(id\)\) : chunk;/);
    expect(loop).toMatch(/\.delete\(\)\.in\("id", doomed\)/);
    expect(loop).not.toMatch(/\.delete\(\)\.in\("id", chunk\)/);
    expect(loop).toMatch(/if \(!clErr\) waitUntil\(Promise\.resolve\(insertExits\(/);
  });

  it("the whole-board exit log reports whether it finished, and its pages are ordered", () => {
    const body = CODE.slice(CODE.indexOf("async function logWholeBoardExit("), CODE.indexOf("async function pruneWholeBoard("));
    expect(body).toMatch(/Promise<\{ logged: number; complete: boolean; loggedIds: string\[\] \}>/);
    expect(body.match(/\.order\("id"\)/g)?.length).toBe(2);
    expect(body).toMatch(/if \(rows\.length < 500\) \{ complete = true; break; \}/);
  });
});

describe("failure state is kept per board on a shared token (L13-49)", () => {
  const shared = new Set(["lush"]);

  it("a shared token's boards get their own keys; every other board keeps its bare token", () => {
    expect(boardKey("greenhouse", "lush", shared)).toBe("greenhouse:lush");
    expect(boardKey("personio", "lush", shared)).toBe("personio:lush");
    expect(boardKey("greenhouse", "stripe", shared)).toBe("stripe");
    expect(keyToken("greenhouse:lush")).toBe("lush");
    expect(keySource("greenhouse:lush")).toBe("greenhouse");
    expect(keySource("stripe")).toBe(null);
    expect(JOB_SOURCES.some((s) => s.token.includes(":")), "a catalog token with a colon would make board keys ambiguous").toBe(false);
  });

  it("a dead twin is pruned while its sibling keeps reading", () => {
    const gh = boardKey("greenhouse", "lush", shared);
    const pe = boardKey("personio", "lush", shared);
    let state = { streaks: {} as Record<string, number>, dormant: {} as Record<string, number>, failedAt: {} as Record<string, number>, firstFailedAt: {} as Record<string, number> };
    let pruned: string[] = [];
    const t0 = Date.parse("2026-10-01T00:00:00Z");
    for (let i = 0; i < 8; i++) {
      const out = updateBoardFailures({
        okTokens: [gh], failedTokens: [pe], recheckTokens: new Set(),
        ...state, deadThreshold: 6, minFailureAgeMs: 41 * 3_600_000, dormantCap: 500, now: t0 + i * 12 * 3_600_000,
      });
      state = { streaks: out.streaks, dormant: out.dormant, failedAt: out.failedAt, firstFailedAt: out.firstFailedAt };
      pruned = pruned.concat(out.toPrune);
    }
    expect(pruned, "the personio board is dead and must reach the prune even though greenhouse:lush reads").toEqual([pe]);
    expect(Object.prototype.hasOwnProperty.call(state.dormant, gh)).toBe(false);
  });

  it("state an older build wrote under a bare shared token is dropped, never left for the retry lane to chase", () => {
    const { state, dropped } = dropBareSharedKeys({ streaks: { lush: 3, stripe: 2 }, dormant: { lush: 1 }, failedAt: { lush: 5, stripe: 6 }, firstFailedAt: { lush: 4 } }, shared);
    expect(dropped).toBe(4);
    expect(state).toEqual({ streaks: { stripe: 2 }, dormant: {}, failedAt: { stripe: 6 }, firstFailedAt: {} });
  });

  it("the stale lane, whose rows name tokens, still sees a keyed board's token", () => {
    expect([...tokensOf({ "greenhouse:lush": 1, stripe: 2 })].sort()).toEqual(["lush", "stripe"]);
  });

  it("index.ts folds, skips and prunes by board key, and prunes a board's own vendor only", () => {
    expect(CODE).toMatch(/okTokens: okKeys,/);
    expect(CODE).toMatch(/if \(skipTokens\.has\(boardKeyOf\(s\)\)\) continue;/);
    expect(CODE).toMatch(/retryBoards = dueKeys\s*\.map\(boardByKey\)/);
    expect(CODE).toMatch(/await pruneWholeBoard\(client, tk, "board_dormant", board\?\.source \?\? keySource\(key\)\)/);
    expect(CODE).toMatch(/\}, SHARED_TOKENS\)\.state;/);
  });
});

describe("the list payload never overwrites what the detail sweep filled (L13-17)", () => {
  it("a placeholder is placeless and a place is not", () => {
    expect(isPlacelessLocation("8 Locations")).toBe(true);
    expect(isPlacelessLocation("Boston, MA")).toBe(false);
  });

  it("the diff loop skips the placeholder over a real place, and a stored mode on a list-silent vendor", () => {
    expect(CODE).toMatch(/const LIST_MODE_UNSTATED = new Set\(\["workday", "jazzhr"\]\);/);
    expect(CODE).toMatch(/const listPlaceholder = isPlacelessLocation\(row\.location as string \| null\) && !isPlacelessLocation\(prev\.location as string \| null\);/);
    expect(CODE).toMatch(/if \(!listPlaceholder\) put\("location", row\.location, prev\.location, false\);/);
    expect(CODE).toMatch(/const keepStoredMode = LIST_MODE_UNSTATED\.has\(s\.source\) && prev\.work_mode != null;/);
    expect(CODE).toMatch(/if \(!keepStoredMode\) put\("work_mode", row\.work_mode, prev\.work_mode, false\);/);
    expect(CODE).toMatch(/if \(typeof row\.remote === "boolean" && !keepStoredMode\) \{/);
  });
});
