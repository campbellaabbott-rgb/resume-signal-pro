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
import { afterAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { INDUSTRY_KEYWORDS } from "../../supabase/functions/free-keyword-scan/industry-detection";
import { ROLE_PAGES, sameRoleName, type RolePage } from "@/data/roles";
import RoleKeywords from "@/pages/RoleKeywords";
import IndustryKeywords from "@/pages/IndustryKeywords";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

vi.setConfig(MOUNT_TEST_BUDGET);

const SITE = "https://resumebooster.work";

// ---- the oracle: is one title the same name as another? ----
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
/**
 * What is left of a word when its start is cut off as a short form. A word
 * plus an ordinary ending is another word, not the same word written shorter:
 * "product" and "production", "account" and "accounting" (review of
 * 2026-11-15). A plural is the same word ("contract manager", "contracts
 * manager"). Written here independently of src/data/roles.ts.
 */
const ENDINGS = ["ed", "er", "ers", "or", "ors", "ing", "ings", "ion", "ions", "ation", "ations", "al", "als", "ally", "ant", "ants", "ent", "ents", "ist", "ists", "ive", "ives", "ity", "ivity", "ment", "ments", "ance", "ence", "ic", "ics", "ical", "y", "ly", "ship"];
const cutIsShortForm = (whole: string, k: number) => !ENDINGS.includes(whole.slice(k));

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
    for (let k = 3; k < w.length; k++) if (cutIsShortForm(w, k)) walk(i + 1, [...acc, w.slice(0, k)]);
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
      // A word and the same word with an ordinary ending are two words.
      ["Product Manager", "Production Manager"],
      ["Account Manager", "Accounting Manager"],
      ["Market Analyst", "Marketing Analyst"],
      ["Design Engineer", "Designer Engineer"],
    ]) expect(oneName(a, b), `${a} / ${b}`).toBe(false);
  });
});

