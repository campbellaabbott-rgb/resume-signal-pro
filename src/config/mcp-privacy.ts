// WHAT EACH WAY OF REACHING US FROM AN AI RECEIVES AND STORES — the one table
// (connect spec §3.8, with the owner decisions of 2026-10-11 applied) that the
// Privacy page renders and the tool descriptions and directory answers are
// drawn from. DRAFT FOR COUNSEL REVIEW: owner action 9 has counsel approve the
// wording before the MCP address on our own domain publishes.
//
// The facts each row states, and where they are made true:
//   - search words: from Claude and other connections, with no record of
//     which postings were shown from CONNECTOR_SEARCH_LOG_CHANGED on (job-board
//     .93 and later write none for connector searches; .93 and .95 never
//     served, so the first such build live is the one deploy's .96), kept for
//     the demand log's general 180 days until the connector prune
//     (20261011103000, applied 2026-11-15) has run, and for 30 days once it
//     has and the page says so (MCP_SEARCH_PRUNE_LIVE, MCP_SEARCH_PRUNE_RUN);
//     NOT written from ChatGPT from that day on (job-board .93 and later honour
//     the no-log flag agent-mcp sets on the ChatGPT surface, only with the
//     reader proof). Searches logged before that day, by the live .92, name
//     the postings shown and include ChatGPT's; both wordings of the row say
//     so, the 30-day one with the day the last of them is deleted
//     (EARLIER_SEARCHES_GONE_BY);
//   - the caller's address and ChatGPT's per-person id: only ever a hashed
//     allowance bucket, the address buckets kept 7 days and ChatGPT's dropped
//     when their day ends (mcp_anon_rate);
//   - host, tool and outcome: daily counts with no address or person
//     (mcp_calls_daily);
//   - a CV: no keyless tool or prompt takes one (the CV-matching prompt no
//     longer has a CV argument); fit_resume, on a key only and never on ChatGPT,
//     receives one in memory to score it and stores none of it.
// A row that goes false when its mechanism moves is the claim-drift pattern;
// src/test/the-privacy-page-says-what-each-ai-surface-receives-and-keeps.test.tsx
// pins the rows the page must carry.

/**
 * Whether the Privacy page says the connector's 30-day search prune keeps
 * connector searches. Its migration (20261011103000) was held in
 * docs/deploy-ledger.json holdUntilVerified, released on 2026-11-08 into the
 * seo-connect deploy message, and applied by Lovable on 2026-11-15 (drizzle
 * 0221). Read live that day, get_cron_health listed
 * search-demand-mcp-retention active at 47 3 * * * with no run yet: its first
 * run is 2026-11-16 03:47 UTC, so until then nothing deletes a connector
 * search before the demand log's general 180 days, and the page says so. Set
 * this true only in a frontend publish after get_cron_health shows a run of
 * that job that succeeded, recorded in MCP_SEARCH_PRUNE_RUN, with
 * PRIVACY_LAST_UPDATED moved to the publish day (docs/wave4/README.md, owner
 * steps). src/test/the-privacy-page-says-what-each-ai-surface-receives-and-keeps.test.tsx
 * fails while it is true without that record, or while the ledger holds the
 * migration again.
 */
export const MCP_SEARCH_PRUNE_LIVE: boolean = false;

/** The day the connector prune's migration applied (drizzle 0221). */
export const CONNECTOR_PRUNE_APPLIED = "2026-11-15";

/**
 * The read that lets MCP_SEARCH_PRUNE_LIVE be true: search-demand-mcp-retention
 * as anon get_cron_health answered it (ch_runs, ch_last_start, ch_last_status)
 * and when, or null until a run is read. Fill it from that read, never by hand.
 */
export const MCP_SEARCH_PRUNE_RUN: { readAt: string; runs: number; lastStart: string; lastStatus: string } | null = null;

/**
 * The day connector searches stop naming the postings shown and ChatGPT's stop
 * being kept: the day job-board 2026-09-09.93 or later (the one deploy's .96)
 * starts serving. The live .92 writes the postings shown for every search and
 * ignores ChatGPT's no-log flag, so the cell names this day, never the
 * policy's own date. It is the deploy day, set at the merge into main:
 * docs/deploy-ledger.json datedAtDeploy makes the ledger refuse a deploy
 * message while job-board is older than .93 and this reads another day (UTC).
 */
