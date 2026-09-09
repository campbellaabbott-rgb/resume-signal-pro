// Explore — a way INTO the board, not a leaderboard of twelve employers.
//
// WHY THIS PAGE WAS REBUILT, IN ONE NUMBER. The version this replaces opened on
// a section whose twelve employer cards held 1,812 open roles against ~938,000
// on the board — 0.19% of the inventory, at employers most readers have never
// heard of — while its highest-coverage surface, the field grid, was the
// seventh of seven tabs. The rigour was never the problem; the DENOMINATOR was.
// Twelve employer cards cannot exceed 11.09% of this board and in practice sit
// under 0.5%, so no amount of care spent on those twelve cards could make the
// page reach the reader's market.
//
// WHAT CHANGED, IN ORDER OF VALUE:
//   1. The default view is the FIELD GRID (DEFAULT_INTENT below). Eighteen
//      tiles, ordered by live count, reaching every posting that carries a
//      field plus the uncategorised bucket no field tile can see.
//   2. Under a field, PRICED ROLE ROWS. This adds no new mass — it changes the
//      SIZE OF WHAT YOU LAND IN, which is the actual failure. Every row's
//      number is a real count from the board, and a row we could not price does
//      not render.
//   3. Under the chosen slice, PRICED CONSTRAINT CHIPS carrying both a live
//      count and the live coverage of the column each one filters on.
//   4. LIFECYCLE AT SLICE GRAIN — not a ranking, a narrowing of the slice the
//      reader already has, with the gap in our record said as loudly as the
//      finding.
//   5. The employer lookup, moved to LAST, plus saved searches.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE DESIGN PASS ON THAT GRID, AND THE ONE RULE IT LEAVES BEHIND
// ─────────────────────────────────────────────────────────────────────────────
//
// **IF A NUMBER IS THE SAME ON EVERY TILE, IT IS NOT A TILE NUMBER.** It is one
// sentence in the collapsed panel, said once. A tile figure exists to SEPARATE
// tiles; a figure that reads identically on twelve of them has separated
// nothing and has spent the reader's whole attention budget doing it.
//
// The grid broke that rule twice at once, and both breaks are fixed here.
//
//   COUNT. Six fields all rendered "10,000+", because the tile ran its count
//   through SERVE_COUNT_CAP. That ceiling is count_jobs_capped's answer to a
//   FILTERED query — the board stops counting a filtered result set at 10,000 —
//   and it does not apply to a SCAN. So the header's promise to order the grid
//   "by how many roles are open" was invisible across the six biggest fields,
//   and a 34x spread (operations 144,664 against design 4,230, measured) was
//   hidden behind one string. The tiles now print the board's own per-category
//   facet: exact, uncapped, and — see readCategoryFacet — the very number the
//   destination prints, out of the very row the destination reads it from.
//
//   LIFECYCLE. R(14) spans 0.128–0.243 across the eighteen fields and renders
//   as "up to 16/16/17/17%"; the medians are 27/28/29/30, the last four values
//   the estimator can emit before censoring at FILL_SUPPORT_MAX_DAYS. Twelve
//   tiles, four strings, one statement. It came off the tiles and off the page
//   face entirely, and no per-field curve is fetched on arrival any more.
//
// THE SECOND LINE IS NOW ROLE NAMES, AND CARRIES NO NUMBERS. Across FIELD_ROLES'
// 116 names no name appears in two fields, so names separate tiles COMPLETELY
// where a rounded percentage could not: "registered nurse · medical assistant"
// against "retail sales associate · store manager". Names have no rounding and
// cannot tie.
//
// THE LIFECYCLE ASSET IS NOT DELETED FROM THE PRODUCT. closureRecordOf's
// slice-grain sentence varies, states its own gap, and stays exactly where it
// is. Only the flat field-grain line goes — and its computation goes with it,
// per this page's standing property below.
//
// REFUSED, AND NOT TO BE REINTRODUCED: promoting per-field sub-counts
// (stated_pay_n, remote_mode_n, week_n) onto the tile face. Each is
// coverage-bounded and needs the denominator sentence that was eating the top
// of this page; three per tile is 54 numbers where there are now 18.
//
// WHAT LEFT, AND IT IS NOT THE STATISTICS:
//   • All five twelve-card employer leaderboards AS SECTIONS — "How long do I
//     have", "The dates here are not what they look like", "Still advertised
//     when it crossed day 30", "Who states pay", "Where a beginner has a
//     chance". Their claim builders, their ranking functions, their card
//     renderers and their client-side gates are all deleted with them: this
//     page's own standing property is that a removed section's COMPUTATION goes
//     with it, because arithmetic with no rendered sentence is a number waiting
//     to be re-rendered by someone who does not know why it left.
//   • HIRING_SLICE = 12 as a page concept, and with it every sentence that had
//     to explain that a collection of twelve is not a population.
//
// THE STATISTICS STAY, AT THE GRAIN WHERE THEIR SAMPLE EXISTS — and after the
// design pass that grain is the SLICE, not the field. get_category_fill_curve
// passes its own gates comfortably at field grain; it was removed from this
// page for the two reasons above (it does not differentiate, and its inputs are
// about to stop being admissible — see the note on the closure log below), not
// because a bar was lowered. The moat gets bigger by changing its denominator,
// never by lowering a bar, and never by publishing a figure whose source has
// stopped qualifying.
//
// WHY THE FIELD CURVE HAD TO LEAVE ANYWAY, NOT ONLY BECAUSE IT WAS FLAT.
// get_category_fill_curve reads closed_at and does not filter on
// absence_basis — zero references to that column in its latest definition
// (20260906092000). The column's own COMMENT (20260909010000) says a
// lap_backfill row's closed_at is "KNOWN TO BE LATE, by an unknown amount up to
// the freshness window, so it is not admissible in ANY duration, tenure or
// fill-speed statistic". No lap has completed yet (deepCursor.laps = 0), so
// nothing published today is wrong — but the first proven lap starts writing
// those rows within days and the curve would pool them silently, in a sentence
// on eighteen tiles, in nine languages. A page does not keep a figure it knows
// is about to become inadmissible just because it is still true this week.
//
// STANDING HONESTY RULES, UNCHANGED AND ENFORCED BELOW:
//   • A published statistic names its date basis AND its population.
//   • A deduped count publishes as a floor ("at least N"), never an equality.
//   • Sample gates are mandatory; the curve returns sufficiency — honour it.
//   • A closure NEVER means "hired".
//   • ONE QUANTITY, ONE SCAN. A number on a tile and the same number on the
//     page that tile opens must come from ONE reading, not from two crons
//     fifty-three minutes apart (the explore cache ran 7 * * * *, the facets
//     7,22,37,52 * * * *). That failure is what the reach line was rebuilt to
//     remove three commits ago and it is not being bought back.
//   • A FIGURE IDENTICAL ON EVERY TILE IS NOT A TILE FIGURE. See the design
//     pass above; the new guard test states this as a property rather than as
//     a spelling.
//   • Never publish a number the query could not produce; a total can be null.
//   • A locale VALUE overrides an inline English default, so every sentence
//     whose MEANING changed here takes a NEW key. Editing a key in place would
//     leave seven languages rendering the claim this page stopped making.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Bookmark, Briefcase, Layers, LucideIcon, MapPin, Search, SlidersHorizontal } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
// The methodology disclosure /ghost-jobs and /hiring-trends already use —
// native <details>, in the accessibility tree, zero JS.
import { HowWeMeasure } from "@/components/HowWeMeasure";
import { SavedSearchPills } from "@/components/jobs/SavedSearchPills";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
// ONE MAPPER, TWO CONSUMERS, SO A NUMBER AND ITS DESTINATION CANNOT DRIFT.
// Every priced thing on this page is a JobSearchParams object that is mapped
// TWICE: through searchToBoardBody to produce the count, and through
// searchToQuery to produce the link. That is the entire defence against the
// class of defect that put "38 entry-level roles" on a card whose destination
// showed 900 — the count and the link were two hand-written filter sets.
import { searchName, searchToBoardBody, searchToQuery, type JobSearchParams } from "@/lib/job-search-params";
// isBoardCategory IS THE ROUTE'S OWN PREDICATE, not a second opinion about it.
// App.tsx registers /jobs/field/:category and Jobs.tsx accepts the param only
// when isBoardCategory says so (Jobs.tsx:1519); a tile that linked to a slug
// the lander rejects would land on the generic board with a board-wide number
// over a one-field list — the exact defect this pass exists to close. So the
// tile asks the same predicate the destination asks.
import { BOARD_CATEGORY_SLUGS, isBoardCategory } from "@/lib/job-board-categories";
// THE FILL BAR IS NO LONGER IMPORTED, AND THAT IS THE POINT.
//
// canStateFillRate, coverageBand, FILL_COVERAGE_MIN, FILL_RATE_MIN_TRACKING_DAYS,
// FILL_SUPPORT_MAX_DAYS and URGENT_FILL_MAX_DAYS were imported here so this page
// and /jobs could not publish and refuse the same evidence under two copies of
// one bar. That guard mattered because this page PUBLISHED a fill-rate figure.
// It no longer does — the field-grain lifecycle line is gone — so the honest
// end state is not a re-typed bar but NO BAR AT ALL: there is nothing on this
// page for it to gate. Re-adding any of those names is therefore the signal
// that a fill claim has come back, and the new guard test reads it that way.

/** EVERY LINK THIS PAGE HANDS TO /jobs, WITH THE ONE PARAMETER THE MAPPER
 *  CANNOT CARRY.
 *
 *  Jobs.tsx reads `from=explore` (:1587) and renders its "Back to Explore" link
 *  only on that flag (:6193) — the affordance that stops a discovery page being
 *  a one-way trip. The deleted employer cards each spelled the param by hand,
 *  so when this rebuild routed the tiles, role rows, constraint chips and
 *  country chips through searchToQuery — which does not emit it, and should
 *  not, being the saved-search mapper shared with /jobs itself — every new link
 *  on the page silently lost the way back.
 *
 *  Wrapped rather than added to the mapper so ONE spelling of `from=explore`
 *  exists on this page and a call site cannot quietly omit it. */
const toBoard = (p: JobSearchParams): string => {
  const url = searchToQuery(p);
  return `${url}${url.includes("?") ? "&" : "?"}from=explore`;
};

/** WHERE A FIELD TILE GOES, AND WHY IT IS NOT toBoard({category}).
 *
 *  toBoard produced /jobs?category=healthcare, which is the GENERIC BOARD with
 *  a filter applied — and the generic board's hero prints `totalAllCompanies`,
 *  the BOARD-WIDE figure. Measured on that page: an H1 with no field in it, a
 *  hero reading 815,755 over a healthcare-only list, and a results summary
 *  reading "10,000+". Three numbers for the one field the tile promised, and
 *  not one of them the tile's.
 *
 *  /jobs/field/:id is a different page in the same file. Jobs.tsx:6288 prints
 *  `data.categories[landerCategory]` — the SAME facet entry this tile reads —
 *  under an H1 naming the field, and falls back to the capped total only when
 *  the facet is absent. So the count that won the click survives it.
 *
 *  THE replaceState AT Jobs.tsx:2899 DOES NOT RESCUE THE OLD LINK. It rewrites
 *  the address bar to /jobs/field/:id once the filters match a lander, but
 *  React Router does not observe history.replaceState — useParams keeps
 *  returning undefined, landerCategory stays undefined, and the hero goes on
 *  printing the board-wide number under a URL that says otherwise. A correct
 *  address is not a correct page.
 *
 *  THE UNCATEGORISED BUCKET HAS NO LANDER AND MUST NOT PRETEND TO. `other` is
 *  deliberately absent from BOARD_CATEGORY_SLUGS ("a catch-all bucket, not a
 *  landing page anyone searches for"), so isBoardCategory refuses it and
 *  /jobs/field/other would fall through to the generic board — the very failure
 *  above. It keeps the query link.
 *
 *  ITS TILE DOES CARRY A FIGURE NOW, and the reason the earlier draft withheld
 *  one is the reason it can. The rule was never "the bucket gets no number" but
 *  "no number without a destination that prints it back", and this query link's
 *  destination was printing the board-wide 815,909 over a 174,535-row list —
 *  the same defect the seventeen field landers were built to remove, surviving
 *  in the one bucket with no lander. Fixed where it was: Jobs.tsx now reads the
 *  response's own category facet whenever a single category is the only filter,
 *  not only when a ROUTE PARAM produced it, so /jobs?category=other prints the
 *  same integer this tile does. Tile and destination, one scan, as everywhere
 *  else on this grid. */
const fieldHref = (id: string): string =>
  isBoardCategory(id) ? `/jobs/field/${id}?from=explore` : toBoard({ category: id });

const rpc = (fn: string, args?: Record<string, unknown>) =>
  (supabase as unknown as { rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error?: unknown }> }).rpc(fn, args);

/** The saved-search table, typed to the ONE operation this page performs.
 *  `code` is read because 23505 (UNIQUE(user_id, name)) means "you already
 *  saved this", which is a different message from a failure and must not
 *  borrow its sentence. */
const searchesTable = () => (supabase as unknown as {
  from: (t: string) => {
    insert: (row: { user_id: string; name: string; params: JobSearchParams }) =>
      Promise<{ error: { code?: string; message?: string } | null }>;
  };
}).from("user_job_searches");

/** COERCE AT THE BOUNDARY, ONCE. An absent column reads as null, which is a
 *  REFUSAL rather than a zero: a gate that cannot be evaluated must suppress
 *  the claim, not pass it.
 *
 *  Exported because the guard test drives the claim builders below with real
 *  payload shapes — including the PostgREST build that sends `numeric` as a
 *  STRING, where `"0.42" >= 0.3` is true by string collation for the wrong
 *  reason. */
