/**
 * ONE SOURCE OF STRUCTURED DATA PER PAGE (SEO-031).
 *
 * The bake writes each prerendered route's JSON-LD into its head, and the
 * React page wrote its own block of the same @type into the body on top of
 * it, so after hydration /methodology, the keyword pages, /vs, the vendor
 * guides, the study and the guides carried two different entities of one
 * type. A page that has a baked file for this address now renders none of
 * its own: the bake is the source. A page without one — an SPA navigation,
 * or a build whose bake did not run — keeps React's blocks.
 *
 * supersedeBakedJsonLd covers any page that still renders its own blocks on
 * a baked route: a baked head block whose @type React has written is
 * removed, so a type is never stated twice. (Since the homepage switch-over
 * the new homepage renders no JSON-LD, and /pricing renders its block
 * through this component.)
 */
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { ownedByReact } from "@/lib/prerendered-head";
import { hasBakedPage, ldTypesOf } from "./baked-head";

/**
 * The id of the posting page's JobPosting slot (POSTING_LD_TAG_ID in
 * src/components/jobs/posting-page.ts, held equal by a test). Named here, not
 * imported: this module rides in the SEO chunk every page loads, and an
 * import pulled the posting page's builders into it (8 KB gzip on every page).
 */
export const POSTING_SLOT_ID = "posting-jsonld";

type Block = Record<string, unknown> | string | null | undefined | false;

const serialise = (b: Exclude<Block, null | undefined | false>) =>
  (typeof b === "string" ? b : JSON.stringify(b)).replace(/</g, "\\u003c");

/** Removes every baked head JSON-LD block whose @type a React-owned block on the page already states. */
export function supersedeBakedJsonLd(): void {
  if (typeof document === "undefined") return;
  const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
  const reactTypes = new Set(scripts.filter(ownedByReact).flatMap((s) => ldTypesOf(s.textContent)));
  if (reactTypes.size === 0) return;
  for (const s of scripts) {
    if (ownedByReact(s) || s.parentElement !== document.head) continue;
    // The posting page owns its JobPosting slot by id and replaces it itself.
    if (s.id === POSTING_SLOT_ID) continue;
    if (ldTypesOf(s.textContent).some((t) => reactTypes.has(t))) s.remove();
  }
}

export function PageJsonLd({ blocks }: { blocks: Block[] }) {
  const { pathname } = useLocation();
  const baked = hasBakedPage(pathname);
  const shown = baked ? [] : (blocks.filter(Boolean) as Array<Exclude<Block, null | undefined | false>>);
  useEffect(() => {
    if (shown.length) supersedeBakedJsonLd();
  });
  if (!shown.length) return null;
  return (
    <>
      {shown.map((b, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: serialise(b) }} />
      ))}
    </>
  );
}
