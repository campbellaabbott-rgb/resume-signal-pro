/**
 * The company shard (src/i18n/shards/company/<lng>.json) merged into the
 * test's i18n instance.
 *
 * The design system group's loader merges every shard at init; until that
 * loader is on this branch, a test that renders the company page in a
 * language other than English, or that asserts the shard's own wording,
 * merges it here first. Merging twice is harmless (deep, overwrite), so this
 * stays correct after the loader lands.
 */
import i18n from "i18next";

const SHARDS = import.meta.glob<{ default: Record<string, unknown> }>("../../i18n/shards/company/*.json", { eager: true });

export const COMPANY_SHARD_LOCALES = Object.keys(SHARDS)
  .map((p) => p.replace(/^.*\/([^/]+)\.json$/, "$1"))
  .sort();

export function companyShard(lng: string): Record<string, unknown> {
  const hit = Object.entries(SHARDS).find(([p]) => p.endsWith(`/${lng}.json`));
  if (!hit) throw new Error(`no company shard for ${lng}`);
  return hit[1].default;
}

/** Merge the shard for these languages (all nine by default) into the translation namespace. */
export function loadCompanyShard(langs: string[] = COMPANY_SHARD_LOCALES): void {
  for (const l of langs) i18n.addResourceBundle(l, "translation", companyShard(l), true, true);
}
