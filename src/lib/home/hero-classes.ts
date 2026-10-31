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
/**
 * ON A PHONE THE HEADLINE STARTS AT 30 PX (review round 2026-10-26). At 24 px
 * no block the bake writes outgrew the analytics banner's text, which React
 * renders, so a phone's first-visit LCP waited for the banner's script: 5.6 s
 * against 2.2 s on a slow 4G profile at 4x CPU. At 30-34 px the baked H1 is
 * the largest block from 320 to 414 px and stays the LCP element.
 */
export const HOME_H1_CLASS =
  "min-h-[3lh] text-[clamp(1.875rem,8.2vw,2.25rem)] font-semibold leading-tight tracking-tight [overflow-wrap:anywhere] md:min-h-0 md:text-4xl md:leading-[2.75rem]";

export const HOME_SUB_CLASS = "mt-2 max-w-[62ch] text-base text-muted-foreground md:text-lg";
