// @vitest-environment node
/**
 * A FORM READ IS PROMISED ONLY WHERE WE READ THAT SYSTEM (SEO audit
 * 2026-11-18, GEO-1b).
 *
 * The apply guide's summary and FAQ and the baked /data-api line said the
 * application form is read "where the employer's hiring system publishes it":
 * every hiring system publishes its form, and the server reads the forms of
 * the systems it names and no others, so the sentence promised a read for
 * every employer. The guide and the bake now tie the read to the systems we
 * read, and the guide names them.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GUIDES } from "@/data/guides";
import { MCP_FORM_VENDORS } from "@/config/mcp-tools";
import { codeOf } from "./helpers/strip-comments";

const LOOSE = /(?:employer's|its) hiring system publishes (?:it|one)/;
const guideText = (g: (typeof GUIDES)[string]) => JSON.stringify([g.title, g.h1, g.description, g.tldr, g.sections, g.faqs]);

describe("the guides", () => {
  it("never promise a form read wherever a hiring system publishes a form", () => {
    for (const g of Object.values(GUIDES)) expect(guideText(g), g.slug).not.toMatch(LOOSE);
  });

  it("the apply guide ties the read to the systems we read, and names each of them", () => {
    const g = GUIDES["how-the-apply-agent-works"];
    expect(g.tldr).toContain("where we read that hiring system's form");
    const text = guideText(g);
    for (const v of MCP_FORM_VENDORS) expect(text, v.label).toContain(v.label);
  });
});

describe("the baked /data-api page", () => {
  it("says the form is read where we read that hiring system's form", () => {
    const code = codeOf(readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8"));
    const line = code.match(/<li><code>GET \/v1\/jobs\/\{id\}\/application<\/code>[^\n]*/)?.[0] ?? "";
    expect(line).toContain("where we read that hiring system's form");
    expect(code).not.toMatch(LOOSE);
  });
});
