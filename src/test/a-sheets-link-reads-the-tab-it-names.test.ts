// @vitest-environment node
//
// Node, not jsdom: the handler is bundled with esbuild, which refuses
// jsdom's TextEncoder (helpers/edge-harness.ts).
/**
 * A GOOGLE SHEETS LINK READS THE TAB IT NAMES (S14X-284, C-S14-134).
 *
 * parse-spreadsheet took the sheet id with /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/
 * and asked for /d/<id>/export?format=csv with no tab. So a link to the
 * second tab (#gid=123) imported the first tab, and a "Publish to the web"
 * link (/spreadsheets/d/e/2PACX-.../pubhtml) gave the id "e": the export
 * answered 404 and the visitor was told to share a sheet that was already
 * public.
 *
 * Now sheetsExportUrl builds the export: the tab from #gid= or ?gid= rides
 * as &gid=, and a published link reads /d/e/<id>/pub?output=csv.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as csv from "../../supabase/functions/parse-spreadsheet/csv";
import { spreadsheetHarness, type SpreadsheetHarness } from "./helpers/spreadsheet-handler";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

let h: SpreadsheetHarness;
beforeAll(async () => { h = await spreadsheetHarness(); });
beforeEach(() => { h.fetched.length = 0; });

async function asked(googleSheetsUrl: string): Promise<{ status: number; url: string | undefined }> {
  const res = await h.post(JSON.stringify({ googleSheetsUrl }), { "content-type": "application/json" });
  return { status: res.status, url: h.fetched.find((u) => u.startsWith("https://docs.google.com/")) };
}

describe("the export the handler asks Google for", () => {
  it("a link to a tab asks for that tab", async () => {
    const r = await asked("https://docs.google.com/spreadsheets/d/1AbC_dEf-GhI/edit#gid=123");
    expect(r.url).toBe("https://docs.google.com/spreadsheets/d/1AbC_dEf-GhI/export?format=csv&gid=123");
    expect(r.status).toBe(200);
  });

  it("a published link reads the published copy, never a sheet called 'e'", async () => {
    const r = await asked("https://docs.google.com/spreadsheets/d/e/2PACX-abc_DEF-123/pubhtml?gid=7&single=true");
    expect(r.url).toBe("https://docs.google.com/spreadsheets/d/e/2PACX-abc_DEF-123/pub?output=csv&gid=7");
    expect(r.status).toBe(200);
  });

  it("a plain link is asked as before", async () => {
    const r = await asked("https://docs.google.com/spreadsheets/d/abc123/edit");
    expect(r.url).toBe("https://docs.google.com/spreadsheets/d/abc123/export?format=csv");
  });

  it("a link that names no sheet is still refused before anything is fetched", async () => {
    const r = await asked("https://docs.google.com/document/d/abc123/edit");
    expect(r.status).toBe(400);
    expect(h.fetched).toEqual([]);
  });
});

describe("sheetsExportUrl", () => {
  const build = (csv as unknown as { sheetsExportUrl?: (u: string) => string | null }).sheetsExportUrl;
  it("exists, beside the CSV reader, and builds only docs.google.com exports", () => {
    expect(typeof build).toBe("function");
    expect(build!("https://docs.google.com/spreadsheets/d/abc/edit?gid=5#gid=5")).toBe("https://docs.google.com/spreadsheets/d/abc/export?format=csv&gid=5");
    expect(build!("https://docs.google.com/spreadsheets/d/e/2PACX-x/pubhtml")).toBe("https://docs.google.com/spreadsheets/d/e/2PACX-x/pub?output=csv");
    expect(build!("https://example.com/spreadsheets/d/abc/edit")).toBe("https://docs.google.com/spreadsheets/d/abc/export?format=csv");
    expect(build!("not a link")).toBeNull();
  });
});