export const numOr = (v: unknown, fallback: number | null = null): number | null => {
  if (v === null || v === undefined || v === "") return fallback;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** THE ARITHMETIC BAR, MIRRORED FROM Jobs.tsx:354 (ACTIVELY_HIRING_MIN_CLOSED).
 *
 *  It is the ONE constant on this page that could not be imported: /jobs
 *  declares it without exporting it, and this workflow does not own that file.
 *  Mirrored deliberately and named here so the duplication is visible rather
 *  than accidental — if /jobs ever exports it, this line is what to delete.
 *
 *  DELIBERATELY NOT GATED ON `sufficient`, and that is the whole reason section
 *  4 can speak where the deleted employer sections could not: "this employer
 *  has taken down three roles and not put them back up" is ARITHMETIC over
 *  events we logged, and it stays true on a record far too thin to carry a
 *  rate. The estimator bar governs rates; this one governs counting. */
const CLOSURE_MIN_FILLS = 3;

/** How many of the slice's own result rows we read to find the employers in it.
 *  One board page. Every distinct token among them goes to the curve in one
 *  batch, and the sentence on screen names BOTH numbers — the rows read and the
 *  employers found — because "the employers in the first sixty results" is a
 *  different claim from "the biggest employers in the slice", and only the
 *  first one is true. */
const CLOSURE_ROWS = 60;

/** MIRRORS `COUNT_CAP` in supabase/functions/job-board/index.ts.
 *
 *  WHAT IT IS: the ceiling count_jobs_capped applies to a FILTERED count. A
 *  role row, a constraint chip and a country chip are all filtered counts, so
 *  each of them can genuinely come back capped and each renders "10,000+" —
 *  never the cap presented as an equality.
 *
 *  WHAT IT IS NOT, AND THIS IS THE CORRECTION: a property of a SCAN. The tiles
 *  used to run through this ceiling on the argument that a tile must agree with
 *  the page it opens, and the argument was sound while the tile's number came
 *  from a different scan than the page's. It does not any more. The board's
 *  category facet is a grouped count over the serving population, taken once
 *  per refresh pass and stored in ONE row that BOTH surfaces read (see
 *  readCategoryFacet), so the tile and the lander print the same exact integer
 *  with nothing to reconcile. Putting a filtered-query ceiling over it made six
 *  of eighteen tiles say "10,000+" — measured: operations 144,664, healthcare
 *  109,811, hospitality_retail 80,414, sales 77,954, engineering 73,841 and the
 *  uncategorised bucket 174,535, all six rendered as one string — which hid a
 *  34x spread and silently falsified the section header's claim to be ordered
 *  by size.
 *
 *  THE TILES DO NOT PASS THROUGH THIS CONSTANT. Only pricedLabel does. */
const SERVE_COUNT_CAP = 10_000;

/** STALE_AFTER_MS IS GONE, WITH THE SENTENCE IT GATED.
 *
 *  It measured the AGE OF THE HOURLY EXPLORE CACHE and drove one warning: "the
 *  hourly refresh has not completed since then — everything below is from that
 *  run, not from now". Nothing below is from that run any more. The tile
 *  numbers come from the board's own facet and carry the board's own
 *  `refreshedAt` in the sentence above them; the counts inside a field are live
 *  probes taken at click time; the only thing left reading the explore cache is
 *  the employer check's churn index. A three-hour clock on a cache that no
 *  longer dates anything on screen would be a warning about the wrong scan —
 *  and `stale_parts` still names any collection the last refresh could not
 *  recompute, which is the disclosure that was actually doing the work. */

/** Collections this page no longer renders. A refresh that could not recompute
 *  one of them says nothing about what is on this screen, and naming it in the
 *  staleness warning is a false alarm about a section that does not exist.
 *
 *  FIVE NAMES JOINED THIS SET IN THE REBUILD — hiring, relisting, entry,
 *  transparent and salary — because the five employer leaderboards they fed are
 *  gone. Unknown names are still KEPT: a part we have not heard of may well be
 *  one we render tomorrow, and swallowing it would hide a real failure.
 *
 *  THREE MORE JOINED IT WHEN THE CACHE WRITER GREW KEYS THIS PAGE DOES NOT
 *  READ. role_rows, chip_coverage and ageout_basis are all written by
 *  refresh_explore_cache and read by nothing here — the roles and the chips are
 *  priced by live probes at click time, and the age-out basis belonged to a
 *  deleted section. role_rows is the one that would have fired on its own:
 *  refresh_explore_role_rows runs on a SEPARATE six-hourly cron, so until its
 *  first tick the read-through finds nothing and the hourly refresh names
 *  role_rows stale — a yellow warning, in a raw internal spelling, about a
 *  section this page does not have.
 *
 *  FOUR MORE JOINED THE SET IN THE DESIGN PASS, and they are the four the page
 *  used to build its tiles out of:
 *
 *    fields, field_grid — the tile counts and the reach pair. Both now come off
 *      the board's own category facet in ONE read, alongside the very number
 *      the destination prints. Keeping the cache as a second source for the
 *      same quantity is exactly the two-scans-one-number failure the reach line
 *      was rebuilt to remove; the cache row is not consulted for a tile at all.
 *    field_curves — the field-grain lifecycle line is gone, and with it the
 *      only reader of this key. It was deliberately NOT retired while that line
 *      existed ("it IS read, and its staleness is this page's business"); the
 *      inverse is just as strictly true now that nothing here reads it, or the
 *      page would fly a yellow warning about a collection it does not render.
 *    totals — get_explore_denominators' pool sizes. The last sentence standing
 *      over one of them was the old reach fraction, and it has gone too. */
const RETIRED_CACHE_PARTS = new Set([
  "trending", "newest", "segments", "reposters",
  "hiring", "relisting", "entry", "transparent", "salary",
  "role_rows", "chip_coverage", "ageout_basis",
  "fields", "field_grid", "field_curves", "totals",
]);

/** THE BOARD'S SERVING WINDOW, MIRRORED — AND IT IS NOT THE CURVE'S SUPPORT CAP.
 *
 *  IT NOW MIRRORS THE FACET'S OWN PREDICATE, which is where the tile numbers
 *  come from: `missing_since IS NULL AND effective_posted >= now() - interval
 *  '30 days'`, in refresh_job_board_facets' categoriesFacet
 *  (20260825190000 — the migration that put the category rail under the serving
 *  rule so "the rail sums to openTotal rather than to the raw table count").
 *  That is how far back the board will serve, and therefore what every tile
 *  COUNTS.
 *
 *  IT IS NOT THE CURVE'S SUPPORT CAP, and that distinction is why this constant
 *  exists at all. FILL_SUPPORT_MAX_DAYS (Jobs.tsx:379) is how far out the
 *  closure curve may be read before a median is reported as censored, and its
 *  own comment anticipates it moving. The tile method sentence used to
 *  interpolate the CURVE's cap to describe the SERVING window: move
 *  FILL_SUPPORT_MAX_DAYS to 45 and that sentence would have started saying
 *  "inside our 45-day freshness window" over counts still taken at 30, in nine
 *  languages, with no edit on this page. The curve is gone from this page now
 *  and the trap with it — but the mirror stays, because the sentence still
 *  names a window and the window still lives in SQL. If the facet's interval
 *  moves, this line moves in the same commit. */
const SERVE_WINDOW_DAYS = 30;

/** A ROLE ROW IS ONLY WORTH A CLICK IF IT LANDS ON A LIST. Section 2 exists to
 *  change the SIZE of what a reader lands in, so a row opening four results
 *  reproduces the very failure the section was added to fix, one grain down.
 *  Rows below this floor are withheld and SAID to be withheld — never silently
 *  dropped into the "nothing matched" sentence, which would be a false
 *  statement about the board. */
const ROLE_ROW_MIN = 25;

/** The uncategorised bucket's category VALUE, and the tile that reaches it.
 *
 *  MEASURED CORRECTION TO THE OBVIOUS ROUTE. `?inclUncat=1` alone reaches
 *  nothing: filters.ts:461 requires a category before the widening applies
 *  (`category !== null && !category.split(",").includes("other") &&
 *  body.includeUncategorised === true`), so a bare inclUncat is dropped and the
 *  link would open the whole unfiltered board under a tile promising the
 *  uncategorised rows. `category=other` is the value that actually selects
 *  them — filters.ts:1051 passes it straight through as the category param, and
 *  Jobs.tsx reads `category` from the URL without validating it against
 *  BOARD_CATEGORY_SLUGS, so the destination initialises with the bucket
 *  selected.
 *
 *  AND THAT ROUTE IS ALSO WHY THIS TILE CARRIES NO NUMBER. The board's facet
 *  does hold a count for it (174,535, measured — a fifth of the servable board,
 *  the single largest bucket on the grid). But `other` is deliberately absent
 *  from BOARD_CATEGORY_SLUGS, so there is no /jobs/field/other, so the one
 *  destination this tile can reach is the generic board — whose hero prints the
 *  BOARD-WIDE total. Printing 174,535 on a tile that opens a page reading
 *  815,755 is the precise defect this pass removed from the other seventeen,
 *  and it is not worth reintroducing for one tile. The bucket keeps its tile,
 *  because it is a door to rows no field tile reaches, and it says in words
 *  that it makes no claim about depth — the same treatment a field under the
 *  scan's floor has always had. The day `other` gets a lander of its own is the
 *  day this tile may carry its count, and not before. */
const UNCATEGORISED = "other";

/** HOW MANY ROLE NAMES RIDE THE TILE FACE.
 *
 *  Three, and the value is the whole design of the second line. The names are
 *  the strongest DISCRIMINATOR the page has: across FIELD_ROLES' 116 names no
 *  name appears in two fields, so any one of them identifies its tile
 *  uniquely — where the retired lifecycle line rendered four distinct strings
 *  across eighteen tiles and the retired capped count rendered one string
 *  across six. One name would separate the tiles just as completely; three is
 *  the count at which the line also SHOWS THE SHAPE of a field ("registered
 *  nurse · medical assistant · certified nursing assistant" is a clinical
 *  field, not a hospital-admin one) while still fitting one line on a phone.
 *
 *  THEY CARRY NO FIGURES, BY RULE. A number here would be a fourth number on a
 *  tile that already has one, and the counts for these names exist — priced
 *  live, one probe each — one click away inside the panel. */
const TILE_ROLE_NAMES = 3;

const CATEGORY_LABELS: Record<string, string> = {
  engineering: "Engineering & IT", data_ai: "Data & AI", design: "Design", product: "Product",
  marketing: "Marketing & Comms", sales: "Sales & Partnerships", customer: "Customer Success",
  finance: "Finance & Accounting", legal: "Legal & Compliance", people_hr: "People & Recruiting",
  operations: "Operations & Logistics", healthcare: "Healthcare & Clinical", science: "Science & Research",
  education: "Education", hospitality_retail: "Hospitality & Retail", security: "Security & Trust",
  admin: "Administrative", [UNCATEGORISED]: "Other",
};

/** THE ROLE VOCABULARY, AND WHAT IT IS AND IS NOT.
 *
 *  IT IS OURS, NOT A MEASUREMENT. These are the role names a reader recognises,
 *  chosen per field; nothing here is a claim about the board. Every row's
 *  NUMBER is a live count from the serving API for exactly the query the row's
 *  link carries, and a row whose probe returns nothing DOES NOT RENDER. So a
 *  role we guessed wrong costs a missing row, never a wrong number — which is
 *  the only way a curated list is allowed on this page.
 *
 *  WHY A VOCABULARY AT ALL, when 20260908130000 already ported
 *  normalizeCloseTitle into SQL as normalize_close_title(text): that function
 *  is exactly the key a role vocabulary needs — it collapses requisition-number
 *  and seniority variants onto one group — but it lives on the CLOSURE log,
 *  which has no anon read path, and mining it into a ranked list of titles is a
 *  migration this workflow does not own. scripts/role-vocab-gaps.ts already
 *  ranks normalised board titles by posting count and is the tool that should
 *  replace this constant the day a cached role table exists. Until then the
 *  honest arrangement is a named list priced by real probes, with the list's
 *  authorship stated on screen.
 *
 *  The spellings lean on supabase/functions/job-board/search-alias.ts: it
 *  expands "rn" to "registered nurse" and "sdr" to "sales development
 *  representative", so the FULL spellings here are the ones that match the most
 *  postings and the shorthand a reader types still reaches them. */
export const FIELD_ROLES: Record<string, readonly string[]> = {
  engineering: ["software engineer", "mechanical engineer", "electrical engineer", "project engineer", "devops engineer", "quality engineer", "systems engineer", "maintenance technician"],
  data_ai: ["data analyst", "data engineer", "data scientist", "machine learning engineer", "business intelligence analyst", "database administrator", "analytics manager"],
  design: ["graphic designer", "product designer", "ux designer", "interior designer", "ui designer", "design manager"],
  product: ["product manager", "product owner", "program manager", "technical program manager", "product analyst", "business analyst"],
  marketing: ["marketing manager", "digital marketing specialist", "content writer", "social media manager", "brand manager", "communications specialist", "marketing coordinator"],
  sales: ["account executive", "sales representative", "sales manager", "account manager", "business development representative", "inside sales representative", "sales engineer"],
  customer: ["customer service representative", "customer success manager", "technical support specialist", "call center representative", "client services manager", "support engineer"],
  finance: ["accountant", "financial analyst", "controller", "accounts payable specialist", "auditor", "bookkeeper", "payroll specialist", "tax accountant"],
  legal: ["paralegal", "attorney", "compliance officer", "legal counsel", "contracts manager", "legal assistant"],
  people_hr: ["recruiter", "human resources generalist", "talent acquisition specialist", "human resources manager", "hr business partner", "benefits specialist"],
  operations: ["operations manager", "warehouse associate", "logistics coordinator", "supply chain analyst", "production supervisor", "truck driver", "forklift operator", "inventory specialist"],
  healthcare: ["registered nurse", "medical assistant", "certified nursing assistant", "physical therapist", "pharmacist", "nurse practitioner", "licensed practical nurse", "medical technologist"],
  science: ["research scientist", "laboratory technician", "clinical research associate", "chemist", "research associate", "quality control analyst"],
  education: ["teacher", "instructional designer", "school counselor", "professor", "teaching assistant", "tutor", "principal"],
  hospitality_retail: ["retail sales associate", "store manager", "server", "cook", "bartender", "housekeeper", "front desk agent", "shift supervisor"],
  security: ["security officer", "information security analyst", "security engineer", "cybersecurity analyst", "security guard", "trust and safety analyst"],
  admin: ["administrative assistant", "executive assistant", "office manager", "receptionist", "data entry clerk", "scheduler"],
};

/** THE SEVEN CONSTRAINTS A READER ACTUALLY NARROWS BY, and the column each one
 *  can see.
 *
 *  COMPOSED, NOT CONSTRUCTED. Every one of these is a JobSearchParams patch —
 *  filters.ts:99-295 already accepts the whole set, normalizeFilters already
 *  refuses contradictory bands, and ignoredFilters already NAMES anything it
 *  dropped. Nothing here re-implements a filter; it hands the existing one a
 *  slice and reads back what the server says about it.
 *
 *  `coverageKey` NAMES THE filterCoverage FIELD THE SERVER RETURNS FOR THIS
 *  FILTER, and the chip prints THAT number — never a constant of ours. See the
 *  long note on PayCoverage below for why a pinned percentage was not an
 *  option here.
 *
 *  A `null` coverageKey MEANS THE SERVER PUBLISHES NO FIGURE FOR THIS FILTER,
 *  AND IT COMES IN TWO KINDS THAT MUST NOT SHARE A RENDER:
 *
 *    sendableOnly — genuinely complete. It filters on `source`, which every
 *      served row carries, so there is no hidden population and a "100%" line
 *      would be noise.
 *
 *    maxAgeDays — THE OPPOSITE, and this was shipped the wrong way round. It
 *      does NOT filter on effective_posted: the board applies
 *      `q.gte("posted_at", …)` (job-board/index.ts:13787, and count_jobs_capped
 *      itself), the EMPLOYER'S own stated date, because our discovery date is
 *      not a posting age. Whole vendors are structurally undated — bamboohr
 *      43,687 of 43,687, rippling 8,991 of 8,991 — and every one of those rows
 *      is silently excluded by this chip however new it is. So it is the chip
 *      hiding the MOST, and it was the only one disclosing nothing, directly
 *      under a note teaching readers that a chip with no percentage is one we
 *      hold no reading for. get_filter_coverage publishes the fraction as
 *      `dated` (20260909100000) but coverageDisclosure has no branch for
 *      maxAgeDays, so no number reaches this page — and the honest render of a
 *      number we cannot get is the exclusion IN WORDS, which is `note`.
 *
 *  `note` therefore states an exclusion the server will not quantify. It is not
 *  a substitute for a coverage figure and no chip may carry both. */
export interface ConstraintChip {
  id: string;
  /** The English fallback; the render interpolates a t() key built from `id`. */
  label: string;
  patch: JobSearchParams;
  coverageKey: string | null;
  /** An exclusion this filter makes that no published figure measures, said in
   *  words on the chip. English fallback; the key is `explore.chipNote.{id}`. */
  note?: string;
}

export const CONSTRAINT_CHIPS: readonly ConstraintChip[] = [
  { id: "remote", label: "Remote", patch: { workMode: "remote" }, coverageKey: "workMode" },
  { id: "onsite", label: "On-site", patch: { workMode: "onsite" }, coverageKey: "workMode" },
  { id: "statedPay", label: "States the pay", patch: { hasStatedPay: true }, coverageKey: "hasStatedPay" },
  { id: "pay80k", label: "$80,000+", patch: { salaryFloor: 80_000 }, coverageKey: "salaryFloor" },
  { id: "entry", label: "Open to beginners", patch: { experience: "entry" }, coverageKey: "experience" },
  { id: "fullTime", label: "Full-time", patch: { employmentType: "full_time" }, coverageKey: "employmentType" },
  { id: "week", label: "Posted this week", patch: { maxAgeDays: 7 }, coverageKey: null, note: "roles carrying the employer's own date only" },
  { id: "apply", label: "One-click apply", patch: { sendableOnly: true }, coverageKey: null },
];

/** WHERE, AS A CANONICAL VALUE RATHER THAN A TYPED STRING.
 *
 *  The brief for this rebuild asked for a location tier under each role, and
 *  the honest form of it is COUNTRY, not city. `location` is free text matched
 *  against whatever the employer wrote, so "canonical" is a property it does
 *  not have and a hand-written metro list would be a curated denominator
 *  pricing nothing. `country` is ISO-2, the board filters on the column
 *  directly, and it is one of the ten filters the server publishes a coverage
 *  figure for — so a country chip can say both how many roles and how much of
 *  the board could even answer. A country with no roles in the slice is priced
 *  at nothing and does not render. */
export const COUNTRY_CHIPS: readonly { id: string; label: string }[] = [
  { id: "US", label: "United States" },
  { id: "GB", label: "United Kingdom" },
  { id: "CA", label: "Canada" },
  { id: "DE", label: "Germany" },
  { id: "AU", label: "Australia" },
  { id: "IN", label: "India" },
];

/** THE FIELD CURVE'S ROW TYPE IS GONE, WITH ITS SENTENCE.
 *
 *  FieldCurveRow, FieldLifecycle and fieldLifecycleOf all lived here to build
 *  the flat field-grain lifecycle line, and this page's standing property is
 *  that a removed section's COMPUTATION goes with it — "arithmetic with no
 *  rendered sentence is a number waiting to be re-rendered by someone who does
 *  not know why it left". That applies with unusual force here, because the
 *  reason it left is not only that it read the same on twelve tiles:
 *  get_category_fill_curve pools lap_backfill closures whose closed_at its own
 *  column comment declares inadmissible in any duration statistic. A dormant
 *  estimator sitting in this file would be re-rendered by exactly the reader
 *  that comment is warning.
 *
 *  get_company_fill_curve's row type below is NOT that, and stays: section 4
 *  counts events, it does not time them. */

/** ONE ROW OF get_company_fill_curve, reduced to the counts section 4 divides
 *  and compares. Deliberately NOT the rate columns: section 4 makes an
 *  arithmetic statement and must not acquire the ability to make a rate one.
 *
 *  ageouts_90d IS HERE FOR THE ABSENCE TEST, not for a sentence. See
 *  closureRecordOf: the three _90d counts together are the only way to tell an
 *  employer we have logged nothing about from one whose log we have read. */
interface CompanyCurveRow {
  company_token?: string;
  fills_90d?: number | string | null;
  relists_90d?: number | string | null;
  ageouts_90d?: number | string | null;
  tracking_days?: number | string | null;
}

/** ONE HIT FROM get_company_suggest, with the two counts the check answer needs.
 *
 *  `open_roles` is an EXACT count of what /jobs/company/{token} serves (both
 *  serving predicates) and a FLOOR on the employer's own hiring, because
 *  paginated vendors are read a page at a time. `feed_total` is the employer's
 *  own advertised number and `feed_total_at` the day we read it — and the SQL
 *  returns both ONLY for an employer we carry a single board for, because
 *  summing several boards' totals read on different days is a figure with no
 *  date basis. */
interface SuggestHit {
  name: string; tokens: string[];
  open_roles?: number | string | null;
  /** ABSENT (undefined) on a build where get_company_suggest still returns
   *  (name, tokens) alone — the deploy window before 20260908136000. That is a
   *  statement about our instrument and must not be rendered as one about the
   *  employer, which is why the refusal below tests for the KEY and not only
   *  for a value. PostgREST sends a NULL column as a present key, so `null`
   *  here really does mean "we hold no reading". */
  feed_total?: number | string | null;
  feed_total_at?: string | null;
}

/** THE ONLY PATH feed_total TAKES ONTO THIS PAGE.
 *
 *  1. The employer's own total must be larger than what we hold, or there is no
 *     gap to report and printing it invites the comparison anyway.
 *  2. It must carry the day it was read. job_board_verifications keeps ONE ROW
 *     PER BOARD and is UPSERTed on every fetch, so it has no history: without
 *     the stamp the number reads as current when it may be three weeks stale.
 *  3. We must know our own count, because the sentence is a comparison.
 *
 *  IT RETURNS TWO NUMBERS AND NEVER A RATIO. Ours is a floor on what we hold;
 *  theirs is one stale reading of what they advertise. 678/19,265 is not a
 *  coverage percentage, it is a division of two quantities measured on
 *  different days under different definitions, and there is no sentence on this
 *  page that may perform it. */
export function feedTotalClaim(
  open: number | null, feedTotal: number | null, feedTotalAt: string | null,
): { open: number; total: number; at: string } | null {
  if (open === null || feedTotal === null || feedTotalAt === null) return null;
  if (!(feedTotal > open)) return null;
  return { open, total: feedTotal, at: feedTotalAt };
}

/** THE ONE SCAN EVERY TILE NUMBER COMES FROM — AND THE ONE THE DESTINATION
 *  PRINTS FROM TOO.
 *
 *  `categories` is the board's own per-field facet. It is computed once per
 *  refresh pass by refresh_job_board_facets under exactly the serving rule
 *  (`missing_since IS NULL AND effective_posted >= now() - interval '30 days'`,
 *  20260825190000), stored in ONE job_board_meta row, and read back out of that
 *  row by every list exit through visibleCategories (clusters.ts:104-113):
 *
 *    unfiltered  → the WHOLE map, which is what this page asks for.
 *    filtered    → the ONE entry for the active category, "scoped to exactly
 *                  what the reader filtered, so it cannot overstate", which is
 *                  what /jobs/field/:id prints in its hero (Jobs.tsx:6288).
 *
 *  SO THE TILE AND ITS LANDING PAGE ARE NOT TWO NUMBERS THAT AGREE — THEY ARE
 *  ONE NUMBER READ TWICE. Verified against production while this was written,
 *  same minute, same `refreshedAt` of 2026-09-09T14:07:54.645Z:
 *
 *    body {action:list, limit:1}                     → categories.engineering 73,841
 *    body {action:list, limit:1, category:engineering} → categories {engineering: 73,841}
 *                                                       total 10,000, countCapped true
 *
 *  That second line is also the whole argument for reading the facet rather
 *  than a count: `total` on the destination is the CAPPED filtered count, which
 *  is where "10,000+" came from on both surfaces. The facet is exact and
 *  uncapped, and it is the figure the lander actually renders.
 *
 *  `at` is the response's own `refreshedAt` — the stamp on the row the counts
 *  came out of. It is the date basis for all eighteen numbers at once, which is
 *  why the page can carry them under ONE sentence instead of one per tile.
 *
 *  IT ASKS FOR THE FACET, NOT FOR A PAGE OF JOBS. This used to send
 *  {action:"list", limit:1, includeFacets:false} and take `categories` off an
 *  otherwise-discarded list reply. That worked and cost three things: it wrote
 *  a job_board_search_events row on EVERY view of this page (an unfiltered,
 *  q-less list falls to the recency exit, which logs immediately before
 *  returning — a prerendered, daily-sitemapped page quietly biasing the browse
 *  denominator with a search nobody performed); it paid page_query and
 *  attachRecheckedAt for a one-row page it threw away, measured at 30.7s during
 *  the 2026-08-30 saturation incident; and it had no way to see facetsCarried,
 *  which rides the served row but appeared in no list response.
 *
 *  action:"facets" (BUILD_VERSION 2026-09-09.67) reads the SAME
 *  job_board_meta k='refresh_head' row through the SAME visibleCategories rule,
 *  so the single-source property is untouched — it is the same integer the
 *  field lander prints, reached without the browse. It is NOT
 *  rpc("get_job_board_facets"), which reads k='facets': a different row, and
 *  the two-scans-for-one-quantity failure this page was rebuilt to remove. */
interface BoardFacet {
  categories: Record<string, number>;
  /** NEVER null. See readCategoryFacet: a facet with no stamp is a failed read,
   *  because this page's first standing rule is that a published statistic
   *  names its date basis, and eighteen exact six-figure integers under a
   *  sentence with an empty gap where the date should be is that rule broken
   *  silently -- the tiles still carry numbers, so nothing looks wrong. */
  at: string;
  /** TRUE when these counts are a PREVIOUS pass's, carried forward through a
   *  failed facet aggregate and re-stamped with the current pass time. `at` is
   *  then the time of the pass, not of the count, and the basis sentence must
   *  say so. */
  carried: boolean;
  /** When the carried counts were actually taken. Null when the row did not
   *  carry the marker (so the sentence names an earlier scan without pretending
   *  to know which one). */
  countedAt: string | null;
}

/** How long the grid waits for its numbers before saying it could not get them.
 *
 *  A FAILURE MUST BE FAST AND STATED, NOT A LONG BLANK GRID. The old read had
 *  no client deadline at all, and the edge function's own notes record a
 *  {limit:1} list call measured at 30,728ms during the 2026-08-30 saturation
 *  incident. Eighteen tiles render no numbers until this resolves, on a page
 *  that is prerendered and sitemapped daily — so an unbounded wait shows a
 *  reader a grid of bare labels with no explanation for half a minute.
 *  action:"facets" is one indexed single-row read and should answer in
 *  milliseconds; if it has not answered in six seconds something is wrong, and
 *  basisNone says so truthfully. */
const FACET_DEADLINE_MS = 6000;

async function readCategoryFacet(): Promise<BoardFacet | null> {
  try {
    const { data, error } = await Promise.race([
      supabase.functions.invoke("job-board", { body: { action: "facets" } }),
      new Promise<{ data: null; error: true }>((res) =>
        setTimeout(() => res({ data: null, error: true }), FACET_DEADLINE_MS)),
    ]);
    if (error) return null;
    const r = (data ?? null) as { categories?: unknown; refreshedAt?: unknown; facetsCarried?: unknown; facetsCarriedAt?: unknown } | null;
    const raw = r?.categories;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      // A ZERO OR A NON-NUMBER IS NOT A TILE NUMBER. The facet omits a category
      // with nothing in it rather than sending 0, so a 0 arriving here is a
      // shape we do not understand — and this page's standing rule is that a
      // number the query could not produce is never published.
      const n = numOr(v);
      if (k && n !== null && n > 0) out[k] = n;
    }
    if (Object.keys(out).length === 0) return null;
    // A COUNT WITHOUT ITS STAMP IS NOT PUBLISHABLE, so it is not returned.
    //
    // refreshedAt is genuinely nullable on the serving path -- the list exits
    // all coalesce it to null, and refresh_headline_open patches coverage into
    // a refresh_head row without touching it -- so a row carrying
    // categoriesFacet and no refreshedAt is reachable. This used to return
    // `at: null`, and the basis sentence interpolated it as "", rendering "All
    // 815,525 roles the board can serve, in eighteen fields -- counted  in the
    // board's own scan". Eighteen exact integers with no date basis at all,
    // presented as though they had one. facetFailed already has the sentence
    // for a read we could not make; this IS one.
    const at = r?.refreshedAt;
    if (typeof at !== "string" || at === "") return null;
    // CARRIED COUNTS ARE LAST PASS'S, UNDER THIS PASS'S STAMP.
    //
    // When refresh_job_board_facets fails, the refresh pass copies the previous
    // categoriesFacet forward and writes it with refreshedAt = the CURRENT pass
    // time. Both halves are deliberate on the writer's side (the maintenance
    // below it must not be switched off by one failing aggregate), and together
    // they mean `at` is not the time these integers were counted. The row says
    // so — facetsCarried, and facetsCarriedAt, which IS the time they were
    // counted — and the sentence below prints that instead of the false one.
    // Measured failure window: 4+ hours on 2026-08-29.
    const carriedAt = r?.facetsCarriedAt;
    return {
      categories: out,
      at,
      carried: r?.facetsCarried === true,
      countedAt: typeof carriedAt === "string" && carriedAt !== "" ? carriedAt : null,
    };
  } catch {
    return null;
  }
}

