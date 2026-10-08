/**
 * THE HEAD THE BAKE WROTE, AND THE HEAD REACT WRITES OVER IT.
 *
 * Every prerendered file ships its own <link rel="canonical"> and
 * <meta name="description">. React 19 hoists the ones <SEO> renders into the
 * same head and, in a client render, inserts them BESIDE the baked ones —
 * measured in jsdom on react-dom 19.2.3 it adopted neither, even with an
 * identical href and content. So every rendered page carried two canonicals
 * and two descriptions, and where they differed the head contradicted itself:
 * the secondary-board company landers, whose bake points the canonical at the
 * employer's primary board while the page pointed it at itself
 * (pwc~wd3~crm_experienced_careers_site, maersk~wd3~Maersk_Manual).
 *
 * React marks every head element it owns, created or adopted, with its
 * internal instance key. An element without one was written before React ran.
 */
import { companyLanderPath } from "@/lib/public-href";

/** Whether React owns this element (it created or adopted it). */
export function ownedByReact(node: Element): boolean {
  return Object.keys(node).some((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactMarker$"));
}

/**
 * Once React has written its own canonical (or description), remove the ones
 * it does NOT own: the page's live head supersedes the bake's. Never touches
 * an element React owns — removing one would break its own unmount — and
 * removes nothing of a kind React has not yet written, so a page that renders
 * no head of its own (a posting still loading) keeps the baked one whole.
 */
export function supersedePrerenderedTags(): void {
  if (typeof document === "undefined") return;
  for (const sel of ['link[rel="canonical"]', 'meta[name="description"]']) {
    const nodes = [...document.head.querySelectorAll(sel)];
    if (!nodes.some(ownedByReact)) continue;
    for (const n of nodes) if (!ownedByReact(n)) n.remove();
  }
}

const trimSlash = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);
const learnedPrimary = new Map<string, string>();

/**
 * The board the bake chose as this employer's indexable page, when the bake
 * pointed THIS lander's canonical somewhere else. Read from the canonical the
 * bake wrote into this address's own head, before React writes over it, and
 * remembered per token for the rest of the page session.
 */
export function bakedCompanyPrimary(token: string): string | null {
  if (learnedPrimary.has(token)) return learnedPrimary.get(token) ?? null;
  if (typeof document === "undefined" || typeof window === "undefined") return null;
  let here: string;
  try { here = decodeURI(window.location.pathname); } catch { return null; }
  if (trimSlash(here) !== trimSlash(decodeURI(companyLanderPath(token)))) return null;
  const baked = [...document.head.querySelectorAll('link[rel="canonical"]')].find((n) => !ownedByReact(n));
  const href = baked?.getAttribute("href");
  if (!href) return null;
  let path: string;
  try { path = new URL(href, "https://resumebooster.work").pathname; } catch { return null; }
  const m = path.match(/^\/jobs\/company\/([^/]+)\/?$/);
  if (!m) return null;
  let primary: string;
  try { primary = decodeURIComponent(m[1]); } catch { return null; }
  if (!primary || primary === token) return null;
  learnedPrimary.set(token, primary);
  return primary;
}
