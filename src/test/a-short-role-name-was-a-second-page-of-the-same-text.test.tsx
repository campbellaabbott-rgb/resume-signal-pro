/**
 * A SHORT NAME FOR A ROLE WAS A SECOND PAGE OF THE SAME TEXT (SEO check
 * 2026-11-15, F06).
 *
 * Every /roles page prints its field's lists, so two pages in one field differ
 * only where they name a role. Where the two names are one name, the pages are
 * one page: /roles/vet-tech and /roles/veterinary-technician served 250 words
 * each, 5-shingle Jaccard 1.0, both indexable, both self-canonical, both in the
 * sitemap. The check measured the same for rn, ml-engineer, ecommerce-manager
 * and lab-technician. A whole template of copies like that is what Search
 * Console reports as "Duplicate, Google chose different canonical".
 *
 * And an address with no role behind it was sent to /industries, a "not
 * found" that answers as a normal page (a soft 404).
 *
 * HOW THE PAIRS ARE FOUND HERE, NOT LISTED BY HAND. Every page is rendered and
 * its own name is set aside: the role's title and every title in its field's
 * table that is the same name written shorter (a word cut to its first three
 * or more letters, a run of words written as initials, a hyphen, another word
 * order). Two pages whose remaining text is identical are the same page. The
 * oracle below is written independently of src/data/roles.ts, so the data
 * file and this test have to agree about which pages those are.
 *
 * What this does not decide: two different roles in one field (plumber and
 * HVAC technician, software engineer and software developer) also print the
 * same lists. They are different names, so they are not collapsed here; what
 * to do with them waits on the Search Console duplicate list (F05).
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { INDUSTRY_KEYWORDS } from "../../supabase/functions/free-keyword-scan/industry-detection";
import { ROLE_PAGES, type RolePage } from "@/data/roles";
import RoleKeywords from "@/pages/RoleKeywords";
import IndustryKeywords from "@/pages/IndustryKeywords";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

vi.setConfig(MOUNT_TEST_BUDGET);

const SITE = "https://resumebooster.work";

// ---- the oracle: is one title the same name as another? ----
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();

/** Every way of writing a title shorter that still reads as that title. */
const shorterCache = new Map<string, Set<string>>();
function shorterSpellings(title: string): Set<string> {
  const key = norm(title);
  const hit = shorterCache.get(key);
  if (hit) return hit;
  const words = key.split(" ");
  const out = new Set<string>();
  const walk = (i: number, acc: string[]) => {
    if (i === words.length) {
      out.add(acc.join(" "));
      return;
    }
    const w = words[i];
    walk(i + 1, [...acc, w]);
    for (let k = 3; k < w.length; k++) walk(i + 1, [...acc, w.slice(0, k)]);
    for (let n = 2; i + n <= words.length; n++) walk(i + n, [...acc, words.slice(i, i + n).map((x) => x[0]).join("")]);
  };
  walk(0, []);
  out.delete(key);
  shorterCache.set(key, out);
  return out;
}

function oneName(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (x.replace(/ /g, "") === y.replace(/ /g, "")) return true;
  if (x.split(" ").sort().join(" ") === y.split(" ").sort().join(" ")) return true;
  return shorterSpellings(y).has(x) || shorterSpellings(x).has(y);
}

/** The role's own name as its field's table spells it, every way. */
function spellingsOf(role: RolePage): string[] {
  const titles = [role.title, ...INDUSTRY_KEYWORDS[role.industry].titles.filter((t) => oneName(t, role.title))];
  return [...new Set(titles.map((t) => t.toLowerCase()))].sort((a, b) => b.length - a.length);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A page's text with its own name, every spelling of it, set aside. */
function withNameSetAside(text: string, role: RolePage): string {
  let out = text;
  for (const s of spellingsOf(role)) out = out.replace(new RegExp(`(?<![a-z0-9])${escapeRe(s)}(?![a-z0-9])`, "gi"), "<role>");
  return out;
}

// ---- rendering ----
function mount(path: string, route: string, el: JSX.Element) {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={el} />
          <Route path="/industries" element={<p>industries index</p>} />
        </Routes>
      </MemoryRouter>
    </HelmetProvider>,
  );
}

