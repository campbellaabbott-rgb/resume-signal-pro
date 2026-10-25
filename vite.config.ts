import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { componentTagger } from "lovable-tagger";

// After every production build, render the ~260 data-driven SEO routes to
// static HTML in dist/ (crawlers that don't run JS — Bing, DuckDuckGo, AI
// crawlers — otherwise see empty pages). Lives in the vite config, not an npm
// postbuild hook, so it runs no matter how the build is invoked (Lovable's
// pipeline included). The script never throws: a prerender failure logs and
// ships SPA-only pages rather than blocking a publish.
const prerenderSeo = (): Plugin => ({
  name: "prerender-seo",
  apply: "build",
  closeBundle() {
    execSync("node scripts/prerender-seo.mjs", { stdio: "inherit" });
    // The bake is gated on being run as a script; a gate that did not open
    // exits 0 with an SPA-only dist and every prerendered page gone. That is
    // not blocked here (the never-block policy above stands) but it is never
    // silent: a known prerendered page must exist when the bake ran.
    if (!existsSync(path.resolve(__dirname, "dist/pricing/index.html"))) {
      console.error("[prerender-seo] POST-CONDITION FAILED: dist/pricing/index.html was not written — the bake did not run; this dist is SPA-only");
    }
  },
});

// ---- The English strings travel with the code that reads them (SEO-040) ----
//
// The entry chunk carried the whole English locale, every page's strings, to
// every page: 302 KB of the entry's 945 KB, about 96 KB of its 293 KB gzip
// (build of 2026-10-18). The other eight languages already load as a whole
// file on demand; English is the fallback and the default, so it rode the
// entry.
//
// The file is not split. src/i18n/locales/en.json stays one file, the file
// the bake reads at build time (the crawler copy lives there, see the
// prerender-reads-main-locale rule), and the file every test reads. What
// changes is how the BUILT app receives it: each top-level key of en.json
// becomes its own small module, and every source module that names a key
// under that namespace (a quoted string starting "<namespace>." or equal to
// "<namespace>", which covers t("jobsPage.x"), t(`jobsPage.x.${y}`), keyPrefix
// and key tables) imports that namespace's module first. Rollup then places
// each namespace beside the code that reads it: the entry keeps what the
// entry's own modules name, and a page's strings arrive with the page's chunk,
// registered before any of its modules run, so nothing renders a bare key.
//
// Before i18next initialises (modules the entry evaluates ahead of
// src/i18n/index.ts), a namespace is collected in the registry, which
// src/i18n/index.ts reads as its English bundle. After, it is merged straight
// into the live store. Development and tests import the whole file as before.
//
// A key no module names in a string (one built wholly from runtime data) is
// the one thing this cannot see coming. For that, the registry sets i18next's
// parseMissingKeyHandler before init (init keeps options set on the instance):
// a missing key whose namespace is an en.json namespace this page has not
// loaded fetches the whole English file once, in its own chunk, and re-renders
// (the languageChanged event, as loadChangelogStrings does). Until then the
// call shows what it showed before, its default or its key. A key that is
// missing from a loaded namespace, or that belongs to the auth strings or a
// shard, loads nothing.
const EN_LOCALE_FILE = path.resolve(__dirname, "src/i18n/locales/en.json");
const SRC_DIR = path.resolve(__dirname, "src") + path.sep;
export const EN_REGISTRY_ID = "\0rb-en:registry";
export const EN_CORE_ID = "\0rb-en:core";
export const EN_ALL_ID = "\0rb-en:all";
export const EN_NAMESPACE_ID = "\0rb-en:ns:";
/** Above this size a namespace ships as JSON.parse of a string, which V8 parses faster than an object literal. */
const JSON_PARSE_ABOVE = 10 * 1024;

