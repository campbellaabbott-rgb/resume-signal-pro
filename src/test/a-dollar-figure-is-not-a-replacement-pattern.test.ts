import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { PASS, SUBSCRIPTIONS } from "@/config/products";

/**
 * THE PRICE WAS WRITTEN INTO A REPLACEMENT STRING, AND A REPLACEMENT STRING
 * HAS A GRAMMAR.
 *
 * String.prototype.replace reads its second argument, when it is a string,
 * for sequences that mean something: the whole match, the text before or
 * after it, or a capture group by number. A dollar sign followed by a digit
 * is one of those sequences, and a dollar sign followed by a digit is also
 * what a price looks like. The prerender built every head tag with a
 * two-group pattern and a replacement string that carried the page's own
 * description, and on 2026-09-27 the live /pricing page, fetched with a
 * Googlebot user agent, served its description as
 *
 *     Paid tools are one-time purchases ("
 *
 * — the catalogue's lowest price named group 2, group 2 was the closing
 * quote, the attribute ended there, and the rest of the sentence sat outside
 * it as attribute garbage. og:title and twitter:title lost the same figure
 * the same way. Nothing failed: the file was written, the build was green.
 *
 * The composer now substitutes through a replacer FUNCTION, which has no
 * grammar, and every head and body slot goes through it. This renders the
 * real template through the same function the bake uses, with a price in
 * every slot, and checks each one comes out verbatim; it also runs the old
 * form on the same inputs so the defect it guards against is on record as a
 * failing shape rather than a story.
 *
 * The second half is about what the crawler could read at all. /pricing sent
 * the crawler to the app for the monthly prices, and /agents named the plan
 * and the pass without a figure. Both now print the same mirrors the
 * checkout functions are pinned to (pricing-truth), and the script types no
 * dollar figure anywhere.
 */

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

// Comments stripped: the docblocks in the script explain this defect and
// necessarily quote the shapes involved.
const SCRIPT = codeOf(read("scripts/prerender-seo.mjs"));
const TEMPLATE = read("index.html");

type Page = {
  path: string;
  title: string;
  description: string;
  content: string;
  jsonLd?: unknown[];
  isFallback?: boolean;
};
type Deps = {
  template: string;
  D: { POSTING_LD_TAG_ID: string };
  esc: (s: unknown) => string;
  shell: (content: string, lang: string | null) => string;
  preloadFor: (path: string) => string;
  publicHref: (path: string) => string;
  onTruncated: (t: unknown) => void;
};
type Composer = {
  composeHtml: (page: Page, deps: Deps) => string;
  putVerbatim: (html: string, pattern: string | RegExp, value: string) => string;
  setContent: (html: string, prefix: string, value: string) => string;
};

// The script runs its bake only as `node scripts/prerender-seo.mjs`; imported,
// it exposes the pure functions and does nothing else.
const load = async (): Promise<Composer> =>
  (await import("../../scripts/prerender-seo.mjs")) as unknown as Composer;

const esc = (s: unknown) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const attr = (html: string, prefix: string): string | null => {
  const at = html.indexOf(prefix);
  if (at === -1) return null;
  const from = at + prefix.length;
  return html.slice(from, html.indexOf('"', from));
};

const deps = (): Deps => ({
  template: TEMPLATE,
  D: { POSTING_LD_TAG_ID: "posting-ld" },
  esc,
  shell: (c) => c,
  preloadFor: () => "",
  publicHref: (p) => p,
  onTruncated: () => {},
});

// The figures are the mirrors', not typed — the same ones the pages print.
const PRO = `$${SUBSCRIPTIONS.pro.priceUsd}`;
const AGENT = `$${SUBSCRIPTIONS.agent.priceUsd}`;
const PASS_PRICE = `$${PASS.priceUsd}`;
// Every sequence the replacement grammar reads: match, before, after, one
// dollar, a group by number, a group by name. A price is the last-but-one.
const GRAMMAR = "$& $` $' $$ $1 $2 $<x>";

