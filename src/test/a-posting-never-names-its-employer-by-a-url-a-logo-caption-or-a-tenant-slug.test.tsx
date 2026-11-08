/**
 * A POSTING NEVER NAMES ITS EMPLOYER BY A URL, A LOGO CAPTION OR A TENANT SLUG
 * (SEO/GEO audit 2026-11-07, B02: findings SD-02, G4J-02, F04, NAME-06).
 *
 * Read as Googlebot on 2026-11-07, the 500 sitemap posting pages carried
 * JobPosting markup whose hiringOrganization was a Personio board's company
 * field ("https://www.deag.de/navi-bottom/investors/karriere.html?t=1"), an
 * ADP logo file's caption ("VHB Email Signature", "Group withMVSB wtag",
 * "CASES Gold+Coral+Burgundy BurgundyText"), or the board's own code as the
 * catalogue was handed it: 224 of the 500 came from employers with no company
 * page and no override, and four of those named the wrong company ("Starfish"
 * is Torch Technologies, "Stars" is Stars Behavioral Health Group). The data
 * tables printed raw keys ("ukg", "Rivhs").
 *
 * Now the name gate refuses a web address and a colour caption and counts more
 * image words; a posting whose name nobody wrote gets no NEW page (a carried
 * one keeps its page under D7, and B05's overrides name it); and the pay and
 * entry-level tables, in the app and the bake, print the name the board's
 * pages print and the vendor's own name for its system.
 *
 * THE CORPUS (the corpus-first rule). Every stored catalogue name, 44,523 on
 * 2026-11-08, was run through main's gate and this one
 * (~/.config/resumebooster/seo-connect-build/corpora/name-gate-catalogue-before-after-2026-11-08.json):
 * exactly fourteen moved from printable to refused, every one a URL or a logo
 * caption, and none main refused is printable now. The fixture below holds
 * the 380 real names nearest the new rules' shapes (domains, slashes, "Global",
 * two colours, "Signature", "Logos", "...Text"); none may be refused.
 */
import { describe, expect, it, vi } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { unpublishableNameReason } from "../../scripts/prerender-names.mjs";
import { postingFreshNameReason } from "../../scripts/prerender-posting-rule.mjs";
import { postingPoolWalksOn } from "../../scripts/prerender-pages.mjs";
import { POSTING_LD_TAG_ID, POSTING_PATH_PREFIX, postingNameVerdict, postingPathParts } from "@/components/jobs/posting-page";
import { isCodeShapedName, isUnreviewedTenantName } from "@/lib/company-display";
import { skipWithoutDist } from "./helpers/built-output";

const ROOT = resolve(__dirname, "../..");

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    functions: { invoke: async () => ({ data: {} }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));

import PayTransparencyIndex from "../pages/PayTransparencyIndex";
import EntryLevelIndex from "../pages/EntryLevelIndex";

describe("the name gate refuses the names seen on live markup", () => {
  it.each([
    ["https://www.deag.de/navi-bottom/investors/karriere.html?t=1", "web address"],
    ["https://hellofair.io/", "web address"],
    ["https://www.antenne-deutschland.de", "web address"],
    ["Coastal Systems TriShield Email Signature (1)", "logo or image text"],
    ["VHB Email Signature", "logo or image text"],
    ["Group withMVSB wtag", "logo or image text"],
    ["AVITA Health Systems unstacked", "logo or image text"],
    ["Klipboard No Strapline Full (1)", "logo or image text"],
    ["AH transparent (3)", "logo or image text"],
    ["CASES Gold+Coral+Burgundy BurgundyText", "colour caption"],
  ])("%s is refused as %s", (name, why) => {
    expect(unpublishableNameReason(name)).toBe(why);
  });
});

describe("the name gate never refuses a real employer's name (380 real catalogue names, read 2026-11-08)", () => {
  const fixture = JSON.parse(readFileSync(resolve(__dirname, "fixtures/employer-names-the-name-gate-keeps-2026-11-08.json"), "utf8")) as {
    names: Array<{ name: string; board: string; why: string }>;
  };

  it("holds at least 300 real names", () => {
    expect(fixture.names.length).toBeGreaterThanOrEqual(300);
  });

  it("refuses none of them", () => {
    const refused = fixture.names
      .map((n) => ({ ...n, reason: unpublishableNameReason(n.name) }))
      .filter((n) => n.reason !== null)
      .map((n) => `${n.board} "${n.name}": ${n.reason}`);
    expect(refused).toEqual([]);
  });

  it.each([
    "Booking.com", "Alarm.com", "HealthCareersInSask.ca", "Logo Brands", "Abt Global", "Gold Coast Health",
    "Signature Aviation", "Blue Cross Blue Shield of Arizona", "OpenText",
  ])("%s is a name", (name) => {
    expect(unpublishableNameReason(name)).toBeNull();
  });
});

const D = { postingNameVerdict, postingPathParts, isUnreviewedTenantName };
const row = (id: string, company: string) => ({ id, token: id.split(":")[1], company });

