/**
 * A LINK TO AN EMPLOYER REACHES A PAGE THE BAKE WROTE (SEO-010).
 *
 * React linked /jobs/company/<token> for every employer, but the bake writes
 * a page for about 500 of 25,000 boards: 206 of the 500 live posting pages,
 * the data pages and the board linked tokens with no written page, and a
 * crawler that runs no scripts got the 22,727-byte homepage copy there
 * (index, follow, canonical "/"). A link now goes to the employer's written
 * page only when the bake's runtime manifest (/landers.json) names one, and
 * otherwise — before the manifest has loaded, for a token it does not name,
 * or for one it maps to null — to the live board filtered to that board.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  companyBoardHref,
  loadLanderManifest,
  parseLanderManifest,
  setLanderManifestForTests,
} from "@/lib/seo/lander-manifest";
import { SimilarCompaniesView } from "@/components/jobs/SimilarCompanies";

afterEach(() => { cleanup(); setLanderManifestForTests(null); });

const row = (company_token: string, company: string) => ({ company, company_token, open_roles: 10, employees: null, employee_basis: null, category: "healthcare" });
const hrefs = () => [...document.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
/** The links a crawler is not asked to skip: no rel="nofollow". */
const followed = () => [...document.querySelectorAll("a")].filter((a) => !/\bnofollow\b/.test(a.getAttribute("rel") ?? "")).map((a) => a.getAttribute("href") ?? "");

describe("companyBoardHref", () => {
  it("links the live board while no manifest has loaded", () => {
    expect(companyBoardHref("rmit~wd3~RMIT_Careers")).toBe("/jobs?company=rmit~wd3~RMIT_Careers");
    expect(companyBoardHref("intel", "experience=entry")).toBe("/jobs?company=intel&experience=entry");
  });

  it("links the written page the manifest names, the primary for a secondary board, and never a token it maps to null", () => {
    setLanderManifestForTests({ dominos: "dominos", "pwc~wd3~crm": "/jobs/company/pwc~wd3~global", "careers.amd.com": "careers.amd.com", clear: null });
    expect(companyBoardHref("dominos")).toBe("/jobs/company/dominos");
    expect(companyBoardHref("pwc~wd3~crm")).toBe("/jobs/company/pwc~wd3~global");
    // A dotted token takes the slash this host needs (publicPath).
    expect(companyBoardHref("careers.amd.com")).toBe("/jobs/company/careers.amd.com/");
    expect(companyBoardHref("dominos", "experience=entry")).toBe("/jobs/company/dominos?experience=entry");
    expect(companyBoardHref("clear")).toBe("/jobs?company=clear");
    expect(companyBoardHref("not-in-the-file")).toBe("/jobs?company=not-in-the-file");
  });

  it("reads the manifest leniently and ignores anything it cannot link", () => {
    expect(parseLanderManifest({ pages: { a: "a", b: null } })?.get("b")).toBeNull();
    expect(parseLanderManifest({ landers: { a: "/jobs/company/a" } })?.get("a")).toBe("/jobs/company/a");
    expect(parseLanderManifest({ a: "https://evil.example/x", b: 7 })?.size).toBe(0);
    expect(parseLanderManifest("<!doctype html>")).toBeNull();
  });

  it("does not take the SPA fallback's homepage HTML for a manifest", async () => {
    const html = async () => new Response("<!doctype html><html></html>", { status: 200, headers: { "content-type": "text/html" } });
    await loadLanderManifest(html as unknown as typeof fetch);
    expect(companyBoardHref("dominos")).toBe("/jobs?company=dominos");
  });
});

describe("a rendered employer profile link", () => {
  // A similar employer is a link to its profile. Since the round's review
  // (2026-10-24) a board with no written page keeps its profile address, so
  // people reach the hiring record, but with rel="nofollow": a crawler is
  // asked to follow only the pages the bake wrote.
  it("never asks a crawler to follow /jobs/company/ for a token without a written page", () => {
    setLanderManifestForTests({ dominos: "dominos" });
    render(<MemoryRouter><SimilarCompaniesView rows={[row("dominos", "Domino's"), row("menasha~wd12~MenashaCorp", "Menasha")]} /></MemoryRouter>);
    expect(hrefs()).toContain("/jobs/company/dominos");
    expect(hrefs()).toContain("/jobs/company/menasha~wd12~MenashaCorp");
    expect(followed().filter((h) => h.startsWith("/jobs/company/") && !h.startsWith("/jobs/company/dominos"))).toEqual([]);
    expect(hrefs().filter((h) => h.startsWith("/jobs?company="))).toEqual([]);
  });

  it("drops the nofollow once the manifest names the written page", async () => {
    render(<MemoryRouter><SimilarCompaniesView rows={[row("dominos", "Domino's")]} /></MemoryRouter>);
    expect(followed()).not.toContain("/jobs/company/dominos");
    await act(async () => { setLanderManifestForTests({ dominos: "dominos" }); });
    expect(followed()).toContain("/jobs/company/dominos");
  });
});
