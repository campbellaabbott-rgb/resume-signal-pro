/**
 * The employer name the prerendered company lander carried in its <h1>.
 *
 * The baked markup stays on screen until the route's first real commit
 * (src/lib/keep-prerendered-page.ts) and is removed then, and React's own
 * mount node sits first inside #root, so main.tsx reads the name here,
 * before React mounts and before the baked nodes go. Kept free of imports so the entry bundle
 * pays nothing for it; src/lib/display-name.ts cleans the text when it reads
 * it back.
 */
const COMPANY_PATH = /^\/jobs\/company\/([^/?#]+)\/?$/;
const BAKED_H1_PREFIX = /^Open roles at\s+/i;

let baked: { token: string; name: string } | null = null;

export function companyTokenOfPath(pathname: string): string | null {
  const m = String(pathname ?? "").match(COMPANY_PATH);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

/** Record the baked name for this address. Records nothing off a company lander. */
export function captureBakedLanderName(doc: Document, pathname: string): void {
  try {
    const token = companyTokenOfPath(pathname);
    if (!token) return;
    const text = doc.querySelector("#root h1")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    if (!BAKED_H1_PREFIX.test(text)) return;
    const name = text.replace(BAKED_H1_PREFIX, "").trim();
    if (name) baked = { token, name };
  } catch {
    /* no name is better than a wrong one */
  }
}

/** The raw baked name for this token, or null. */
export function rawBakedLanderName(token: string | null | undefined): string | null {
  return baked && token && baked.token === token ? baked.name : null;
}

/** Test seam. */
export function resetBakedLanderName(): void {
  baked = null;
}