/** The text in a page's <main>, one space between text nodes. */
function mainText(container: HTMLElement): string {
  const main = container.querySelector("main");
  if (!main) return "";
  const parts: string[] = [];
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.textContent ?? "");
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

let rendered: Map<string, { text: string; links: string[] }> | null = null;
function renderAll() {
  if (rendered) return rendered;
  rendered = new Map();
  for (const role of Object.values(ROLE_PAGES)) {
    const { container, unmount } = mount(`/roles/${role.slug}`, "/roles/:slug", <RoleKeywords />);
    const links = [...container.querySelectorAll("main a[href^='/roles/']")].map((a) => a.getAttribute("href") ?? "");
    rendered.set(role.slug, { text: withNameSetAside(mainText(container), role), links });
    unmount();
  }
  return rendered;
}

const deferTo = (slug: string) => (ROLE_PAGES[slug] as RolePage & { canonicalSlug?: string }).canonicalSlug;

describe("the oracle", () => {
  it("reads the pairs the check measured as one name, and two different roles as two", () => {
    for (const [a, b] of [
      ["RN", "registered nurse"],
      ["Vet Tech", "veterinary technician"],
      ["ML Engineer", "machine learning engineer"],
      ["Ecommerce Manager", "e-commerce manager"],
      ["Lab Technician", "laboratory technician"],
      ["project manager construction", "construction project manager"],
    ]) expect(oneName(a, b), `${a} / ${b}`).toBe(true);
    for (const [a, b] of [
      ["captain", "ship captain"],
      ["HVAC Technician", "plumber"],
      ["software engineer", "software developer"],
      ["software engineer", "full stack developer"],
      ["CPA", "accountant"],
      ["telecom technician", "telecommunications engineer"],
      ["mine manager", "mining engineer"],
      ["AI Engineer", "ML Engineer"],
    ]) expect(oneName(a, b), `${a} / ${b}`).toBe(false);
  });
});

describe("a role page whose text is another's once its own name is set aside", () => {
  it("keeps every one of the 174 role pages (a deferring page still renders)", () => {
    expect(Object.keys(ROLE_PAGES).length).toBe(174);
  });

  it("defers to the one page of its group that stays indexable, and no two indexable pages are left alike", () => {
    const pages = renderAll();
    const byText = new Map<string, string[]>();
    for (const [slug, { text }] of pages) byText.set(text, [...(byText.get(text) ?? []), slug]);
    const groups = [...byText.values()].filter((g) => g.length > 1);
    // the check's five measured pairs are among what rendering finds
    const pairOf = (slug: string) => groups.find((g) => g.includes(slug)) ?? [];
    expect(pairOf("vet-tech")).toContain("veterinary-technician");
    expect(pairOf("rn")).toContain("registered-nurse");
    expect(pairOf("ml-engineer")).toContain("machine-learning-engineer");
    expect(pairOf("ecommerce-manager")).toContain("e-commerce-manager");
    expect(pairOf("lab-technician")).toContain("laboratory-technician");

    const leftAlike: string[] = [];
    const wrongTarget: string[] = [];
    for (const g of groups) {
      const indexable = g.filter((s) => !deferTo(s));
      if (indexable.length !== 1) leftAlike.push(`${g.join(" = ")} (indexable: ${indexable.join(", ") || "none"})`);
      for (const s of g) if (deferTo(s) && deferTo(s) !== indexable[0]) wrongTarget.push(`${s} -> ${deferTo(s)}`);
    }
    expect(leftAlike, "pages that render the same text with more than one of them indexable").toEqual([]);
    expect(wrongTarget).toEqual([]);

    // and nothing defers that renders text of its own: a canonical names a copy, never a different page
    const deferredApart = Object.values(ROLE_PAGES)
      .filter((r) => deferTo(r.slug))
      .filter((r) => pages.get(r.slug)?.text !== pages.get(deferTo(r.slug)!)?.text)
      .map((r) => `${r.slug} -> ${deferTo(r.slug)}`);
    expect(deferredApart).toEqual([]);
  });

  it("a short name defers to the full name, in its own field, and never through a second page", () => {
    expect(deferTo("vet-tech")).toBe("veterinary-technician");
    expect(deferTo("rn")).toBe("registered-nurse");
    expect(deferTo("ml-engineer")).toBe("machine-learning-engineer");
    expect(deferTo("lab-technician")).toBe("laboratory-technician");
    for (const full of ["veterinary-technician", "registered-nurse", "machine-learning-engineer", "laboratory-technician"]) expect(deferTo(full), full).toBeUndefined();
    // spellings of equal length: exactly one of the two defers
    expect([deferTo("ecommerce-manager"), deferTo("e-commerce-manager")].filter(Boolean)).toHaveLength(1);
    // two different roles, and the two captains of two different fields, stay their own pages
    for (const slug of ["captain", "ship-captain", "hvac-technician", "plumber", "software-engineer", "software-developer", "full-stack-developer", "cpa", "accountant", "ai-engineer"]) {
      expect(deferTo(slug), slug).toBeUndefined();
    }
    for (const role of Object.values(ROLE_PAGES)) {
      const to = deferTo(role.slug);
      if (!to) continue;
      expect(ROLE_PAGES[to], `${role.slug} -> ${to}`).toBeDefined();
      expect(ROLE_PAGES[to].industry, `${role.slug} -> ${to}`).toBe(role.industry);
      expect(deferTo(to), `${role.slug} -> ${to} -> ${deferTo(to)}`).toBeUndefined();
    }
  });
});

