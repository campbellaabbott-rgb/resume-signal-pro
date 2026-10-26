/**
 * THE KEYWORD PAGES SPELL AN ACRONYM AS ONE AND A WORD AS A WORD (SEO-019, S13-089).
 *
 * Live and baked on 2026-10-17: /roles/rn was titled "Rn Resume Keywords",
 * /roles/cpa "Cpa", /roles/vp-of-product "Vp Of Product", /industries/hr "Hr",
 * while keyword chips read "WIND", "SPAY", "MENU", "SOPS", "APIS", "RFIS".
 * And 41 sitemap pages shared a meta description with another page, because
 * the description named the page's own role or field only after a keyword
 * list long enough for the bake's 160-character clamp to cut it off.
 *
 * The bake reads ROLE_PAGES (src/data/roles.ts) for its role titles, so the
 * title assertions below hold the baked titles too.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { INDUSTRY_KEYWORDS } from "../../supabase/functions/free-keyword-scan/industry-detection";
import { ROLE_PAGES } from "@/data/roles";
import { displayKeyword, displayTitle, industryLabel, inSentence, PLAIN_WORDS } from "@/lib/seo/display-case";
import { industryKeywordsHead, roleKeywordsHead } from "@/lib/seo/keyword-pages";
import IndustryKeywords from "@/pages/IndustryKeywords";
import RoleKeywords from "@/pages/RoleKeywords";

/** A real acronym written as a word: "Rn", "Cpa", "Hr", "Vp", "Ui", "Ml", "Ai". */
const TITLE_CASED_ACRONYM = /\b(Rn|Cpa|Cmo|Hr|Vp|Ui|Ux|Ml|Ai|Soc|Tv|Bim|Hvac|Qa|It)\b/;

describe("role titles and industry labels", () => {
  it("print acronyms upper-case and little words lower-case", () => {
    expect(ROLE_PAGES.rn.title).toBe("RN");
    expect(ROLE_PAGES.cpa.title).toBe("CPA");
    expect(ROLE_PAGES.cmo.title).toBe("CMO");
    expect(ROLE_PAGES["hr-manager"].title).toBe("HR Manager");
    expect(ROLE_PAGES["vp-of-product"].title).toBe("VP of Product");
    expect(ROLE_PAGES["ui-designer"].title).toBe("UI Designer");
    expect(ROLE_PAGES["ml-engineer"].title).toBe("ML Engineer");
    expect(ROLE_PAGES["strength-and-conditioning-coach"].title).toBe("Strength and Conditioning Coach");
    expect(industryLabel("hr")).toBe("HR");
    expect(industryLabel("customer_success")).toBe("Customer Success");
  });

  it("no role title and no industry label writes an acronym as a word", () => {
    const titles = Object.values(ROLE_PAGES).map((r) => r.title).filter((t) => TITLE_CASED_ACRONYM.test(t));
    expect(titles).toEqual([]);
    const labels = Object.keys(INDUSTRY_KEYWORDS).map(industryLabel).filter((l) => TITLE_CASED_ACRONYM.test(l));
    expect(labels).toEqual([]);
  });

  it("keeps every one of the 174 role pages (no page dropped by the casing fix, D7)", () => {
    expect(Object.keys(ROLE_PAGES).length).toBe(174);
  });

  it("keeps an acronym inside a sentence and lower-cases the plain words", () => {
    expect(inSentence("HR Manager")).toBe("HR manager");
    expect(inSentence("Customer Success")).toBe("customer success");
    expect(inSentence(displayTitle("rn"))).toBe("RN");
  });
});

describe("keyword chips", () => {
  const shortTokens = new Set<string>();
  for (const d of Object.values(INDUSTRY_KEYWORDS)) {
    for (const k of [...new Set(d.primary)].slice(0, 24)) if (k.length <= 4 && !k.includes(" ")) shortTokens.add(k);
  }

  it("decide every short token the tables carry: an acronym, or a reviewed plain word", () => {
    const undecided = [...shortTokens].filter((k) => k !== "or" && displayKeyword(k) === k && !PLAIN_WORDS.has(k));
    expect(undecided, "a new short keyword needs a decision in src/lib/seo/display-case.ts").toEqual([]);
  });

  it("never print a plain word in capitals, and print plural acronyms with a lower-case s", () => {
    for (const w of ["wind", "spay", "menu", "code", "turf", "sod", "ore", "jet", "law", "lean", "aula", "grid"]) {
      expect(displayKeyword(w), w).toBe(w);
    }
    expect(displayKeyword("sops")).toBe("SOPs");
    expect(displayKeyword("apis")).toBe("APIs");
    expect(displayKeyword("rfis")).toBe("RFIs");
    expect(displayKeyword("icu")).toBe("ICU");
    expect(displayKeyword("or")).toBe("OR");
    expect(displayKeyword("ehr documentation")).toBe("EHR documentation");
  });
});

describe("the head of every keyword page", () => {
  const heads = [
    ...Object.entries(INDUSTRY_KEYWORDS).map(([slug, d]) => ({ path: `/industries/${slug}`, ...industryKeywordsHead(slug, [...new Set(d.primary)].slice(0, 24)) })),
    ...Object.values(ROLE_PAGES).map((r) => ({ path: `/roles/${r.slug}`, ...roleKeywordsHead(r.title, r.industry, [...new Set(INDUSTRY_KEYWORDS[r.industry].primary)].slice(0, 20)) })),
  ];

  it("has a description of at most 160 characters that names the page", () => {
    for (const h of heads) {
      expect(h.description.length, h.path).toBeLessThanOrEqual(160);
      expect(h.description.startsWith(`${h.name} resume keywords `), h.path).toBe(true);
    }
  });

  it("shares its description with no other page", () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const h of heads) {
      if (seen.has(h.description)) dupes.push(`${h.path} = ${seen.get(h.description)}`);
      seen.set(h.description, h.path);
    }
    expect(dupes).toEqual([]);
  });
});

describe("the React pages print through the same functions", () => {
  const at = (path: string, route: string, el: JSX.Element) =>
    render(
      <HelmetProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes><Route path={route} element={el} /></Routes>
        </MemoryRouter>
      </HelmetProvider>,
    );

  it("/roles/rn: the heading says RN and the head is the shared builder's", async () => {
    at("/roles/rn", "/roles/:slug", <RoleKeywords />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("RN Resume Keywords & ATS Expectations");
    const want = roleKeywordsHead("RN", ROLE_PAGES.rn.industry, [...new Set(INDUSTRY_KEYWORDS[ROLE_PAGES.rn.industry].primary)].slice(0, 20));
    await screen.findByText(/RN Resume Keywords/);
    await new Promise((r) => setTimeout(r, 0));
    expect(document.title).toBe(want.title);
    expect(document.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(want.description);
  });

  it("/industries/energy: no chip prints a plain word in capitals", () => {
    at("/industries/energy", "/industries/:slug", <IndustryKeywords />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/^Energy Resume Keywords/);
    const chips = [...document.querySelectorAll("main span")].map((s) => s.textContent ?? "");
    for (const w of ["WIND", "GRID", "RIG"]) expect(chips, w).not.toContain(w);
  });

  it("/industries/hr: the heading and the sentences say HR", () => {
    at("/industries/hr", "/industries/:slug", <IndustryKeywords />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("HR Resume Keywords & ATS Expectations");
    expect(document.body.textContent).toMatch(/to analyze HR resumes/);
    expect(document.body.textContent).not.toMatch(/\bhr resumes\b/);
  });
});