/** token -> [repost_events, reposted_roles, days_tracked]. Kept for the
 *  employer check alone: a reader typing a company name has already decided to
 *  consider that employer, and this is the last moment before they leave. */
type RepostIndex = Record<string, [number, number, number] | undefined>;

// ─────────────────────────────────────────────────────────────────────────────
// THE PAGE'S TWO ANSWERS
// ─────────────────────────────────────────────────────────────────────────────

/** THE ANSWERS, IN RENDER ORDER, AND THE DEFAULT IS THE FIRST OF THEM.
 *
 *  `fields` and `check` keep the ids they have always had, so every shared
 *  /explore?i=fields and /explore?i=check link still lands where it named.
 *  The five leaderboard ids (`hiring`, `ghost`, `aged`, `pay`, `entry`) are
 *  GONE and isIntent rejects them, exactly as it already rejected `scale`: a
 *  retired id falls back to DEFAULT_INTENT rather than silently showing a
 *  reader something other than what their link said. */
export type Intent = "fields" | "check";
export const INTENTS: readonly Intent[] = ["fields", "check"];

/**
 * THE SINGLE HIGHEST-VALUE LINE ON THIS PAGE.
 *
 * The page opens on the field grid. That one change moves the default view from
 * a section reaching 0.19% of the board to one reaching every posting that
 * carries a field plus the uncategorised bucket — a change in reach of roughly
 * two and a half orders of magnitude, bought by moving a default and attaching
 * RPCs that already existed, without lowering a single gate.
 *
 * DECLARED AS AN EXPORTED CONSTANT RATHER THAN TYPED INTO useState, so the
 * property is assertable from outside the render and cannot be undone by an
 * edit that looks local. The guard test reads THIS, the initial state that
 * consumes it, and the rendered page.
 */
export const DEFAULT_INTENT: Intent = "fields";

const isIntent = (v: string | null): v is Intent => !!v && (INTENTS as readonly string[]).includes(v);

// ─────────────────────────────────────────────────────────────────────────────
// THE CLAIMS. Each builder returns a fully-formed statement or a named refusal,
// and a refusal is STATED rather than left as a gap. No renderer below composes
// a figure from a row directly, so there is no path on which a number reaches
// the screen without the window it was measured over.
// ─────────────────────────────────────────────────────────────────────────────

/** THE FIELD-GRAIN LIFECYCLE CLAIM USED TO BE BUILT HERE, AND IT IS NOT
 *  COMING BACK AS A TILE FIGURE.
 *
 *  fieldLifecycleOf mapped one get_category_fill_curve row onto one of five
 *  outcomes — median, censored, window, thin, absent — and its renderer put the
 *  result under every field name. The estimator was never the problem: it
 *  passed its own gates comfortably at field grain, which is exactly why it was
 *  brought here. What it could not do was SEPARATE EIGHTEEN TILES.
 *
 *    R(14) across the eighteen fields:  0.128 - 0.243
 *    ...as rendered, to the point:      "up to 16%" / "16%" / "17%" / "17%"
 *    medians, in days:                  27 / 28 / 29 / 30
 *
 *  Thirty is FILL_SUPPORT_MAX_DAYS, so those medians are the last four values
 *  the estimator can emit before it censors. Twelve tiles, four strings, one
 *  statement — a figure that costs a reader a line on every tile and hands them
 *  no way to tell one tile from another is not a tile figure. It is a sentence,
 *  and a sentence belongs in the collapsed panel, said once, or nowhere.
 *
 *  IT WOULD ALSO HAVE GONE FALSE ON ITS OWN. See the header: the curve reads
 *  closed_at without filtering absence_basis, and lap_backfill rows — which the
 *  column's own COMMENT declares inadmissible in ANY duration, tenure or
 *  fill-speed statistic — start being written the moment the first lap
 *  completes. Nothing it published today was wrong; everything it published
 *  next week would have been, silently, in nine languages.
 *
 *  WHAT STAYS: closureRecordOf, immediately below. It COUNTS events (fills,
 *  re-lists and age-outs over 90 days) rather than TIMING them, so no closed_at
 *  timestamp enters its arithmetic and the absence_basis hazard does not reach
 *  it; it varies per slice; and it already states its own gap as loudly as its
 *  finding. The lifecycle asset is not deleted from the product — it is kept at
 *  the one grain where it says something a reader could not have guessed.
 */