describe("what the rendered head says", () => {
  const head = async (slug: string) => {
    const view = mount(`/roles/${slug}`, "/roles/:slug", <RoleKeywords />);
    await new Promise((r) => setTimeout(r, 0));
    const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute("href");
    const robots = [...document.querySelectorAll('meta[name="robots"]')].map((m) => m.getAttribute("content"));
    view.unmount();
    return { canonical, robots };
  };

  it("a deferring page names its full-name page as canonical, without noindex; the full-name page names itself", async () => {
    expect(await head("vet-tech")).toEqual({ canonical: `${SITE}/roles/veterinary-technician`, robots: [] });
    expect(await head("rn")).toEqual({ canonical: `${SITE}/roles/registered-nurse`, robots: [] });
    expect(await head("veterinary-technician")).toEqual({ canonical: `${SITE}/roles/veterinary-technician`, robots: [] });
    expect(await head("plumber")).toEqual({ canonical: `${SITE}/roles/plumber`, robots: [] });
  });

  it("an address with no role page renders the not-found page, marked noindex, at its own address", async () => {
    const view = mount("/roles/no-such-role-at-all", "/roles/:slug", <RoleKeywords />);
    await new Promise((r) => setTimeout(r, 0));
    expect(view.container.textContent).not.toContain("industries index");
    expect(view.container.textContent).toContain("Page not found");
    expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex");
    view.unmount();
    // and the mark leaves with the page, so the next page is not carried out of the index
    expect(document.querySelector('meta[name="robots"]')).toBeNull();
  });
});

describe("links between keyword pages", () => {
  const deferring = new Set(Object.values(ROLE_PAGES).filter((r) => deferTo(r.slug)).map((r) => `/roles/${r.slug}`));

  it("no role page links a page that defers to another", () => {
    const pages = renderAll();
    const bad: string[] = [];
    for (const [slug, { links }] of pages) for (const href of links) if (deferring.has(href)) bad.push(`/roles/${slug} -> ${href}`);
    expect(deferring.size).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });

  it("no industry page links a page that defers to another", () => {
    const bad: string[] = [];
    const fields = new Set(Object.values(ROLE_PAGES).filter((r) => deferTo(r.slug)).map((r) => r.industry));
    expect(fields.size).toBeGreaterThan(0);
    for (const industry of fields) {
      const { container, unmount } = mount(`/industries/${industry}`, "/industries/:slug", <IndustryKeywords />);
      for (const a of container.querySelectorAll("main a[href^='/roles/']")) {
        const href = a.getAttribute("href") ?? "";
        if (deferring.has(href)) bad.push(`/industries/${industry} -> ${href}`);
      }
      unmount();
    }
    expect(bad).toEqual([]);
  });
});
