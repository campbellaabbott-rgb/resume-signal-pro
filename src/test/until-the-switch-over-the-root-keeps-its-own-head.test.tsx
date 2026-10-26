/**
 * UNTIL THE SWITCH-OVER, "/" KEEPS ITS OWN HEAD (review of hp/scanner,
 * 2026-10-25).
 *
 * hp/scanner deleted the old homepage from Index, so until switch-over step 1
 * swaps "/"'s element for the new HomePage, "/" renders the scanner. It
 * rendered it with /resume-checker's own landing, and Index writes the head
 * from the landing: after hydration "/" carried /resume-checker's canonical
 * and its hreflang pair (en and x-default /resume-checker, es
 * /es/revisar-curriculum). Published like that, ahead of step 1, Google is
 * told the homepage is a duplicate of /resume-checker.
 *
 * "/" now renders the scanner under SCANNER_AT_ROOT: /resume-checker's copy
 * with "/" as its path and no language pair, so the rendered canonical is
 * "/" and no hreflang names /resume-checker. Step 1 deletes it with the
 * element it feeds.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { HelmetProvider, type HelmetServerState } from "react-helmet-async";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SCANNER_AT_ROOT } from "@/lib/scanner-address";
import { TOOL_LANDINGS } from "@/data/tool-landings";
import { SEO } from "@/components/seo/SEO";

afterEach(cleanup);
const ROOT = resolve(__dirname, "../..");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
const app = strip(readFileSync(resolve(ROOT, "src/App.tsx"), "utf8"));
const index = strip(readFileSync(resolve(ROOT, "src/pages/Index.tsx"), "utf8"));

describe('"/" renders the scanner under a head whose path is "/"', () => {
  it('the "/" route passes SCANNER_AT_ROOT, never /resume-checker\'s own landing', () => {
    const root = app.split("\n").find((l) => l.includes('<Route path="/" ')) ?? "";
    expect(root).toMatch(/<Index landing=\{SCANNER_AT_ROOT\} \/>/);
    expect(root).not.toMatch(/TOOL_LANDINGS\["resume-checker"\]/);
  });

  it("SCANNER_AT_ROOT is the scanner's copy at \"/\", with no language pair", () => {
    expect(SCANNER_AT_ROOT.path).toBe("/");
    expect(SCANNER_AT_ROOT.alternates).toBeUndefined();
    expect(SCANNER_AT_ROOT.title).toBe(TOOL_LANDINGS["resume-checker"].title);
    expect(Object.values(TOOL_LANDINGS), "the bake writes a page for every tool landing; \"/\" is not one").not.toContain(SCANNER_AT_ROOT);
    // /resume-checker itself is unchanged.
    expect(TOOL_LANDINGS["resume-checker"].path).toBe("/resume-checker");
  });

  it("Index writes the canonical from the landing's path and hreflang only from its pair", () => {
    expect(index).toMatch(/path=\{landing\?\.path \?\? "\/"\}/);
    expect(index).toMatch(/\{landing\?\.alternates && \(/);
  });

  it("the head it writes names \"/\", not /resume-checker", async () => {
    const ctx: { helmet?: HelmetServerState } = {};
    render(
      <HelmetProvider context={ctx}>
        <SEO title={SCANNER_AT_ROOT.title} description={SCANNER_AT_ROOT.description} path={SCANNER_AT_ROOT.path} />
      </HelmetProvider>,
    );
    await new Promise((r) => setTimeout(r, 0));
    const canonical = document.head.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? ctx.helmet?.link.toString() ?? "";
    expect(canonical).toMatch(/https:\/\/resumebooster\.work\/?("|$)/);
    expect(canonical).not.toMatch(/resume-checker/);
  });
});
