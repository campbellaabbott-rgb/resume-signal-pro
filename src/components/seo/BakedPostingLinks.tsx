import { useId } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { selectBakedPostingRows, useBakedPostingRows } from "@/lib/seo/posting-manifest";

/**
 * "OPENINGS WITH A PAGE OF THEIR OWN" (CRAWL18B-4 and CRAWL18B-1, SEO audit
 * 2026-11-18b).
 *
 * The bake links the posting pages it wrote from the pages that lead to them
 * (/jobs about 500, a field page 4 to 8, a company page about 7, "/" 8). Once
 * React commits, keep-prerendered-page.ts removes those baked sections and no
 * route drew them again, so a search engine's renderer, which indexes what
 * React draws, found none of them on the hubs it renders.
 *
 * This draws them again from the rows of /posting-pages.json
 * (src/lib/seo/posting-manifest.ts): the field's rows on a field page, the
 * board's rows on a company page, the first `limit` elsewhere. Every link is a
 * path the manifest's live list names (parsePostingManifestRows keeps no
 * other row), so it never links a page the bake did not write or has
 * retired. Until the file has loaded, when it is missing, when it carries no
 * rows (a bake before the rows were added) or when no row matches, it draws
 * nothing at all: no heading over an empty list, and no reserved space.
 */
export interface BakedPostingLinksProps {
  /** Only the rows of this board field (a field page: "design"). */
  field?: string | null;
  /** Only the rows of this employer board (a company page). Its rows then print no employer name. */
  token?: string | null;
  /** At most this many rows, in the bake's order ("/" shows 8). */
  limit?: number;
  /** The heading's level where the section sits: 2 by default, 3 under a page's own h2. */
  headingLevel?: 2 | 3;
  className?: string;
}

export function BakedPostingLinks({ field, token, limit, headingLevel = 2, className }: BakedPostingLinksProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const shown = selectBakedPostingRows(useBakedPostingRows(), { field, token, limit });
  if (shown.length === 0) return null;
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <section data-baked-posting-links="" aria-labelledby={headingId} className={className}>
      <Heading id={headingId} className="mb-2 text-base font-semibold text-foreground">
        {t("listing.bakedPostings.title", "Openings with a page of their own")}
      </Heading>
      <ul className="grid gap-1.5 text-sm">
        {shown.map((r) => (
          <li key={r.path} className="min-w-0 break-words">
            <Link to={r.path} className="text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary">
              {r.title}
            </Link>
            {!token && r.company ? <span className="text-muted-foreground"> · {r.company}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