describe("a posting whose name nobody wrote gets no new page", () => {
  it.each([
    // Single-segment boards named by their token, title-cased (the audit's two).
    ["ashby:creatoriq:6a1", "Creatoriq"],
    ["ashby:harmattan-ai:fbf01ce6-af2c-4049-9fb2-f32eb28085a0", "Harmattan Ai"],
    // A Workday site whose tenant hosts several companies: only the one read
    // took a name (ebi~wd5~ebadcareers is Ensign-Bickford Aerospace & Defense).
    ["workday:ebi~wd5~afbcareers:R1", "Ebi"],
  ])("%s named %s", (id, company) => {
    expect(postingFreshNameReason(row(id, company), D)).toBe("unreviewed tenant name");
  });

  it("refuses a logo caption by the gate's own reason, not as unreviewed", () => {
    expect(postingFreshNameReason(row("adp:07372372-77a5-45e9-8573-f67327c3c3ec:9201", "Group withMVSB wtag"), D)).toBe("logo or image text");
  });

  it.each([
    // A name read on the employer's own site (REAL_TENANT_NAMES).
    ["workday:intel~wd1~External:JR1", "Intel", "Intel"],
    ["workday:chevron~wd5~ExternalCareerSite_Private:R1", "Chevron", "Chevron"],
    // A name someone wrote.
    ["workday:dollartree~wd5~dollartreeus:R-009515", "Dollar Tree", "Dollar Tree"],
    ["ashby:openai:1", "OpenAI", "OpenAI"],
    // The audit's "Atd" and "Starfish" carry their employers' names now (B05).
    ["workday:atd~wd1~American_Tire_Distributors:R1", "Atd", "American Tire Distributors"],
    ["workday:starfish~wd501~Careers:R1604", "Starfish", "Torch Technologies"],
  ])("%s named %s gets a page as %s", (id, company, printed) => {
    expect(postingFreshNameReason(row(id, company), D)).toBeNull();
    expect(postingNameVerdict(row(id, company)).name).toBe(printed);
  });

  it("takes a written spelling of the slug for a name, and leaves a company page the code it prints", () => {
    // "Liquid AI" was written; "Liquid Ai" is the slug title-cased.
    expect(isUnreviewedTenantName("liquid-ai", "Liquid AI")).toBe(false);
    expect(isUnreviewedTenantName("liquid-ai", "Liquid Ai")).toBe(true);
    // A tenant code a company page prints stays printable there (S11-013).
    expect(isCodeShapedName("ebi~wd5~afbcareers", "Ebi")).toBe(false);
  });
});

describe("the pool's walk reads more list pages only while the new pages cannot be filled", () => {
  const base = { pages: 20, maxPages: 30, rowCap: 1200, freshBudget: 400, budgetLeft: 600 };
  it("reads its usual pages", () => {
    expect(postingPoolWalksOn({ ...base, page: 0, rows: 0, selectable: 0 })).toBe(true);
    expect(postingPoolWalksOn({ ...base, page: 19, rows: 1140, selectable: 900 })).toBe(true);
  });
  it("stops at the row cap once the selectable rows fill the budget", () => {
    expect(postingPoolWalksOn({ ...base, page: 20, rows: 1200, selectable: 400 })).toBe(false);
  });
  it("reads on past the cap while they do not, to the page limit and inside the board reads", () => {
    expect(postingPoolWalksOn({ ...base, page: 20, rows: 1200, selectable: 399 })).toBe(true);
    expect(postingPoolWalksOn({ ...base, page: 30, rows: 1800, selectable: 399 })).toBe(false);
    expect(postingPoolWalksOn({ ...base, page: 20, rows: 1200, selectable: 399, budgetLeft: 400 })).toBe(false);
  });
  it("reads nothing when there are no new pages to write", () => {
    expect(postingPoolWalksOn({ ...base, page: 0, rows: 0, selectable: 0, freshBudget: 0 })).toBe(false);
  });
});

