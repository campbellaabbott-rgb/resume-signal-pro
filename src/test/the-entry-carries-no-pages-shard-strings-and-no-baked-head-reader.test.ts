// @vitest-environment node
/**
 * THE ENTRY CARRIES NO PAGE'S SHARD STRINGS AND NO BAKED-HEAD READER (the bug
 * round's review, 2026-11-16).
 *
 * WHAT WAS WRONG. SEO-040's budget is 220 KB gzip for the entry and every
 * chunk it imports statically. The bug round's integration built 239,740 B:
 * src/i18n/index.ts globbed every English shard into the entry (about 17 KB
 * gzip of the account page's, the affiliate page's, the scanner's, the
 * board's and nine more lanes' strings, carried to every page), and App.tsx
 * imported RouteDefaultHead statically, which brought the baked-head reader,
 * the prerendered-head helpers and the bake's employer-statements module with
 * it.
 *
 * WHAT HOLDS NOW.
 *   - In the built app a shard's English strings are a namespace like any of
 *     en.json's (vite.config.ts, rb-en-namespaces): the entry's glob of a
 *     deferred shard reads an empty bundle, and each module that names the
 *     shard's root imports the root's strings first, so they arrive with the
 *     page. The homepage's and the pricing page's keep their own modules, and
 *     the site shell's stay in the entry, which renders them. src/i18n names
 *     every root as data and brings none.
 *   - The registry knows the shard roots, so a miss in one this page has not
 *     loaded fetches the whole English file, the shards included.
 *   - App.tsx loads RouteDefaultHead lazily. The baked head is still read
 *     before any route renders: RouteDefaultHead renders only once its chunk,
 *     and the reader it imports, have run, and every page that reads the
 *     baked head imports the reader too.
 * The budget itself is held by
 * seo-speed-the-entry-carries-only-the-strings-it-renders.test.ts on a build.
 */
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Plugin } from "vite";
import { EN_ALL_ID, EN_NAMESPACE_ID, EN_REGISTRY_ID, EN_SHARDS_IN_THE_ENTRY, EN_SHARD_EMPTY_ID, deferredEnglishShards, enNamespaces } from "../../vite.config";
import { SHARD_ROOT_KEYS } from "@/i18n/merge-shards";
import { codeOf } from "./helpers/strip-comments";

const ROOT = resolve(__dirname, "../..");
const SRC = resolve(ROOT, "src") + "/";
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

/** The plugin's hooks, called the way Rollup calls them. */
function plugin() {
  const p = enNamespaces() as Plugin & Record<string, (...a: unknown[]) => unknown>;
  const ctx = { addWatchFile: () => {}, error: (m: string) => { throw new Error(m); } };
  const call = (hook: string, ...args: unknown[]) => {
    const h = p[hook] as unknown as ((...a: unknown[]) => unknown) | { handler: (...a: unknown[]) => unknown };
    return (typeof h === "function" ? h : h.handler).apply(ctx, args);
  };
  call("buildStart");
  return {
    resolve: (source: string, importer: string) => call("resolveId", source, importer) as string | null,
    load: (id: string) => call("load", id) as string | null,
    transform: (code: string, file: string) => (call("transform", code, file) as { code: string } | null)?.code ?? null,
  };
}

const SHARD_DIRS = readdirSync(resolve(ROOT, "src/i18n/shards")).filter((d) => !d.includes("."));

describe("which English shards ride the entry", () => {
  it("every shard but the homepage's, the pricing page's and the site shell's loads with its page", () => {
    const deferred = deferredEnglishShards().map((s) => s.dir);
    expect([...EN_SHARDS_IN_THE_ENTRY].sort()).toEqual(["home", "pricing", "site-shell"]);
    expect(deferred.sort()).toEqual(SHARD_DIRS.filter((d) => !EN_SHARDS_IN_THE_ENTRY.has(d)).sort());
    expect(deferred.length).toBeGreaterThanOrEqual(14);
    for (const s of deferredEnglishShards()) expect(s.root, s.dir).toBe(SHARD_ROOT_KEYS[s.dir]);
  });

  it("a shard that writes two top-level keys is refused, not half-deferred", () => {
    const dir = mkdtempSync(join(tmpdir(), "rb-shards-"));
    mkdirSync(join(dir, "stray"));
    writeFileSync(join(dir, "stray", "en.json"), JSON.stringify({ a: { x: "1" }, b: { y: "2" } }));
    expect(() => deferredEnglishShards(dir)).toThrow(/writes 2 top-level keys/);
  });
});

