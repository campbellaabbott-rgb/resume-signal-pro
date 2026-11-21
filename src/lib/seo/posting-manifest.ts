/**
 * WHICH POSTING PAGES THE BAKE WROTE, READ AT RUN TIME (CRAWL-M1, CRAWL-1).
 *
 * The bake writes a page for about 500 postings, and React linked a posting
 * page for any live row it drew: "More roles at {employer}" under every
 * posting page (four rows, almost never baked) and the homepage's cards. Such
 * an address serves the fallback file (the homepage's copy, index, follow,
 * canonical "/"), and then renders a self-canonical page with job markup:
 * a JobPosting outside the per-page employer read, the 500-page ceiling, the
 * sitemap and the closure check (SEO audit 2026-11-18).
 *
 * The bake publishes /posting-pages.json beside /landers.json:
 * {"at": "YYYY-MM-DD", "live": ["/jobs/posting/...", ...]}, the live posting
 * paths its sitemap lists. It cannot be compiled into the bundle (the bake
 * runs after the JS is hashed), so it is read here the way lander-manifest.ts
 * reads /landers.json.
 *
 * Until the file has loaded, when it is missing, and for any path it does not
 * name, a caller links the employer's page instead (companyBoardHref): a page
 * the bake wrote, or the live board filtered to the board.
 *
 * This module may load on "/": it imports nothing from the posting page's
 * module (src/test/hp-fix-the-homepage-loads-no-posting-page-module.test.ts),
 * so a caller hands it a path, never an id.
 */
import { useEffect, useSyncExternalStore } from "react";

export const POSTING_PAGES_MANIFEST_PATH = "/posting-pages.json";

const PREFIX = "/jobs/posting/";

let live: ReadonlySet<string> | null = null;
let pending: Promise<void> | null = null;
let version = 0;
const listeners = new Set<() => void>();
const notify = () => {
  version++;
  for (const l of listeners) l();
};

/** One spelling per page: no origin, no query or fragment, no trailing slash (a dotted key's path ends in one). */
function keyOf(path: string): string | null {
  let p = path.trim();
  const origin = /^https?:\/\/[^/]+/i.exec(p);
  if (origin) p = p.slice(origin[0].length);
  const cut = p.search(/[?#]/);
  if (cut >= 0) p = p.slice(0, cut);
  p = p.replace(/\/+$/, "");
  return p.startsWith(PREFIX) && p.length > PREFIX.length ? p : null;
}

/**
 * The file's shape, read leniently: {"live": [paths]} (paths or absolute
 * URLs on this site), or a bare array of them. Anything that is not a posting
 * path is ignored rather than linked. A file with no list is no manifest.
 */
export function parsePostingManifest(json: unknown): Set<string> | null {
  const list = Array.isArray(json)
    ? json
    : json && typeof json === "object" && Array.isArray((json as { live?: unknown }).live)
      ? (json as { live: unknown[] }).live
      : null;
  if (!list) return null;
  const out = new Set<string>();
  for (const v of list) {
    if (typeof v !== "string") continue;
    const k = keyOf(v);
    if (k) out.add(k);
  }
  return out;
}

/** Fetches the manifest once per page session. A failed read keeps every link on the employer's page. */
export function loadPostingManifest(fetcher: typeof fetch = fetch): Promise<void> {
  if (live || pending) return pending ?? Promise.resolve();
  pending = (async () => {
    try {
      const res = await fetcher(POSTING_PAGES_MANIFEST_PATH, { headers: { accept: "application/json" } });
      if (!res.ok) return;
      const type = res.headers.get("content-type") ?? "";
      // The SPA fallback answers an unknown path with the homepage's HTML and a 200.
      if (type && !type.includes("json")) return;
      const parsed = parsePostingManifest(await res.json());
      if (parsed) {
        live = parsed;
        notify();
      }
    } catch {
      /* no manifest: every link stays on the employer's page */
    }
  })();
  return pending;
}

/** True when the manifest has loaded and names `path` as a live page the bake wrote. */
export function isBakedPostingPage(path: string | null | undefined): boolean {
  if (!path || !live) return false;
  const k = keyOf(path);
  return !!k && live.has(k);
}

/** `path` itself when the bake wrote it and it is live, otherwise null. */
export function bakedPostingPath(path: string | null | undefined): string | null {
  return path && isBakedPostingPage(path) ? path : null;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};
const snapshot = () => version;

/**
 * For a component: loads the manifest and re-renders when it arrives.
 * Returns bakedPostingPath, so a link reads `bakedPostingPath(path) ?? companyHref(token)`.
 */
export function useBakedPostingPath(): (path: string | null | undefined) => string | null {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => { void loadPostingManifest(); }, []);
  return bakedPostingPath;
}

/** Tests only: set (or clear) the manifest as if it had loaded. */
export function setPostingManifestForTests(paths: readonly string[] | null): void {
  live = paths ? parsePostingManifest([...paths]) : null;
  pending = paths ? Promise.resolve() : null;
  notify();
}