describe("the data tables print display names (bake)", () => {
  const src = readFileSync(resolve(ROOT, "scripts/prerender-seo.mjs"), "utf8");
  const slice = src.slice(src.indexOf("// >>> DATA-PAGE FIGURE BUILDER START"), src.indexOf("// <<< DATA-PAGE FIGURE BUILDER END"));
  const build = new Function(`${slice}; return dataPageFigures;`)() as (p: unknown) => Record<string, { html: string }>;
  const text = (h: string) => h.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  const T = {
    computed_at: "2026-11-08T06:37:00Z",
    pay: { overall: { pay_pct: 33, total: 1032138 }, categories: [], top_companies: [{ company: "Rivhs", company_token: "rivhs~wd1~ProviderRHS", pay_pct: 100, total: 900 }] },
    coverage: { overall: { mode_pct: 26.4 }, by_source: [{ source: "ukg", total: 900, pay_pct: 44, mode_pct: 70 }] },
  };

  it("prints the vendor's own name for a hiring system, given the bake's name map", async () => {
    const { systemLabel } = await import("@/lib/listing/apply-url");
    const { employerName } = await import("@/lib/company-display");
    const html = text(build({
      transparency: T,
      openTotal: 1022600,
      systemName: (s: string) => systemLabel(s) ?? s,
      companyName: (t: string, s: string) => employerName(t, s),
    }).pay.html);
    expect(html).toContain("UKG Pro Recruiting");
    expect(html).not.toMatch(/\bukg\b/);
    expect(html).toContain("Riverside Health");
    expect(html).not.toContain("Rivhs");
  });

  it("is handed both maps by the bake", () => {
    expect(src).toMatch(/systemName: \(source\) => D\.systemLabel\(source\) \?\? String\(source \?\? ""\)/);
    expect(src).toMatch(/companyName: \(token, stored\) => D\.employerName\(token, stored\)/);
  });
});

describe("the data tables print display names (app)", () => {
  it("/pay-transparency names the employer by its override and the system by the vendor's name", async () => {
    rpc.mockReset();
    rpc.mockImplementation((fn: string) => (fn === "get_transparency_cache"
      ? Promise.resolve({
        data: {
          pay: { categories: [], overall: { total: 5000, pay_pct: 38 }, top_companies: [{ company: "Denverhealth", company_token: "denverhealth~wd1~dhha-main", total: 80, pay_pct: 90 }] },
          coverage: { by_source: [{ source: "ukg", total: 900, pay_pct: 44, mode_pct: 70 }], overall: { total: 5000, pay_pct: 38, mode_n: 3000, mode_pct: 60 } },
          computed_at: "2026-11-08T01:37:00Z",
        },
        error: null,
      })
      : Promise.resolve({ data: null, error: { code: "42501" } })));
    const { container, unmount } = render(<MemoryRouter><PayTransparencyIndex /></MemoryRouter>);
    await waitFor(() => expect(container.textContent).toContain("Denver Health"));
    expect(container.textContent).not.toContain("Denverhealth");
    expect(container.textContent).toContain("UKG Pro Recruiting");
    expect([...container.querySelectorAll("td")].map((td) => td.textContent)).not.toContain("ukg");
    unmount();
  });

  it("/entry-level-index names the employer by its override", async () => {
    rpc.mockReset();
    rpc.mockImplementation((fn: string) => Promise.resolve(fn === "get_stats_cache"
      ? { data: { entry_stats: { total_entry: 5000, companies_with_entry: 300, remote_entry: 200, total_open: 90000, by_category: {} }, entry_companies: [{ company: "Cngholdingsinc", company_token: "cngholdingsinc~wd5~CNG", entry_roles: 63, open_roles: 63 }], computed_at: "2026-11-08T00:00:00Z", stale_parts: [] } }
      : { data: null }));
    const { container, unmount } = render(<HelmetProvider><MemoryRouter><EntryLevelIndex /></MemoryRouter></HelmetProvider>);
    await waitFor(() => expect(container.textContent).toContain("CNG Holdings"));
    expect(container.textContent).not.toContain("Cngholdingsinc");
    unmount();
  });
});

// THE BUILT PAGES: no sitemap posting's markup names its employer by a web
// address or by text the gate refuses.
const DIST = resolve(ROOT, "dist");
const sitemaps = existsSync(DIST) ? readdirSync(DIST).filter((f) => /^sitemap.*\.xml$/.test(f)) : [];
const built = existsSync(resolve(DIST, "index.html")) && sitemaps.length > 0;

describe.skipIf(skipWithoutDist(built))("the built posting pages' hiringOrganization", () => {
  it("never holds a web address, a logo caption or a colour caption", () => {
    const paths = new Set<string>();
    for (const f of sitemaps) {
      for (const m of readFileSync(resolve(DIST, f), "utf8").matchAll(/<loc>https:\/\/resumebooster\.work([^<]+)<\/loc>/g)) {
        if (m[1].startsWith(`${POSTING_PATH_PREFIX}/`)) paths.add(m[1]);
      }
    }
    const bad: string[] = [];
    const tag = new RegExp(`<script[^>]*id="${POSTING_LD_TAG_ID}"[^>]*>([\\s\\S]*?)</script>`);
    for (const p of paths) {
      const file = [resolve(DIST, `.${p}/index.html`), resolve(DIST, `.${p.replace(/\/$/, "")}.html`)].find((x) => existsSync(x));
      if (!file) continue;
      const m = tag.exec(readFileSync(file, "utf8"));
      if (!m) continue;
      const name = String((JSON.parse(m[1]) as { hiringOrganization?: { name?: string } }).hiringOrganization?.name ?? "");
      const why = name.includes("://") ? "web address" : unpublishableNameReason(name);
      if (why) bad.push(`${p}: "${name}" (${why})`);
    }
    expect(bad).toEqual([]);
  });
});