describe("the built app's English, through the namespace plugin", () => {
  const p = plugin();
  const INDEX = resolve(ROOT, "src/i18n/index.ts");

  it("the entry's glob of a deferred shard reads an empty bundle; a kept shard's and any other importer's read the file", () => {
    expect(p.resolve("./shards/account/en.json", INDEX)).toBe(`${EN_SHARD_EMPTY_ID}account`);
    expect(p.resolve("./shards/free-scan-page/en.json", INDEX)).toBe(`${EN_SHARD_EMPTY_ID}free-scan-page`);
    expect(p.resolve("/src/i18n/shards/board-ui/en.json", INDEX), "a root-absolute glob path").toBe(`${EN_SHARD_EMPTY_ID}board-ui`);
    expect(p.load(`${EN_SHARD_EMPTY_ID}account`)).toBe("export default {};\n");
    expect(p.resolve("./shards/site-shell/en.json", INDEX), "the shell the entry renders").toBeNull();
    expect(p.resolve("./shards/home/en.json", INDEX)).toBeNull();
    expect(p.resolve("./shards/account/de.json", INDEX), "another language loads on demand as before").toBeNull();
    expect(p.resolve("./shards/home/en.json", resolve(ROOT, "src/i18n/home-strings.ts"))).toBeNull();
    expect(p.resolve("../i18n/shards/account/en.json", resolve(ROOT, "src/test/x.ts"))).toBeNull();
  });

  it("a module naming a shard root imports that root's strings first, and the strings are the shard's", () => {
    const code = `export const A = () => t("accountView.followUpDraft"); const b = t(\`boardUi.unscored\${x}\`);`;
    const out = p.transform(code, `${SRC}pages/Account.tsx`);
    expect(out).toContain(`import ${JSON.stringify(`${EN_NAMESPACE_ID}accountView`)};`);
    expect(out).toContain(`import ${JSON.stringify(`${EN_NAMESPACE_ID}boardUi`)};`);
    const mod = p.load(`${EN_NAMESPACE_ID}accountView`)!;
    expect(mod).toContain(JSON.stringify(EN_REGISTRY_ID));
    const account = JSON.parse(read("src/i18n/shards/account/en.json")).accountView;
    expect(mod).toContain(JSON.stringify(account.followUpDraft).slice(1, -1));
  });

  it("src/i18n names every root as data and brings none of the shards' strings", () => {
    const merge = read("src/i18n/merge-shards.ts");
    expect(merge).toContain('account: "accountView"');
    const out = p.transform(merge, `${SRC}i18n/merge-shards.ts`) ?? merge;
    for (const root of ["accountView", "listing", "freeScanPage"]) expect(out, root).not.toContain(JSON.stringify(`${EN_NAMESPACE_ID}${root}`));
    // The same table outside src/i18n would bring them: the scan does see the roots.
    expect(p.transform(merge, `${SRC}lib/a-table.ts`)).toContain(JSON.stringify(`${EN_NAMESPACE_ID}accountView`));
  });

  it("the registry knows the shard roots after en.json's own namespaces, and the safety net's whole file carries them", () => {
    const registry = p.load(EN_REGISTRY_ID)!;
    const names = JSON.parse(/const NAMES = new Set\((\[.*?\])\);/.exec(registry)![1]) as string[];
    const en = Object.keys(JSON.parse(read("src/i18n/locales/en.json")));
    expect(names.slice(0, en.length)).toEqual(en);
    for (const s of deferredEnglishShards()) expect(names, s.root).toContain(s.root);
    expect(names).not.toContain("siteShell");
    const all = p.load(EN_ALL_ID)!;
    expect(all).toContain("ingestParsers");
    expect(all).toContain("freeScanPage");
  });
});

describe("App.tsx", () => {
  it("loads RouteDefaultHead lazily, so the baked-head reader is not in the entry", () => {
    const app = codeOf(read("src/App.tsx"));
    expect(app).not.toMatch(/^import [^;]*from "\.\/components\/RouteDefaultHead";/m);
    expect(app).toMatch(/const RouteDefaultHead = lazy\(\(\) => import\("\.\/components\/RouteDefaultHead"\)/);
    expect(app).toMatch(/<Suspense fallback=\{null\}><RouteDefaultHead \/><\/Suspense>/);
  });
});
