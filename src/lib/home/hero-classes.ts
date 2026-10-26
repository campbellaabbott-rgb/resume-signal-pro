/**
 * THE HOMEPAGE HERO'S HEADLINE AND SUMMARY CLASSES, FOR REACT AND THE BAKE.
 *
 * The crawler bake (scripts/prerender-seo.mjs, the "/" page) paints the
 * headline long before React does. When React's headline was larger than the
 * baked one, React's became the page's Largest Contentful Paint and the
 * desktop LCP moved from about 0.2 s to about 1 s (SEO round hand-off,
 * docs/seo-round/README.md). So both renderers write the headline and the
 * line under it with these exact classes, from this one module: the baked
 * paint is as large as React's and stays the LCP element.
 */
export const HOME_H1_CLASS =
  "min-h-[3lh] text-[clamp(1.5rem,6vw,2.25rem)] font-semibold leading-tight tracking-tight [overflow-wrap:anywhere] md:min-h-0 md:text-4xl md:leading-[2.75rem]";

export const HOME_SUB_CLASS = "mt-2 max-w-[62ch] text-base text-muted-foreground md:text-lg";
