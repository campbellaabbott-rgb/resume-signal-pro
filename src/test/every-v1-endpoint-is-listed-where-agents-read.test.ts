/**
 * EVERY /v1 ENDPOINT IS LISTED WHERE AGENTS READ (RC-S13-105), AND THE
 * /v1/changes ENTRY SAYS HOW TO RESUME (S14X-065, the docs half).
 *
 * public-api served and metered GET /v1/jobs/{id}/application for weeks while
 * llms.txt, llms-full.txt, the /data-api bake and the DataApi page each named
 * it zero times (2026-11-15). The route list is read from the API's own index
 * answer (its `endpoints` array, with APPLICATION_ENDPOINT resolved from
 * endpoint.ts), so a route added there and listed nowhere fails here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { APPLICATION_ENDPOINT } from "../../supabase/functions/public-api/endpoint";

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

/** The paths the API's own index lists, as "GET /v1/..." or "POST /v1/...". */
function apiRoutes(): string[] {
  const api = codeOf(read("supabase/functions/public-api/index.ts"));
  const m = /endpoints:\s*\[([^\]]+)\]/.exec(api);
  expect(m, "the API index's endpoints array moved").toBeTruthy();
  return m![1].split(",").map((x) => x.trim()).filter(Boolean).map((x) => {
    if (x === "APPLICATION_ENDPOINT") return `GET ${APPLICATION_ENDPOINT}`;
    const s = x.replace(/^["']|["']$/g, "");
    return /^(GET|POST) /.test(s) ? s : `GET ${s}`;
  });
}

const LLMS = read("public/llms.txt");
const PAGE = codeOf(read("src/pages/DataApi.tsx"));
const BAKE = read("scripts/prerender-seo.mjs");
const DATA_API_LIST = (() => {
  const a = BAKE.indexOf("<h2>Query it yourself</h2>");
  return BAKE.slice(a, BAKE.indexOf("</ul>", a));
})();
const LLMS_FULL_LINE = BAKE.split("\n").find((l) => l.includes("lines.push(`- Hiring Data & API:")) ?? "";

describe("the route list", () => {
  it("is read from the API and holds the application route", () => {
    const routes = apiRoutes();
    expect(routes).toContain("GET /v1/jobs/{id}/application");
    expect(routes.length).toBeGreaterThanOrEqual(8);
  });
});

describe("every route is named in all four places", () => {
  for (const route of apiRoutes()) {
    const path = route.replace(/^(GET|POST) /, "");
    it(`${route}`, () => {
      expect(LLMS, "public/llms.txt").toContain(path);
      expect(PAGE, "DataApi ENDPOINTS").toContain(`path: "${route}"`);
      expect(DATA_API_LIST, "the /data-api bake").toContain(`<code>${route}</code>`);
      expect(LLMS_FULL_LINE, "llms-full's Data API line").toContain(path);
    });
  }
});

describe("the /v1/changes entry says where a reader resumes (S14X-065)", () => {
  it("names settledThrough and resumeCursor on the page and in the bake", () => {
    for (const [where, src] of [["DataApi", PAGE], ["the /data-api bake", DATA_API_LIST]] as const) {
      expect(src, where).toContain("settledThrough");
      expect(src, where).toContain("resumeCursor");
      expect(src, where).toMatch(/never by moving (<code>)?since/);
    }
  });
});
