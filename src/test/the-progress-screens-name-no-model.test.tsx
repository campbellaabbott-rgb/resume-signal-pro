/**
 * THE PROGRESS SCREENS NAME NO MODEL (CW2-AI7, cost wave 2's AI-7).
 *
 * What was wrong: the free scan's progress card said it was "Using Gemini Pro
 * for maximum accuracy" while the scanner ran a Flash model, and the paid
 * products' generation overlay said "GPT-5 is Working", "GPT-5 is reading
 * your experience and skills" and "Using GPT-5 for maximum quality", in
 * English literals the component typed itself (its keys sat unused in nine
 * locales that said the same). Which model answers changes on the AI
 * gateway's schedule, not ours, so a model's name in copy goes false without
 * a line of ours changing.
 *
 * Now no string in any language names a model, and the overlay reads its
 * words from the locale files, so it also speaks the reader's language.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import { AIGenerationProgress } from "@/components/AIGenerationProgress";
import { ScanProgressStages } from "@/components/ScanProgressStages";
import { LOCALE_FILES, readLocale, readMainLocale, stringLeaves } from "./helpers/locale-strings";
import { bothReadings } from "./helpers/visible-text";
import { codeOf } from "./helpers/strip-comments";

/** A model by name: the Gemini family, or GPT with a version number (ChatGPT, the app, is a host, not a model). */
const MODEL = /\bgemini\b|\bgpt-?\d/i;
const PROGRESS_ROOTS = ["scanProgress", "aiGenerationProgress", "streamingContent"];
const ROOT = resolve(__dirname, "../..");
const de = readMainLocale("de.json");

afterEach(async () => {
  cleanup();
  await act(async () => { await i18n.changeLanguage("en"); });
});

async function german() {
  i18n.addResourceBundle("de", "translation", de, true, true);
  await act(async () => { await i18n.changeLanguage("de"); });
}

describe("the progress screens and the model behind them", () => {
  it("the nine languages hold all three progress namespaces, so the scan below reads something", () => {
    expect(LOCALE_FILES).toHaveLength(9);
    for (const file of LOCALE_FILES) {
      const bundle = readLocale(file) as Record<string, unknown>;
      for (const root of PROGRESS_ROOTS) expect(stringLeaves(bundle[root]).length, `${file} ${root}`).toBeGreaterThan(0);
    }
  });

  it("no progress string, in any language, names a model", () => {
    const named: string[] = [];
    for (const file of LOCALE_FILES) {
      const bundle = readLocale(file) as Record<string, unknown>;
      for (const root of PROGRESS_ROOTS) {
        for (const [key, value] of stringLeaves(bundle[root], root)) if (MODEL.test(value)) named.push(`${file} ${key}: ${value}`);
      }
    }
    expect(named).toEqual([]);
  });

  it("no string the site serves, in any language and any shard, names a model", () => {
    const named: string[] = [];
    for (const file of LOCALE_FILES) {
      for (const [key, value] of stringLeaves(readLocale(file))) if (MODEL.test(value)) named.push(`${file} ${key}: ${value}`);
    }
    expect(named).toEqual([]);
  });

  it("neither progress component types a model's name into its own source", () => {
    for (const rel of ["src/components/AIGenerationProgress.tsx", "src/components/ScanProgressStages.tsx"]) {
      const code = codeOf(readFileSync(resolve(ROOT, rel), "utf8"));
      expect(code.match(MODEL)?.[0] ?? null, rel).toBeNull();
    }
  });

  it("the generation overlay shows the locale's words, in English and in German, and no model", async () => {
    const en = readMainLocale("en.json") as { aiGenerationProgress: Record<string, string | Record<string, string>> };
    const { container } = render(<AIGenerationProgress isVisible productName="Full Analysis" />);
    for (const reading of bothReadings(container)) expect(reading.match(MODEL)?.[0] ?? null).toBeNull();
    expect(container.textContent).toContain(en.aiGenerationProgress.title as string);
    expect(container.textContent).toContain((en.aiGenerationProgress.steps as Record<string, string>).analyzingDesc);
    cleanup();

    await german();
    const g = de as { aiGenerationProgress: { title: string; quality: string; secure: string; generating: string; steps: Record<string, string> } };
    const view = render(<AIGenerationProgress isVisible productName="Full Analysis" />).container;
    for (const reading of bothReadings(view)) expect(reading.match(MODEL)?.[0] ?? null).toBeNull();
    for (const s of [g.aiGenerationProgress.title, g.aiGenerationProgress.steps.analyzingTitle, g.aiGenerationProgress.steps.analyzingDesc, g.aiGenerationProgress.quality, g.aiGenerationProgress.secure]) {
      expect(view.textContent).toContain(s);
    }
    expect(view.textContent).toContain(g.aiGenerationProgress.generating.replace("{{productName}}", "Full Analysis"));
  });

  it("the free scan's progress card names no model, in English and in German", async () => {
    const en = readMainLocale("en.json") as { scanProgress: { subtitle: string } };
    const { container } = render(<ScanProgressStages />);
    expect(container.textContent).toContain(en.scanProgress.subtitle);
    for (const reading of bothReadings(container)) expect(reading.match(MODEL)?.[0] ?? null).toBeNull();
    cleanup();

    await german();
    const view = render(<ScanProgressStages />).container;
    expect(view.textContent).toContain((de as { scanProgress: { subtitle: string } }).scanProgress.subtitle);
    for (const reading of bothReadings(view)) expect(reading.match(MODEL)?.[0] ?? null).toBeNull();
  });
});
