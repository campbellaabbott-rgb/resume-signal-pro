// @vitest-environment node
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { EN_ALL_ID, EN_NAMESPACE_ID, EN_REGISTRY_ID, namespaceModule, namespacesNamedIn, registryModule } from "../../vite.config";
import { skipWithoutDist } from "./helpers/built-output";

/**
 * WHAT WAS WRONG (SEO-040, spec 2026-10-12): every page downloaded and parsed
 * the whole English UI text before anything ran. The entry chunk was 945,134 B
 * raw and 292,837 B gzip (build of 2026-10-18), 302 KB of it en.json: the job
 * board's 75 KB of strings rode to the homepage, the homepage's to every
 * posting page. The spec's budget is 220 KB gzip.
 *
 * What holds now (vite.config.ts, rb-en-namespaces): en.json stays one file,
 * the file the bake reads, but the built app receives it a namespace at a
 * time, each imported by the source modules that name it, so a page's strings
 * arrive with that page's code. A key no module names (built from runtime
 * data) loads the whole file once, from its own chunk, and re-renders.
 *
 * The unit tests below hold the three pieces (what counts as naming a
 * namespace, the module that registers one, and the registry with its
 * safety net). The built-output tests hold the budget (the entry and every
 * chunk it imports statically, which is what runs before anything renders:
 * splitting the entry into eager pieces cannot pass it), that the entry no
 * longer carries the board's strings, and that the bake still reads every
 * namespace from the one file.
 */
const ROOT = resolve(__dirname, "../..");
const EN = JSON.parse(readFileSync(resolve(ROOT, "src/i18n/locales/en.json"), "utf8")) as Record<string, unknown>;
const NAMES = new Set(Object.keys(EN));
const ENTRY_BUDGET_GZIP = 220 * 1024;

describe("what counts as naming a namespace", () => {
  it("finds a key literal, a template key, a bare namespace and a JSX key attribute", () => {
    const code = [
      `t("jobsPage.filters.title")`,
      "t(`jobsPage.categories.${slug}`)",
      `useTranslation("translation", { keyPrefix: 'hero' })`,
      `<Trans i18nKey='faq.items.0.q' />`,
      `const KEYS = { a: "pricingPage.title" };`,
    ].join("\n");
    expect(namespacesNamedIn(code, NAMES)).toEqual(["faq", "hero", "jobsPage", "pricingPage"]);
  });

  it("ignores identifiers, longer words and strings that are not en.json namespaces", () => {
    const code = `const jobsPage = 1; t(jobsPage); "jobsPageX.y"; "notANamespace.key"; 'hero-banner'; obj.hero.title`;
    expect(namespacesNamedIn(code, NAMES)).toEqual([]);
  });

  it("every en.json namespace is a name the scan can see (no dots, no spaces)", () => {
    for (const ns of NAMES) expect(ns, ns).toMatch(/^[A-Za-z_$][\w$-]*$/);
    expect(NAMES.size).toBeGreaterThan(50);
  });
});

