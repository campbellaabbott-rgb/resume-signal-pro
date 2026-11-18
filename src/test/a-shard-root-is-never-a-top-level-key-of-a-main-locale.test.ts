/**
 * A SHARD ROOT IS NEVER A TOP-LEVEL KEY OF A MAIN LOCALE.
 *
 * Each shard directory writes under one root key (SHARD_ROOT_KEYS in
 * src/i18n/merge-shards.ts). The shard guard
 * (every-shard-string-is-loaded-translated-and-scanned) catches a shard LEAF
 * that main already defines, but not a ROOT main already uses: a shard
 * registered as "accountPage" would add new leaves beside the 282 the main
 * locale keeps there, both files would write the same object, and which of
 * them owns a sentence would depend on who edits it next. The bug round of
 * 2026-11-08 registers twelve roots at once for twelve lanes, and its last
 * lane edits the main locale files, so the root has to stay free on both
 * sides: no registered root may be a top-level key of any main locale.
 *
 * Also held here: two directories never share a root (their leaves would
 * collide by construction), and every registered directory name is one the
 * runtime glob can read (parseShardPath), so a lane that writes its strings
 * where it was told to finds them loaded.
 */
import { describe, expect, it } from "vitest";
import { parseShardPath, SHARD_ROOT_KEYS, type Bundle } from "@/i18n/merge-shards";
import { LOCALE_FILES, readMainLocale } from "./helpers/locale-strings";

/** Every registered root that a main bundle already uses as a top-level key. */
function rootsMainAlreadyHolds(main: Bundle, roots: Readonly<Record<string, string>>): string[] {
  return Object.entries(roots)
    .filter(([, root]) => Object.prototype.hasOwnProperty.call(main, root))
    .map(([dir, root]) => `${dir} -> ${root}`);
}

/** Every root two or more directories register. */
function sharedRoots(roots: Readonly<Record<string, string>>): string[] {
  const seen = new Map<string, string[]>();
  for (const [dir, root] of Object.entries(roots)) seen.set(root, [...(seen.get(root) ?? []), dir]);
  return [...seen].filter(([, dirs]) => dirs.length > 1).map(([root, dirs]) => `${root}: ${dirs.join(", ")}`);
}

describe("the registered shard roots", () => {
  it("are not top-level keys of any of the nine main locales", () => {
    expect(LOCALE_FILES).toHaveLength(9);
    for (const f of LOCALE_FILES) {
      expect(rootsMainAlreadyHolds(readMainLocale(f), SHARD_ROOT_KEYS), f).toEqual([]);
    }
  });

  it("belong to one directory each", () => {
    expect(sharedRoots(SHARD_ROOT_KEYS)).toEqual([]);
  });

  it("name directories the runtime glob reads", () => {
    for (const dir of Object.keys(SHARD_ROOT_KEYS)) {
      expect(parseShardPath(`./shards/${dir}/en.json`), dir).toEqual({ name: dir, lng: "en" });
      expect(parseShardPath(`./shards/${dir}/en-GB.json`), dir).toEqual({ name: dir, lng: "en-GB" });
    }
  });
});

describe("the checks, on fixtures", () => {
  const main: Bundle = { accountPage: { tracked: "Tracked" }, header: { jobs: "Jobs" } };

  it("names a root the main locale already holds", () => {
    expect(rootsMainAlreadyHolds(main, { account: "accountPage", listing: "listing" })).toEqual(["account -> accountPage"]);
    expect(rootsMainAlreadyHolds(main, { account: "accountView", listing: "listing" })).toEqual([]);
  });

  it("names a root two directories share", () => {
    expect(sharedRoots({ mail: "mailPrefs", "mail-b": "mailPrefs", paid: "paidAnalysis" })).toEqual(["mailPrefs: mail, mail-b"]);
    expect(sharedRoots({ mail: "mailPrefs", paid: "paidAnalysis" })).toEqual([]);
  });

  it("refuses a directory name the glob cannot read", () => {
    expect(parseShardPath("./shards/Board_UI/en.json")).toBeNull();
  });
});
