import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";

/**
 * WHAT WAS WRONG (commercial-readiness plan 2026-10-08, items 8 and 9; owner
 * decision 2 of the same day): the site's headline, every page title, the
 * hero and llms.txt promised "Zero Ghost Jobs", and the copy around it said
 * "Every job here is real", "never scraped", "bank-level encryption", a typed
 * "0 Data Breaches", a "GDPR Compliant" badge, "Pay once, use forever", "Save
 * $6", "Priority processing", and four different board sizes (450k, 550k,
 * 700k, and the live one). The board's own Ghost Job Index says it cannot
 * tell a filled role from a withdrawn one, and the board carries talent-pool
 * and general-application posts, so none of the absolutes could be proved.
 * The owner chose wording of the form "live jobs straight from employers' own
 * hiring systems".
 *
 * Swept over every surface a reader, a crawler or an answer engine is served:
 * all nine locale files' values, the static shell and manifest, llms.txt, the
 * app's code with its comments removed, and the bake with its comments
 * removed. The changelog is a dated record of what shipped and is not swept.
 */

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

// Each claim, in every language a locale file carries it in.
const BANNED: Array<[string, RegExp]> = [
  ["zero ghost jobs", /zero ghost jobs|null Geisterjobs|cero ofertas fantasma|zéro offre fantôme|शून्य घोस्ट जॉब्स|nul spookvacatures|zero vagas fantasma/i],
  ["every job here is real", /every job here is real|Jede Stelle hier ist echt|Cada empleo aquí es real|Chaque offre ici est réelle|यहाँ हर नौकरी असली है|Elke vacature hier is echt|Cada vaga aqui é real|Totoo ang bawat trabaho rito/i],
  ["never scraped (unqualified)", /never scraped(?! from a search engine)|nie gescrapt|nunca extraídas|jamais aspirées|कभी स्क्रैप नहीं|nooit gescrapet|nunca raspadas|hindi kailanman scraped/i],
  ["bank-level encryption", /bank[- ]level|Bankniveau|nivel bancario|niveau bancaire|बैंक-स्तर|bankniveau|nível bancário|antas ng bangko/i],
  ["a GDPR-compliance badge", /GDPR[- ]compliant|DSGVO-konform|Cumple con el RGPD|Conforme au RGPD|GDPR कम्प्लायंट|AVG-conform|Conforme com o RGPD/i],
  ["pay once, use forever", /use forever|Einmal zahlen, für immer|usa para siempre|utilisez pour toujours|हमेशा उपयोग करें|voor altijd gebruiken|use para sempre|gamitin habambuhay/i],
  ["save $6", /Save \$6/],
  ["priority processing", /priority processing/i],
  ["a typed board size", /\b(?:450|550|700|900)[,.]000\+|\b1\.02M\b/],
  // L4-11: the data API page sold "genuine fills vs re-listing churn"; the
  // board sees a takedown, never a hire.
  ["a takedown sold as a fill", /genuine fills|genuinely filled|companies that fill roles|Fills vs\.? re-listing/i],
];

function walk(dir: string, keep: (f: string) => boolean): string[] {
  const out: string[] = [];
  const go = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "test" || e.name === "changelog") continue;
        go(p);
      } else if (keep(e.name)) out.push(relative(ROOT, p));
    }
  };
  go(resolve(ROOT, dir));
  return out;
}

function leaves(o: unknown, pre = ""): Array<[string, string]> {
  if (typeof o === "string") return [[pre, o]];
  if (o && typeof o === "object") return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => leaves(v, pre ? `${pre}.${k}` : k));
  return [];
}

const LOCALES = readdirSync(resolve(ROOT, "src/i18n/locales")).filter((f) => f.endsWith(".json"));
const APP = walk("src", (f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));

describe("no surface makes a claim the board's own data cannot prove", () => {
  it("the sweep reads what it says it reads", () => {
    expect(LOCALES.length).toBe(9);
    expect(APP.length).toBeGreaterThan(200);
    expect(APP).toContain("src/components/HomeHero.tsx");
    expect(statSync(resolve(ROOT, "public/llms.txt")).size).toBeGreaterThan(1000);
  });

  for (const file of LOCALES) {
    it(`${file}: no value carries a banned claim`, () => {
      const hits = leaves(JSON.parse(read(`src/i18n/locales/${file}`)))
        .flatMap(([k, v]) => BANNED.filter(([, re]) => re.test(v)).map(([name]) => `${k} (${name}): ${v.slice(0, 80)}`));
      expect(hits).toEqual([]);
    });
  }

  it.each(["index.html", "public/manifest.webmanifest", "public/llms.txt"])("%s carries no banned claim", (rel) => {
    // llms.txt's corpus clause is rewritten from a LIVE facets read on every
    // publish (the bake's sub() over this exact shape), so its number is the
    // board's, not typed; everything else in the file is checked as written.
    const raw = rel.endsWith(".html") ? read(rel).replace(/<!--[\s\S]*?-->/g, "") : read(rel);
    const text = rel === "public/llms.txt" ? raw.replace(/[\d,]+\+ openings from [\d,]+\+ company job boards/, "<live> openings from <live> company job boards") : raw;
    expect(BANNED.filter(([, re]) => re.test(text)).map(([name]) => name)).toEqual([]);
  });

  it("the app's code and the bake carry no banned claim outside a comment", () => {
    const hits: string[] = [];
    for (const rel of [...APP, "scripts/prerender-seo.mjs", "scripts/prerender-pages.mjs"]) {
      const code = codeOf(read(rel));
      for (const [name, re] of BANNED) if (re.test(code)) hits.push(`${rel}: ${name}`);
    }
    expect(hits).toEqual([]);
  });

  it("the headline says where the jobs come from, in the shell, the SPA head and the bake", () => {
    const want = /Live Jobs Straight From Employers/;
    expect(read("index.html")).toMatch(want);
    expect(codeOf(read("src/pages/Index.tsx"))).toMatch(want);
    expect(codeOf(read("scripts/prerender-seo.mjs"))).toMatch(want);
    const en = JSON.parse(read("src/i18n/locales/en.json"));
    expect(en.hero.headline.recruiterGrade).toBe("live jobs straight from employers' own hiring systems");
  });

  it("the trust page states no typed security statistic", () => {
    const trust = codeOf(read("src/pages/Trust.tsx"));
    expect(trust, "a hand-typed tile value").not.toMatch(/\{\s*value:\s*"[^"]*"\s*,/);
  });
});
