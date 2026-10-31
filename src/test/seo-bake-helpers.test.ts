/**
 * THE BAKE'S HELPERS FOR THE SEO ROUND (2026-10-18), against the real inputs:
 *   - SEO-029 / S13-133: /privacy and /terms baked only their headings; the
 *     full text is now converted from the page files the app renders.
 *   - SEO-023: posting pages preloaded the Jobs chunk and / and /pricing no
 *     route chunk; each page now preloads its own chunk and its imports.
 *   - SEO-034: "CV Rules in United States", "Currículo em Brasil".
 *   - S13-049 / S13-088: the pay page ranked boards as employers and said its
 *     table held roles since taken down.
 *   - SEO-014 / SEO-015: one address for the MCP server and one for the API.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { legalBodyFromTsx, legalText } from "../../scripts/prerender-legal.mjs";
import { preloadClosure, routeChunkPrefix, staticImportsOf } from "../../scripts/prerender-preload.mjs";
import { cvFill } from "@/lib/cv-country-phrase";
import { CV_LOCALES, EN_TEMPLATE } from "@/data/cv-standards-content";
import { mcpServerUrl, publicApiBase } from "@/config/public-endpoints";
import { MCP_PRIVACY_ROWS } from "@/config/mcp-privacy";
import EN from "@/i18n/locales/en.json";

const ROOT = resolve(__dirname, "../..");
const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

describe("SEO-029: the legal pages' full text, from the files the app renders", () => {
  const privacy = legalBodyFromTsx(readFileSync(resolve(ROOT, "src/pages/Privacy.tsx"), "utf8"), { locale: EN, vars: { AI_CACHE_MAX_HOURS: 48, SHARED_ANALYSIS_DAYS: 90, MCP_PRIVACY_ROWS }, esc });
  const terms = legalBodyFromTsx(readFileSync(resolve(ROOT, "src/pages/Terms.tsx"), "utf8"), { locale: EN, vars: { fullAnalysisPrice: "$5.00 USD" }, esc });
  it("converts every section of both policies", () => {
    expect(legalText(privacy).length).toBeGreaterThan(8000);
    expect(legalText(terms).length).toBeGreaterThan(8000);
    expect(privacy).toContain(esc(EN.privacy.sections.retention));
    expect(terms).toContain(esc(EN.terms.sections.payment));
  });
  it("carries the section-4 refund paragraph and the retention sentence", () => {
    expect(legalText(terms)).toMatch(/4\. Payment Terms and Refund Policy The Service costs \$5\.00 USD per analysis/);
    expect(legalText(terms)).toMatch(/refund/i);
    expect(legalText(privacy)).toMatch(/Held in a private temporary store for 24 hours/);
    expect(legalText(privacy)).toMatch(/cached for up to 48 hours/);
  });
  it("leaves no JSX behind, and refuses what it cannot render rather than half-convert it", () => {
    expect(privacy).not.toMatch(/className|\{|\}|<Link/);
    expect(() => legalBodyFromTsx("<section><Widget /></section>", { locale: EN, vars: {}, esc })).toThrow(/component/);
    expect(() => legalBodyFromTsx("<section>{UNKNOWN}</section>", { locale: EN, vars: {}, esc })).toThrow(/no value/);
  });
  // Wave 4's privacy page (merged with main 2026-10-25): the table of what
  // each way of reaching us from an AI receives and keeps is rendered from
  // MCP_PRIVACY_ROWS, and a button reopens the analytics choice. The table is
  // baked row by row from the same constant; the button, a control, is not.
  it("bakes the AI table from its rows and leaves the consent button out", () => {
    const text = legalText(privacy);
    for (const r of MCP_PRIVACY_ROWS) {
      expect(text, r.id).toContain(legalText(esc(r.what)));
      expect(text, r.id).toContain(legalText(esc(r.kept)));
    }
    expect(privacy.match(/<tr>/g)?.length).toBe(MCP_PRIVACY_ROWS.length + 1);
    expect(privacy).not.toMatch(/<button|onClick|data-change-consent/);
    expect(text).not.toContain(EN.privacy.changeConsent ?? "Change my analytics choice");
    expect(() => legalBodyFromTsx("<section><table><tbody>{ROWS.map((r) => (\n<tr key={r.id}><td>{r.what}</td></tr>\n))}</tbody></table></section>", { locale: EN, vars: {}, esc })).toThrow(/no row list/);
    expect(() => legalBodyFromTsx("<section><table><tbody>{ROWS.map((r) => (\n<tr><td>{r.gone}</td></tr>\n))}</tbody></table></section>", { locale: EN, vars: { ROWS: [{ what: "x" }] }, esc })).toThrow(/field gone/);
  });
});

describe("SEO-023: each page preloads the chunk it runs", () => {
  it("maps posting pages to JobPosting, / to HomePage, /pricing to PricingPage and the board family to Jobs", () => {
    expect(routeChunkPrefix("/jobs/posting/workday/a~wd1~b/R1")).toBe("JobPosting");
    // The board-first homepage and the new pricing page (homepage switch-over).
    expect(routeChunkPrefix("/")).toBe("HomePage");
    expect(routeChunkPrefix("/pricing")).toBe("PricingPage");
    expect(routeChunkPrefix("/jobs")).toBe("Jobs");
    expect(routeChunkPrefix("/jobs/company/dominos")).toBe("Jobs");
    expect(routeChunkPrefix("/jobs/field/engineering")).toBe("Jobs");
    expect(routeChunkPrefix("/guides")).toBeNull();
  });
  it("adds the chunk's static imports, never a dynamic import and never the entry", () => {
    const files: Record<string, string> = {
      "JobPosting-a.js": 'import{a}from"./index-E.js";import{b}from"./PostingDetail-c.js";import"./Footer-f.js";const x=()=>import("./Lazy-z.js");',
      "PostingDetail-c.js": 'import{s}from"./SEO-s.js";',
      "SEO-s.js": "",
      "Footer-f.js": "",
    };
    expect(staticImportsOf(files["JobPosting-a.js"])).toEqual(["index-E.js", "PostingDetail-c.js", "Footer-f.js"]);
    const list = preloadClosure("JobPosting-a.js", { readChunk: (f: string) => files[f] ?? "", entry: "index-E.js" });
    expect(list).toEqual(["JobPosting-a.js", "PostingDetail-c.js", "Footer-f.js", "SEO-s.js"]);
    expect(list).not.toContain("Lazy-z.js");
    expect(list).not.toContain("index-E.js");
  });
});

describe("SEO-034: a country's name in the form its sentence needs", () => {
  it("fixes the three titles the bake served", () => {
    expect(cvFill(EN_TEMPLATE.title, { name: "United States", docTerm: "resume" })).toBe("CV Rules in the United States: Photo, Length, Format");
    expect(cvFill(EN_TEMPLATE.h1, { name: "United States" })).toBe("CV & resume standards in the United States");
    expect(cvFill(CV_LOCALES.pt.t.title, { name: "Brasil", docTerm: "currículo" }, "pt")).toBe("Currículo no Brasil: foto, extensão e formato");
    expect(cvFill(CV_LOCALES.de.t.title, { name: "Schweiz", docTerm: "Lebenslauf" }, "de")).toBe("Lebenslauf in der Schweiz: Foto, Länge, Format");
  });
  it("leaves a name that takes no article as the template wrote it", () => {
    expect(cvFill(EN_TEMPLATE.title, { name: "Germany", docTerm: "Lebenslauf" })).toBe("CV Rules in Germany: Photo, Length, Format");
    expect(cvFill(CV_LOCALES.pt.t.title, { name: "Portugal", docTerm: "CV" }, "pt")).toBe("Currículo em Portugal: foto, extensão e formato");
  });
});

describe("SEO-014 / SEO-015: one address each", () => {
  it("builds the MCP server and the API base from the project address, with the public one as the fallback", () => {
    expect(mcpServerUrl("https://x.supabase.co/")).toBe("https://x.supabase.co/functions/v1/agent-mcp");
    expect(publicApiBase("https://x.supabase.co")).toBe("https://x.supabase.co/functions/v1/public-api");
    expect(mcpServerUrl(null)).toBe("https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/agent-mcp");
  });
});

describe("S13-049 / S13-088: the pay page's table and its population, from the builder the bake runs", () => {
  const SCRIPT = resolve(ROOT, "scripts/prerender-seo.mjs");
  const src = readFileSync(SCRIPT, "utf8");
  const slice = src.slice(src.indexOf("// >>> DATA-PAGE FIGURE BUILDER START"), src.indexOf("// <<< DATA-PAGE FIGURE BUILDER END"));
  // eslint-disable-next-line no-new-func
  const build = new Function(`${slice}; return dataPageFigures;`)() as (p: unknown) => Record<string, { html: string }>;
  const text = (h: string) => h.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  const T = {
    computed_at: "2026-10-18T06:37:00Z",
    pay: { overall: { pay_pct: 33, total: 1032138 }, categories: [], top_companies: [{ company: "PwC", company_token: "pwc~wd3~x", pay_pct: 100, total: 900 }] },
    coverage: { overall: { mode_pct: 26.4 } },
  };
  it("labels the ranked rows as job boards, one per board", () => {
    const html = text(build({ transparency: T, openTotal: 1022600 }).pay.html);
    expect(html).toContain("Most transparent large job boards");
    expect(html).toContain("One row per job board; an employer running several counts once per board.");
    expect(html).not.toContain("Most transparent large employers");
  });
  it("states the population the table holds: what the board carries plus the few awaiting removal", () => {
    const html = text(build({ transparency: T, openTotal: 1022600 }).pay.html);
    expect(html).toContain("Counted across the postings the board currently carries, plus about 1% awaiting removal (1,032,138 rows in the table against 1,022,600 open)");
    expect(html).not.toMatch(/including roles since taken down/);
    // Without the open count it says so in words, never a number it did not read.
    expect(text(build({ transparency: T }).pay.html)).toContain("plus the few awaiting removal");
  });
});
