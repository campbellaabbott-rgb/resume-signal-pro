/**
 * THE HEAD THE BAKE WROTE FOR THE ADDRESS THIS DOCUMENT WAS LOADED AT.
 *
 * Every prerendered file carries <meta name="x-prerendered">, its own title,
 * description, canonical and JSON-LD. React then rendered its own head over
 * it with different words (SEO-007: "Domino's jobs: 23,789 open roles from
 * their own hiring system" became "Domino's jobs: open roles from their own
 * hiring system"; the field pages and /jobs likewise) and a second JSON-LD
 * block of the same type beside the bake's (SEO-031), so a crawler that runs
 * scripts read a different head from one that does not.
 *
 * This reads that head ONCE, when the module is first evaluated — before any
 * route renders — and remembers which path it belongs to: the path of the
 * document load (the navigation entry), never a later SPA address, so the
 * first page's title is never kept on the next page (the SEO-007 review).
 *
 * The root index.html is also the SPA fallback for every address without a
 * file of its own. It carries the marker too, so it counts as a baked head
 * only on "/" itself: on any other path its script has already removed the
 * canonical, and an unowned canonical is what this requires.
 */
import { ownedByReact } from "@/lib/prerendered-head";

export interface BakedHead {
  /** The decoded path the bake wrote this head for, without a trailing slash. */
  path: string;
  title: string | null;
  description: string | null;
  /** The @type of every JSON-LD block the bake put in the head. */
  ldTypes: string[];
}

const trim = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);
const decode = (p: string) => {
  try { return decodeURI(p); } catch { return p; }
};
/** A path or href as the comparison reads it: no query, no fragment, decoded, no trailing slash. */
export const normalisePath = (p: string) => trim(decode(p.split(/[?#]/)[0] || "/"));

function loadPath(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const nav = performance.getEntriesByType?.("navigation")?.[0] as PerformanceNavigationTiming | undefined;
    if (nav?.name) return new URL(nav.name).pathname;
  } catch { /* no navigation timing: fall back to the address now */ }
  return window.location.pathname;
}

/** The @type values of a JSON-LD script's text (an array of nodes or a @graph counts each). */
export function ldTypesOf(text: string | null): string[] {
  try {
    const parsed = JSON.parse(text || "");
    const nodes: unknown[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.["@graph"]) ? parsed["@graph"] : [parsed];
    return nodes.flatMap((n) => {
      const t = (n as { "@type"?: unknown } | null)?.["@type"];
      return typeof t === "string" ? [t] : Array.isArray(t) ? t.filter((x): x is string => typeof x === "string") : [];
    });
  } catch {
    return [];
  }
}

function readBakedHead(): BakedHead | null {
  if (typeof document === "undefined") return null;
  const marker = document.head.querySelector('meta[name="x-prerendered"]');
  if (!marker || ownedByReact(marker)) return null;
  const path = loadPath();
  if (!path) return null;
  const canonical = [...document.head.querySelectorAll('link[rel="canonical"]')].find((n) => !ownedByReact(n));
  if (normalisePath(path) !== "/" && !canonical) return null;
  const title = [...document.head.querySelectorAll("title")].find((n) => !ownedByReact(n));
  const description = [...document.head.querySelectorAll('meta[name="description"]')].find((n) => !ownedByReact(n));
  const ldTypes = [...document.head.querySelectorAll('script[type="application/ld+json"]')]
    .filter((n) => !ownedByReact(n))
    .flatMap((n) => ldTypesOf(n.textContent));
  return {
    path: normalisePath(path),
    title: title?.textContent ?? null,
    description: description?.getAttribute("content") ?? null,
    ldTypes,
  };
}

let captured: BakedHead | null | undefined;

/** The baked head of this document load, or null when the page was not prerendered. */
export function bakedHead(): BakedHead | null {
  if (captured === undefined) captured = readBakedHead();
  return captured;
}

/** The baked head, only when it was written for `path` (a route path or an href). */
export function bakedHeadFor(path: string): BakedHead | null {
  const b = bakedHead();
  return b && normalisePath(path) === b.path ? b : null;
}

/** Whether the bake wrote a page for this path in this document load. */
export const hasBakedPage = (path: string): boolean => bakedHeadFor(path) !== null;

/** Tests only: read the head again, now (after a test writes a baked head into jsdom at its address). */
export function resetBakedHeadForTests(): void {
  captured = undefined;
  bakedHead();
}

/**
 * THE BAKED TITLE AND SHARE TAGS GIVE WAY TO REACT'S, AS THE CANONICAL AND
 * THE DESCRIPTION DO (src/lib/prerendered-head.ts). React adopts an unowned
 * <title> in a production client render, but not in every build, and Helmet's
 * og:* and twitter:* tags are inserted beside the baked ones: a page could
 * carry two titles and two of each share tag. Once React owns one of a kind,
 * the unowned ones of that kind are removed; nothing of a kind React has not
 * written is touched.
 *
 * The robots directive is one of those kinds: an address with no baked file
 * is served the root index.html, whose template says "index, follow", and a
 * noindex page (an internal tool, an uncarried board) added its own beside
 * it, so the head carried two contradicting directives.
 */
export function supersedeBakedTitleAndShareTags(): void {
  if (typeof document === "undefined") return;
  const kinds: Array<[string, (n: Element) => string]> = [
    ["title", () => "title"],
    ['meta[name="robots"]', () => "robots"],
    ['meta[property^="og:"]', (n) => `og|${n.getAttribute("property")}`],
    ['meta[name^="twitter:"]', (n) => `tw|${n.getAttribute("name")}`],
  ];
  for (const [sel, keyOf] of kinds) {
    const nodes = [...document.head.querySelectorAll(sel)];
    const owned = new Set(nodes.filter(ownedByReact).map(keyOf));
    for (const n of nodes) if (!ownedByReact(n) && owned.has(keyOf(n))) n.remove();
  }
}

// Read at module evaluation, before a route renders and React adopts or
// supersedes the baked tags.
bakedHead();
