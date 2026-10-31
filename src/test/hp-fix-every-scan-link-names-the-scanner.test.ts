/**
 * EVERY LINK THAT MEANS THE SCANNER NAMES THE SCANNER (switch-over step 11,
 * review round of 2026-10-26).
 *
 * After the switch-over "/" is the job search and the scanner lives at
 * /resume-checker. Step 11 read src/pages and src/components only, so four
 * guides' scan pills (src/data/guides.ts, rendered by GuideArticle and by the
 * bake), every company page's "free resume scan" link (prerender-pages.mjs)
 * and the CV-standards pages' "Scan my resume free" button (prerender-seo.mjs,
 * every language but Spanish) still pointed at "/": a seeker who tapped one
 * landed on the board with no uploader, and a crawler read scan wording on a
 * link to the homepage. This reads every place a link to "/" is written and
 * fails on one whose words name a scan.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { GUIDES } from "@/data/guides";
import { codeOf } from "./helpers/strip-comments";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

/** Words that name the scan, in the languages a link carries (English, French, German, Dutch, Spanish, Portuguese). */
const SCAN_WORDS = /\bscan|scanner|scannen|escanear|revisar (?:mi |tu )?curr[ií]culum|check (?:it|your r[ée]sum[ée])|r[ée]sum[ée] (?:check|score)/i;

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(resolve(ROOT, dir))) {
    const rel = join(dir, name);
    if (statSync(resolve(ROOT, rel)).isDirectory()) out.push(...filesUnder(rel));
    else if (/\.(tsx?|mjs)$/.test(name) && !/\.test\./.test(name)) out.push(rel);
  }
  return out;
}

describe("the guides' related links", () => {
  it("a pill whose label names a scan opens the scanner, never the homepage", () => {
    const wrong: string[] = [];
    let scanPills = 0;
    for (const [slug, g] of Object.entries(GUIDES)) {
      for (const r of g.related ?? []) {
        if (!SCAN_WORDS.test(r.label)) continue;
        scanPills += 1;
        if (r.href === "/" || r.href.startsWith("/#") || r.href.startsWith("/?")) wrong.push(`${slug}: "${r.label}" -> ${r.href}`);
      }
    }
    expect(scanPills, "the guides carry scan pills (the check is not vacuous)").toBeGreaterThanOrEqual(4);
    expect(wrong).toEqual([]);
  });
});

describe("links the bake writes", () => {
  it("no anchor to \"/\" in a prerender script carries scan wording", () => {
    const wrong: string[] = [];
    for (const f of ["scripts/prerender-pages.mjs", "scripts/prerender-seo.mjs"]) {
      const code = codeOf(read(f));
      for (const m of code.matchAll(/<a\s[^>]*href="\/"[^>]*>([^<]{0,120})<\/a>/g)) {
        if (SCAN_WORDS.test(m[1])) wrong.push(`${f}: <a href="/">${m[1]}</a>`);
      }
      for (const m of code.matchAll(/\{\s*name:\s*"([^"]*)",\s*href:\s*"\/"\s*\}/g)) {
        if (SCAN_WORDS.test(m[1])) wrong.push(`${f}: breadcrumb "${m[1]}" -> /`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("the CV-standards button opens the scanner in every language (Spanish on its own page)", () => {
    const code = codeOf(read("scripts/prerender-seo.mjs"));
    const m = code.match(/<a href="\$\{([^}]*)\}"[^>]*>\$\{esc\(t\.ctaButton\)\}<\/a>/);
    expect(m, "the bake's CV-standards call to action").not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const hrefFor = new Function("locale", `return (${m![1]});`) as (locale: string) => string;
    for (const locale of ["en", "fr", "de", "nl", "pt"]) expect(hrefFor(locale), locale).toBe("/resume-checker");
    expect(hrefFor("es")).toBe("/es/revisar-curriculum");
  });
});

describe("links React renders", () => {
  it("no Link, anchor or navigate() to \"/\" in src/pages, src/components or src/data carries scan wording", () => {
    const wrong: string[] = [];
    let homeLinks = 0;
    for (const f of [...filesUnder("src/pages"), ...filesUnder("src/components"), ...filesUnder("src/data")]) {
      const code = codeOf(read(f));
      for (const m of code.matchAll(/(?:\b(?:to|href)=(?:"\/"|\{"\/"\})|navigate\("\/"\)|\bhref:\s*"\/")/g)) {
        homeLinks += 1;
        const after = code.slice(m.index!, m.index! + 400);
        const end = after.search(/<\/(?:Link|a|Button)>|\}\s*[,\]]|\)\s*;/);
        const window = end > 0 ? after.slice(0, end) : after.slice(0, 160);
        if (SCAN_WORDS.test(window.replace(/[a-zA-Z]+(?:\.[a-zA-Z]+)+/g, ""))) wrong.push(`${f}: ${window.replace(/\s+/g, " ").slice(0, 120)}`);
      }
    }
    expect(homeLinks, "the home links were found (the check is not vacuous)").toBeGreaterThan(10);
    expect(wrong).toEqual([]);
  });

  it("the installed app's scan shortcut opens the scanner itself", () => {
    const manifest = JSON.parse(read("public/manifest.webmanifest")) as { shortcuts: { name: string; url: string }[]; description: string };
    const scan = manifest.shortcuts.find((s) => SCAN_WORDS.test(s.name));
    expect(scan?.url).toBe("/resume-checker#upload");
  });
});
