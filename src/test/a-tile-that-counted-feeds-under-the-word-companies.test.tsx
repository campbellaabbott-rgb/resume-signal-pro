// A TILE THAT COUNTED FEEDS UNDER THE WORD "COMPANIES".
//
// Four claim-drift defects, each a label that stopped describing the number or
// the action under it.
//
// ── 1. /ghost-job-index "companies, each from its own feed" (trace, major) ──
//
// The tile printed ghost_stats.total_companies = count(DISTINCT company_token)
// — feed tokens, i.e. BOARDS. One employer runs several (PwC ships five Workday
// sub-sites; 76 such employers in the top 1,500 alone), so the figure
// overstated employers by every sub-board, under a caption that said
// "companies". total_company_names — count(DISTINCT company), boards merged by
// the raw company string exactly as get_size_segments merges — was in the same
// payload, counted in the same statement, and read by nothing on this page.
//
// DECISION: switch the tile to total_company_names and caption the population
// (a posting the board has not withdrawn — the same predicate as the open-roles
// tile beside it), rather than adding a 30-day fence to refresh_ghost_stats by
// migration. The fence would have put this ONE tile on a different predicate
// from its neighbour, and "no migrations unless item 6 chooses one" is the
// cheaper of two honest answers. A cache row written before the column existed
// prints no number rather than the larger one.
//
// ── 2. /companies rows linked the primary token only (trace, minor) ──────────
//
// A row carrying `tokens` shows `open` SUMMED across the group, and linked
// /jobs?company=<primary> — a number the destination could not serve. The
// link now takes the whole group, the same contract scopeTokensOf keeps on
// /jobs, and the pure scope function is walked here.
//
// ONE SIZE CLASS UP: the /jobs lander keeps at most 12 tokens of that list
// (companyTokens .slice(0, 12)), and mergeCompanyFacet folds without a bound,
// so a group past 12 would print its whole sum above a link the lander cuts —
// the same sum-vs-served mismatch, moved from 1 token to 12. The cap now lives
// in src/lib/company-scope.ts, /companies cuts the link there and withholds the
// figure for a cut group, and a mirror test holds Jobs.tsx's literal to it.
//
// ── 3. The hero's "Rank them to my resume" (trace, minor) ───────────────────
//
// Promised a ranking the click could not deliver: /jobs ranks nothing until a
// résumé is dropped on it, and the button did not say so. The label now says
// what happens. New key (rankCta2), because the meaning changed.
//
// ── 4. jobsPage.welcomeFillers (item 9, deferred from the control fix) ──────
//
// The welcome panel's middle button reuses hiringFilter2 and sets the filter
// it names, so "Companies that fill roles" is called by nothing. An orphan key
// in nine locales is a sentence waiting to be re-rendered by someone who does
// not know why it left; it is gone from all nine.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const invoke = vi.fn();
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: (...a: unknown[]) => rpc(...a),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
function stubTable() {
  const th: Record<string, unknown> = {};
  const self = () => th;
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in"]) th[k] = self;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}
import GhostJobIndex from "../pages/GhostJobIndex";
import Companies, { companyLinkScope, companyRowScope } from "../pages/Companies";
import { COMPANY_SCOPE_MAX } from "../lib/company-scope";

const ROOT = resolve(__dirname, "../..");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const GHOST = strip(readFileSync(resolve(ROOT, "src/pages/GhostJobIndex.tsx"), "utf8"));
const COMPANIES = strip(readFileSync(resolve(ROOT, "src/pages/Companies.tsx"), "utf8"));
const HERO = strip(readFileSync(resolve(ROOT, "src/components/JobBoardHero.tsx"), "utf8"));
const JOBS = strip(readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8"));
const LOCALES = resolve(ROOT, "src/i18n/locales");
const LOCALE_FILES = readdirSync(LOCALES).filter((f) => f.endsWith(".json")).sort();
const locale = (f: string) => JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")) as Record<string, Record<string, unknown>>;
const SLOW = { timeout: 4000 } as const;

describe("1. the ghost index tile counts employers, and says so", () => {
  beforeEach(() => { rpc.mockReset(); invoke.mockReset(); });

  function mountGhost(stats: Record<string, unknown>) {
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "get_stats_cache") return { data: null };
      if (fn === "get_ghost_job_index_stats") return { data: [stats] };
      if (fn === "get_actively_hiring_companies") return { data: [] };
      return { data: [] };
    });
    return render(<MemoryRouter><GhostJobIndex /></MemoryRouter>);
  }
  /** The number rendered directly above the employers caption. */
  const employersTile = () => {
    const cap = Array.from(document.querySelectorAll("div")).find((d) => (d.textContent ?? "").trim().startsWith("employers with an open posting"));
    return cap?.previousElementSibling?.textContent ?? null;
  };

  it("behaviour: prints total_company_names, not the feed-token count beside it", async () => {
    mountGhost({ total_open: 1000, total_companies: 50, total_company_names: 42, closed_90d: 200, median_days_open: 9, median_days_to_close: null, observed_days: 60 });
    await waitFor(() => expect(employersTile()).toBe("42"), SLOW);
  });

  it("behaviour: a cache row without the column prints no number — never the larger one", async () => {
    mountGhost({ total_open: 1000, total_companies: 50, closed_90d: 200, median_days_open: 9, median_days_to_close: null, observed_days: 60 });
    await waitFor(() => expect(employersTile()).not.toBeNull(), SLOW);
    await waitFor(() => expect(employersTile()).toBe("—"), SLOW);
  });

  it("source: the feed-token count is rendered nowhere, and the caption names the population", () => {
    expect(GHOST).not.toMatch(/fmt\(stats\?\.total_companies\)/);
    expect(GHOST).toMatch(/fmt\(stats\?\.total_company_names\)/);
    expect(GHOST).not.toContain("companies, each from its own feed");
    expect(GHOST).toMatch(/employers with an open posting/);
    expect(GHOST, "boards merged by name — the rule get_size_segments shares").toMatch(/boards merged by name/);
  });
});

