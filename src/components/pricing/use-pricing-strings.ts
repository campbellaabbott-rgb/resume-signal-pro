/**
 * THE PRICING STRINGS, UNTIL THEY ARE A REGISTERED SHARD.
 *
 * The pricing page's strings are written as a string shard: one file per
 * language, every key under the one root "pricingPlans", the same key set in
 * all nine languages (src/i18n/merge-shards.ts rules). They live in
 * ./strings/<lng>.json for now, not in src/i18n/shards/pricing/, because a
 * shard directory there must also be registered in SHARD_ROOT_KEYS
 * (merge-shards.ts, an existing file this round may not edit), and the shard
 * guard fails every unregistered directory. At switch-over the folder moves to
 * src/i18n/shards/pricing/, SHARD_ROOT_KEYS gains `pricing: "pricingPlans"`,
 * and this file is deleted (docs/homepage-pricing/README.md, "Switch-over").
 * Components call t("pricingPlans.…") either way.
 *
 * English is merged when this module loads, deep and never overwriting, so the
 * first render of the page already has it. Another language is merged only
 * AFTER that language's main locale has landed: src/i18n/index.ts skips
 * loading a language that already holds a bundle, so merging ours first would
 * leave the reader with only this page's strings.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import en from "./strings/en.json";

export const PRICING_ROOT = "pricingPlans";

type Bundle = Record<string, unknown>;

const lazyBundles = import.meta.glob(["./strings/*.json", "!./strings/en.json"], { import: "default" }) as Record<
  string,
  () => Promise<Bundle>
>;

const merged = new Set<string>();

function merge(lng: string, bundle: Bundle): void {
  i18n.addResourceBundle(lng, "translation", bundle, true, false);
  merged.add(lng);
}

merge("en", en as Bundle);

/** The strings file a language reads (fr-CA reads fr). */
function fileFor(lng: string): string {
  return lng === "fr-CA" ? "fr" : lng;
}

/**
 * How long to wait for the main locale before merging anyway. A main locale
 * that failed to load would otherwise leave the page blank for good; after
 * this the reader gets this page's strings over the English fallback.
 */
export const MAIN_WAIT_MS = 6000;

function mainLocaleLanded(lng: string, waitMs: number): Promise<void> {
  if (i18n.hasResourceBundle(lng, "translation")) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      i18n.store.off("added", onAdded);
      clearTimeout(timer);
      resolve();
    };
    const onAdded = (l: string, ns: string) => {
      if (l === lng && ns === "translation") finish();
    };
    const timer = setTimeout(finish, waitMs);
    i18n.store.on("added", onAdded);
  });
}

/** Merge one language's pricing strings. Safe to call repeatedly; never throws. */
export async function loadPricingStrings(lng: string, waitMs: number = MAIN_WAIT_MS): Promise<void> {
  if (!lng || merged.has(lng)) return;
  const want = fileFor(lng);
  const entry = Object.entries(lazyBundles).find(([p]) => p.endsWith(`/${want}.json`));
  if (!entry) return;
  try {
    const bundle = await entry[1]();
    await mainLocaleLanded(lng, waitMs);
    if (!merged.has(lng)) merge(lng, bundle);
  } catch {
    /* the page reads English, the fallback language */
  }
}

export function pricingStringsMerged(lng: string): boolean {
  return merged.has(lng) || !Object.keys(lazyBundles).some((p) => p.endsWith(`/${fileFor(lng)}.json`));
}

/** True once the reader's language has its pricing strings. */
export function usePricingStrings(): boolean {
  const { i18n: inst } = useTranslation();
  const lng = inst.language || "en";
  const [readyFor, setReadyFor] = useState<string | null>(() => (pricingStringsMerged(lng) ? lng : null));
  useEffect(() => {
    let alive = true;
    if (pricingStringsMerged(lng)) {
      setReadyFor(lng);
      return;
    }
    void loadPricingStrings(lng).then(() => {
      if (alive) setReadyFor(lng);
    });
    return () => {
      alive = false;
    };
  }, [lng]);
  return readyFor === lng;
}
