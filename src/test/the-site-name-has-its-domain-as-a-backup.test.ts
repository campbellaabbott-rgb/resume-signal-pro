/**
 * SEO AUDIT 2026-11-18, OFFSITE-2: THE SITE NAME HAS ITS DOMAIN AS A BACKUP.
 *
 * An exact-domain search in the readable index returned resumebooster.io,
 * ResumeBoostAI and Enhancv's "Resume Booster" instead of this site, whose
 * own pages were indexed (18 URLs came back when the query was limited to
 * the domain). Google's site-name documentation says it generally will not
 * give two global sites the same name, and recommends the domain as an
 * alternateName on the WebSite node as the backup name. The Organization
 * node already carried one; the WebSite node, which index.html holds and
 * the bake gives to every page (withWebsiteGraph in prerender-copy.mjs),
 * had none.
 *
 * Judged on the shipped template and through the function the bake applies
 * to it on every page, never by a grep: the WebSite node names the domain as
 * its alternateName, keeps its name, URL and SearchAction, and stays the one
 * WebSite entity; the Organization node is unchanged (no sameAs, no legal
 * identity: the owner has supplied neither). A copy of the template without
 * the line fails the same check.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ORG_DESCRIPTION, ORG_DISAMBIGUATION, orgNode, withWebsiteGraph } from "../../scripts/prerender-copy.mjs";

const ROOT = resolve(__dirname, "../..");
const SITE = "https://resumebooster.work";
const TEMPLATE = readFileSync(resolve(ROOT, "index.html"), "utf8");

type Node = Record<string, unknown>;
/** Every JSON-LD node in a document: arrays and @graph flattened, a block that does not parse kept as null. */
function nodesOf(html: string): Array<Node | null> {
  const out: Array<Node | null> = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let j: unknown;
    try { j = JSON.parse(m[1]); } catch { out.push(null); continue; }
    const walk = (x: unknown) => {
      if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === "object") {
        const n = x as Node;
        if (Array.isArray(n["@graph"])) walk(n["@graph"]);
        else out.push(n);
      }
    };
    walk(j);
  }
  return out;
}
const websites = (html: string) => nodesOf(html).filter((n): n is Node => !!n && n["@type"] === "WebSite");
const names = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : []);

/** What is wrong with a document's site name, as sentences; [] when the WebSite node names its domain as a backup. */
function siteNameProblems(html: string): string[] {
  const nodes = nodesOf(html);
  if (nodes.some((n) => n === null)) return ["a JSON-LD block does not parse"];
  const ws = websites(html);
  if (ws.length !== 1) return [`${ws.length} WebSite nodes, not one`];
  const w = ws[0];
  const out: string[] = [];
  if (w.name !== "Resume Booster") out.push(`name is ${JSON.stringify(w.name)}`);
  if (w.url !== SITE) out.push(`url is ${JSON.stringify(w.url)}`);
  const host = new URL(String(w.url)).hostname;
  if (!names(w.alternateName).includes(host)) out.push(`alternateName ${JSON.stringify(w.alternateName ?? null)} does not name the domain ${host}`);
  if (names(w.alternateName).includes(String(w.name))) out.push("alternateName repeats the name");
  return out;
}

describe("the template's WebSite node names the domain as its backup name", () => {
  it("index.html carries one WebSite node whose alternateName is the site's own host, with its name, URL and SearchAction kept", () => {
    expect(siteNameProblems(TEMPLATE)).toEqual([]);
    const [w] = websites(TEMPLATE);
    expect(w.alternateName).toEqual(["resumebooster.work"]);
    expect(w.potentialAction).toEqual({
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${SITE}/jobs?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    });
  });

  it("the bake's head step (withWebsiteGraph, applied to every written page) keeps it beside the @id and publisher", () => {
    const baked = withWebsiteGraph(TEMPLATE, SITE);
    expect(siteNameProblems(baked)).toEqual([]);
    const [w] = websites(baked);
    expect(w["@id"]).toBe(`${SITE}/#website`);
    expect(w.publisher).toEqual({ "@id": `${SITE}/#org` });
    expect(w.alternateName).toEqual(["resumebooster.work"]);
  });

  it("the Organization node is unchanged: the same keys, no sameAs and no legal identity", () => {
    expect(orgNode(SITE)).toEqual({
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": `${SITE}/#org`,
      name: "Resume Booster",
      alternateName: "resumebooster.work",
      url: `${SITE}/`,
      logo: `${SITE}/icons/icon-512.png`,
      description: ORG_DESCRIPTION,
      disambiguatingDescription: ORG_DISAMBIGUATION,
    });
  });

  it("teeth: the template without the line, with another host, or with a second WebSite node fails the same check", () => {
    const without = TEMPLATE.replace(/\n\s*"alternateName": \["resumebooster\.work"\],/, "");
    expect(without).not.toBe(TEMPLATE);
    expect(siteNameProblems(without)).toEqual(["alternateName null does not name the domain resumebooster.work"]);
    expect(siteNameProblems(withWebsiteGraph(without, SITE))).toHaveLength(1);
    const otherHost = TEMPLATE.replace('"alternateName": ["resumebooster.work"]', '"alternateName": ["resumebooster.io"]');
    expect(otherHost).not.toBe(TEMPLATE);
    expect(siteNameProblems(otherHost)).toEqual(['alternateName ["resumebooster.io"] does not name the domain resumebooster.work']);
    const two = TEMPLATE.replace("</head>", '<script type="application/ld+json">{"@type":"WebSite","name":"Resume Booster","url":"https://resumebooster.work"}</script></head>');
    expect(siteNameProblems(two)).toEqual(["2 WebSite nodes, not one"]);
  });
});