/** The namespaces of `names` that `code` names in a quoted string: "ns.…", 'ns.…', `ns.…` or exactly "ns". */
export function namespacesNamedIn(code: string, names: ReadonlySet<string>): string[] {
  const found = new Set<string>();
  for (const m of code.matchAll(/(["'`])([A-Za-z_$][\w$-]*)(?=\.|\1)/g)) {
    if (names.has(m[2])) found.add(m[2]);
  }
  return [...found].sort();
}

/** The module source that registers a part of the English strings (one namespace, or all of them). */
export function namespaceModule(part: Record<string, unknown>): string {
  const json = JSON.stringify(part);
  const data = json.length > JSON_PARSE_ABOVE ? `JSON.parse(${JSON.stringify(json)})` : json;
  return `import { addEnglish } from ${JSON.stringify(EN_REGISTRY_ID)};\naddEnglish(${data});\n`;
}

/** The registry module: collects namespaces, feeds the live store, and loads every namespace on a miss it did not foresee. */
export function registryModule(names: readonly string[]): string {
  return [
    `import i18n from "i18next";`,
    `export const EN = {};`,
    `export function addEnglish(part) {`,
    `  Object.assign(EN, part);`,
    `  if (i18n.store) i18n.addResourceBundle("en", "translation", part, true, true);`,
    `}`,
    `const NAMES = new Set(${JSON.stringify([...names])});`,
    `let everything = null;`,
    `const loadEverything = () => {`,
    `  everything = everything || import(${JSON.stringify(EN_ALL_ID)}).then(() => i18n.emit("languageChanged", i18n.language), () => {});`,
    `};`,
    `const previous = i18n.options.parseMissingKeyHandler;`,
    `i18n.options.parseMissingKeyHandler = (key, defaultValue, options) => {`,
    `  const ns = String(key).split(".")[0];`,
    `  if (NAMES.has(ns) && !EN[ns]) loadEverything();`,
    `  if (typeof previous === "function") return previous(key, defaultValue, options);`,
    `  return defaultValue === undefined ? key : defaultValue;`,
    `};`,
  ].join("\n");
}

export const enNamespaces = (localeFile = EN_LOCALE_FILE, srcDir = SRC_DIR): Plugin => {
  let en: Record<string, unknown> = {};
  let names = new Set<string>();
  return {
    name: "rb-en-namespaces",
    apply: "build",
    // Ahead of vite's own resolver, which would otherwise resolve the file first.
    enforce: "pre",
    buildStart() {
      en = JSON.parse(readFileSync(localeFile, "utf8"));
      names = new Set(Object.keys(en));
      this.addWatchFile(localeFile);
    },
    resolveId(source, importer) {
      if (source === EN_REGISTRY_ID || source === EN_CORE_ID || source === EN_ALL_ID || source.startsWith(EN_NAMESPACE_ID)) return source;
      // Only the app's i18n module receives the registry in place of the file.
      if (importer && /\.json$/.test(source) && path.resolve(path.dirname(importer), source) === localeFile && /[\\/]src[\\/]i18n[\\/]index\.ts$/.test(importer)) {
        return EN_CORE_ID;
      }
      return null;
    },
    load(id) {
      if (id === EN_REGISTRY_ID) return registryModule([...names]);
      if (id === EN_CORE_ID) return `import { EN } from ${JSON.stringify(EN_REGISTRY_ID)};\nexport default EN;\n`;
      if (id === EN_ALL_ID) return namespaceModule(en);
      if (id.startsWith(EN_NAMESPACE_ID)) {
        const ns = id.slice(EN_NAMESPACE_ID.length);
        if (!names.has(ns)) this.error(`en.json has no namespace "${ns}"`);
        return namespaceModule({ [ns]: en[ns] });
      }
      return null;
    },
    transform(code, id) {
      if (!id.startsWith(srcDir) || !/\.[cm]?[jt]sx?$/.test(id)) return null;
      const used = namespacesNamedIn(code, names);
      if (used.length === 0) return null;
      const imports = used.map((ns) => `import ${JSON.stringify(EN_NAMESPACE_ID + ns)};`).join("");
      return { code: imports + code, map: null };
    },
  };
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    // PORT lets the preview harness assign a free port (multiple sessions run
    // dev servers against this repo); default stays 8080 for humans.
    port: Number(process.env.PORT) || 8080,
  },
  plugins: [react(), mode === "development" && componentTagger(), enNamespaces(), prerenderSeo()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Vite's own pattern, except that a chunk named after a virtual module
        // (the namespace chunks above, whose ids start with a NUL that Rollup
        // turns into "_") does not ship as a file whose name starts with an
        // underscore: some static hosts treat those as private and do not
        // serve them, and a page whose strings 404 cannot load.
        chunkFileNames: (chunk) => `assets/${chunk.name.replace(/^_+/, "")}-[hash].js`,
      },
    },
  },
}));