/**
 * SECTION 4'S CLAIM: THE CLOSURE RECORD FOR THE SLICE THE READER IS IN.
 *
 * NOT A LEADERBOARD. It narrows the slice the reader already has, and it says
 * the GAP IN OUR RECORD as loudly as the finding:
 *
 *   "118 employers have data-analyst roles here. We have a readable closure
 *    record for 9 of them. 7 of those 9 close roles and do not put them back
 *    up."
 *
 * THREE DENOMINATORS, AND ALL THREE ARE NAMED, because they are three different
 * populations and this page's whole defect history is populations swapped for
 * each other:
 *
 *   inSlice  — companiesCount from the board's own facet. The employers with a
 *              posting in this slice. NULL when the server did not compute it;
 *              never defaulted to the facet array's length, which is a TOP-N
 *              slice capped for payload weight.
 *   asked    — how many tokens we could actually hand to the curve. The facet
 *              array is capped, so this is at most the top employers by count
 *              and the sentence says so rather than implying we asked about all
 *              of them.
 *   readable — of those, how many the closure log HAS ANYTHING IN IT FOR.
 *
 * WHAT "READABLE" HAD TO BECOME, AND WHY THE OBVIOUS TEST WAS A FALSEHOOD.
 * This once tested `fills_90d === null || relists_90d === null`, which reads
 * like the right refusal and is a branch that can never be taken:
 * get_company_fill_curve is `FROM toks t LEFT JOIN …` and projects
 * `COALESCE(c.f90, 0) AS fills_90d` / `COALESCE(c.r90, 0) AS relists_90d`
 * (20260908137000:535-536). It returns ONE ROW FOR EVERY TOKEN ASKED, and an
 * employer with no logged closure at all comes back 0/0 rather than null. So
 * `readable` was structurally identical to `asked`, and the sentence whose
 * whole job is to state the gap in our record printed "51 employers, a readable
 * closure record for 51 of those" — a confident claim about our own log for the
 * forty-seven of them we have never logged an event for. The gap it exists to
 * state could not be non-zero.
 *
 * The test that works is over the COUNTS the curve actually reports, all three
 * arms of them: an employer contributes a fill, a relist or an age-out, or we
 * have read nothing about it and may not count it as evidence in either
 * direction. The null test is KEPT in front of it, because a build that stops
 * returning the columns at all is our instrument failing and is a different
 * fact again.
 *
 * THE BAR IS ARITHMETIC, NOT AN ESTIMATE: fills_90d >= CLOSURE_MIN_FILLS AND
 * relists_90d <= fills_90d. relists_90d is a FLOOR (the collector logs one
 * superseded closure per title per 24h and deletes the rest), so requiring it
 * to stay at or under the fills errs towards DISQUALIFYING — the safe direction
 * for a claim that speaks well of an employer.
 *
 * AND IT IS NOT A CLAIM THAT ANYONE WAS HIRED. A closure is a posting going
 * away and not coming back; a hire, a withdrawal, a cancelled requisition and a
 * retitle are indistinguishable to us, and no sentence built from this may pick
 * one.
 */
export interface ClosureRecord {
  /** How many employers have a role in this slice IN ALL.
   *
   *  ALWAYS NULL TODAY, AND THAT IS A MEASUREMENT, NOT AN OVERSIGHT. The board
   *  returns a `companies` facet with a `companiesCount` beside it, and both
   *  are BOARD-WIDE — probed live, three ways, while this was written:
   *
   *    category=data_ai                             total 7,837  companiesCount 33,545
   *    category=data_ai + q="database administrator" total     4  companiesCount 33,545
   *    the whole board                              total 805,926 companiesCount 33,545
   *
   *  ...with the identical top row every time (Domino's, whose `count` of
   *  34,000 is its WHOLE-BOARD total, over a slice holding four roles). It is a
   *  cached global employer list, not a facet of the query. Reading it as the
   *  slice's employer count would have printed "33,545 employers have roles in
   *  this slice" over four postings, and handed the curve the sixty largest
   *  employers on the board, most of which have nothing in the slice at all —
   *  the exact denominator defect this whole rebuild exists to remove, at the
   *  bottom of the page that removed it.
   *
   *  So the field stays, and stays null: the shape keeps the three quantities
   *  separate, and the sentence says plainly that we cannot count this one
   *  rather than borrowing a number that answers a different question. */
  inSlice: number | null;
  /** Result rows the slice's own query returned, and the population `asked` was
   *  drawn from. Named on screen, because "the employers in the first sixty
   *  results" is a different claim from "the biggest employers in the slice". */
  rowsRead: number;
  asked: number;
  readable: number;
  closers: number;
  /** The closers' tokens, capped at 12 — the size Jobs.tsx:1523-1545 already
   *  round-trips through the comma-separated `company` param, so a link this
   *  page builds cannot become a scope the destination silently truncates. */
  tokens: string[];
  /** THE TRUNCATION, RETURNED RATHER THAN LEFT FOR THE LINK TO IMPLY. The
   *  finding sentence counts `closers` and the link that follows it carries at
   *  most twelve, so "open this slice at THOSE employers" asserted an identity
   *  the destination did not have — on a live Design slice it read "27 of those
   *  51" and then opened twelve of the twenty-seven. The link's own copy has to
   *  name both numbers when they differ, and it can only do that if the builder
   *  says they do. */
  capped: boolean;
}

