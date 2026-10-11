/**
 * A BACKUP REPORT THAT HID ITS EMPTY SECTIONS SAYS BOTH (wave-3 fix round
 * integration, where S11-147 met S11-150).
 *
 * Two groups fixed the same banner from two sides. S11-147: the streaming
 * fork marks a thin reply it did not fill as partialReason "thin_unfilled",
 * and the banner says the empty sections are hidden. S11-150: every report
 * the fork writes during an outage is marked partialReason "fallback", and
 * the banner says the simpler backup wrote it. The homepage reaches the fork
 * only through asFallbackReport, which overwrote the fork's own reason, so
 * after the merge a thin backup report hid sections and never said so. Now
 * the wrapper keeps that fact (partialHidden), the page carries it to the
 * banner, and the banner says both sentences, in all nine locales.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "@testing-library/react";
import { codeOf } from "./helpers/strip-comments";
import { asFallbackReport } from "@/lib/scan-fallback";
import { PartialResultsNotice } from "@/components/PartialResultsNotice";

const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"];
const locale = (l: string) => JSON.parse(readFileSync(resolve(__dirname, "../i18n/locales", `${l}.json`), "utf8"));

describe("the backup's thin reply keeps its hidden sections through the wrapper", () => {
  it("a thin_unfilled report from the fork is a fallback report that hid sections", () => {
    const r = asFallbackReport({ atsScoreEstimate: 55, partialResults: true, partialReason: "thin_unfilled" });
    expect(r).toMatchObject({ atsScoreEstimate: 55, partialResults: true, partialReason: "fallback", partialHidden: true });
  });

  it("a whole report from the fork hid nothing", () => {
    const r = asFallbackReport({ atsScoreEstimate: 61, partialResults: false as boolean });
    expect(r.partialReason).toBe("fallback");
    expect((r as { partialHidden?: boolean }).partialHidden).toBeUndefined();
  });

  it("a thin report the fork did fill (reason thin) hid nothing", () => {
    const r = asFallbackReport({ atsScoreEstimate: 48, partialResults: true, partialReason: "thin" });
    expect((r as { partialHidden?: boolean }).partialHidden).toBeUndefined();
  });
});

describe("the banner says both facts, and only when both are true", () => {
  it("fallback with hidden sections: the backup wrote it AND its empty sections are hidden", () => {
    const { container } = render(<PartialResultsNotice reason="fallback" hidden />);
    expect(container.textContent).toMatch(/simpler backup wrote this report/);
    expect(container.textContent).toMatch(/Sections the backup left empty are hidden\./);
    expect(container.textContent).not.toMatch(/filled them in/);
  });

  it("fallback alone says nothing about hidden sections", () => {
    const { container } = render(<PartialResultsNotice reason="fallback" />);
    expect(container.textContent).toMatch(/simpler backup wrote this report/);
    expect(container.textContent).not.toMatch(/hidden/);
  });

  it("the fork's own thin_unfilled reason still reads as hidden sections", () => {
    const { container } = render(<PartialResultsNotice reason="thin_unfilled" />);
    expect(container.textContent).toMatch(/hidden/);
    expect(container.textContent).not.toMatch(/backup/);
  });
});

describe("the page carries the fact from the wrapper to the banner", () => {
  const page = codeOf(readFileSync(resolve(__dirname, "../pages/Index.tsx"), "utf8"));
  it("maps partialHidden onto the report and hands it to the banner", () => {
    expect(page).toMatch(/partialHidden: \(result as any\)\.partialHidden,/);
    expect(page).toMatch(/<PartialResultsNotice reason=\{freeKeywordResult\.partialReason\} hidden=\{freeKeywordResult\.partialHidden\} \/>/);
  });
});

describe("the hidden-sections sentence exists in all nine locales", () => {
  for (const l of LOCALES) {
    it(`${l}: homepage.partialResults.fallbackHidden is a sentence of its own`, () => {
      const v = locale(l).homepage.partialResults.fallbackHidden;
      expect(typeof v).toBe("string");
      expect((v as string).trim().length).toBeGreaterThan(15);
      expect(v).not.toBe(locale(l).homepage.partialResults.thinUnfilled);
    });
  }
});
