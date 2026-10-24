/**
 * WHICH EMPLOYER BOARDS HAVE A COMPANY PAGE, READ AT RUN TIME (SEO-010).
 *
 * Every React link to an employer went to /jobs/company/<token>, but the bake
 * writes a page for only the employers it chooses (about 500 of 25,000
 * boards). 206 of the 500 live posting pages, the data pages and the board
 * linked tokens with no written page, and a crawler that runs no scripts got
 * the homepage's copy at those addresses (/jobs/company/intel answered the
 * 22,727-byte homepage file, index, follow, canonical "/").
 *
 * The bake publishes /landers.json: board token -> the page that is that
 * employer's (its primary board's path, or the token of it), or null when
 * the board has no page it may link (a page that canonicalises to a
 * different employer sharing its name — employerPageOf in
 * scripts/prerender-pages.mjs). It cannot be compiled into the bundle: the
 * bake runs in Vite's closeBundle, after the JS is hashed.
 *
 * Until the file has loaded, and for any token it does not name, a link goes
 * to the live board filtered to that board (/jobs?company=<token>), which is
 * what the baked pages already link.
 */
import { useEffect, useSyncExternalStore } from "react";
import { companyLanderPath, publicPath } from "@/lib/public-href";

export const LANDERS_MANIFEST_PATH = "/landers.json";

type Target = string | null;
let manifest: ReadonlyMap<string, Target> | null = null;
let pending: Promise<void> | null = null;
let version = 0;
const listeners = new Set<() => void>();
const notify = () => {
  version++;
  for (const l of listeners) l();
};

/**
 * The file's shape, read leniently: { token: target } at the top level or
 * under "pages" / "landers"; a target is a /jobs/company/ path, a primary
 * token, or null. Anything else is ignored rather than linked.
 */
export function parseLanderManifest(json: unknown): Map<string, Target> | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const root = json as Record<string, unknown>;
  const body = (["pages", "landers"].map((k) => root[k]).find((v) => v && typeof v === "object" && !Array.isArray(v)) ?? root) as Record<string, unknown>;
  const out = new Map<string, Target>();
  for (const [token, v] of Object.entries(body)) {
    if (!token) continue;
    if (v === null) out.set(token, null);
    else if (typeof v === "string" && v.startsWith("/jobs/company/")) out.set(token, publicPath(v));
    else if (typeof v === "string" && v && !v.includes("/")) out.set(token, companyLanderPath(v));
  }
  return out;
}

/** Fetches the manifest once per page session. A failed read keeps every link on the live board. */
export function loadLanderManifest(fetcher: typeof fetch = fetch): Promise<void> {
  if (manifest || pending) return pending ?? Promise.resolve();
  pending = (async () => {
    try {
      const res = await fetcher(LANDERS_MANIFEST_PATH, { headers: { accept: "application/json" } });
      if (!res.ok) return;
      const type = res.headers.get("content-type") ?? "";
      // The SPA fallback answers an unknown path with the homepage's HTML and a 200.
      if (type && !type.includes("json")) return;
      const parsed = parseLanderManifest(await res.json());
      if (parsed) {
        manifest = parsed;
        notify();
      }
    } catch {
      /* no manifest: links stay on the live board */
    }
  })();
  return pending;
}

/**
 * The href a link to one employer board uses: its written company page when
 * the manifest names one, otherwise the live board filtered to the board.
 * `query` is kept either way ("experience=entry").
 */
export function companyBoardHref(token: string, query?: string): string {
  const q = query ? (query.startsWith("?") || query.startsWith("&") ? query.slice(1) : query) : "";
  const page = manifest?.get(token);
  if (page) {
    if (!q) return page;
    const [path, existing] = page.split("?");
    return `${path}?${existing ? `${existing}&` : ""}${q}`;
  }
  return `/jobs?company=${encodeURIComponent(token)}${q ? `&${q}` : ""}`;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};
const snapshot = () => version;

/** companyBoardHref for a component: it loads the manifest and re-renders when it arrives. */
export function useCompanyBoardHref(): (token: string, query?: string) => string {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => { void loadLanderManifest(); }, []);
  return companyBoardHref;
}

/**
 * Tests only: set (or clear) the manifest as if it had loaded. "*" stands for
 * a bake that wrote every board its own page, for tests that hold some other
 * property of an employer link.
 */
export function setLanderManifestForTests(entries: Record<string, Target> | "*" | null): void {
  manifest = entries === "*"
    ? ({ get: (token: string) => companyLanderPath(token) } as unknown as ReadonlyMap<string, Target>)
    : entries ? parseLanderManifest(entries) : null;
  pending = entries ? Promise.resolve() : null;
  notify();
}
