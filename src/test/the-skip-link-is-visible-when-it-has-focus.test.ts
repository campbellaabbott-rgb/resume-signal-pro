/**
 * THE SKIP LINK IS VISIBLE WHEN IT HAS FOCUS (WCAG 2.4.7).
 *
 * index.html's "Skip to main content" link is the first Tab stop on every
 * page. Its focus utilities (focus:top-4, focus:left-4, focus:z-50,
 * focus:bg-primary, focus:px-4, ...) are written in index.html, and the
 * Tailwind content globs scanned only src/, so none of them was generated:
 * measured on 3ebdcbb2's build, the focused link sat at [0,0,154,24] with
 * z-index auto and elementFromPoint at its centre returned the fixed header
 * (z 40). The built CSS held only `.focus\:not-sr-only:focus`.
 *
 * Held here by compiling the real Tailwind config over index.html alone:
 * every focus: class the skip link names comes out, and its z layer beats the
 * header's.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import tailwind from "tailwindcss";
import config from "../../tailwind.config";

const ROOT = resolve(__dirname, "../..");
const INDEX = readFileSync(resolve(ROOT, "index.html"), "utf8");
const HEADER = readFileSync(resolve(ROOT, "src/components/Header.tsx"), "utf8");

const skipClasses = (): string[] => {
  const m = /<a href="#main-content" class="([^"]+)"/.exec(INDEX);
  expect(m, "index.html no longer carries the skip link where this guard looks").toBeTruthy();
  return m![1].split(/\s+/).filter(Boolean);
};
const escapeClass = (c: string) => c.replace(/[:/[\].]/g, (ch) => `\\${ch}`);

describe("the skip link's focus styles are generated", () => {
  it("the content globs scan index.html", () => {
    expect((config as { content: string[] }).content).toContain("./index.html");
  });

  it("compiling the config over index.html yields every focus: class the link names", async () => {
    const cfg = { ...(config as object), content: [{ raw: INDEX, extension: "html" }] };
    const out = await postcss([tailwind(cfg as never)]).process("@tailwind utilities;", { from: undefined });
    const focus = skipClasses().filter((c) => c.startsWith("focus:"));
    expect(focus.length).toBeGreaterThanOrEqual(8);
    const missing = focus.filter((c) => !out.css.includes(`.${escapeClass(c)}:focus`));
    expect(missing, "focus: utilities on the skip link that Tailwind never generated").toEqual([]);
  });

  it("its focus layer is above the fixed header's", () => {
    const z = Number(/focus:z-(\d+)/.exec(skipClasses().join(" "))?.[1]);
    const header = Number(/<header className="fixed[^"]*\bz-(\d+)/.exec(HEADER)?.[1]);
    expect(header, "the header's z layer moved: re-point this guard").toBeGreaterThan(0);
    expect(z).toBeGreaterThan(header);
  });
});
