/**
 * THE HOMEPAGE'S STRINGS, UNTIL THEY MOVE INTO THE SHARD DIRECTORY.
 *
 * The homepage writes only under the top-level key "home". The design system's
 * shard loader (src/i18n/merge-shards.ts) picks up any src/i18n/shards/<dir>/,
 * but its guard fails on a directory whose root key is not registered in
 * SHARD_ROOT_KEYS, and this round may not edit that file. So the nine files
 * live beside this loader and are merged the way the loader merges a shard:
 * deep, and UNDER the main bundle (main's text wins on any collision), with
 * English in the chunk that renders the page and every other language loaded
 * with the page. docs/homepage-pricing/README.md has the switch-over: the
 * files move to src/i18n/shards/home/, "home" joins SHARD_ROOT_KEYS, and this
 * module's two calls go.
 */
import { useEffect, useState } from "react";
import i18n from "i18next";
import { useTranslation } from "react-i18next";
import en from "./strings/en.json";

type Bundle = Record<string, unknown>;

const LAZY = import.meta.glob(["./strings/*.json", "!./strings/en.json"], { import: "default" }) as Record<string, () => Promise<Bundle>>;

const loaded = new Set<string>();

function add(lng: string, bundle: Bundle): void {
  // deep = true, overwrite = false: a key main already defines keeps main's text.
  i18n.addResourceBundle(lng, "translation", bundle, true, false);
  loaded.add(lng);
}

/** English is merged as soon as this module loads, so the first render reads it. */
export function ensureEnglishHomeStrings(): void {
  if (loaded.has("en")) return;
  if (i18n.isInitialized) add("en", en as Bundle);
  else i18n.on("initialized", () => { if (!loaded.has("en")) add("en", en as Bundle); });
}
ensureEnglishHomeStrings();

/** The file a language reads: fr-CA reads fr, en-GB its own, an unknown code nothing. */
export function homeStringsFile(lng: string): string | null {
  const want = lng === "fr-CA" ? "fr" : lng;
  const path = `./strings/${want}.json`;
  return LAZY[path] ? path : null;
}

/**
 * The main locale's own loader (src/i18n/index.ts loadLocale) skips a language
 * that already has a bundle, so a homepage file added first would stop the
 * main file from ever loading. Wait for the main bundle (or give up waiting
 * after MAIN_WAIT_MS, when it has failed), then add.
 */
export const MAIN_WAIT_MS = 6000;
function mainBundleReady(lng: string): Promise<void> {
  if (i18n.hasResourceBundle(lng, "translation")) return Promise.resolve();
  return new Promise((resolve) => {
    const store = i18n.store as unknown as { on?: (e: string, fn: (l: string) => void) => void; off?: (e: string, fn: (l: string) => void) => void } | undefined;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      store?.off?.("added", onAdded);
      clearTimeout(timer);
      resolve();
    };
    const onAdded = (l: string) => { if (l === lng) finish(); };
    const timer = setTimeout(finish, MAIN_WAIT_MS);
    store?.on?.("added", onAdded);
  });
}

/** Merge a language's homepage strings. Never throws; English stays as the fallback. */
export async function loadHomeStrings(lng: string | null | undefined): Promise<void> {
  const code = lng || "en";
  if (code === "en" || loaded.has(code)) return;
  const path = homeStringsFile(code);
  if (!path) return;
  try {
    const [bundle] = await Promise.all([LAZY[path](), mainBundleReady(code)]);
    add(code, bundle);
  } catch {
    /* English renders */
  }
}

/** Load the reader's language and re-render once it is in. */
export function useHomeStrings(): void {
  const { i18n: instance } = useTranslation();
  const lng = instance.language;
  const [, bump] = useState(0);
  useEffect(() => {
    let live = true;
    if (!lng || lng === "en" || loaded.has(lng)) return;
    void loadHomeStrings(lng).then(() => { if (live) bump((n) => n + 1); });
    return () => { live = false; };
  }, [lng]);
}
