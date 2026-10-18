/**
 * ONE TRANSLATION KEY, ONE ENGLISH SENTENCE (wave 4 round 2 integration).
 *
 * A component writes t("ns.key", "English default"). The locale files hold one
 * value per key, and that value beats every inline default. So a key written
 * with two different defaults can only ever be one of them: once the locale
 * pass gives it a value, the other call site shows the wrong sentence in every
 * language, and before that pass the two sites already disagree.
 *
 * Round 2 put the account home through the translator (S12-137), and one key,
 * accountPage.matchingPinned, was written for two sentences: the toast after a
 * pin ("Pinned: the board and your alerts now match against this résumé.")
 * and the status line naming the pinned scan ("Pinned: {{name}} · {{date}}").
 * Given one value, the status line would have lost the scan's name and date,
 * or the toast would have printed "Pinned:  · ". The status line now has its
 * own key.
 *
 * The property: across src (tests and the locale files aside), every key that
 * is called with a literal English default is called with the same one
 * everywhere. A key called with a computed default (a plural chosen in code)
 * is not counted.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const SRC = resolve(__dirname, "..");

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "test" || name === "i18n") continue;
      files(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

/** A string literal starting at s[i] (a quote), or null for a template with an expression. */
function literal(s: string, i: number): { value: string; end: number } | null {
  const q = s[i];
  let out = "";
  for (let j = i + 1; j < s.length; j++) {
    const c = s[j];
    if (c === "\\") { out += s[j + 1]; j++; continue; }
    if (q === "`" && c === "$" && s[j + 1] === "{") return null;
    if (c === q) return { value: out, end: j + 1 };
    out += c;
  }
  return null;
}

function defaultsByKey(): Map<string, Map<string, string[]>> {
  const byKey = new Map<string, Map<string, string[]>>();
  const call = /(?<![A-Za-z0-9_$.])(?:i18n\.)?t\(\s*(['"`])/g;
  for (const file of files(SRC)) {
    const s = readFileSync(file, "utf8");
    for (const m of s.matchAll(call)) {
      const key = literal(s, m.index! + m[0].length - 1);
      if (!key || !/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+$/.test(key.value)) continue;
      let i = key.end;
      while (/\s/.test(s[i] ?? "")) i++;
      if (s[i] !== ",") continue;
      i++;
      while (/\s/.test(s[i] ?? "")) i++;
      if (!["'", '"', "`"].includes(s[i] ?? "")) continue;
      const def = literal(s, i);
      if (!def) continue;
      const seen = byKey.get(key.value) ?? new Map<string, string[]>();
      seen.set(def.value, [...(seen.get(def.value) ?? []), file.slice(SRC.length + 1)]);
      byKey.set(key.value, seen);
    }
  }
  return byKey;
}

describe("a translation key carries one English sentence", () => {
  const byKey = defaultsByKey();

  it("reads the components it judges", () => {
    // The account home alone has well over a hundred defaulted keys; a scan
    // that found almost nothing is a scan that could not look.
    expect(byKey.size).toBeGreaterThan(1000);
    expect(byKey.get("accountPage.matchingPinnedGone")?.size).toBe(1);
  });

  it("no key is written with two different defaults", () => {
    const split = [...byKey.entries()]
      .filter(([, defs]) => defs.size > 1)
      .map(([key, defs]) => `${key}: ${[...defs.entries()].map(([d, where]) => `"${d}" (${[...new Set(where)].join(", ")})`).join(" vs ")}`);
    expect(split, split.join("\n")).toEqual([]);
  });

  it("the pinned-scan status line and the pin toast are two keys", () => {
    expect([...(byKey.get("accountPage.matchingPinned")?.keys() ?? [])]).toEqual(["Pinned: the board and your alerts now match against this résumé."]);
    expect([...(byKey.get("accountPage.matchingPinnedScan")?.keys() ?? [])]).toEqual(["Pinned: {{name}} · {{date}}"]);
  });
});