export function closureRecordOf(
  inSlice: number | null,
  rowsRead: number,
  askedTokens: readonly string[],
  rows: readonly CompanyCurveRow[],
): ClosureRecord | null {
  const asked = askedTokens.length;
  if (asked === 0) return null;
  const byToken = new Map<string, CompanyCurveRow>();
  for (const r of rows) {
    if (r && typeof r.company_token === "string" && r.company_token) byToken.set(r.company_token, r);
  }
  let readable = 0;
  const tokens: string[] = [];
  for (const tok of askedTokens) {
    const r = byToken.get(tok);
    if (!r) continue;
    const fills = numOr(r.fills_90d);
    const relists = numOr(r.relists_90d);
    const ageouts = numOr(r.ageouts_90d);
    // OUR INSTRUMENT FIRST. Absent columns mean the deployed function does not
    // return them, which is a statement about the build and not about the
    // employer.
    if (fills === null || relists === null) continue;
    // THEN THE RECORD. The RPC answers for every token it is handed, so a row
    // is not evidence of anything until the log has actually recorded one of
    // this employer's roles leaving: a fill, a re-list or an age-out. All three
    // at zero is "we have logged nothing about this board", and counting it as
    // a readable record is how the gap-stating sentence came to state no gap.
    // ageouts_90d absent on an older build degrades to 0, which errs towards
    // calling a record unreadable — the safe direction for a sentence about how
    // little we hold.
    if (fills + relists + (ageouts ?? 0) <= 0) continue;
    readable += 1;
    if (fills >= CLOSURE_MIN_FILLS && relists <= fills) tokens.push(tok);
  }
  if (readable === 0) return { inSlice, rowsRead, asked, readable: 0, closers: 0, tokens: [], capped: false };
  return {
    inSlice, rowsRead, asked, readable,
    closers: tokens.length,
    tokens: tokens.slice(0, 12),
    capped: tokens.length > 12,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PRICING. Every number on a role row, a constraint chip and a country chip
// comes from here, and every one of them is a REAL COUNT for exactly the query
// the thing's own link carries.
// ─────────────────────────────────────────────────────────────────────────────

/** WHAT A PROBE CAN HONESTLY RETURN.
 *
 *  `total: null` IS A REAL OUTCOME AND NOT AN ERROR. The board answers
 *  countUnavailable when the exact count could not be taken, and this page's
 *  standing rule is that a number the query could not produce is never
 *  published — so a null total renders as no number, not as a zero.
 *
 *  `capped` is the server's countCapped: the count stopped at COUNT_CAP and the
 *  true figure is higher, so it renders "10,000+" and never an equality.
 *  `atLeast` is totalAtLeast — a proven floor when the exact total is
 *  unknowable, rendered as "N+" for the same reason.
 *
 *  `ignored` is ignoredFilters. A chip whose OWN filter is named there priced
 *  a query the click will not run, so it does not render at all. */
export interface Priced {
  total: number | null;
  capped: boolean;
  atLeast: number | null;
  coverage: number | null;
  ignored: string[];
  /** The probe itself failed — OUR instrument, distinct from a probe that
   *  answered with nothing. */
  failed: boolean;
}

/** THE PAY-COVERAGE RECONCILIATION, AND WHY NO CHIP HERE CARRIES A CONSTANT.
 *
 *  Three numbers were in the repository for one apparent fact, which is the
 *  claim-drift shape this codebase has already been burned by:
 *
 *    20.1%  MEASURED_COVERAGE.hasStatedPay in job-board/index.ts. It is
 *           `salary_min_annual IS NOT NULL` — 112,524 of the 559,805 SERVABLE
 *           rows (open, inside the freshness window), measured 2026-08-25. This
 *           is the population "states pay at all", and it is the right figure
 *           for a "states the pay" chip.
 *
 *    12.9%  In the comments at index.ts (the coverage pass, and again above
 *           coverageDisclosure), written as "salary is stated on 12.9%" and
 *           measured against 599,316 OPEN postings — a denominator that does
 *           NOT apply the freshness window. It is attached to the PAY FLOOR's
 *           cost ("setting a salary floor discards 87% of the board"), and the
 *           floor binds `salary_rank_usd`, a different column from the one
 *           20.1% counts. So it is mislabelled AND stale, and the live board
 *           settles it: probed here while this was written, the same request
 *           that returns a count returns filterCoverage {salaryFloor 0.22,
 *           hasStatedPay 0.22}. The two columns are within a point of each
 *           other in practice — almost every parsed annual figure also resolves
 *           a currency — so 12.9% is not a second reading of a narrower
 *           population. It is simply an old number under a wrong name.
 *
 *     ~4%   "only ~4% of postings state salary at all", in a comment in
 *           Jobs.tsx. WRONG UNDER EVERY DEFINITION IN THE REPOSITORY. It is a
 *           gloss on an $80k-floor collapse (572,348 -> 10,374), which is a
 *           FLOOR RESULT — 1.8% — and not a pay-statement rate at all. No query
 *           in this codebase produces 4%. It drives no rendered figure (the
 *           panel it introduces prices itself with live countOnly probes), so
 *           it is a stale comment rather than a shipped falsehood; it belongs
 *           to /jobs, which this workflow does not own, and is reported rather
 *           than edited here.
 *
 *  THE ANSWER, THEN: 20.1% is right, for the servable board, as at 2026-08-25,
 *  and the live figure has since moved to about 22% for both keys. 12.9% is
 *  wrong under its own label and out of date under any other. ~4% is not a
 *  measurement of anything.
 *
 *  THE RESOLUTION THIS PAGE ADOPTS: a chip publishes NO pinned percentage at
 *  all. get_filter_coverage() recomputes all ten figures in one pass every
 *  refresh, coverageDisclosure returns the live value for exactly the filters a
 *  request applied, and each chip reads the figure for ITS OWN column out of
 *  ITS OWN probe response. A chip whose response carries no coverage for its
 *  key says so in words and prints no percentage — which is the only reading of
 *  three-numbers-for-one-fact that cannot go stale again.
 */
export const PAY_COVERAGE_SOURCE = "filterCoverage" as const;

interface BoardCountReply {
  total?: number | null;
  totalAtLeast?: number;
  countCapped?: boolean;
  countUnavailable?: boolean;
  ignoredFilters?: string[];
  filterCoverage?: Record<string, number>;
  /** The slice's own result rows. `token` on a row is the employer that posting
   *  belongs to, and a page of these is the ONLY slice-scoped employer list the
   *  board offers — see the note on ClosureRecord.inSlice for what the
   *  `companies` facet actually is, and why it is not read anywhere here. */
  jobs?: Array<{ token?: string | null }>;
}

const FAILED: Priced = { total: null, capped: false, atLeast: null, coverage: null, ignored: [], failed: true };

/** ONE PROBE, ONE SLICE, THROUGH THE ONE MAPPER.
 *
 *  `searchToBoardBody` is the same mapper the Account card and the board's own
 *  saved-search pills use — the one that knows `companies` is an array the
 *  board reads while `company` is a key it does not. A hand-written body here
 *  would be the drift that had a pill advertising "+N new" for a query the user
 *  never saved: every filter the hand-written list omitted was silently WIDENED
 *  for the count only. */
async function priceSlice(params: JobSearchParams, coverageKey: string | null): Promise<Priced> {
  try {
    const { data, error } = await supabase.functions.invoke("job-board", {
      // `limit: 1`, NOT `countOnly: true`, AND THE REASON IS MEASURED.
      //
      // Probed live against production while this was written, same filters,
      // both exits:
      //   {countOnly:true}  -> keys ["total"]                     total 1059
      //   {limit:1}         -> keys [... "filterCoverage" ...]    total 1059,
      //                        filterCoverage {workMode: 0.235}
      //
      // The countOnly exit returns the number and DROPS EVERY DISCLOSURE the
      // other exits carry — the coverage block and ignoredFilters both. On a
      // countOnly probe every chip on this page said "coverage unknown", which
      // is the honest render of a missing figure and a completely avoidable
      // one; worse, a chip whose filter the server had REFUSED would have
      // rendered a count for a query the click never runs, because the name of
      // the refusal was in the payload the countOnly exit does not send. That
      // is the silent-filter failure this codebase has a standing contract
      // against.
      //
      // One row of payload buys both. The count is identical, and the server
      // does the same work either way.
      body: { action: "list", limit: 1, includeFacets: false, ...searchToBoardBody(params) },
    });
    if (error) return FAILED;
    const r = (data ?? null) as BoardCountReply | null;
    if (!r) return FAILED;
    const total = typeof r.total === "number" ? r.total : null;
    const cov = coverageKey && r.filterCoverage && typeof r.filterCoverage[coverageKey] === "number"
      ? r.filterCoverage[coverageKey] : null;
    return {
      total,
      capped: r.countCapped === true,
      atLeast: typeof r.totalAtLeast === "number" ? r.totalAtLeast : null,
      coverage: cov,
      ignored: Array.isArray(r.ignoredFilters) ? r.ignoredFilters.filter((x): x is string => typeof x === "string") : [],
      failed: false,
    };
  } catch { return FAILED; }
}

/** Run probes a few at a time. A field with eight roles, eight constraints and
 *  six countries is twenty-two counts; firing them at once is a burst the
 *  serving API has no reason to absorb, and they are all triggered by an
 *  explicit click rather than by a page view. */
async function inBatches<T, R>(items: readonly T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// RENDERERS
// ─────────────────────────────────────────────────────────────────────────────

/** A STATED REFUSAL, never a gap. */
function Refusal({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 px-4 py-4">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-[13px] text-muted-foreground">{body}</p>
    </div>
  );
}

function Section({ icon: Icon, title, blurb, note, children }: { icon: LucideIcon; title: string; blurb: string; note?: string | null; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <div className="flex items-start gap-2.5 mb-3">
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 shrink-0 mt-0.5">
          <Icon className="w-4 h-4 text-primary" />
        </span>
        <div>
          <h2 className="text-lg font-bold text-foreground leading-tight">{title}</h2>
          <p className="text-[13px] text-muted-foreground">{blurb}</p>
          {note && <p className="text-[12px] text-foreground/70 mt-1.5 font-medium">{note}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export default function Explore() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();

  // THE DEFAULT VIEW. Consumes DEFAULT_INTENT rather than repeating its value,
  // so the constant above is the single place the page's entry point is
  // decided and an edit to one cannot leave the other behind.
  const [intent, setIntent] = useState<Intent>(DEFAULT_INTENT);

  /** THE TILE NUMBERS AND THEIR DATE BASIS, FROM ONE READ.
   *
   *  `null` while the read is in flight and after it fails; the two are told
   *  apart by `facetFailed`, because "we have not counted yet" and "we could
   *  not count" are different facts and the page says the second one out loud
   *  rather than leaving eighteen tiles mutely numberless.
   *
   *  NOT SEEDED FROM THE HOURLY EXPLORE CACHE, deliberately, and this is the
   *  single most important line in the state block. The cache carried a
   *  `fields` map that answers the same question — and answered it from a
   *  DIFFERENT SCAN on a DIFFERENT CRON (explore cache 7 * * * *, board facets
   *  7,22,37,52 * * * *), so a tile drawn from it could be up to fifty-three
   *  minutes out of step with the page it opens. Two exact counts of one
   *  quantity is the failure the reach line was rebuilt to remove three commits
   *  ago. A "fall back to the cache when the facet read fails" branch would buy
   *  exactly that back, silently, on the path nobody watches — so there is no
   *  such branch, and a failed read publishes no numbers at all. */
  const [facet, setFacet] = useState<BoardFacet | null>(null);
  const [facetFailed, setFacetFailed] = useState(false);
  const [repostIndex, setRepostIndex] = useState<RepostIndex>({});
  const [stale, setStale] = useState<string[]>([]);

  // The reader's slice: a field, then optionally a role inside it, then
  // optionally one constraint and one country. Every one of those is a real
  // filter the board applies, and the URL the page hands over carries all of
  // them through the same mapper that priced them.
  const [openField, setOpenField] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [rolePrices, setRolePrices] = useState<Record<string, Priced>>({});
  const [rolesPricing, setRolesPricing] = useState(false);
  const [chipPrices, setChipPrices] = useState<Record<string, Priced>>({});
  const [countryPrices, setCountryPrices] = useState<Record<string, Priced>>({});
  const [chipsPricing, setChipsPricing] = useState(false);
  const [closure, setClosure] = useState<ClosureRecord | null>(null);
  /** The closure call failed, which is OUR outage — kept apart from a closure
   *  record that came back empty, which is a fact about our log. The same
   *  distinction Jobs.tsx:4029-4067 draws with healthFailed, for the same
   *  reason: a resolved PostgREST error is still an error, and treating it as
   *  "no employer closes roles" makes a claim about employers out of an outage
   *  of ours. */
  const [closureFailed, setClosureFailed] = useState(false);
  const [closurePending, setClosurePending] = useState(false);
  /** Tokens we have already handed to the curve for the slice on screen, so a
   *  re-render never re-asks. Jobs.tsx's healthAttempted dedupe, scoped to a
   *  slice rather than to the session. */
  const closureAsked = useRef<string>("");

  // Employer lookup. Fires on keystroke only, never on load, and only at 3+
  // characters — a shorter one would scan the alphabet.
  const [cq, setCq] = useState("");
  const [cHits, setCHits] = useState<SuggestHit[]>([]);
  /** THREE STATES, NOT TWO. A failed lookup once fell into the same branch as a
   *  genuine miss: searching "wegman" while the RPC was undeployed printed "We
   *  don't carry that employer's job board" about a company we hold 498 roles
   *  for. A broken instrument must never render as a fact about the thing it
   *  measures. */
  const [cState, setCState] = useState<"idle" | "ok" | "error">("idle");

  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "exists" | "failed">("idle");

  // ── THE ONE READ THE TILES COME FROM ────────────────────────────────────
  //
  // ONE REQUEST, EIGHTEEN NUMBERS, ONE DATE BASIS. The board's category facet
  // is a stored row, not an aggregate on the request path — measured against
  // production while this was written, this exact body answered in well under a
  // second with all eighteen categories and a refreshedAt stamp — so unlike the
  // 44-second closure scan this replaces on the arrival path, it is something a
  // page view may honestly pay for.
  //
  // AND IT IS THE READ THE DESTINATION MAKES. /jobs/field/:id sends the same
  // action to the same function and prints the same facet entry. There is no
  // second scan to reconcile, which is why the tiles can now print exact
  // integers instead of a shared "10,000+".
  useEffect(() => {
    let live = true;
    void (async () => {
      const f = await readCategoryFacet();
      if (!live) return;
      // A FAILED READ PUBLISHES NO NUMBERS. Not a cached fallback, not a zero,
      // not a stale map from an earlier session — see the note on `facet`.
      if (!f) { setFacetFailed(true); return; }
      setFacet(f);
    })();
    return () => { live = false; };
  }, []);

  // ── THE HOURLY CACHE, FOR THE ONE THING THIS PAGE STILL READS FROM IT ─────
  //
  // The churn index the employer check carries, and nothing else. `fields`,
  // `field_grid`, `field_curves` and `totals` are no longer read — the first
  // two because the tiles now come off the board's own facet in one read with
  // their destination, the third because the field-grain lifecycle line is
  // gone, the fourth because the sentence that stood over it went with the old
  // reach fraction. All four are in RETIRED_CACHE_PARTS, because a collection
  // this page does not render cannot make this page stale, and a yellow warning
  // naming a key in a raw internal spelling is worse than no warning at all.
  useEffect(() => {
    (async () => {
      try {
        const { data: cache } = await Promise.resolve(rpc("get_explore_cache")).catch(() => ({ data: null }));
        const c = cache as Record<string, unknown> | null;
        const obj = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
        if (c) {
          if (obj(c.repost_index)) setRepostIndex(c.repost_index as RepostIndex);
          if (Array.isArray(c.stale_parts)) {
            setStale((c.stale_parts as unknown[])
              .filter((x): x is string => typeof x === "string")
              .filter((x) => !RETIRED_CACHE_PARTS.has(x)));
          }
        }
      } catch { /* the employer check still works, without the churn warning */ }
    })();
  }, []);

  // The chosen answer lives in the URL, so it is shareable, survives Back, and
  // a crawler following ?i=check sees the employer check. A RETIRED id — the
  // five deleted leaderboards — is not an Intent and falls through to
  // DEFAULT_INTENT rather than landing a reader on something their link did not
  // name.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("i");
    if (isIntent(q)) setIntent(q);
  }, []);
  const chooseIntent = (next: Intent) => {
    setIntent(next);
    const u = new URL(window.location.href);
    u.searchParams.set("i", next);
    window.history.replaceState(null, "", u.toString());
  };

  // Debounced typeahead. 250ms and 3 chars keep this to roughly one request per
  // word typed, against a single-row lookup — no aggregate on the request path.
  useEffect(() => {
    const s = cq.trim();
    if (s.length < 3) { setCHits([]); setCState("idle"); return; }
    let alive = true;
    const id = setTimeout(() => {
      void Promise.resolve(rpc("get_company_suggest", { p_q: s }))
        .then((r: { data: unknown; error?: unknown }) => {
          if (!alive) return;
          // A non-array reply is a FAILURE, not an empty result. supabase-js
          // resolves rather than throws on a PostgREST error, so an undeployed
          // RPC arrives with data === null — and treating that as "no match" is
          // what printed "we don't carry that employer" over 498 open roles.
          if (r.error || !Array.isArray(r.data)) { setCHits([]); setCState("error"); return; }
          setCHits(r.data as SuggestHit[]);
          setCState("ok");
        })
        .catch(() => { if (alive) { setCHits([]); setCState("error"); } });
    }, 250);
    return () => { alive = false; clearTimeout(id); };
  }, [cq]);

  const nf = useCallback((n: number) => n.toLocaleString(i18n.language), [i18n.language]);
  const dateOf = (iso: string) => new Date(iso).toLocaleDateString(i18n.language, { dateStyle: "medium" });

  /** A PRICED NUMBER, WITH ITS FLOOR MARKED IN THE VALUE. Returns null when the
   *  query could not produce a number at all, and every caller renders nothing
   *  in that case rather than a zero.
   *
   *  THIS IS THE ONLY THING ON THE PAGE THAT STILL PASSES THROUGH
   *  SERVE_COUNT_CAP, and correctly so: a role row, a constraint chip and a
   *  country chip are all FILTERED counts, which is exactly what
   *  count_jobs_capped stops at 10,000. The tiles are not filtered counts and
   *  no longer go anywhere near it. */
  const pricedLabel = useCallback((p: Priced | undefined): string | null => {
    if (!p || p.failed) return null;
    if (p.capped) return `${SERVE_COUNT_CAP.toLocaleString(i18n.language)}+`;
    if (p.total === null) return p.atLeast !== null ? `${nf(p.atLeast)}+` : null;
    return nf(p.total);
  }, [i18n.language, nf]);

  /** THE EIGHTEEN TILES, ORDERED BY THE FACET'S OWN COUNT, WITH THE
   *  UNCATEGORISED BUCKET ALWAYS LAST.
   *
   *  Seventeen fields plus the bucket. The bucket does not compete for position
   *  by size — it is not a field, it is the rows whose field could not be read
   *  from the title, and sorting it into the middle of a list of fields would
   *  present it as one. It is also the one tile that carries no number (see
   *  UNCATEGORISED), so it could not be ranked against the others honestly even
   *  if it were a field.
   *
   *  `n` IS null, NEVER 0, FOR A FIELD THE FACET DOES NOT MENTION. The facet
   *  omits an empty category rather than sending a zero, and a tile with no
   *  reading must make no claim about depth rather than claim there is none. */
  const tiles = useMemo(() => {
    const cats = facet?.categories ?? {};
    const named = BOARD_CATEGORY_SLUGS
      .map((id) => ({ id, n: cats[id] ?? null }))
      .sort((a, b) => (b.n ?? 0) - (a.n ?? 0));
    return [...named, { id: UNCATEGORISED, n: cats[UNCATEGORISED] ?? null }];
  }, [facet]);

  /** THE PAGE'S ONE AGGREGATE, AND IT IS ONE SENTENCE RATHER THAN A FRACTION.
   *
   *  WHY THERE IS NO PERCENTAGE ANY MORE. The old reach line divided a sum of
   *  tiles by a board total and published "about {{pct}}%". Both halves came
   *  off get_explore_field_grid, which was the fix for an earlier version whose
   *  halves came off two different functions — but the whole quantity was only
   *  ever interesting because the scan had a 50-posting floor that could drop a
   *  small field out of the grid entirely. The board's category facet has no
   *  floor: it is `GROUP BY category` over the serving population, so every
   *  servable posting is in exactly one bucket and the eighteen tiles PARTITION
   *  the board by construction. A fraction of a partition is 100%, and
   *  publishing a number that can only be 100 tells a reader nothing.
   *
   *  SO THE SENTENCE STATES THE POPULATION INSTEAD: how many roles the tiles
   *  reach, from the same map every tile number came from, under the same
   *  stamp. One number, one scan, said once — which is what the rule at the top
   *  of this file requires of a figure that would otherwise be identical on
   *  every tile.
   *
   *  `untiled` IS THE ONE THING THAT COULD MAKE IT NOT A PARTITION: a category
   *  VALUE the board starts emitting that this page has no tile for. It is zero
   *  today (measured: the facet's eighteen keys are exactly
   *  BOARD_CATEGORY_SLUGS plus `other`), and if it ever is not, the sentence
   *  names the remainder rather than quietly absorbing it into "every posting
   *  we can serve". Derived from the SAME map, so it cannot be scan skew
   *  wearing a floor's name. */
  const reach = useMemo(() => {
    if (!facet) return null;
    const tiledIds = new Set<string>([...BOARD_CATEGORY_SLUGS, UNCATEGORISED]);
    let all = 0;
    let tiled = 0;
    for (const [k, n] of Object.entries(facet.categories)) {
      all += n;
      if (tiledIds.has(k)) tiled += n;
    }
    if (all <= 0 || tiled <= 0) return null;
    return { all, tiled, untiled: all - tiled };
  }, [facet]);

  /** THE SLICE, AS ONE OBJECT. Everything on this page that shows a number or
   *  opens a page is built from this, mapped twice — searchToBoardBody for the
   *  count, searchToQuery for the link. */
  const sliceParams = useCallback((extra?: JobSearchParams): JobSearchParams => ({
    ...(openField ? { category: openField } : {}),
    ...(role ? { q: role } : {}),
    ...extra,
  }), [openField, role]);

  const sliceLabel = useMemo(() => {
    const field = openField ? t(`jobsPage.categories.${openField}`, CATEGORY_LABELS[openField] ?? openField) : null;
    if (role && field) return `${role} · ${field}`;
    return role ?? field ?? "";
  }, [openField, role, t]);

  // ── PRICE THE ROLE ROWS FOR THE OPEN FIELD ────────────────────────────────
  // On an explicit click, never on a page view. A field with no role
  // vocabulary of ours (the uncategorised bucket) asks for nothing and says so.
  useEffect(() => {
    if (!openField) { setRolePrices({}); setRolesPricing(false); return; }
    const names = FIELD_ROLES[openField];
    if (!names || names.length === 0) { setRolePrices({}); setRolesPricing(false); return; }
    let live = true;
    setRolePrices({});
    setRolesPricing(true);
    void (async () => {
      const results = await inBatches(names, 4, async (name) => [name, await priceSlice({ category: openField, q: name }, null)] as const);
      if (!live) return;
      const map: Record<string, Priced> = {};
      for (const [name, p] of results) map[name] = p;
      setRolePrices(map);
      setRolesPricing(false);
    })();
    return () => { live = false; };
  }, [openField]);

  // ── PRICE THE CONSTRAINT AND COUNTRY CHIPS FOR THE CHOSEN SLICE ───────────
  useEffect(() => {
    if (!openField) { setChipPrices({}); setCountryPrices({}); setChipsPricing(false); return; }
    let live = true;
    setChipPrices({});
    setCountryPrices({});
    setChipsPricing(true);
    void (async () => {
      const base = { ...(openField ? { category: openField } : {}), ...(role ? { q: role } : {}) } as JobSearchParams;
      const chips = await inBatches(CONSTRAINT_CHIPS, 4, async (c) =>
        [c.id, await priceSlice({ ...base, ...c.patch }, c.coverageKey)] as const);
      if (!live) return;
      const cm: Record<string, Priced> = {};
      for (const [id, p] of chips) cm[id] = p;
      setChipPrices(cm);
      const countries = await inBatches(COUNTRY_CHIPS, 3, async (c) =>
        [c.id, await priceSlice({ ...base, country: c.id }, "country")] as const);
      if (!live) return;
      const km: Record<string, Priced> = {};
      for (const [id, p] of countries) km[id] = p;
      setCountryPrices(km);
      setChipsPricing(false);
    })();
    return () => { live = false; };
  }, [openField, role]);

  // ── THE CLOSURE RECORD FOR THE CHOSEN SLICE ───────────────────────────────
  // Two calls, in order: a page of the slice's OWN RESULTS, whose rows carry
  // the employer token each posting belongs to, then ONE batched
  // get_company_fill_curve over the distinct tokens among them — exactly as
  // Jobs.tsx:4051 does it, from exactly the same source. NO new table, NO sort,
  // NO migration.
  //
  // NOT THE `companies` FACET, WHICH IS BOARD-WIDE. That was the obvious source
  // and it is the wrong one: it returns the same 33,545 employers and the same
  // top row for a four-role slice as for the whole 805,926-row board, with each
  // employer's WHOLE-BOARD count beside it. The full measurement is on
  // ClosureRecord.inSlice. Result rows are slice-scoped by construction, which
  // is the property this section needs and the only one that survives a
  // narrowing.
  useEffect(() => {
    if (!openField) { setClosure(null); setClosureFailed(false); setClosurePending(false); closureAsked.current = ""; return; }
    const sig = `${openField}|${role ?? ""}`;
    if (closureAsked.current === sig) return;
    closureAsked.current = sig;
    let live = true;
    setClosure(null);
    setClosureFailed(false);
    setClosurePending(true);
    void (async () => {
      // A FAILURE HERE IS OURS AND SAYS SO. Released from the dedupe on the way
      // out, so a later slice change retries rather than the session inheriting
      // one 404 as "no employer closes roles here".
      const giveUp = () => {
        if (!live) return;
        closureAsked.current = "";
        setClosureFailed(true);
        setClosurePending(false);
      };
      let page: BoardCountReply | null = null;
      try {
        const { data, error } = await supabase.functions.invoke("job-board", {
          // includeFacets FALSE, deliberately: the facet this call would return
          // is the board-wide employer list, and asking for it would put a
          // number on the page that answers a different question.
          body: { action: "list", limit: CLOSURE_ROWS, includeFacets: false, ...searchToBoardBody({ category: openField, ...(role ? { q: role } : {}) }) },
        });
        if (error) { giveUp(); return; }
        page = (data ?? null) as BoardCountReply | null;
      } catch { giveUp(); return; }
      if (!live) return;
      if (!page) { giveUp(); return; }
      const rows = page.jobs ?? [];
      const tokens = [...new Set(rows
        .map((j) => (typeof j?.token === "string" ? j.token : ""))
        .filter(Boolean))];
      if (tokens.length === 0) {
        // NO EMPLOYER COUNT IS INVENTED HERE. See ClosureRecord.inSlice.
        setClosure({ inSlice: null, rowsRead: rows.length, asked: 0, readable: 0, closers: 0, tokens: [], capped: false });
        setClosurePending(false);
        return;
      }
      const { data: curve, error: curveErr } = await Promise.resolve(rpc("get_company_fill_curve", { p_tokens: tokens }))
        .then((r) => r as { data: unknown; error?: unknown })
        .catch(() => ({ data: null, error: true }));
      if (!live) return;
      if (curveErr || !Array.isArray(curve)) { giveUp(); return; }
      setClosure(closureRecordOf(null, rows.length, tokens, curve as CompanyCurveRow[]));
      setClosurePending(false);
    })();
    return () => { live = false; };
  }, [openField, role]);

  /** The churn warning for one employer, or null — POSITIVE FORM ONLY.
   *
   *  A hit means "this employer cleared a rate gate of 5 re-lists per affected
   *  role on 25+ events". A MISS means only that it did not, which includes
   *  every employer whose board we have watched for a week. So there is no "no
   *  re-posting detected", no green tick and no clean-bill styling anywhere. */
  const repostWarn = (token: string | undefined): string | null => {
    if (!token) return null;
    const hit = repostIndex[token];
    if (!Array.isArray(hit) || hit.length < 3) return null;
    const [events, roles, days] = hit;
    if (!(typeof events === "number" && events > 0 && typeof roles === "number" && roles > 0)) return null;
    // A FLOOR, MARKED IN THE VALUE RATHER THAN IN THE SENTENCE — this file's
    // own idiom ("10,000+" on the tiles), so every translation of
    // explore.repostWarn becomes a floor at once.
    return t("explore.repostWarn", "Re-lists roles: {{events}} re-postings across {{roles}} roles in {{d}}d", {
      events: `${nf(events)}+`, roles: `${nf(roles)}+`, d: days,
    });
  };

  /** THE SECOND LINE ON A FIELD TILE: THE ROLES INSIDE IT, BY NAME.
   *
   *  WHAT REPLACED WHAT. This slot held the field's lifecycle sentence, which
   *  rendered as one of four strings across eighteen tiles. It now holds the
   *  first TILE_ROLE_NAMES names of that field's own vocabulary, and across all
   *  116 names in FIELD_ROLES no name appears in two fields — so every tile's
   *  second line is unique to it, with no rounding and no possibility of a tie.
   *  "registered nurse · medical assistant · certified nursing assistant" and
   *  "retail sales associate · store manager · server" tell a reader which tile
   *  they are looking at; "up to 17% · 30-day closure log" on both did not.
   *
   *  IT CARRIES NO NUMBERS, AND THAT IS THE RULE, NOT A SHORTAGE. Every one of
   *  these names is priced — a live count for exactly the query its row opens —
   *  one click away, inside the field's own panel. Putting those counts on the
   *  face would be three more figures per tile, 54 in all, each needing the
   *  coverage sentence that used to eat the top of this page.
   *
   *  NULL FOR THE UNCATEGORISED BUCKET, which has no vocabulary because it is
   *  not a field. Its tile says so in words instead. */
  const tileRoles = (id: string): string | null => {
    const names = FIELD_ROLES[id];
    if (!names || names.length === 0) return null;
    return names.slice(0, TILE_ROLE_NAMES).join(" · ");
  };

  /** SAVE THE SLICE THE READER ASSEMBLED.
   *
   *  Every slice built on this page was thrown away on navigation, while
   *  user_job_searches has persisted all 21 JobSearchParams (RLS-scoped) the
   *  whole time and src/lib/job-search-params.ts is the single mapper for them.
   *  The same insert /jobs performs, with the same name builder, so a search
   *  saved here is indistinguishable from one saved there — and reachable from
   *  the pills at the top of this section. */
  const saveSlice = async () => {
    if (!user || !openField) return;
    setSaveState("saving");
    const params = sliceParams();
    const name = searchName(params, t(`jobsPage.categories.${openField}`, CATEGORY_LABELS[openField] ?? openField));
    try {
      const { error } = await searchesTable().insert({ user_id: user.id, name, params });
      // 23505 is UNIQUE(user_id, name): the reader already has this exact
      // slice, which is a different message from a failure and must not borrow
      // its sentence.
      if (error) { setSaveState(error.code === "23505" ? "exists" : "failed"); return; }
      setSaveState("saved");
    } catch { setSaveState("failed"); }
  };

  useEffect(() => { setSaveState("idle"); }, [openField, role]);

  const INTENT_LABEL: Record<Intent, string> = {
    fields: t("explore.intentFields2", "Browse the whole board"),
    check: t("explore.intentCheck", "Check an employer"),
  };

  return (
    <div className="min-h-screen bg-background">
      {/* NEW SEO KEYS. The old ones advertised, in seven languages, the five
          employer rankings this page no longer contains — and a crawler
          following that description would land on a field grid. */}
      <SEO
        title={/* seoTitle5, NOT seoTitle4. The standing rule at the top of this
            file is that every sentence whose MEANING changed here takes a NEW
            key; the title's meaning changed when the field-grain lifecycle line
            came off the page and its key did not, so it went on promising "How
            Long Roles Last" in nine languages over a grid that publishes no
            duration at any field grain. seoTitle4 is DELETED from all nine
            locale files rather than merely unreferenced -- a locale VALUE
            overrides an inline English default, so an orphaned key is one
            careless t() away from rendering the retired claim again. Mirrored
            in scripts/prerender-seo.mjs, the document crawlers receive. */
          t("explore.seoTitle5", "Explore Every Field on the Board — An Exact Live Count and the Roles Inside Each One")}
        description={t("explore.seoDescription4", "Start from the field you work in, narrow to the actual role, then to remote, pay, experience or country — every number is a live count of the exact search the link runs, with how much of the board each filter can even see. Plus what our closure record does and does not say about the employers hiring in that slice.")}
        path="/explore"
      />
      <Header />
      <main className="max-w-4xl mx-auto px-4 py-10">
        {/* ABOVE THE FOLD: AN H1 AND ONE SENTENCE.
            197 words became 39. What was here explained what a filter over a
            column employers often leave blank does to a result set, and how a
            coverage percentage differs from a live count, BEFORE the reader had
            seen a single job. All of it was true and none of it was needed
            yet — it is the answer to a question the reader has not asked until
            they have opened a field, and it now lives in that field's own
            "How we measure" panel, one scroll further down, where the chips it
            describes actually are.

            THE ONE SENTENCE CARRIES THE DATE BASIS FOR ALL EIGHTEEN NUMBERS AT
            ONCE, which is the only reason eighteen tiles can be bare integers.
            Every one of them comes out of a single stored row with a single
            stamp, so the basis is a property of the GRID, not of a tile — and a
            property of the grid is one sentence, said once. */}
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-2">
            {t("explore.headline2", "Start with your field. Land on a list you can actually read.")}
          </h1>
          {/* `facet &&` is redundant at runtime -- reach is null whenever facet
              is -- and is written anyway so the compiler can see that facet.at,
              which is now a plain string rather than a nullable one, exists
              here. The redundancy is the point: it makes the stamp's presence a
              type-level fact on the one sentence that must carry it. */}
          {reach && facet && (
            <p className="text-base text-muted-foreground max-w-2xl">
              {/* basisWhole2 / basisPartial2, AND THE OLD PAIR IS DELETED FROM
                  ALL NINE LOCALES. Two claims in the retired wording were
                  wrong in ways only a reader could see.

                  "in eighteen fields" COUNTED THE BUCKET AS A FIELD, which the
                  method panel two scrolls below explicitly denies ("It is not a
                  field, it does not compete with the others for position"), the
                  tiles memo relies on, and the prerendered document contradicts
                  in so many words ("Seventeen fields plus the roles whose field
                  we could not read"). The page made three different claims
                  about the same tile. Worse, "eighteen" was a hardcoded word
                  inside translated prose in nine files, so adding a slug to
                  BOARD_CATEGORY_SLUGS would render nineteen tiles under nine
                  sentences still saying eighteen, with every guard green. It is
                  interpolated from BOARD_CATEGORY_SLUGS.length now and cannot
                  drift in any language.

                  "All N roles the board can serve" WAS A SECOND TOTAL FOR A
                  QUANTITY /jobs ALREADY PUBLISHES. reach.all sums this facet;
                  /jobs' hero prints totalAllCompanies (coverage.open), which
                  refresh_headline_open patches BETWEEN facet passes while
                  categoriesFacet is not patched. Two exact six-figure totals for
                  one quantity on two adjacent pages is the defect this whole
                  pass exists to close, one level up from the tile. The sentence
                  now claims only what the facet proves: how many roles these
                  tiles hold, as of the stamp on the row they came from. */}
              {/* A CARRIED COUNT NAMES THE SCAN THAT PRODUCED IT, not the pass
                  that copied it forward. Without this the page said "counted
                  Sep 9, 2026, 2:07 PM in the board's own scan" over eighteen
                  integers that were hours old and had been counted at no such
                  time — a published statistic naming a FALSE date basis, with
                  no failure state entered and nothing on screen looking wrong.
                  The stale_parts line below already treats a carried-forward
                  aggregate this way; the tile counts now get the same
                  treatment, one level up. */}
              {facet.carried
                ? t("explore.basisCarried", "{{n}} roles across {{fields}} fields plus the roles whose field we could not read from the title. The board's latest count did not complete, so these are the last ones that did{{when}} — each field's number is still the same one that field's page prints.", {
                    n: nf(reach.all),
                    fields: BOARD_CATEGORY_SLUGS.length,
                    when: facet.countedAt
                      ? t("explore.basisCarriedWhen", ", taken {{time}}", {
                          time: new Date(facet.countedAt).toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" }),
                        })
                      : "",
                  })
                : reach.untiled <= 0
                ? t("explore.basisWhole2", "{{n}} roles across {{fields}} fields plus the roles whose field we could not read from the title — counted {{time}} in the board's own scan, and each field's number is the same one that field's page prints.", {
                    n: nf(reach.all),
                    fields: BOARD_CATEGORY_SLUGS.length,
                    // i18n.language, not undefined. `undefined` resolves to the
                    // BROWSER's locale, which is independent of the language the
                    // reader picked — so a German page rendered its one visible
                    // date in English.
                    time: new Date(facet.at).toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" }),
                  })
                // THE REMAINDER IS NAMED, NEVER ABSORBED. If the board ever
                // emits a category this page has no tile for, the sentence says
                // how many roles sit in it rather than going on calling the
                // grid whole. Both numbers come from the one map.
                : t("explore.basisPartial2", "{{tiled}} of {{all}} roles, across {{fields}} fields plus the roles whose field we could not read from the title — counted {{time}} in the board's own scan. The other {{untiled}} sit in a field this page has no tile for.", {
                    tiled: nf(reach.tiled), all: nf(reach.all), untiled: nf(reach.untiled),
                    fields: BOARD_CATEGORY_SLUGS.length,
                    time: new Date(facet.at).toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" }),
                  })}
            </p>
          )}
          {/* A FAILED READ IS SAID, NOT MIMED. Eighteen tiles with no numbers
              and no explanation reads as a broken page; the links all still
              work, and the sentence says both halves of that. */}
          {facetFailed && (
            <p className="text-base text-muted-foreground max-w-2xl">
              {t("explore.basisNone", "We could not read the board's field counts just now, so these tiles carry no numbers. That is our measurement failing, not the board emptying — every tile still opens its field.")}
            </p>
          )}
          {stale.length > 0 && (
            <p className="mt-1.5 text-xs text-warning">
              {t("explore.staleParts", "{{parts}} could not be recomputed in the last refresh and are shown from an earlier run.", { parts: stale.join(", ") })}
            </p>
          )}
        </div>

        {/* THE PAGE'S ONLY CONTROL, AND IT IS NOW TWO CHOICES RATHER THAN
            SEVEN. Five of the seven were rankings of twelve employers each;
            with them gone, the control is the field grid and the employer
            check, in that order. */}
        <div className="mb-8" role="tablist" aria-label={t("explore.intentAria", "What are you looking for?")}>
          <div className="flex flex-wrap gap-2">
            {INTENTS.map((i, idx) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={intent === i}
                // role="tablist" PROMISES arrow-key navigation. Shipping the
                // role without the keys is worse than shipping neither.
                tabIndex={intent === i ? 0 : -1}
                onKeyDown={(e) => {
                  const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                  if (!d) return;
                  e.preventDefault();
                  const nextIdx = (idx + d + INTENTS.length) % INTENTS.length;
                  chooseIntent(INTENTS[nextIdx]);
                  const el = e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
                  el?.[nextIdx]?.focus();
                }}
                onClick={() => chooseIntent(i)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border text-sm font-medium transition-colors min-h-[40px] ${
                  intent === i
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card/60 text-muted-foreground hover:border-primary/50 hover:text-foreground"
                }`}
              >
                {INTENT_LABEL[i]}
              </button>
            ))}
            <Link
              to="/jobs"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-primary/40 bg-primary/5 text-sm font-medium text-primary hover:bg-primary/10 transition-colors min-h-[40px]"
            >
              <Briefcase className="w-3.5 h-3.5" />
              {t("explore.searchAll", "Search all jobs")}
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        {/* ── 1. THE FIELD GRID — THE DEFAULT VIEW ──────────────────────────
            Eighteen tiles, ordered by the board's own count, two lines each:
            the count, then the names of the roles inside that field. The
            eighteenth is the uncategorised bucket, which no field tile can
            reach and which carries no count, because no page of ours prints
            one for it. */}
        <div hidden={intent !== "fields"}>
          <Section
            icon={Layers}
            title={t("explore.fieldsTitle2", "Every field on the board")}
            // THE ORDERING CLAUSE IS GATED ON THE THING THAT CREATES THE
            // ORDERING. `tiles` sorts on (b.n ?? 0) - (a.n ?? 0) over
            // facet?.categories ?? {}, so on a failed read every n is null, the
            // sort is a no-op and the grid renders in BOARD_CATEGORY_SLUGS'
            // declaration order — engineering, data_ai, design, product, with
            // operations eleventh. Measured, that puts design (4,230) third and
            // operations (144,664) eleventh: a 34x inversion, presented under a
            // sentence calling it an ordering by open roles. basisNone already
            // retracts the numbers and said nothing about the order, which is
            // the half a reader can still see.
            blurb={facet
              ? t("explore.fieldsBlurb3", "Ordered by how many roles are open right now, with the roles you would find inside each one. Open a field to see every role in it counted, then narrow it.")
              : t("explore.fieldsBlurb4", "The roles you would find inside each field. We could not read the board's counts just now, so these tiles are not ordered by size — open a field to see every role in it counted, then narrow it.")}
            // NO NOTE. The reach claim used to live here as a second aggregate
            // under the section header, on top of the one above the fold; both
            // described the same eighteen tiles, and one of them had to go. The
            // one that survived is the one carrying the date basis, because a
            // reader who reads nothing else must still get that.
            note={null}
          >
            <HowWeMeasure items={[
              {
                // {{cap}} IS THE SERVING WINDOW, NOT THE CURVE'S SUPPORT CAP.
                // See SERVE_WINDOW_DAYS. There is no lifecycle sentence on this
                // page any more to confuse it with, but the mirror stays and so
                // does this note: the window lives in SQL and this sentence
                // names it.
                term: t("explore.methodTileTerm", "The number on a tile"),
                method: t("explore.methodTileMethod3", "An exact count, not a ceiling. It is the board's own per-field count — every posting open and inside our {{cap}}-day freshness window — grouped once per refresh and stored in one row, and it is the SAME row and the SAME number the field's own page prints in its heading when you click through. Nothing rounds it and nothing caps it: the “{{n}}+” these tiles used to show was the ceiling the serving API puts on a FILTERED count, which is not what a grouped scan produces, and it made the six biggest fields on the board look identical.", { cap: SERVE_WINDOW_DAYS, n: SERVE_COUNT_CAP.toLocaleString(i18n.language) }),
              },
              {
                term: t("explore.methodNamesTerm", "The role names under a field"),
                // THEY ARE UNTRANSLATED, AND THE PANEL SAYS SO RATHER THAN
                // LEAVING IT TO LOOK LIKE AN OVERSIGHT. tileRoles joins raw
                // FIELD_ROLES entries, which are English literals, so a German
                // reader sees "Gesundheitswesen & Klinik" over "registered
                // nurse · medical assistant". That is deliberate: each name is
                // the literal `q` this page sends the board, and the board
                // matches posting TITLES, which are written in the language the
                // employer posted in — overwhelmingly English on the ATS feeds
                // we carry. Translating the label would break the link between
                // the name a reader sees and the search it runs, and would
                // price a query nobody can run. Naming it here is the honest
                // resolution; silently showing English is not.
                method: t("explore.methodNamesMethod2", "Ours, not the board's: the first few names from the list we wrote for that field, so you can tell one tile from another at a glance. They are not a measurement and they carry no numbers. They stay in English in every language, because each one is the exact search term we send the board and postings are titled in the language the employer wrote them in. Open the field and every one of them is counted for real — a live count of exactly the search that row opens, taken at the moment you click, with any name that matches too little left out rather than shown as a zero."),
              },
              {
                term: t("explore.methodUncatTerm", "The last tile — the roles with no field"),
                method: t("explore.methodUncatMethod3", "Where a posting lands when its field could not be read from its title. It is not a field and it does not compete with the others for position — it is always last, because sorting it by size into a list of fields would present it as one. Its count comes from the same scan and the same row as every other tile's, and the page it opens counts exactly these roles, so the number on it means what the others mean. It is a large part of the board and no field tile reaches it, which is why it has a tile at all."),
              },
              {
                // THIS IS THE PARAGRAPH THAT USED TO BE ABOVE THE FOLD. It
                // answers a question a reader does not have until they have
                // opened a field and seen a percentage on a chip, so it waits
                // here until they do.
                term: t("explore.methodLiveTerm", "The counts and percentages inside a field"),
                method: t("explore.methodLiveMethod", "Every COUNT inside a field — on a role, on a narrowing, on a country — is taken live, at the moment you click it, for exactly the search that link runs. The PERCENTAGE beside a narrowing is not: it is how much of the board states that thing at all, from the board's own coverage scan rather than from your click. It matters because a filter can only search what employers published, so a narrowing hides the roles that did not say — it does not prove they are not there. Where we hold no coverage reading for a filter, the chip shows its count and no percentage rather than a number we would have had to invent."),
              },
            ]} />
            {!facet && !facetFailed ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5" aria-hidden="true">
                <span className="sr-only" role="status" aria-live="polite">Loading fields…</span>
                {Array.from({ length: 12 }, (_, i) => (
                  <div key={i} className="rounded-xl border border-border bg-card/30 px-4 py-3">
                    <div className="h-3.5 rounded bg-muted animate-pulse" style={{ width: `${45 + ((i * 7) % 35)}%` }} />
                    <div className="mt-2 h-2.5 rounded bg-muted/60 animate-pulse" style={{ width: `${60 + ((i * 11) % 30)}%` }} />
                  </div>
                ))}
              </div>
            ) : (
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {tiles.map(({ id, n }) => {
                  const label = t(`jobsPage.categories.${id}`, CATEGORY_LABELS[id] ?? id);
                  const uncat = id === UNCATEGORISED;
                  const roles = uncat ? null : tileRoles(id);
                  const open = openField === id;
                  return (
                    <li key={id} className={`rounded-xl border transition-colors ${open ? "border-primary/60 bg-card sm:col-span-2" : "border-border bg-card/60 hover:border-primary/50"}`}>
                      <div className="flex items-stretch">
                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={() => { setOpenField(open ? null : id); setRole(null); }}
                          className="min-w-0 flex-1 text-left px-4 py-3"
                        >
                          <span className="flex items-baseline gap-2">
                            <span className="text-sm font-semibold text-foreground">{label}</span>
                            {/* EXACT, UNCAPPED, AND ABSENT RATHER THAN ZERO.
                                The facet omits a category with nothing in it,
                                so a tile with no reading makes no claim about
                                depth: it must never render "0", and it must
                                never render a ceiling.

                                THE UNCATEGORISED TILE NOW CARRIES ITS NUMBER
                                TOO. It was withheld for one reason and it was a
                                good one — no destination of ours printed the
                                figure back, so the tile would have made a claim
                                its own link contradicted, and /jobs?category=other
                                was in fact printing the board-wide 815,909 over
                                a 174,535-row list. That is fixed at the
                                destination (Jobs.tsx countCategory), not papered
                                over here: the count line on that page now reads
                                the same facet entry, so the tile and the page it
                                opens are one integer read twice, exactly like
                                the other seventeen. The rule was never "the
                                bucket gets no number" — it was "no number
                                without a destination that prints it". */}
                            {typeof n === "number" && n > 0 && (
                              <span className="text-[12px] tabular-nums text-muted-foreground">{nf(n)}</span>
                            )}
                          </span>
                          {uncat ? (
                            <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground/80 italic">
                              {t("explore.uncatLine3", "Roles whose field we could not read from the title. No field tile reaches these, and they have no role list of their own — but the page this opens counts exactly these roles.")}
                            </span>
                          ) : roles ? (
                            <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                              {roles}
                            </span>
                          ) : null}
                        </button>
                        {/* THE WAY STRAIGHT IN, kept beside the expander rather
                            than behind it: a reader who already knows their
                            field should not have to open a panel to reach the
                            board. Built through the same mapper that prices
                            everything else, so the link and any count of this
                            slice describe one query. */}
                        <Link
                          to={fieldHref(id)}
                          aria-label={t("explore.tileOpen", "Open {{field}} on the board", { field: label })}
                          className="flex items-center px-3 border-l border-border/60 text-muted-foreground/60 hover:text-primary transition-colors"
                        >
                          <ArrowRight className="w-4 h-4" />
                        </Link>
                      </div>

                      {open && (
                        <div className="border-t border-border/60 px-4 py-4">
                          {/* ── 2. PRICED ROLE ROWS ─────────────────────────
                              This adds no mass to the page. It changes the SIZE
                              of what a reader lands in, which is the actual
                              failure a field-sized list has. */}
                          <p className="text-[12px] font-semibold text-foreground">
                            {t("explore.rolesTitle", "The biggest roles in {{field}}", { field: label })}
                          </p>
                          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                            {t("explore.rolesNote", "Role names are ours, not the board's. Every count beside one is a live count of exactly the search that row opens, taken just now — a role we named that matches nothing here is left out rather than shown as zero.")}
                          </p>
                          {uncat ? (
                            <p className="mt-2 text-[12px] text-muted-foreground">
                              {t("explore.rolesUncat", "These roles have no field we could read, so we have no role list for them. Search by title on the board instead.")}
                            </p>
                          ) : rolesPricing && Object.keys(rolePrices).length === 0 ? (
                            <p className="mt-2 text-[12px] text-muted-foreground" role="status" aria-live="polite">
                              {t("explore.rolesPricing", "Counting each role…")}
                            </p>
                          ) : (
                            (() => {
                              const priced = (FIELD_ROLES[id] ?? [])
                                .map((name) => ({ name, p: rolePrices[name] }))
                                // A ROW WE COULD NOT PRICE DOES NOT RENDER. A
                                // failed probe is our instrument and a zero
                                // count is a role that is not here; neither is
                                // a row worth putting a reader through.
                                .filter((r) => r.p && !r.p.failed && ((r.p.total ?? 0) > 0 || r.p.capped || (r.p.atLeast ?? 0) > 0));
                              // AND A ROW BELOW THE FLOOR DOES NOT RENDER
                              // EITHER, which is a different refusal and is
                              // said separately below. This section's whole job
                              // is the SIZE of what a reader lands in;
                              // "database administrator 4" beside "data
                              // engineer 2,028" is an honest number attached to
                              // a click that reproduces the landing-size defect
                              // one grain down. A capped or floored count is
                              // above the bar by construction.
                              const rows = priced
                                .filter((r) => r.p!.capped || (r.p!.total ?? r.p!.atLeast ?? 0) >= ROLE_ROW_MIN)
                                .sort((a, b) => (b.p!.total ?? b.p!.atLeast ?? 0) - (a.p!.total ?? a.p!.atLeast ?? 0));
                              if (rows.length === 0) {
                                return (
                                  <p className="mt-2 text-[12px] text-muted-foreground">
                                    {rolesPricing
                                      ? t("explore.rolesPricing", "Counting each role…")
                                      // TWO DIFFERENT FACTS, TWO SENTENCES. "No
                                      // role name matched" and "every role name
                                      // matched too few to be worth a page" are
                                      // not the same statement about the board,
                                      // and letting the floor fall into the
                                      // first one would publish a falsehood
                                      // about a field that does have these
                                      // roles in it.
                                      : priced.length > 0
                                        ? t("explore.rolesBelowFloor", "Every role name we tried matched fewer than {{min}} roles in this field — too few to be worth a page of their own. Open the whole field instead, or search by title on the board.", { min: nf(ROLE_ROW_MIN) })
                                        : t("explore.rolesNone", "None of the role names we tried matched anything in this field right now.")}
                                  </p>
                                );
                              }
                              return (
                                <ul className="mt-2 divide-y divide-border/60">
                                  {rows.map(({ name, p }) => (
                                    <li key={name} className="flex items-center gap-2 py-1.5">
                                      <button
                                        type="button"
                                        onClick={() => setRole(role === name ? null : name)}
                                        aria-pressed={role === name}
                                        className={`min-w-0 flex-1 text-left text-[13px] ${role === name ? "font-semibold text-primary" : "text-foreground/85 hover:text-primary"}`}
                                      >
                                        {name}
                                      </button>
                                      <span className="text-[12px] tabular-nums text-muted-foreground shrink-0">{pricedLabel(p)}</span>
                                      <Link
                                        to={toBoard({ category: id, q: name })}
                                        aria-label={t("explore.roleOpen", "Open {{role}} on the board", { role: name })}
                                        className="shrink-0 text-muted-foreground/50 hover:text-primary transition-colors"
                                      >
                                        <ArrowRight className="w-3.5 h-3.5" />
                                      </Link>
                                    </li>
                                  ))}
                                </ul>
                              );
                            })()
                          )}

                          {/* ── 3. PRICED CONSTRAINT CHIPS ──────────────────
                              Under the chosen slice, each carrying its live
                              count AND the live coverage of the column it
                              filters on. */}
                          <p className="mt-4 flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
                            <SlidersHorizontal className="w-3.5 h-3.5 text-primary" />
                            {sliceLabel
                              ? t("explore.chipsTitle", "Narrow “{{slice}}”", { slice: sliceLabel })
                              : t("explore.chipsTitleBare", "Narrow this field")}
                          </p>
                          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                            {t("explore.chipsCoverageNote", "The percentage on a chip is how much of the board states that thing at all. A filter can only search what employers published — roles that did not say are hidden by it, not absent from the market. Where we hold no coverage reading for a filter, the chip shows its count and no percentage rather than a number we would have had to invent.")}
                          </p>
                          {chipsPricing && Object.keys(chipPrices).length === 0 ? (
                            <p className="mt-2 text-[12px] text-muted-foreground" role="status" aria-live="polite">
                              {t("explore.chipsPricing", "Counting each narrowing…")}
                            </p>
                          ) : (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {CONSTRAINT_CHIPS.map((c) => {
                                const p = chipPrices[c.id];
                                if (!p || p.failed) return null;
                                // A CHIP WHOSE OWN FILTER THE SERVER DROPPED
                                // MUST NOT RENDER. normalizeFilters names what
                                // it refused in ignoredFilters, and a chip
                                // priced on a query the click will not run is
                                // the silent-filter failure this codebase has a
                                // contract against.
                                if (Object.keys(c.patch).some((k) => p.ignored.includes(k))) return null;
                                const label = pricedLabel(p);
                                if (label === null) return null;
                                if ((p.total ?? p.atLeast ?? 0) <= 0 && !p.capped) return null;
                                return (
                                  <Link
                                    key={c.id}
                                    to={toBoard({ category: id, ...(role ? { q: role } : {}), ...c.patch })}
                                    className="inline-flex items-baseline gap-1.5 px-3 py-1.5 rounded-full border border-border bg-card/60 text-[12px] text-foreground/85 hover:border-primary/50 hover:text-primary transition-colors"
                                  >
                                    <span>{t(`explore.chip.${c.id}`, c.label)}</span>
                                    <span className="tabular-nums text-muted-foreground">{label}</span>
                                    {c.coverageKey && p.coverage !== null && (
                                      <span className="text-[10px] text-muted-foreground/70">
                                        {t("explore.chipCoverage", "stated on {{pct}}%", { pct: Math.round(p.coverage * 100) })}
                                      </span>
                                    )}
                                    {c.coverageKey && p.coverage === null && (
                                      <span className="text-[10px] italic text-muted-foreground/60">
                                        {t("explore.chipCoverageUnknown", "coverage unknown")}
                                      </span>
                                    )}
                                    {/* THE EXCLUSION NO FIGURE MEASURES. Only
                                        the week chip carries one today, and it
                                        is the chip that hides the most: it
                                        binds posted_at, so every posting from a
                                        structurally undated vendor is dropped
                                        however new it is, and coverageDisclosure
                                        publishes no key for maxAgeDays to
                                        quantify it with. Rendering nothing here
                                        put the page's biggest silent exclusion
                                        under a note that reads silence as "we
                                        hold no reading". */}
                                    {c.note && (
                                      <span className="text-[10px] italic text-muted-foreground/60">
                                        {t(`explore.chipNote.${c.id}`, c.note)}
                                      </span>
                                    )}
                                  </Link>
                                );
                              })}
                            </div>
                          )}

                          {/* WHERE. Country, because it is canonical and the
                              board publishes a coverage figure for it; a typed
                              city is neither. */}
                          <p className="mt-4 flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
                            <MapPin className="w-3.5 h-3.5 text-primary" />
                            {t("explore.whereTitle", "Where")}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {COUNTRY_CHIPS.map((c) => {
                              const p = countryPrices[c.id];
                              if (!p || p.failed || p.ignored.includes("country")) return null;
                              const label = pricedLabel(p);
                              if (label === null) return null;
                              if ((p.total ?? p.atLeast ?? 0) <= 0 && !p.capped) return null;
                              return (
                                <Link
                                  key={c.id}
                                  to={toBoard({ category: id, ...(role ? { q: role } : {}), country: c.id })}
                                  className="inline-flex items-baseline gap-1.5 px-3 py-1.5 rounded-full border border-border bg-card/60 text-[12px] text-foreground/85 hover:border-primary/50 hover:text-primary transition-colors"
                                >
                                  <span>{t(`explore.country.${c.id}`, c.label)}</span>
                                  <span className="tabular-nums text-muted-foreground">{label}</span>
                                  {p.coverage !== null && (
                                    <span className="text-[10px] text-muted-foreground/70">
                                      {t("explore.chipCoverage", "stated on {{pct}}%", { pct: Math.round(p.coverage * 100) })}
                                    </span>
                                  )}
                                </Link>
                              );
                            })}
                          </div>

                          {/* ── 4. THE CLOSURE RECORD, AT SLICE GRAIN ───────
                              Not a leaderboard: a narrowing of the slice the
                              reader already has, with the gap in our record
                              stated as loudly as the finding. */}
                          <p className="mt-4 text-[12px] font-semibold text-foreground">
                            {t("explore.closureTitle", "What our closure record says about the employers here")}
                          </p>
                          {closureFailed ? (
                            <p className="mt-1 text-[12px] text-warning">
                              {t("explore.closureFailed", "We could not read our closure record just now. That is our measurement failing, and it says nothing about the employers in this slice.")}
                            </p>
                          ) : closurePending && !closure ? (
                            <p className="mt-1 text-[12px] text-muted-foreground" role="status" aria-live="polite">
                              {t("explore.closurePending", "Reading the closure record for this slice…")}
                            </p>
                          ) : closure && closure.asked > 0 ? (
                            <>
                              <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
                                {closure.inSlice !== null
                                  ? t("explore.closureBasis2", "{{inSlice}} employers have roles in this slice. We looked at {{asked}} of them and hold a readable closure record for {{readable}}.", {
                                      inSlice: nf(closure.inSlice), asked: nf(closure.asked), readable: nf(closure.readable),
                                    })
                                  : t("explore.closureBasisNoTotal2", "We read the first {{rows}} results for this slice, found {{asked}} employers among them, and hold a readable closure record for {{readable}} of those. This is not every employer hiring in the slice — the board publishes no count of those, and we are not going to guess one.", {
                                      rows: nf(closure.rowsRead), asked: nf(closure.asked), readable: nf(closure.readable),
                                    })}
                              </p>
                              {closure.readable > 0 && (
                                <p className="mt-1 text-[12px] leading-snug text-foreground/85">
                                  {t("explore.closureFinding", "{{closers}} of those {{readable}} have taken at least {{min}} roles down and not put them back up.", {
                                    closers: nf(closure.closers), readable: nf(closure.readable), min: CLOSURE_MIN_FILLS,
                                  })}
                                </p>
                              )}
                              <p className="mt-1 text-[11px] leading-snug text-muted-foreground/80">
                                {/* THE BAR IS INTERPOLATED, NEVER TYPED. This sentence names the same
                                    number the finding above it takes from CLOSURE_MIN_FILLS, and a
                                    literal here is how a page goes on saying "three" after the bar
                                    moves. It matters most in a locale key: a translated VALUE beats
                                    the inline default, so a hardcoded three would survive in every
                                    language a change to the constant. */}
                                {t("explore.closureBasisNote2", "Counting, not estimating: taking {{min}} roles down and not re-listing them is arithmetic over closures we logged, and it stays true on a record far too thin to support a rate. It is not a claim that anyone was hired — a hire, a withdrawal, a cancelled requisition and a retitle look the same to us. The re-listing half is a floor, because we log one return per title per day and delete the rest, so this errs towards leaving employers out.", { min: CLOSURE_MIN_FILLS })}
                              </p>
                              {closure.tokens.length > 0 && (
                                <Link
                                  to={`/jobs?${new URLSearchParams({
                                    ...(role ? { q: role } : {}),
                                    category: id,
                                    company: closure.tokens.join(","),
                                    from: "explore",
                                  }).toString()}`}
                                  className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-medium text-primary hover:underline"
                                >
                                  {/* "THOSE" HAS TO BE TRUE OF THE LINK. The
                                      finding above counts every closer;
                                      Jobs.tsx round-trips at most twelve tokens
                                      through the comma-separated `company`
                                      param, so on a live Design slice this read
                                      "27 of those 51 have taken roles down"
                                      followed by "open this slice at THOSE 12
                                      employers" — the same word, fifteen
                                      employers quietly dropped between one
                                      sentence and the next. The capped copy
                                      names both numbers; the uncapped copy is
                                      unchanged, because there the word is
                                      accurate. */}
                                  {closure.capped
                                    ? t("explore.closureOpenCapped", "Open this slice at {{n}} of those {{closers}} employers", { n: nf(closure.tokens.length), closers: nf(closure.closers) })
                                    : t("explore.closureOpen", "Open this slice at those {{n}} employers", { n: nf(closure.tokens.length) })}
                                  <ArrowRight className="w-3.5 h-3.5" />
                                </Link>
                              )}
                            </>
                          ) : (
                            <p className="mt-1 text-[12px] text-muted-foreground">
                              {t("explore.closureNone", "We hold no readable closure record for the employers in this slice yet.")}
                            </p>
                          )}

                          {/* SAVE THE SLICE. Everything assembled above was
                              thrown away on navigation until this existed. */}
                          {user && (
                            <div className="mt-4 border-t border-border/60 pt-3">
                              <button
                                type="button"
                                onClick={() => { void saveSlice(); }}
                                disabled={saveState === "saving" || saveState === "saved"}
                                className="inline-flex items-center gap-1.5 text-[12px] font-medium text-primary hover:underline disabled:opacity-60 disabled:no-underline"
                              >
                                <Bookmark className="w-3.5 h-3.5" />
                                {saveState === "saved" ? t("explore.saveDone", "Saved to your searches")
                                  : saveState === "exists" ? t("explore.saveExists", "You already saved this search")
                                  : saveState === "failed" ? t("explore.saveFailed", "Couldn't save — try again")
                                  : saveState === "saving" ? t("explore.saving", "Saving…")
                                  : t("explore.saveSlice", "Save this slice")}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </div>

        {/* ── 5. CHECK AN EMPLOYER, PLUS THE SEARCHES YOU ALREADY SAVED ─────
            MOVED TO LAST, deliberately. It is the answer for a reader who
            already has a name in mind; the field grid is the answer for
            everyone who does not, which is who arrives here. */}
        <div hidden={intent !== "check"}>
          <Section
            icon={Search}
            title={t("explore.checkTitle2", "Check an employer — and how much of them we actually see")}
            blurb={t("explore.checkBlurb3", "Every employer whose board we carry. We show how many of their roles we hold and, where their own feed publishes a total, how much of their hiring never reaches this page.")}
          >
            <HowWeMeasure items={[
              {
                term: t("explore.methodHoldTerm", "“Roles open on our board”"),
                method: t("explore.methodHoldMethod", "An exact count of what we are serving for that employer right now — the same rows its company page shows, under both serving predicates. Nothing caps it. It is still a FLOOR on their hiring: paginated job boards are read a page at a time, so we hold what we have read, which is why so many of these land on multiples of twenty."),
              },
              {
                term: t("explore.methodFeedTerm2", "The employer's own advertised total, and the gap it opens"),
                method: t("explore.methodFeedMethod2", "Where the feed publishes its own count we show it with the day we last read it, because we keep one row per board and overwrite it on every fetch — there is no history, so a board that went dark would otherwise advertise its last total forever. THE GAP BETWEEN THE TWO IS THE MOST USEFUL THING THIS CARD CARRIES: it is how much of that employer's own advertising our reading of their board did not reach on the day shown. DO NOT DIVIDE THE TWO NUMBERS: ours is a floor on what we hold today, theirs is a single reading taken on the date shown, and their ratio is not a coverage percentage. Where we carry several boards for one employer we show no total at all, because adding figures read on different days produces a number with no date basis."),
              },
            ]} />
            {/* THE SEARCHES A READER ALREADY BUILT. user_job_searches persists
                all 21 JobSearchParams, RLS-scoped, and every Explore section
                before this one referenced it zero times — so a slice assembled
                here was thrown away the moment the reader navigated. Renders
                nothing when signed out or when there are none. */}
            <div className="mb-3">
              <SavedSearchPills />
            </div>
            <input
              type="search"
              value={cq}
              onChange={(e) => setCq(e.target.value)}
              placeholder={t("explore.checkPlaceholder", "Type a company name…")}
              aria-label={t("explore.checkTitle2", "Check an employer — and how much of them we actually see")}
              className="w-full rounded-xl border border-border bg-card/60 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            {cHits.length > 0 && (
              <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {cHits.map((h) => {
                  /* ACROSS ALL ITS FEEDS, worst first: an employer with four ATS
                     feeds merges into one row here (get_company_suggest groups by
                     display name) while the churn index is keyed by token, so
                     checking only tokens[0] would miss churn on a sibling feed. */
                  const worstToken = h.tokens
                    .filter((tk) => Array.isArray(repostIndex[tk]))
                    .sort((a, b) => (repostIndex[b]![0] ?? 0) - (repostIndex[a]![0] ?? 0))[0];
                  const worst = worstToken ? repostWarn(worstToken) : null;
                  const open = numOr(h.open_roles);
                  const single = h.tokens.length === 1;
                  // ONE GUARD, TWO CALL SITES. `single` is checked here as well
                  // as in the SQL: a later change that started summing several
                  // boards' advertised totals would otherwise reach the screen
                  // as one number carrying one board's date.
                  const feed = single ? feedTotalClaim(open, numOr(h.feed_total), typeof h.feed_total_at === "string" ? h.feed_total_at : null) : null;
                  /* A MISSING COLUMN IS OUR INSTRUMENT; A MISSING READING IS A
                     FACT ABOUT THE RECORD. get_company_suggest returned (name,
                     tokens) alone until 20260908136000, so every read below
                     resolved to undefined and the page told every single-board
                     reader "we hold no dated reading of this employer's own
                     total" — a confident falsehood about our own holdings.
                     PostgREST sends a NULL column as a present key, so
                     `undefined` here means the deployed function does not return
                     the column at all. */
                  const hasFeedColumn = h.feed_total !== undefined;
                  return (
                  <Link
                    key={h.name}
                    to={`/jobs/company/${encodeURIComponent(h.tokens[0])}?from=explore`}
                    className="group flex items-center gap-3 rounded-xl border border-border bg-card/60 px-4 py-3 hover:border-primary/50 hover:bg-card transition-colors"
                  >
                    <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 text-primary font-bold text-sm shrink-0">
                      {h.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-foreground truncate">{h.name}</span>
                      {/* OUR COUNT IS AN INSTANT and says so ("now"); the
                          employer's own total carries the day we read it. */}
                      {open !== null && (
                        <span className="block text-[11px] text-muted-foreground">
                          {t("explore.fillOpen", "{{n}} roles open on our board now", { n: nf(open) })}
                        </span>
                      )}
                      {feed && (
                        /* THE GAP, NAMED AS A COUNT AND NEVER AS A RATIO. The
                           subtraction is between two numbers we hold — how many
                           they advertised on the day shown, and how many we
                           serve — and it is the windowing story per employer:
                           what our reading of their board did not reach. It is
                           NOT a coverage percentage, which is why the sentence
                           states the difference and both of its terms rather
                           than dividing them. The gate only established that
                           their total EXCEEDS ours, so the inference stays
                           hedged: 101 against 100 satisfies it, and a "most of
                           their hiring is missing" claim would be a majority
                           assertion the gate never proved. */
                        <span className="block text-[11px] text-foreground/75 mt-0.5">
                          {t("explore.checkFeedGap2", "Their own feed advertised {{total}} roles when we read it on {{when}} — {{gap}} more than we serve for them here, so their board may show roles this page does not.", {
                            total: nf(feed.total), when: dateOf(feed.at), gap: nf(feed.total - feed.open),
                          })}
                        </span>
                      )}
                      {/* THE REFUSALS, STATED. Two different reasons, and they
                          must not borrow each other's sentence: a multi-feed
                          employer is a limit of what we may ADD UP, a missing
                          stamp is a limit of what we KNOW. */}
                      {!single && (
                        <span className="block text-[11px] text-muted-foreground/70 italic mt-0.5">
                          {t("explore.checkFeedMulti", "We carry {{n}} separate boards for this employer, read on different days, so we do not add their advertised totals together.", { n: h.tokens.length })}
                        </span>
                      )}
                      {single && !feed && hasFeedColumn && (
                        <span className="block text-[11px] text-muted-foreground/70 italic mt-0.5">
                          {t("explore.checkFeedUnknown", "We hold no dated reading of this employer's own total, so we cannot say how much of their hiring is missing here.")}
                        </span>
                      )}
                      {h.tokens.length > 1 && (
                        <span className="block text-[11px] text-muted-foreground">
                          {t("explore.checkFeeds", "{{n}} job boards", { n: h.tokens.length })}
                        </span>
                      )}
                      {worst && <span className="block text-[11px] text-warning mt-0.5">{worst}</span>}
                    </span>
                    <ArrowRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
                  </Link>
                  );
                })}
              </div>
            )}
            {/* A GENUINE MISS. Only reachable when the lookup actually answered
                and returned nothing — never when it failed. */}
            {cState === "ok" && cHits.length === 0 && (
              <p className="mt-3 text-sm text-muted-foreground">
                {t("explore.checkNone", "We don't carry that employer's job board — so we have nothing measured to show you.")}
              </p>
            )}
            {/* A BROKEN LOOKUP, said as such. This must never borrow the
                sentence above: "we don't carry them" is a claim about the
                employer, and we are in no position to make it when our own query
                did not answer. */}
            {cState === "error" && (
              <p className="mt-3 text-sm text-warning">
                {t("explore.checkErr", "Employer lookup is unavailable right now — this says nothing about that employer. Try again shortly.")}
              </p>
            )}
            {cState === "idle" && cq.trim().length === 0 && !user && (
              <div className="mt-4">
                <Refusal
                  title={t("explore.checkIdleTitle", "Nothing typed yet")}
                  body={t("explore.checkIdleBody", "This looks up one employer at a time. If you don't have a name in mind, the field grid above reaches far more of the board than any single employer can.")}
                />
              </div>
            )}
          </Section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
