/**
 * THE DIAGNOSTIC HEADER NAMES THE INDUSTRY IN WORDS (RC-OI-29).
 *
 * The specimen block at the top of the free report printed the industry as
 * its id with the underscores turned to spaces and CSS capitalisation on
 * top: "Hr (high confidence)", "Data engineering", and the English words
 * "high confidence", "Report", "Subject" and "industry estimates" whatever
 * the reader's language. It now shows the industry by the label the
 * report's select uses, and every word of the block in the reader's
 * language.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import { DiagnosticHeader } from "@/components/ReportInsightCards";

const ROOT = resolve(__dirname, "../..");
const json = (p: string) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));
async function speak(lng: string) {
  i18n.addResourceBundle(lng, "translation", json(`src/i18n/locales/${lng}.json`), true, true);
  const shard = `src/i18n/shards/free-scan-page/${lng}.json`;
  if (existsSync(resolve(ROOT, shard))) i18n.addResourceBundle(lng, "translation", json(shard), true, true);
  await i18n.changeLanguage(lng);
}
afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

const META = { reportId: "A1B2C3", engineVersion: "v9", generatedAt: "2026-11-10T12:00:00Z", industry: "hr", industryConfidence: "high", benchmarkSource: "estimated" };
const header = (meta = META) => {
  const { container } = render(<DiagnosticHeader meta={meta} />);
  const rows = [...container.querySelectorAll("dl > div")].map((d) => [d.querySelector("dt")?.textContent ?? "", d.querySelector("dd")?.textContent ?? ""]);
  return { text: container.textContent ?? "", rows, dd: [...container.querySelectorAll("dd")] };
};

describe("in English", () => {
  it("an hr résumé reads HR, never the id", async () => {
    await speak("en");
    const { rows } = header();
    const industry = rows.find(([k]) => /industry/i.test(k))?.[1] ?? "";
    expect(industry.startsWith("HR"), `industry row reads "${industry}"`).toBe(true);
  });
  it("a two-word id reads as its label, with no CSS capitalising the value", async () => {
    await speak("en");
    const { rows, dd } = header({ ...META, industry: "data_engineering" });
    const industry = rows.find(([k]) => /industry/i.test(k))?.[1] ?? "";
    expect(industry).not.toContain("data engineering");
    expect(industry).not.toContain("_");
    for (const el of dd) expect(el.className).not.toMatch(/\bcapitalize\b/);
  });
});

describe("in Spanish", () => {
  it("says the confidence, the labels and the benchmark source in Spanish", async () => {
    await speak("es");
    const { text } = header();
    expect(text).not.toMatch(/\bhigh\b|confidence|Subject|industry estimates|Resume Diagnostic Report/);
    expect(text).toContain(i18n.t("freeScanPage.confidence.high"));
    expect(text).toContain(i18n.t("freeScanPage.diagnostic.industry"));
    expect(text).not.toContain("freeScanPage.");
  });
});