describe("the modules the build writes", () => {
  it("a namespace module registers exactly its namespace, as JSON.parse when it is large", () => {
    const small = namespaceModule({ common: EN.common });
    expect(small).toContain(`from ${JSON.stringify(EN_REGISTRY_ID)}`);
    expect(small).toContain(`addEnglish(${JSON.stringify({ common: EN.common })})`);
    const big = namespaceModule({ jobsPage: EN.jobsPage });
    expect(big).toMatch(/addEnglish\(JSON\.parse\("/);
  });

  /** Runs the registry with a stand-in i18next and a stand-in import(). */
  function runRegistry() {
    const imported: string[] = [];
    const events: string[] = [];
    const i18n = {
      options: {} as Record<string, unknown>,
      store: undefined as unknown,
      language: "en",
      added: [] as unknown[],
      addResourceBundle(...args: unknown[]) { this.added.push(args); },
      emit(name: string) { events.push(name); },
    };
    const src = registryModule([...NAMES])
      .replace(/^import i18n from "i18next";$/m, "")
      .replace(/export const EN/, "const EN")
      .replace(/export function addEnglish/, "function addEnglish")
      .replace(/import\(/, "__import(");
    const run = new Function("i18n", "__import", `${src}\nreturn { EN, addEnglish };`);
    const api = run(i18n, (id: string) => { imported.push(id); return Promise.resolve(); }) as { EN: Record<string, unknown>; addEnglish: (p: Record<string, unknown>) => void };
    const handler = i18n.options.parseMissingKeyHandler as (key: string, def?: string) => string;
    return { i18n, api, handler, imported, events };
  }

  it("before init the registry collects; after init it feeds the live store", () => {
    const { i18n, api } = runRegistry();
    api.addEnglish({ common: { close: "Close" } });
    expect(api.EN.common).toEqual({ close: "Close" });
    expect(i18n.added).toHaveLength(0);
    i18n.store = {};
    api.addEnglish({ hero: { title: "x" } });
    expect(i18n.added).toEqual([["en", "translation", { hero: { title: "x" } }, true, true]]);
  });

  it("a miss in a namespace this page has not loaded fetches every namespace once and re-renders; any other miss loads nothing", async () => {
    const { api, handler, imported, events } = runRegistry();
    api.addEnglish({ common: { close: "Close" } });
    expect(handler("common.nothingHere", "Fallback"), "a loaded namespace's miss keeps its default").toBe("Fallback");
    expect(handler("auth.signIn.title"), "the auth strings are not en.json's").toBe("auth.signIn.title");
    expect(handler("listing.row.open"), "a shard is not en.json's").toBe("listing.row.open");
    expect(imported).toEqual([]);
    expect(handler("jobsPage.filters.title")).toBe("jobsPage.filters.title");
    expect(handler("explore.title", "Explore")).toBe("Explore");
    expect(imported).toEqual([EN_ALL_ID]);
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["languageChanged"]);
  });
});

// ---- the built app ----
const DIST = resolve(ROOT, "dist");
const INDEX = resolve(DIST, "index.html");
const hasDist = existsSync(INDEX) && existsSync(resolve(DIST, "assets"));

/** The entry script the built index.html loads, and every chunk it imports statically. */
function entryClosure(): { entry: string; files: string[] } {
  const html = readFileSync(INDEX, "utf8");
  const entry = /<script type="module"[^>]*src="\/assets\/([^"]+\.js)"/.exec(html)?.[1];
  expect(entry, "the built index.html loads an entry script").toBeTruthy();
  const seen = new Set<string>();
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const code = readFileSync(resolve(DIST, "assets", file), "utf8");
    for (const m of code.matchAll(/(?:^|[;\n}])\s*import\s*(?:[^"';]*?from\s*)?["']\.\/([^"']+\.js)["']/g)) walk(m[1]);
  };
  walk(entry!);
  return { entry: entry!, files: [...seen] };
}

/** A long English string only `ns` has, to look for in the built chunks. */
function signatureOf(ns: string): string {
  const leaves: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") leaves.push(v);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(EN[ns]);
  const others = JSON.stringify(Object.fromEntries(Object.entries(EN).filter(([k]) => k !== ns)));
  const sig = leaves.filter((s) => s.length >= 40 && !/[{}"\\<]/.test(s) && !others.includes(s)).sort((a, b) => b.length - a.length)[0];
  expect(sig, `${ns} has a string of its own`).toBeTruthy();
  return sig!;
}

describe.skipIf(skipWithoutDist(hasDist))("the built app's entry", () => {
  it(`with every chunk it imports statically, is within ${ENTRY_BUDGET_GZIP / 1024} KB gzip`, () => {
    const { files } = entryClosure();
    const gz = files.reduce((n, f) => n + gzipSync(readFileSync(resolve(DIST, "assets", f)), { level: 9 }).length, 0);
    expect(gz, `${files.join(" + ")} is ${gz} B gzip`).toBeLessThanOrEqual(ENTRY_BUDGET_GZIP);
  });

  it("carries none of the job board's strings, which arrive with the board's code", () => {
    const sig = signatureOf("jobsPage");
    const { files } = entryClosure();
    for (const f of files) expect(readFileSync(resolve(DIST, "assets", f), "utf8").includes(sig), `${f} carries "${sig}"`).toBe(false);
    const holders = readdirSync(resolve(DIST, "assets")).filter((f) => f.endsWith(".js") && readFileSync(resolve(DIST, "assets", f), "utf8").includes(sig));
    expect(holders.length, "some chunk carries the board's strings").toBeGreaterThan(0);
  });

  it("ships the namespace chunks under names a static host serves (none starts with an underscore)", () => {
    const assets = readdirSync(resolve(DIST, "assets"));
    expect(assets.filter((f) => f.startsWith("_")), "files whose names start with an underscore").toEqual([]);
    expect(assets.some((f) => /^rb-en_ns_jobsPage-[\w-]+\.js$/.test(f)), "the board's strings have a chunk of their own").toBe(true);
    expect(assets.some((f) => /^rb-en_all-[\w-]+\.js$/.test(f)), "the safety net's whole-file chunk exists").toBe(true);
  });

  it("keeps the registry and the strings of what the entry itself renders (the help button, in App)", () => {
    const { files } = entryClosure();
    const code = files.map((f) => readFileSync(resolve(DIST, "assets", f), "utf8")).join("\n");
    // The registry's list of en.json namespaces (i18next's own code also names
    // parseMissingKeyHandler, so that word alone proves nothing).
    expect(code).toContain(JSON.stringify([...NAMES]).slice(1, -1));
    const help = Object.values(EN.floatingHelpButton as Record<string, string>).filter((s) => typeof s === "string");
    expect(help.length).toBeGreaterThan(0);
    for (const s of help) expect(code, `the entry carries "${s}"`).toContain(JSON.stringify(s).slice(1, -1));
  });
});

const METHODOLOGY = resolve(DIST, "methodology/index.html");
describe.skipIf(skipWithoutDist(existsSync(METHODOLOGY)))("the bake", () => {
  it("still reads a namespace the entry no longer carries, from the one en.json", () => {
    const html = readFileSync(METHODOLOGY, "utf8");
    const steps = (EN.methodologyPage as { steps?: Record<string, { title?: string }> }).steps ?? {};
    const titles = Object.values(steps).map((s) => s.title).filter((t): t is string => typeof t === "string" && t.length > 3);
    expect(titles.length).toBeGreaterThan(0);
    expect(titles.filter((t) => html.includes(t.replace(/&/g, "&amp;"))), "the baked /methodology prints the methodologyPage step titles").toEqual(titles);
  });
});

it("the namespace ids the build uses are its own (no clash with a real module path)", () => {
  for (const id of [EN_REGISTRY_ID, EN_ALL_ID, EN_NAMESPACE_ID]) expect(id.startsWith("\0rb-en:")).toBe(true);
});
