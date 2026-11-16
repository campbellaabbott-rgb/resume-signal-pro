// @vitest-environment node
/**
 * EVERY ACCOUNT STRING EXISTS IN NINE LANGUAGES (S14X-254).
 *
 * WHAT WAS WRONG. The account page, the interviews card, the prepared
 * applications, the apply profile and the agent page asked t() for 28 keys
 * that no locale held (the follow-up draft, "Posting still open", the
 * interview outcome question, the "since your interview" lines, the agent
 * page's title...), so every language read the English default. The
 * follow-up draft a person mails to an employer was English with an English
 * " on <date>" spliced in.
 *
 * WHAT HOLDS NOW: every literal key those files ask for resolves, in each of
 * the nine bundles the app serves (the main locale with every shard merged,
 * as src/i18n/index.ts merges them). The new strings live in the account
 * shard (src/i18n/shards/account, root accountView), translated, and the
 * follow-up draft takes its date phrase from the same shard.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { LOCALE_FILES, readLocale, readMainLocale, readShards } from "./helpers/locale-strings";
import { shardProblems } from "../i18n/merge-shards";

const root = resolve(__dirname, "../..");
const FILES = [
  "src/pages/Account.tsx",
  "src/pages/Agent.tsx",
  "src/components/account/InterviewsHub.tsx",
  "src/components/account/ApplyQueuePanel.tsx",
  "src/components/account/ApplyProfilePanel.tsx",
  "src/components/account/OrdersList.tsx",
  "src/components/account/CreditsAndPurchases.tsx",
  "src/components/account/DataPrivacyCard.tsx",
  "src/components/account/LocalHistoryOffer.tsx",
  "src/components/account/GapReport.tsx",
];

/** The literal keys a file asks t() for. A key built at run time is not a literal and is not read here. */
const keysOf = (file: string) =>
  [...new Set([...codeOf(readFileSync(resolve(root, file), "utf8")).matchAll(/\bt\(\s*["']([A-Za-z0-9_.-]+)["']/g)].map((m) => m[1]))];

const resolves = (bundle: Record<string, unknown>, key: string) => {
  const at = (k: string) => k.split(".").reduce<unknown>((o, p) => (o && typeof o === "object" ? (o as Record<string, unknown>)[p] : undefined), bundle);
  return [key, `${key}_one`, `${key}_other`].some((k) => typeof at(k) === "string");
};

describe("the account's strings, in every language the app serves", () => {
  it("there are nine bundles", () => {
    expect(LOCALE_FILES).toHaveLength(9);
  });

  it.each(FILES)("%s asks only for keys every language holds", (file) => {
    const keys = keysOf(file);
    expect(keys.length).toBeGreaterThan(0);
    const missing: string[] = [];
    for (const lf of LOCALE_FILES) {
      const bundle = readLocale(lf);
      for (const k of keys) if (!resolves(bundle, k)) missing.push(`${lf}: ${k}`);
    }
    expect(missing).toEqual([]);
  });

  it("the account shard writes only under its root and redefines nothing main holds", () => {
    for (const lf of LOCALE_FILES) {
      const account = readShards(lf).filter((s) => s.name === "account");
      expect(account, lf).toHaveLength(1);
      expect(shardProblems(readMainLocale(lf), account), lf).toEqual([]);
    }
  });

  it("the follow-up draft takes its date phrase from the shard, not an English splice", () => {
    const code = codeOf(readFileSync(resolve(root, "src/pages/Account.tsx"), "utf8"));
    expect(code).toMatch(/t\("accountView\.followUpWhen"/);
    expect(code).not.toMatch(/` on \$\{/);
    for (const lf of LOCALE_FILES.filter((f) => !f.startsWith("en"))) {
      const v = (readLocale(lf).accountView as Record<string, string>);
      expect(v.followUpWhen, lf).toContain("{{date}}");
      expect(v.followUpWhen, lf).not.toBe(" on {{date}}");
      expect(v.followUpDraft, lf).toContain("{{when}}");
    }
  });
});
