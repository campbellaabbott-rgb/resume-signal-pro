import { useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { useTranslation } from "react-i18next";
import { publicPath } from "@/lib/public-href";
import { supersedePrerenderedTags } from "@/lib/prerendered-head";
import { bakedHeadFor, supersedeBakedTitleAndShareTags } from "./baked-head";
import { supersedeBakedJsonLd } from "./PageJsonLd";

const SITE = "https://resumebooster.work";

interface SEOProps {
  title: string;
  description: string;
  path: string;
  image?: string;
  /** Internal pages (admin dashboards) that must never be indexed. */
  noIndex?: boolean;
  /**
   * The page this one consolidates into, when it is not itself. A secondary
   * board's company lander names the employer's primary board here — the same
   * canonical the bake wrote — so the rendered head keeps ONE canonical.
   */
  canonicalPath?: string;
  /**
   * Keep the title and description the bake wrote for this address, when the
   * document was loaded from a baked file for exactly this path (SEO-007). The
   * company, field and /jobs pages pass it: their baked head carries the
   * build's count, and React's own words (the same template, read through
   * src/lib/seo/board-heads.ts) are used only where there is no baked head —
   * an SPA navigation, or a build whose bake did not run. A noindex head never
   * keeps the baked one.
   */
  preferBakedHead?: boolean;
}

// Per-route head metadata: title, description, canonical, og:* and twitter:* tags.
// Keep title ≤ 60 chars and description ≤ 160 chars.
//
// THE CANONICAL USES THE BAKE'S SPELLING (publicPath: a dotted last segment
// takes the trailing slash this host needs), and the baked canonical and
// description are removed once React has written its own — otherwise React 19
// leaves both beside each other (see prerendered-head.ts).
export function SEO({ title, description, path, image, noIndex, canonicalPath, preferBakedHead }: SEOProps) {
  const url = `${SITE}${publicPath(canonicalPath ?? path)}`;
  const ogImage = image ?? `${SITE}/og-image.png`;
  // Only an indexable page's own baked head is kept: a stub or a duplicate
  // pointing at its twin describes itself, not what React renders over it.
  // AND ONLY FOR A READER OF THE BAKE'S LANGUAGE: the bake writes English, and
  // a German reader of /jobs/company/dominos kept its English title over a
  // German page (the round's review, 2026-10-24). Crawlers read English.
  const { i18n } = useTranslation();
  const lang = String(i18n?.language || i18n?.resolvedLanguage || "en").toLowerCase();
  const readsBakedLanguage = lang === "en" || lang.startsWith("en-");
  const bakedFile = preferBakedHead && !noIndex && readsBakedLanguage ? bakedHeadFor(path) : null;
  const baked = bakedFile?.indexable ? bakedFile : null;
  const shownTitle = baked?.title || title;
  const shownDescription = baked?.description || description;
  useEffect(() => {
    supersedePrerenderedTags();
    supersedeBakedTitleAndShareTags();
    supersedeBakedJsonLd();
  }, [url, shownDescription, shownTitle]);
  return (
    <Helmet>
      <title>{shownTitle}</title>
      <meta name="description" content={shownDescription} />
      {noIndex && <meta name="robots" content="noindex,nofollow" />}
      <link rel="canonical" href={url} />

      <meta property="og:title" content={shownTitle} />
      <meta property="og:description" content={shownDescription} />
      <meta property="og:url" content={url} />
      <meta property="og:image" content={ogImage} />

      <meta name="twitter:title" content={shownTitle} />
      <meta name="twitter:description" content={shownDescription} />
      <meta name="twitter:url" content={url} />
      <meta name="twitter:image" content={ogImage} />
    </Helmet>
  );
}
