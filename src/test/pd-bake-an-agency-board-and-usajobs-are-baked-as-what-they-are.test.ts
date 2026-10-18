// @vitest-environment node
/**
 * THE BAKE NAMES EACH BOARD FOR WHAT IT IS, AND ITS SMALLER CLAIMS HOLD
 * (design and profiles fix round, 2026-10-18 review).
 *
 *   - USAJOBS was baked as an employer: "Open roles at USAJOBS", "pulled
 *     straight from USAJOBS' own hiring system", "The fields USAJOBS is hiring
 *     in", an Organization named USAJOBS, on an indexable page whose SPA says
 *     it is a listing site, not an employer.
 *   - A staffing agency's board (Surge Staffing, indexable) was baked as a
 *     plain employer page, while /companies says agency boards are labelled.
 *   - A USAJOBS row could become a posting page saying "Apply on <agency>'s
 *     own site".
 *   - A duplicate group member indexable today that failed the name gate was
 *     noindexed, against D7.
 *   - The four data pages were re-dated on counts alone.
 *   - og:url on a dotted company path pointed at a 404.
 *   - A name repair that leaves one word reached nobody's review.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  companyLanderPage, postingRowEligible, resolveDuplicateGroups, COUNT_BEARING, contentFingerprint,
} from "../../scripts/prerender-pages.mjs";
import { agencyTokensOf } from "../../scripts/prerender-agency.mjs";
import { CATALOG, RAW_SOURCE } from "./helpers/catalog";
import { crawlerText } from "../../scripts/prerender-retired.mjs";

const ROOT = resolve(__dirname, "../..");
const SHARD = JSON.parse(readFileSync(resolve(ROOT, "src/i18n/shards/company/en.json"), "utf8")).companyProfile;
const esc = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const base = {
  primaryToken: "", openN: 13926, countedOn: "2026-10-17",
  facts: { countries: [{ code: "US", name: "United States" }], fields: [{ slug: "healthcare", label: "Healthcare" }] },
  openings: [], sources: "Workday, Greenhouse", boardCompanies: 31000, site: "https://resumebooster.work",
  esc, possessive: (n: string) => (n.endsWith("s") ? `${n}'` : `${n}'s`), fmt: (n: number) => n.toLocaleString("en-US"), href: (t: string) => `/jobs/company/${t}`,
  copy: { usajobsH1: SHARD.usajobs.h1, usajobsSubtitle: SHARD.usajobs.subtitle, usajobsCap: SHARD.usajobs.cap, usajobsCapValue: 10000, agencyBanner: SHARD.agency.banner },
};
const all = (p: { title: string; description: string; content: string; jsonLd: unknown[] }) => `${p.title}\n${p.description}\n${crawlerText(p.content)}\n${JSON.stringify(p.jsonLd)}`;

describe("USAJOBS is baked as the federal listing site it is", () => {
  const p = companyLanderPage({ ...base, token: "usajobs", name: "USAJOBS", primaryToken: "usajobs", kind: "usajobs" });
  it("in the SPA hub's own words, with the per-query cap", () => {
    expect(p.title).toBe(`${SHARD.usajobs.h1}: 13,926 roles`);
    expect(p.content).toContain(`<h1>${esc(SHARD.usajobs.h1)}</h1>`);
    expect(crawlerText(p.content)).toContain(SHARD.usajobs.subtitle);
    expect(crawlerText(p.content)).toContain("Up to 10,000 results per query; not every federal opening.");
  });
  it("never as an employer with its own hiring system, hiring in fields, or an Organization", () => {
    expect(all(p)).not.toMatch(/own hiring system|is hiring in|Open roles at USAJOBS|USAJOBS' own/);
    expect(JSON.stringify(p.jsonLd)).not.toMatch(/"Organization"/);
  });
  it("positive control: an employer's page keeps its own-system wording and its Organization", () => {
    const e = companyLanderPage({ ...base, token: "dominos", name: "Domino's", primaryToken: "dominos" });
    expect(e.title).toBe("Domino's jobs: 13,926 open roles from their own hiring system");
    expect(all(e)).toMatch(/The fields Domino's is hiring in/);
    expect(JSON.stringify(e.jsonLd)).toMatch(/"Organization"/);
    // The JSON-LD no longer says "re-checked throughout the day" (GD6/A3).
    expect(JSON.stringify(e.jsonLd)).not.toMatch(/throughout the day/);
  });
  it("the bake routes the usajobs token to this variant, and every company page through the one kind", () => {
    const bake = readFileSync(resolve(ROOT, "scripts/prerender-seo.mjs"), "utf8");
    expect(bake).toMatch(/const landerKindOf = \(token\) => \(D\.isUsajobsBoard\(token, null\) \? "usajobs" : AGENCY_TOKENS\.has\(token\) \? "agency" : "employer"\)/);
    expect(bake.match(/kind: landerKindOf\(/g)?.length, "pageOf and the carried once-published page").toBe(2);
    expect(bake).toMatch(/export \{ USAJOBS_RESULT_CAP, isUsajobsBoard \} from "\.\.\/src\/lib\/company\/lander-model"/);
  });
});

describe("a staffing agency's board says so", () => {
  const p = companyLanderPage({ ...base, token: "surge", name: "Surge Staffing", primaryToken: "surge", openN: 308, kind: "agency" });
  it("carries the SPA's banner, says where roles are listed, and names no employer Organization", () => {
    expect(crawlerText(p.content)).toContain(SHARD.agency.banner);
    expect(all(p)).toMatch(/The fields Surge Staffing' roles are listed in|roles are listed in/);
    expect(all(p)).not.toMatch(/is hiring in|pulled straight from Surge Staffing's own hiring system/);
    expect(JSON.stringify(p.jsonLd)).not.toMatch(/"Organization"/);
    expect(p.title).toBe("Surge Staffing jobs: 308 roles listed by a staffing agency");
  });
  it("the catalogue reader finds every agency board the shared catalogue reader finds", () => {
    const viaShared = new Set(CATALOG.filter((e) => (e as { agency?: boolean }).agency === true).map((e) => e.token));
    const viaBake = agencyTokensOf(RAW_SOURCE);
    expect(viaShared.size, "the shared reader sees agency boards").toBeGreaterThan(50);
    expect([...viaBake].sort()).toEqual([...viaShared].sort());
    expect(viaBake.has("surge")).toBe(true);
  });
});

describe("no USAJOBS row gets a posting page of its own", () => {
  const D = {
    postingPagePath: (id: string) => `/jobs/posting/${id}`,
    postingPathParts: (id: string) => ({ token: id.split(":")[1] }),
    isCodeShapedName: () => false,
    postingEmployer: (j: { company: string }) => j.company,
    isPostingLive: () => true,
  };
  const row = { id: "usajobs:usajobs:1", source: "usajobs", token: "usajobs", title: "Nurse", company: "Veterans Health Administration", country: "US", location: "Denver, CO" };
  it("refused, while the same row from an employer's own system is eligible", () => {
    expect(postingRowEligible(row, D)).toBe(false);
    expect(postingRowEligible({ ...row, id: "workday:acme~wd1~x:1", source: "workday", token: "acme~wd1~x", company: "Acme" }, D)).toBe(true);
  });
});

describe("D7 before the name gate in a duplicate group", () => {
  const groups = [["a", "b"], ["c", "d"]];
  it("a member indexable today keeps its index even when the name gate would refuse it", () => {
    const r = resolveDuplicateGroups({ groups, wasIndexable: (k) => k === "a" || k === "c" || k === "d", openOf: () => 1, nameKeyOf: (k) => k, failsGate: (k) => k === "a" || k === "c" || k === "d" });
    expect(r.get("a")).toEqual({ role: "keep" });
    expect(r.get("c")).toEqual({ role: "keep" });
    expect(r.get("d")).toEqual({ role: "keep" });
  });
  it("a group none of whose members is indexable today and all fail the gate still goes noindex", () => {
    const r = resolveDuplicateGroups({ groups: [["x", "y"]], wasIndexable: () => false, openOf: () => 1, nameKeyOf: (k) => k, failsGate: () => true });
    expect(r.get("x")).toEqual({ role: "noindex" });
    expect(r.get("y")).toEqual({ role: "noindex" });
  });
});

describe("the four data pages move their date only when what they say moves", () => {
  it("are count-bearing, so a count moving is not the page changing", () => {
    for (const p of ["/ghost-job-index", "/entry-level-index", "/hiring-trends", "/pay-transparency"]) {
      expect(COUNT_BEARING(p), p).toBe(true);
      expect(contentFingerprint(`<p>1,040,471 roles</p>`, { blindCounts: COUNT_BEARING(p) })).toBe(contentFingerprint(`<p>1,040,353 roles</p>`, { blindCounts: COUNT_BEARING(p) }));
    }
    expect(COUNT_BEARING("/guides/why-resumes-get-rejected"), "a guide stays exact").toBe(false);
  });
});

describe("og:url on a dotted company path resolves", () => {
  it("is built through publicHref, as the canonical is", async () => {
    const { composeHtml } = (await import("../../scripts/prerender-seo.mjs")) as unknown as {
      composeHtml: (page: Record<string, unknown>, deps: Record<string, unknown>) => string;
    };
    const html = composeHtml(
      { path: "/jobs/company/careers.ulta.com", title: "Ulta jobs", description: "Ulta", content: "<p>x</p>" },
      {
        template: readFileSync(resolve(ROOT, "index.html"), "utf8"), D: { POSTING_LD_TAG_ID: "posting-ld" }, esc,
        shell: (c: string) => c, preloadFor: () => "", publicHref: (p: string) => (/\.[^/]*$/.test(p) ? `${p}/` : p), onTruncated: () => {},
      },
    );
    expect(html).toContain('<meta property="og:url" content="https://resumebooster.work/jobs/company/careers.ulta.com/"');
    expect(html).toContain('<meta name="twitter:url" content="https://resumebooster.work/jobs/company/careers.ulta.com/"');
  });
});

describe("a one-word name repair reaches the owner's report", () => {
  it("the bake flags it and the report prints it", () => {
    const bake = readFileSync(resolve(ROOT, "scripts/prerender-seo.mjs"), "utf8");
    expect(bake).toMatch(/singleWord: !\/\\s\/\.test\(String\(c\.name\)\.trim\(\)\)/);
    const report = readFileSync(resolve(ROOT, "scripts/prerender-name-gate-report.mjs"), "utf8");
    expect(report).toMatch(/e\.singleWord \?/);
  });
});
