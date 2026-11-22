// @vitest-environment node
/**
 * EACH MANIFEST ROW NAMES ITS POSTING'S BOARD TOKEN (SEO audit 2026-11-18,
 * CRAWL18B-4 step 1: rows of path, title, company, token and field; review of
 * 2026-11-21).
 *
 * The bake wrote each /posting-pages.json row with its path, title, company
 * and field only. The reader (src/lib/seo/posting-manifest.ts) picks a
 * company page's rows by `token`, so on every company page the section that
 * links the employer's own baked postings drew nothing:
 * selectBakedPostingRows(rows, { token: "pnc~wd5~External" }) was []. Held
 * here from the bake's own inputs (the postings it wrote, by board token, and
 * the ledger for a page it only carried) through the reader the app runs.
 */
import { describe, expect, it } from "vitest";
import * as seo from "../../scripts/prerender-seo.mjs";
import { parsePostingManifest, parsePostingManifestRows, selectBakedPostingRows } from "@/lib/seo/posting-manifest";

type About = (path: string) => Record<string, unknown> | null;
const S = seo as unknown as {
  postingPagesManifest: (entries: unknown[], o: Record<string, unknown>) => { at: string; live: string[]; rows: Array<Record<string, unknown>> };
  postingManifestAbout?: (byToken: Map<string, unknown[]>, ledger: Record<string, unknown>, isLanderField: (f: string) => boolean) => About;
};

const PNC = "pnc~wd5~External";
const PNC_1 = "/jobs/posting/workday/pnc~wd5~External/R217438-1";
const PNC_2 = "/jobs/posting/workday/pnc~wd5~External/R219001";
const ACME = "/jobs/posting/greenhouse/acme/123";
const CARRIED = "/jobs/posting/workday/insulet~wd5~insuletcareers/REQ-1.5";
const BY_TOKEN = new Map<string, unknown[]>([
  [PNC, [
    { id: `workday:${PNC}:R217438-1`, path: PNC_1, title: "Branch Banker", company: "PNC", category: "finance" },
    { id: `workday:${PNC}:R219001`, path: PNC_2, title: "Teller", company: "PNC", category: "not_a_lander" },
  ]],
  ["acme", [{ id: "greenhouse:acme:123", path: ACME, title: "Analyst", company: "Acme", category: null }]],
]);
const LEDGER: Record<string, unknown> = {
  [CARRIED]: { state: "live", title: "Supplier Engineer", company: "Insulet", token: "insulet~wd5~insuletcareers" },
};
const ENTRIES = [{ path: "/jobs" }, { path: PNC_1 }, { path: ACME }, { path: `${CARRIED}` }, { path: PNC_2 }];
const isPosting = (e: { path: string }) => e.path.startsWith("/jobs/posting/");
const href = (p: string) => (/\.[^/]*$/.test(p) ? `${p}/` : p);
const isLanderField = (f: string) => f === "finance";

function bakedManifest() {
  expect(typeof S.postingManifestAbout).toBe("function");
  const about = S.postingManifestAbout!(BY_TOKEN, LEDGER, isLanderField);
  return S.postingPagesManifest(ENTRIES, { today: "2026-11-21", isPosting, href, about });
}

describe("the rows the bake writes", () => {
  it("a row carries the token its about names", () => {
    const m = S.postingPagesManifest([{ path: PNC_1 }], { today: "2026-11-21", isPosting, about: () => ({ title: "Branch Banker", company: "PNC", token: PNC, field: null }) });
    expect(m.rows[0]).toEqual({ path: PNC_1, title: "Branch Banker", company: "PNC", token: PNC, field: null });
  });

  it("every row names the token of the board its page was written from, a carried page's from its ledger entry", () => {
    const m = bakedManifest();
    expect(m.rows.map((r) => [r.path, r.token])).toEqual([
      [PNC_1, PNC],
      [ACME, "acme"],
      [`${CARRIED}/`, "insulet~wd5~insuletcareers"],
      [PNC_2, PNC],
    ]);
    // The token a row names is the board segment of its own path.
    for (const r of m.rows) expect(String(r.path).split("/")[4]).toBe(r.token);
  });

  it("keeps the field only where the field has a lander", () => {
    const m = bakedManifest();
    expect(Object.fromEntries(m.rows.map((r) => [r.path, r.field]))).toEqual({ [PNC_1]: "finance", [ACME]: null, [`${CARRIED}/`]: null, [PNC_2]: null });
  });
});

describe("what the app reads back", () => {
  it("a company page's token picks its own baked postings, and no other employer's", () => {
    const m = JSON.parse(JSON.stringify(bakedManifest()));
    const rows = parsePostingManifestRows(m, parsePostingManifest(m));
    expect(selectBakedPostingRows(rows, { token: PNC }).map((r) => r.path)).toEqual([PNC_1, PNC_2]);
    expect(selectBakedPostingRows(rows, { token: "insulet~wd5~insuletcareers" }).map((r) => r.title)).toEqual(["Supplier Engineer"]);
    expect(selectBakedPostingRows(rows, { token: "acme" }).map((r) => r.company)).toEqual(["Acme"]);
  });
});