describe("2. a /companies row links the scope its number was summed over", () => {
  beforeEach(() => { rpc.mockReset(); invoke.mockReset(); });

  it("walk: the group when the server sent one, the single token otherwise", () => {
    expect(companyLinkScope({ token: "pwc-us", tokens: ["pwc-us", "pwc-uk", "pwc-de"] })).toEqual(["pwc-us", "pwc-uk", "pwc-de"]);
    expect(companyLinkScope({ token: "acme" })).toEqual(["acme"]);
    // A one-element list is not a group.
    expect(companyLinkScope({ token: "acme", tokens: ["acme"] })).toEqual(["acme"]);
    expect(companyLinkScope({ token: "acme", tokens: [] })).toEqual(["acme"]);
  });

  it("behaviour: the rendered href carries every token of the group, comma-joined as the board reads it", async () => {
    rpc.mockImplementation(async () => ({ data: [] }));
    invoke.mockImplementation(async () => ({
      data: {
        companies: [
          { token: "pwc-us", name: "PwC", open: 500, tokens: ["pwc-us", "pwc-uk"] },
          { token: "acme", name: "Acme", open: 12 },
        ],
        companiesOpenCount: 2,
      },
    }));
    render(<MemoryRouter><Companies /></MemoryRouter>);
    await waitFor(() => expect(document.body.textContent).toContain("PwC"), SLOW);
    const hrefs = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");
    expect(hrefs).toContain("/jobs?company=pwc-us%2Cpwc-uk");
    expect(hrefs, "the primary token alone links a number the destination cannot serve").not.toContain("/jobs?company=pwc-us");
    expect(hrefs).toContain("/jobs?company=acme");
    expect(document.body.textContent).toContain("500 open roles");
  });

  it("walk: a group past the lander's cap links what the lander keeps, and its figure is not the link's", () => {
    const big = Array.from({ length: COMPANY_SCOPE_MAX + 3 }, (_, i) => `mega-${i}`);
    const r = companyRowScope({ token: "mega-0", tokens: big });
    expect(r.tokens).toEqual(big.slice(0, COMPANY_SCOPE_MAX));
    expect(r.complete, "a cut group must say it was cut").toBe(false);
    expect(companyLinkScope({ token: "mega-0", tokens: big })).toHaveLength(COMPANY_SCOPE_MAX);
    // Exactly at the cap is whole.
    const atCap = big.slice(0, COMPANY_SCOPE_MAX);
    expect(companyRowScope({ token: "mega-0", tokens: atCap })).toEqual({ tokens: atCap, complete: true });
    expect(companyRowScope({ token: "acme" })).toEqual({ tokens: ["acme"], complete: true });
  });

  it("behaviour: a group past the cap prints its name and no figure; a group inside it prints both", async () => {
    const big = Array.from({ length: COMPANY_SCOPE_MAX + 1 }, (_, i) => `mega-${i}`);
    rpc.mockImplementation(async () => ({ data: [] }));
    invoke.mockImplementation(async () => ({
      data: {
        companies: [
          { token: "mega-0", name: "MegaCorp", open: 9001, tokens: big },
          { token: "pwc-us", name: "PwC", open: 500, tokens: ["pwc-us", "pwc-uk"] },
        ],
        companiesOpenCount: 2,
      },
    }));
    render(<MemoryRouter><Companies /></MemoryRouter>);
    await waitFor(() => expect(document.body.textContent).toContain("MegaCorp"), SLOW);
    expect(document.body.textContent).toContain("500 open roles");
    expect(document.body.textContent, "a sum over 13 boards above a link that serves 12").not.toContain("9,001");
    const hrefs = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");
    const mega = hrefs.find((h) => h.startsWith("/jobs?company=mega-0"));
    expect(mega).toBeDefined();
    expect(decodeURIComponent(mega!.slice("/jobs?company=".length)).split(",")).toEqual(big.slice(0, COMPANY_SCOPE_MAX));
    // The figure is gated on the scope being whole — in the source, not only
    // in this one render.
    expect(COMPANIES).toMatch(/typeof c\.open === "number" && companyRowScope\(c\)\.complete/);
  });

  it("mirror: the cap /companies cuts at is the cap the /jobs lander keeps and the typeahead refuses past", () => {
    // Jobs.tsx spells the literal (an older guard pins that spelling); this
    // holds the spelling to the shared constant so the two cannot drift.
    const lander = JOBS.match(/const companyTokens = useMemo\(\s*\(\) => company\.split\(","\)\.map\(\(s\) => s\.trim\(\)\)\.filter\(Boolean\)\.slice\(0, (\d+)\)/);
    expect(lander, "the lander's companyTokens cap").not.toBeNull();
    expect(Number(lander![1])).toBe(COMPANY_SCOPE_MAX);
    const group = JOBS.match(/if \(tokens\.length \+ add\.length > (\d+)\) return prev;/);
    expect(group, "toggleCompanyGroup's refusal at the cap").not.toBeNull();
    expect(Number(group![1])).toBe(COMPANY_SCOPE_MAX);
    const single = JOBS.match(/if \(tokens\.length >= (\d+)\) return prev;/);
    expect(single, "toggleCompanyToken's refusal at the cap").not.toBeNull();
    expect(Number(single![1])).toBe(COMPANY_SCOPE_MAX);
  });

  it("source: the link is built from the scope, not from c.token", () => {
    expect(COMPANIES).toMatch(/company=\$\{encodeURIComponent\(companyLinkScope\(c\)\.join\(","\)\)\}/);
    expect(COMPANIES).not.toMatch(/company=\$\{encodeURIComponent\(c\.token\)\}/);
    // And the wire shape admits the group, so tsc sees the read.
    expect(COMPANIES).toMatch(/tokens\?: string\[\]/);
  });
});

describe("3. the hero's second CTA says what happens", () => {
  it("calls rankCta2, and the English locales carry it; rankCta is called nowhere and lives in no locale", () => {
    expect(HERO).toMatch(/t\("boardHero\.rankCta2"/);
    expect(HERO).not.toMatch(/t\("boardHero\.rankCta"/);
    for (const f of ["en.json", "en-GB.json"]) {
      const s = String(locale(f).boardHero?.rankCta2 ?? "");
      expect(s, `${f} lacks boardHero.rankCta2`).not.toBe("");
      // The label names the action the click actually leads to.
      expect(s.toLowerCase()).toMatch(/drop/);
    }
    // en-GB says CV where en says resume — the one variance that file exists for.
    expect(String(locale("en-GB.json").boardHero.rankCta2)).toMatch(/\bCV\b/);
    for (const f of LOCALE_FILES) expect("rankCta" in (locale(f).boardHero ?? {}), `${f} carries a retired boardHero.rankCta`).toBe(false);
  });
});

describe("4. jobsPage.welcomeFillers is retired everywhere", () => {
  it("called by nothing, present in no locale; the panel's button sets the filter it names", () => {
    expect(JOBS).not.toMatch(/jobsPage\.welcomeFillers/);
    for (const f of LOCALE_FILES) expect("welcomeFillers" in locale(f).jobsPage, `${f} still carries jobsPage.welcomeFillers`).toBe(false);
    const i = JOBS.indexOf('trackBoard("welcome_actively_hiring")');
    expect(i).toBeGreaterThan(0);
    const btn = JOBS.slice(i, i + 500);
    expect(btn).toMatch(/setActivelyHiringOnly\(true\)/);
    expect(btn).toMatch(/jobsPage\.hiringFilter2/);
  });
});