export const CONNECTOR_SEARCH_LOG_CHANGED = "2026-10-31";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "2026-10-31" as "October 31, 2026", the way the page writes its own date. */
export function writtenDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/**
 * The day the last search logged before CONNECTOR_SEARCH_LOG_CHANGED is gone
 * once the connector prune runs: it deletes a row on the 31st day after the
 * day it was written (at < today - 30, nightly at 03:47 UTC), so the last of
 * them, made on the day of the change before the new build served, goes on the
 * run 31 days after that day.
 */
export const EARLIER_SEARCHES_GONE_BY = "2026-12-01";

/**
 * NB-39. The day connector searches began to name the connection that made
 * them: job-board's caller column arrived with the 2026-09-06 deploy, with no
 * backfill, so a search logged before this day has no caller. The 30-day
 * prune deletes only rows that name a connection, so those searches cannot be
 * told apart from the site's own and are kept like them, for 180 days. The
 * owner chose to say so (option 1) rather than delete every unnamed row of
 * that week, which would take the site's own searches with them.
 */
export const CONNECTOR_CALLER_RECORDED_FROM = "2026-09-07";

/**
 * The day the last unnamed connector search is gone under the site's 180
 * days: the demand log's prune deletes a row made on day D on the run of day
 * D+181, so the last of them, made on 2026-09-06, goes on 2027-03-06; the page
 * names the day after, one run of margin.
 */
export const UNNAMED_SEARCHES_GONE_BY = "2027-03-07";

const SINCE = writtenDay(CONNECTOR_SEARCH_LOG_CHANGED);
const GONE_BY = writtenDay(EARLIER_SEARCHES_GONE_BY);
const UNNAMED = `Searches made through any connection before ${writtenDay(CONNECTOR_CALLER_RECORDED_FROM)} were logged without naming it, so they cannot be told apart from the site's own and are kept like them, for up to 180 days, the last by ${writtenDay(UNNAMED_SEARCHES_GONE_BY)}.`;
/** The search row's "kept" cell, in the wording for a prune that has run (true) or not yet (false). */
export function searchKept(pruneHasRun: boolean): string {
  return pruneHasRun
    ? `From Claude and other connections: the search words and filters, kept for 30 days; searches made from ${SINCE} on keep no record of which postings were shown, and earlier ones still do until they are deleted at 30 days old, the last by ${GONE_BY}. From ChatGPT: searches made from ${SINCE} on are not kept; earlier ones are deleted at 30 days old, the last by ${GONE_BY}. ${UNNAMED}`
    : `From Claude and other connections: the search words and filters, kept for up to 180 days, like the site's own search log; searches made from ${SINCE} on keep no record of which postings were shown, and earlier ones still do. From ChatGPT: searches made from ${SINCE} on are not kept; earlier ones are kept like the site's own search log.`;
}
const SEARCH_KEPT = searchKept(MCP_SEARCH_PRUNE_LIVE);

export interface McpPrivacyRow {
  id: "search" | "job-ids" | "address" | "chatgpt-id" | "usage" | "cv" | "chat";
  what: string;
  claude: string;
  chatgpt: string;
  kept: string;
}

export const MCP_PRIVACY_ROWS: readonly McpPrivacyRow[] = [
  {
    id: "search",
    what: "Your search words and filters",
    claude: "Received",
    chatgpt: "Received",
    kept: SEARCH_KEPT,
  },
  {
    id: "job-ids",
    what: "The ids of postings your AI opens or checks",
    claude: "Received",
    chatgpt: "Received",
    kept: "Only daily totals, with nothing that identifies you.",
  },
  {
    id: "address",
    what: "The network address the call comes from",
    claude: "Received",
    chatgpt: "Received",
    kept: "Only as a one-way hashed allowance counter, kept for 7 days. From Claude and ChatGPT the address is the provider's server, not yours.",
  },
  {
    id: "chatgpt-id",
    what: "ChatGPT's anonymous per-person id, when ChatGPT sends one",
    claude: "Not applicable",
    chatgpt: "Received",
    kept: "Only as a one-way hashed allowance counter, deleted when its day ends.",
  },
  {
    id: "usage",
    what: "Which app called, which tool, and whether it answered",
    claude: "Received",
    chatgpt: "Received",
    kept: "Daily counts only, with no address and no person.",
  },
  {
    id: "cv",
    what: "Your CV or résumé",
    claude: "Never requested by any tool that works without a key. With a key, the résumé-fit tool receives a résumé to score it.",
    chatgpt: "Never requested",
    kept: "Never stored. The résumé-fit tool uses it in memory to score postings and keeps none of it.",
  },
  {
    id: "chat",
    what: "Your conversation with your AI",
    claude: "Never received",
    chatgpt: "Never received",
    kept: "Nothing: it never reaches us.",
  },
];
