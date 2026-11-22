/**
 * A BACKUP REPORT SAYS IT HAS NO COMPARISON WITH THE POSTING (register
 * S14X-118).
 *
 * A reader who pasted a posting and got the backup scanner's report was told
 * the report was partial, but not that the one thing they asked for, a check
 * against that posting, was not done: the backup sends postingComparison
 * 'not_available' and the notice did not read it. The notice now adds a
 * sentence saying so, in the reader's language.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import { PartialResultsNotice } from "@/components/PartialResultsNotice";

const ROOT = resolve(__dirname, "../..");
const json = (p: string) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));
const LANGS = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"];
afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

describe("the partial-results notice", () => {
  it("on a backup report whose posting was not compared, says so in French", async () => {
    i18n.addResourceBundle("fr", "translation", json("src/i18n/locales/fr.json"), true, true);
    i18n.addResourceBundle("fr", "translation", json("src/i18n/shards/free-scan-page/fr.json"), true, true);
    await i18n.changeLanguage("fr");
    const { container } = render(<PartialResultsNotice reason="fallback" postingComparison="not_available" />);
    const text = container.textContent ?? "";
    expect(text).toContain(json("src/i18n/shards/free-scan-page/fr.json").freeScanPage.partial.noPostingComparison);
    expect(text).toContain(i18n.t("homepage.partialResults.fallback"));
  });

  it("says nothing of a posting when the scan compared one or none was given", async () => {
    await i18n.changeLanguage("en");
    const sentence = i18n.t("freeScanPage.partial.noPostingComparison");
    expect(render(<PartialResultsNotice reason="fallback" />).container.textContent).not.toContain(sentence);
    cleanup();
    expect(render(<PartialResultsNotice reason="thin" postingComparison="done" />).container.textContent).not.toContain(sentence);
  });

  it("the sentence is written in all nine languages", () => {
    for (const lng of LANGS) {
      const s = json(`src/i18n/shards/free-scan-page/${lng}.json`).freeScanPage.partial?.noPostingComparison;
      expect(typeof s === "string" && s.trim().length > 0, lng).toBe(true);
    }
  });

  it("the backup scanner is the one that sends 'not_available'", () => {
    const fork = readFileSync(resolve(ROOT, "supabase/functions/free-keyword-scan-stream/index.ts"), "utf8");
    expect(fork).toMatch(/postingComparison:\s*truncatedJobDescription\s*\?\s*'not_available'/);
  });
});
