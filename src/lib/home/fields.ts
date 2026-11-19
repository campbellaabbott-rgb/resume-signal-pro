/**
 * THE FIELD LINKS ON THE HOMEPAGE COME FROM THE BOARD'S CATEGORY LIST.
 *
 * The mockup typed "retail" and "hospitality", and neither page exists: the
 * board has one field, hospitality_retail (review P11). A slug here must be a
 * BoardCategorySlug (src/lib/job-board-categories.ts, the list the field
 * landers and the bake share), so a typo fails the typecheck, and the label is
 * the board's own translated category name (jobsPage.categories.<slug>).
 *
 * THE LARGEST FIELDS (CONTENT-N5, SEO audit 2026-11-18b). The six skipped
 * the largest field on the board: Operations & Logistics, 166,215 open roles
 * on the bake's 2026-11-19 field count, while Education, ninth at 13,492, had
 * a link. Education gives its place to Operations. The bake prints the same
 * list on its "/" (scripts/prerender-seo.mjs reads HOME_FIELD_SLUGS), and
 * each label is copied into the home shard (home.rail.fields.<slug>).
 */
import { BOARD_CATEGORY_SLUGS, type BoardCategorySlug } from "@/lib/job-board-categories";

export const HOME_FIELD_SLUGS = [
  "healthcare",
  "engineering",
  "sales",
  "finance",
  "operations",
  "hospitality_retail",
] as const satisfies readonly BoardCategorySlug[];

export const ALL_FIELDS_PATH = "/explore";

export function fieldPath(slug: BoardCategorySlug): string {
  return `/jobs/field/${slug}`;
}

/** The fields the homepage links, kept to the ones the category list still carries. */
export function homeFields(): BoardCategorySlug[] {
  return HOME_FIELD_SLUGS.filter((s) => (BOARD_CATEGORY_SLUGS as readonly string[]).includes(s));
}