describe("the data file's own test of one name", () => {
  it("agrees with the oracle on the pairs it was built for", () => {
    for (const [a, b] of [
      ["RN", "registered nurse"],
      ["Vet Tech", "veterinary technician"],
      ["ML Engineer", "machine learning engineer"],
      ["Ecommerce Manager", "e-commerce manager"],
      ["Lab Technician", "laboratory technician"],
      ["Admin Assistant", "administrative assistant"],
      ["project manager construction", "construction project manager"],
    ]) expect(sameRoleName(a, b), `${a} / ${b}`).toBe(true);
  });

  it("never reads a word and the same word with an ordinary ending as one name (Product Manager and Production Manager are two roles)", () => {
    for (const [a, b] of [
      ["Product Manager", "Production Manager"],
      ["Account Manager", "Accounting Manager"],
      ["Market Analyst", "Marketing Analyst"],
      ["Design Engineer", "Designer Engineer"],
      ["captain", "ship captain"],
      ["software engineer", "software developer"],
    ]) {
      expect(sameRoleName(a, b), `${a} / ${b}`).toBe(false);
      expect(oneName(a, b), `${a} / ${b}`).toBe(false);
    }
  });

  it("agrees with the oracle on every pair of titles any field's table lists", () => {
    const disagree: string[] = [];
    for (const [field, data] of Object.entries(INDUSTRY_KEYWORDS)) {
      const titles = [...new Set(data.titles)];
      for (let i = 0; i < titles.length; i++) {
        for (let j = i + 1; j < titles.length; j++) {
          if (sameRoleName(titles[i], titles[j]) !== oneName(titles[i], titles[j])) disagree.push(`${field}: ${titles[i]} / ${titles[j]}`);
        }
      }
    }
    expect(disagree).toEqual([]);
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

/**
 * THE CANONICAL THE BAKE WRITES FOR A ROLE PAGE, read from its roles section
 * (scripts/prerender-seo.mjs, "/roles/:slug" up to "/vs/:slug"): true when its
 * write() call passes a canonical built from the role's canonicalSlug. Google's
 * JavaScript SEO guide asks that script never set a canonical other than the
 * one in the served HTML (review of 2026-11-15, F06), so the React page names
 * the full-name page exactly when the bake does. Both halves landed together
 * (SEO audit 2026-11-18, CONTENT-2): the bake names it, and so does the page.
 */
function bakeNamesRoleCanonical(): boolean {
  const src = readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8");
  const from = src.indexOf("// ---- /roles/:slug");
  const to = src.indexOf("// ---- /vs/:slug", from);
  expect(from, "the bake's roles section is where this guard reads it").toBeGreaterThan(-1);
  expect(to, "the bake's roles section ends where this guard reads it").toBeGreaterThan(from);
  const block = src.slice(from, to);
  const write = block.slice(block.indexOf("write({"));
  return /\bcanonical\s*:[^\n]*canonicalSlug/.test(write);
}

describe("what the rendered head says", () => {
  const head = async (slug: string) => {
    const view = mount(`/roles/${slug}`, "/roles/:slug", <RoleKeywords />);
    await new Promise((r) => setTimeout(r, 0));
    const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute("href");
    const robots = [...document.querySelectorAll('meta[name="robots"]')].map((m) => m.getAttribute("content"));
    view.unmount();
    return { canonical, robots };
  };

  it("every short-name role page names the full-name page as its canonical, as its baked file does", async () => {
    expect(bakeNamesRoleCanonical(), "the bake's /roles write() passes a canonical built from canonicalSlug").toBe(true);
    const short = Object.values(ROLE_PAGES).filter((r) => deferTo(r.slug));
    expect(short.map((r) => r.slug).sort()).toEqual(["admin-assistant", "e-commerce-manager", "hr-manager", "lab-technician", "ml-engineer", "project-manager-construction", "rn", "vet-tech"]);
    const wrong: string[] = [];
    for (const r of short) {
      const want = `${SITE}/roles/${deferTo(r.slug)}`;
      const got = await head(r.slug);
      if (got.canonical !== want || got.robots.length) wrong.push(`/roles/${r.slug}: canonical ${got.canonical}, robots ${got.robots.join(",") || "none"}; want ${want}`);
    }
    expect(wrong).toEqual([]);
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

/**
 * THE SERVED FILES (SEO audit 2026-11-18, CONTENT-2): an offline bake writes
 * every role page, so the short name's canonical, the sitemap, the links
 * between keyword pages and the llms files' count are read from the files a
 * crawler is served, not from the source.
 *
 * The bake is handed the llms.txt 9c9234e9a committed ("Role keyword pages
 * (174)"), not this branch's: a bake of a file already saying 166 serves 166
 * whether or not the bake restates the count (lane A review, 2026-11-18).
 */
const COMMITTED_LLMS = readFileSync(resolve(__dirname, "../../public/llms.txt"), "utf8");
/** A line no restatement touches: the served file carries it only if the bake read the stale copy. */
const SEEDED = "Seeded stale copy, lane A review 2026-11-18.";
const STALE_LLMS = `${COMMITTED_LLMS.replace(/Role keyword pages \(\d+\)/, "Role keyword pages (174)")}\n${SEEDED}\n`;

describe("the baked role pages", () => {
  let OUT = "";
  const bake = () => {
    if (OUT) return join(OUT, "dist");
    OUT = mkdtempSync(join(tmpdir(), "roles-canonical-"));
    mkdirSync(join(OUT, "dist"), { recursive: true });
    mkdirSync(join(OUT, "public"), { recursive: true });
    writeFileSync(join(OUT, "public", "llms.txt"), STALE_LLMS);
    copyFileSync(resolve(__dirname, "../../index.html"), join(OUT, "dist", "index.html"));
    execFileSync("node", [resolve(__dirname, "../../scripts/prerender-seo.mjs")], {
      cwd: resolve(__dirname, "../.."),
      env: { ...process.env, PRERENDER_OUT: OUT, PRERENDER_OFFLINE: "1", VITE_SUPABASE_URL: "", VITE_SUPABASE_PUBLISHABLE_KEY: "" },
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
    return join(OUT, "dist");
  };
  afterAll(() => {
    if (OUT && OUT.startsWith(tmpdir())) rmSync(OUT, { recursive: true, force: true });
  });
  const canonicalOf = (html: string) => (/<link rel="canonical" href="([^"]+)"/.exec(html) || [])[1];

  it("a short name's baked page names the full-name page; the full name names itself", () => {
    const dist = bake();
    for (const r of Object.values(ROLE_PAGES)) {
      const file = join(dist, "roles", r.slug, "index.html");
      expect(existsSync(file), file).toBe(true);
      expect(canonicalOf(readFileSync(file, "utf8")), r.slug).toBe(`${SITE}/roles/${deferTo(r.slug) ?? r.slug}`);
    }
    expect(canonicalOf(readFileSync(join(dist, "roles", "rn", "index.html"), "utf8"))).toBe(`${SITE}/roles/registered-nurse`);
  }, 120_000);

  it("the sitemap lists the 166 role pages that name themselves, and none that defers", () => {
    const dist = bake();
    const locs = [...readFileSync(join(dist, "sitemap.xml"), "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    const roles = locs.filter((l) => l.startsWith(`${SITE}/roles/`));
    expect(roles).toHaveLength(166);
    for (const r of Object.values(ROLE_PAGES)) expect(roles.includes(`${SITE}/roles/${r.slug}`), r.slug).toBe(!deferTo(r.slug));
  }, 120_000);

  it("no baked role or industry page links a role page that defers to another", () => {
    const dist = bake();
    const deferring = new Set(Object.values(ROLE_PAGES).filter((r) => deferTo(r.slug)).map((r) => r.slug));
    expect(deferring.size).toBe(8);
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".html") ? [join(dir, e.name)] : []));
    const pages = [...files(join(dist, "roles")), ...files(join(dist, "industries"))];
    // every role page and every industry page, each read
    expect(pages.filter((f) => f.endsWith(`${join("roles", "registered-nurse", "index.html")}`))).toHaveLength(1);
    expect(pages.filter((f) => f.endsWith(`${join("industries", "healthcare", "index.html")}`))).toHaveLength(1);
    let linksRead = 0;
    const bad: string[] = [];
    for (const f of pages) {
      for (const m of readFileSync(f, "utf8").matchAll(/<a\b[^>]*\shref="(?:https:\/\/resumebooster\.work)?\/roles\/([a-z0-9-]+)\/?(?:[?#][^"]*)?"/g)) {
        linksRead++;
        if (deferring.has(m[1])) bad.push(`${f.slice(dist.length)} -> /roles/${m[1]}`);
      }
    }
    expect(linksRead, "the baked pages link role pages at all").toBeGreaterThan(500);
    expect(bad).toEqual([]);
  }, 120_000);

  it("the llms files count the 166 role pages an engine can cite, from a stale llms.txt too", () => {
    expect(STALE_LLMS, "the bake is handed the old count").toContain("Role keyword pages (174)");
    const dist = bake();
    expect(readFileSync(join(dist, "llms.txt"), "utf8"), "the bake read the stale copy").toContain(SEEDED);
    for (const f of ["llms.txt", "llms-full.txt"]) {
      const text = readFileSync(join(dist, f), "utf8");
      expect(text, f).toContain("Role keyword pages (166)");
      expect(text, f).not.toMatch(/Role keyword pages \((?!166\))\d+\)/);
    }
    expect(COMMITTED_LLMS, "the committed public/llms.txt").toContain("Role keyword pages (166)");
  }, 120_000);
});