describe("a dollar figure is not a replacement pattern", () => {
  it("putVerbatim inserts every replacement-grammar sequence as-is, with or without groups in the pattern", async () => {
    const { putVerbatim } = await load();
    const value = `${PRO} ${AGENT} ${PASS_PRICE} ${GRAMMAR}`;
    expect(putVerbatim("a<x/>b", "<x/>", value)).toBe(`a${value}b`);
    expect(putVerbatim("a<x/>b", /(<)(x)(\/>)/, value)).toBe(`a${value}b`);
  });

  it("setContent rewrites the whole attribute, so a digit has no group to name", async () => {
    const { setContent } = await load();
    const html = '<meta name="description" content="old" />';
    const value = `One-time ($2–$59); Pro ${PRO}/month`;
    expect(setContent(html, '<meta name="description" content="', value)).toBe(
      `<meta name="description" content="${value}" />`,
    );
  });

  it("a page rendered through composeHtml keeps a price in every slot", async () => {
    const { composeHtml } = await load();
    const title = `Tools from $2, Pro ${PRO}`;
    const description = `One-time tools $2–$59; Pro ${PRO}/month; Apply Agent ${AGENT}/month; a ${PASS_PRICE} pass. ${GRAMMAR}`;
    const content = `<p>${PRO}</p><p>${AGENT}</p><p>${PASS_PRICE}</p><p>$2</p><p>${GRAMMAR}</p>`;
    const html = composeHtml(
      { path: "/pricing", title, description, content, jsonLd: [{ "@type": "Offer", price: PRO }] },
      deps(),
    );
    expect(html).toContain(`<title>${esc(title)}</title>`);
    for (const prefix of [
      '<meta name="description" content="',
      '<meta property="og:description" content="',
      '<meta name="twitter:description" content="',
    ]) {
      expect(attr(html, prefix), prefix).toBe(esc(description));
    }
    for (const prefix of ['<meta property="og:title" content="', '<meta name="twitter:title" content="']) {
      expect(attr(html, prefix), prefix).toBe(esc(title));
    }
    expect(html).toContain(`<div id="root">${content}</div>`);
    expect(html).toContain(`"price":"${PRO}"`);
  });

  it("the form the composer used to run through loses the figure on the same inputs", () => {
    // What shipped: a two-group pattern and a replacement string carrying the
    // description. "$2" names group 2 — the closing quote — so the attribute
    // ends where the price should be and the rest spills outside it.
    const description = "Paid tools are one-time purchases ($2–$59), plus a Pro plan.";
    const old = TEMPLATE.replace(/(<meta name="description" content=")[^"]*(")/, `$1${description}$2`);
    // The quote sits where the price was, and the parsed value ends there.
    expect(old).toContain('purchases ("–$59), plus a Pro plan.');
    expect(attr(old, '<meta name="description" content="')).toBe("Paid tools are one-time purchases (");
    expect(attr(old, '<meta name="description" content="')).not.toContain("$2–$59");
    // The body slot: "$&" is the whole match, so the template's own root div
    // is pasted back inside the injected one.
    const oldRoot = TEMPLATE.replace('<div id="root"></div>', `<div id="root">$&</div>`);
    expect(oldRoot).toContain('<div id="root"><div id="root"></div></div>');
    // On record, not a claim: a figure whose digits name NO group survived the
    // old form in V8, which is why the loss looked like a missing sentence and
    // not like a broken page. The two-digit plan prices were never in the
    // content to lose — that is the second half of this file.
    const survived = TEMPLATE.replace(/(<meta name="description" content=")[^"]*(")/, `$1Pro ${PRO}/month$2`);
    expect(attr(survived, '<meta name="description" content="')).toBe(`Pro ${PRO}/month`);
  });

  it("composeHtml carries no data through a replacement string", () => {
    const start = SCRIPT.indexOf("export const composeHtml = (");
    const end = SCRIPT.indexOf("const isMain", start);
    expect(start, "composeHtml is exported from the script").toBeGreaterThan(-1);
    expect(end, "the main gate follows the composer").toBeGreaterThan(start);
    const body = SCRIPT.slice(start, end);
    // The verbatim primitive is what the composer substitutes with.
    expect(body).toMatch(/putVerbatim\(html,/);
    expect(body).toMatch(/setContent\(html,/);
    // Every .replace( left in the composer takes a replacer function or a
    // string literal with no dollar sign in it — never a value, never a
    // template. (The description clamp and the JSON `<` escape are the two
    // that remain, and both replace with a fixed literal.)
    const calls = body.match(/\.replace\(/g) ?? [];
    const safe =
      body.match(
        /\.replace\((?:\/(?:\\.|[^/\n])+\/[a-z]*|"[^"\n]*"|'[^'\n]*'),\s*(?:"[^"$\n]*"|'[^'$\n]*'|\(?[\w, ]*\)?\s*=>)/g,
      ) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    expect(safe.length, "a .replace( in composeHtml with a data-bearing replacement string").toBe(calls.length);
    // And no replacement string names a group anywhere in the composer.
    expect(body).not.toMatch(/`\$1\$\{|\$\{[^}]*\}\$2`/);
  });

  it("the bake is gated on being run as a script, so the composer is importable -- and an import bakes nothing", async () => {
    // The same rule scripts/load-oflc-lca.mjs uses. The vite plugin runs
    // `node scripts/prerender-seo.mjs`, which is main; a test's import is
    // not. The gate compares REAL paths (a symlinked checkout must not turn
    // it off), and the property is checked as a behaviour: a fresh import
    // with argv[1] pointing elsewhere leaves the bake's first write (the
    // data-entry module) and the dist untouched.
    expect(SCRIPT).toMatch(/const isMain = [^\n]*process\.argv\[1\][^\n]*import\.meta\.url/);
    expect(SCRIPT).toMatch(/if \(isMain\) try \{/);
    const { existsSync, statSync, symlinkSync, unlinkSync } = await import("node:fs");
    // The comparison itself, as a behaviour through a real symlink: the
    // script reached by a link is still main; another file is not; a path
    // that does not exist is not.
    const { tmpdir } = await import("node:os");
    const { pathToFileURL } = await import("node:url");
    const gate = (await import("../../scripts/prerender-seo.mjs")) as unknown as { isMainModule: (a: string, u: string) => boolean };
    const real = resolve(root, "scripts/prerender-seo.mjs");
    const link = resolve(tmpdir(), `prerender-gate-${process.pid}-${Date.now()}.mjs`);
    symlinkSync(real, link);
    try {
      expect(gate.isMainModule(link, pathToFileURL(real).href), "a symlinked argv is still the script").toBe(true);
      expect(gate.isMainModule(real, pathToFileURL(real).href)).toBe(true);
      expect(gate.isMainModule(resolve(root, "scripts/load-oflc-lca.mjs"), pathToFileURL(real).href)).toBe(false);
      expect(gate.isMainModule("/nonexistent/prerender-seo.mjs", pathToFileURL(real).href)).toBe(false);
    } finally {
      unlinkSync(link);
    }
    const entry = resolve(root, "scripts/.prerender-data-entry.ts");
    const dist = resolve(root, "dist");
    const before = { entry: existsSync(entry) ? statSync(entry).mtimeMs : null, dist: existsSync(dist) ? statSync(dist).mtimeMs : null };
    const argv1 = process.argv[1];
    process.argv[1] = resolve(root, "scripts/load-oflc-lca.mjs");
    try {
      vi.resetModules();
      const started = Date.now();
      const m = (await import("../../scripts/prerender-seo.mjs")) as unknown as Composer;
      expect(typeof m.composeHtml).toBe("function");
      expect(Date.now() - started, "an import that bakes takes minutes").toBeLessThan(5_000);
    } finally {
      process.argv[1] = argv1;
    }
    const after = { entry: existsSync(entry) ? statSync(entry).mtimeMs : null, dist: existsSync(dist) ? statSync(dist).mtimeMs : null };
    expect(after).toEqual(before);
  });
});

describe("the prices a crawler reads are the mirrors', never typed", () => {
  // A binding whose right-hand side is the mirror, whatever it is called.
  const boundTo = (rhs: string): string[] =>
    [...SCRIPT.matchAll(new RegExp(`const (\\w+) = ${rhs.replace(/[.$]/g, (c) => `\\${c}`)};`, "g"))].map((m) => m[1]);
  // The page block: from its path line to the next page written.
  const block = (path: string): string => {
    const at = SCRIPT.indexOf(`path: "${path}",`);
    expect(at, `${path} is prerendered`).toBeGreaterThan(-1);
    const next = SCRIPT.indexOf("write({", at);
    return SCRIPT.slice(at, next === -1 ? undefined : next);
  };
  const prints = (text: string, names: string[], suffix = "") =>
    names.some((n) => text.includes(`$\${${n}${suffix}}`));

  it("the script types no dollar figure", () => {
    expect(SCRIPT).not.toMatch(/\$\d/);
  });

  it("the data entry carries SUBSCRIPTIONS beside PASS and the catalogue", () => {
    expect(SCRIPT).toMatch(/export \{[^}]*\bSUBSCRIPTIONS\b[^}]*\} from "\.\.\/src\/config\/products"/);
  });

  it("/pricing prints Pro, the Apply Agent and the pass from the mirrors", () => {
    const pro = boundTo("D.SUBSCRIPTIONS.pro");
    const agent = boundTo("D.SUBSCRIPTIONS.agent");
    expect(pro.length, "a binding to the Pro mirror").toBeGreaterThan(0);
    expect(agent.length, "a binding to the Agent mirror").toBeGreaterThan(0);
    const b = block("/pricing");
    expect(prints(b, pro, ".priceUsd"), "Pro's price, from the mirror").toBe(true);
    expect(prints(b, agent, ".priceUsd"), "the Apply Agent's price, from the mirror").toBe(true);
    expect(b).toContain("$${D.PASS.priceUsd}");
    // The description is one of the slots — the snippet is what the query sees.
    const desc = /description: `([^`]*)`/.exec(b)?.[1] ?? "";
    expect(prints(desc, pro, ".priceUsd")).toBe(true);
    expect(prints(desc, agent, ".priceUsd")).toBe(true);
    expect(desc).toContain("$${D.PASS.priceUsd}");
    // The offer ceiling is derived from everything on sale, as Pricing.tsx does.
    expect(b).toMatch(/highPrice: String\(Math\.max\(\.\.\.offerPrices\)\)/);
    expect(SCRIPT).toMatch(/const offerPrices = \[\.\.\.paid\.map\(\(p\) => p\.priceUsd\), \w+\.priceUsd, \w+\.priceUsd, D\.PASS\.priceUsd\];/);
  });

  it("/agents prints the Agent plan and the pass prices from the mirrors", () => {
    const agent = boundTo("D.SUBSCRIPTIONS.agent.priceUsd");
    const pass = boundTo("D.PASS.priceUsd");
    expect(agent.length).toBeGreaterThan(0);
    expect(pass.length).toBeGreaterThan(0);
    const b = block("/agents");
    expect(prints(b, agent), "the plan's monthly price").toBe(true);
    expect(prints(b, pass), "the pass price").toBe(true);
    const desc = /description: `([^`]*)`/.exec(b)?.[1] ?? "";
    expect(prints(desc, agent)).toBe(true);
    expect(prints(desc, pass)).toBe(true);
  });

  it("/agent prints its monthly price from the mirror in the title, the description and the body", () => {
    const agent = boundTo("D.SUBSCRIPTIONS.agent.priceUsd");
    const b = block("/agent");
    const title = /title: `([^`]*)`/.exec(b)?.[1] ?? "";
    const desc = /description: `([^`]*)`/.exec(b)?.[1] ?? "";
    expect(prints(title, agent), "title").toBe(true);
    expect(prints(desc, agent), "description").toBe(true);
    expect((b.match(/\$\$\{\w+\}\/month/g) ?? []).length, "the body's price line").toBeGreaterThan(0);
  });
});
