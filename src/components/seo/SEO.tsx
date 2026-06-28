import { Helmet } from "react-helmet-async";

const SITE = "https://resumebooster.work";

interface SEOProps {
  title: string;
  description: string;
  path: string;
  image?: string;
}

// Per-route head metadata: title, description, canonical, og:* and twitter:* tags.
// Keep title ≤ 60 chars and description ≤ 160 chars.
export function SEO({ title, description, path, image }: SEOProps) {
  const url = `${SITE}${path}`;
  const ogImage = image ?? `${SITE}/og-image.png`;
  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
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
