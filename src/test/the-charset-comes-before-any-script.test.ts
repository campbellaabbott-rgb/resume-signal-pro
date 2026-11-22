// @vitest-environment node
/**
 * THE CHARSET COMES BEFORE ANY SCRIPT (SEO audit 2026-11-18, PERF-B3).
 *
 * Every page's <meta charset> sat after the address-stash script and its
 * explanation, at byte 4,979. A browser looks for the charset in the first
 * 1,024 bytes; past them it may start parsing in a guessed encoding and
 * re-parse when it meets the tag. The charset is now the first child of
 * <head>. It runs nothing, so the stash script is still the first script.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const HTML = readFileSync(resolve(__dirname, "../../index.html"), "utf8");

describe("index.html, the shell of every page", () => {
  it("declares its charset in the first 1,024 bytes", () => {
    const at = Buffer.from(HTML, "utf8").indexOf('<meta charset="UTF-8" />');
    expect(at).toBeGreaterThan(-1);
    expect(at + '<meta charset="UTF-8" />'.length).toBeLessThanOrEqual(1024);
  });

  it("declares it before any script, once", () => {
    expect(HTML.indexOf('<meta charset="UTF-8" />')).toBeLessThan(HTML.indexOf("<script"));
    expect(HTML.match(/<meta charset=/gi)?.length).toBe(1);
  });

  it("keeps the stash script the first script in <head>", () => {
    const head = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(HTML)?.[1] ?? "";
    expect(head).toMatch(/^\s*<meta charset="UTF-8" \/>\s*<script>/);
    expect(/<script\b[^>]*>([\s\S]*?)<\/script>/i.exec(head)?.[1]).toContain("rb_url_stash");
  });
});
