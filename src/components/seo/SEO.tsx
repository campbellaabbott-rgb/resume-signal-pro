import { useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { publicPath } from "@/lib/public-href";
import { supersedePrerenderedTags } from "@/lib/prerendered-head";

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
}

// Per-route head metadata: title, description, canonical, og:* and twitter:* tags.
// Keep title ≤ 60 chars and description ≤ 160 chars.
//
// THE CANONICAL USES THE BAKE'S SPELLING (publicPath: a dotted last segment
// takes the trailing slash this host needs), and the baked canonical and
// description are removed once React has written its own — otherwise React 19
// leaves both beside each other (see prerendered-head.ts).
export function SEO({ title, description, path, image, noIndex, canonicalPath }: SEOProps) {
  const url = `${SITE}${publicPath(canonicalPath ?? path)}`;
  const ogImage = image ?? `${SITE}/og-image.png`;
  useEffect(() => { supersedePrerenderedTags(); }, [url, description]);
  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      {noIndex && <meta name="robots" content="noindex,nofollow" />}
      <link rel="canonical" href={url} />

      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={url} />
      <meta property="og:image" content={ogImage} />

      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:url" content={url} />
      <meta name="twitter:image" content={ogImage} />
    </Helmet>
  );
}
