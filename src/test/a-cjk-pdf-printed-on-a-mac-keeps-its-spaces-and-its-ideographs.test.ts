// @vitest-environment node
//
// Node, not jsdom: pdfjs-serverless mistakes jsdom for a browser, and the
// handler half bundles parse-pdf with esbuild, which refuses jsdom's
// TextEncoder (helpers/edge-harness.ts).
/**
 * A CJK PDF PRINTED ON A MAC KEEPS ITS SPACES AND ITS IDEOGRAPHS (S14X-123,
 * M-S14-096; S14X-146, M-S14-121).
 *
 * Chrome on macOS prints a Korean or Japanese word gap as a glyph pdf.js can
 * only name U+0001, each in a text item of its own. looksGarbled counts
 * control bytes, so every such résumé was refused as a broken font (422
 * garbled_text). A lone control item is now read as the space it stands for,
 * and inside an item a control between two letters is a space only when it is
 * the one control in a mostly Hangul, Kana or Han text: a broken font in Latin
 * text is still refused.
 *
 * The same printer names some Chinese glyphs by their CJK Radicals Supplement
 * form, which NFKC leaves alone, so 增长 read as 增⻓ and 部门 as 部⻔. Each
 * radical with a single unified equivalent is read as that ideograph.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { cjkControlsAsSpaces, pageTextFromItems, unifiedRadicals, type PdfTextItem } from "../../supabase/functions/parse-pdf/page-text";
import { looksGarbled } from "../../supabase/functions/_shared/text-validation";
import { pdfFixture, pdfText } from "./helpers/pdf-pages";
import { parserHarness, type ParserHarness } from "./helpers/parser-handlers";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

// eslint-disable-next-line no-control-regex -- the bytes under test
const CONTROL = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;

describe("the page reader", () => {
  it("reads a Korean PDF's word gaps as spaces", async () => {
    const text = await pdfText(pdfFixture("chrome-ko.pdf"));
    expect(text).not.toMatch(CONTROL);
    expect(text).toContain("minjun.kim@naver.com | 010-1234-5678 | 서울특별시 강남구");
    expect(text).toContain("경력 사항");
    expect(looksGarbled(text)).toBe(false);
  });

  it("reads a Japanese PDF's word gaps as spaces", async () => {
    const text = await pdfText(pdfFixture("chrome-ja2.pdf"));
    expect(text).not.toMatch(CONTROL);
    expect(text).toContain("佐藤 健太");
    expect(looksGarbled(text)).toBe(false);
  });

  it("reads a Chinese PDF's radical forms as ideographs", async () => {
    const text = await pdfText(pdfFixture("chrome-zh.pdf"));
    expect(text).toContain("增长");
    expect(text).toContain("部门");
    expect(text).not.toMatch(/[⺀-⻿]/);
  });

  it("maps the radicals with a single equivalent, and only those", () => {
    expect(unifiedRadicals("⻓⻔⺌⺍⺾⻀")).toBe("长门小小艹艹");
    // U+2E80 and U+2E9A have no single equivalent and stay as they are.
    expect(unifiedRadicals("⺀⺚")).toBe("⺀⺚");
    expect(unifiedRadicals("plain text 增长")).toBe("plain text 增长");
  });
});

describe("a control inside an item", () => {
  it("is a space in Korean text whose only control it is", () => {
    const { text, spaced } = cjkControlsAsSpaces("삼성전자\u0001선임\u0001연구원\u0001으로\u0001근무했습니다");
    expect(text).toBe("삼성전자 선임 연구원 으로 근무했습니다");
    expect(spaced).toBe(4);
  });

  it("is left for looksGarbled in Latin text, which still refuses it", () => {
    const latin = "Senior\u0001Product\u0001Manager\u0001with\u0001nine\u0001years\u0001in\u0001payments\u0001and\u0001fintech\u0001platforms";
    const text = pageTextFromItems([{ str: latin, transform: [1, 0, 0, 1, 50, 700], width: 300, height: 10 } as PdfTextItem]);
    expect(cjkControlsAsSpaces(text)).toEqual({ text, spaced: 0 });
    expect(looksGarbled(cjkControlsAsSpaces(text).text)).toBe(true);
  });

  it("is left alone when the controls are a mix", () => {
    const mixed = "삼성전자\u0001선임\u0002연구원";
    expect(cjkControlsAsSpaces(mixed)).toEqual({ text: mixed, spaced: 0 });
  });
});

let pdf: ParserHarness;
beforeAll(async () => { pdf = await parserHarness("parse-pdf"); });

describe("parse-pdf, run", () => {
  for (const name of ["chrome-ko.pdf", "chrome-ja2.pdf"]) {
    it(`${name} is accepted, with no control character in its text`, async () => {
      const r = await pdf.upload("resume.pdf", pdfFixture(name));
      expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
      expect(String(r.body.text)).not.toMatch(CONTROL);
    });
  }

  it("chrome-zh.pdf answers 增长 and 部门", async () => {
    const r = await pdf.upload("resume.pdf", pdfFixture("chrome-zh.pdf"));
    expect(r.status).toBe(200);
    expect(String(r.body.text)).toContain("增长");
    expect(String(r.body.text)).toContain("部门");
  });
});
