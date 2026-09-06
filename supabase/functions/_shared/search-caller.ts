/**
 * WHO ASKED. The write side of the caller enum on job_board_search_events.
 *
 * `logSearch()` in job-board/index.ts fires on every exit from the `list`
 * action, unconditionally, and the row it wrote carried q, filters, route,
 * took_ms, results, total and offset — and nothing at all about WHERE the
 * request came from. No bot flag, no visitor id, no user agent, no source.
 *
 * Meanwhile `action:'list'` is called by us, constantly:
 *
 *   - the filter audit's self-calls        ~31 rows a day, every day
 *   - scan-heartbeat's contract battery    four probes per heartbeat run,
 *                                          including a literal
 *                                          {salaryFloor: 100000} probe that is
 *                                          not a person wanting a six-figure job
 *   - send-search-digest                   a call per saved search per digest
 *   - agent-mcp                            every MCP tool call
 *   - public-api                           every paying /v1 customer, since
 *                                          /v1/jobs?engine=ranked and POST
 *                                          /v1/fit proxy straight through
 *
 * All of it landed in the same table as a candidate typing "nurse" into the
 * site, indistinguishable. No retroactive filter can separate them: the probes
 * are ordinary queries with ordinary filters, and the only thing that ever
 * distinguished them — the caller — was not written down. It is a WRITE gap.
 * A day that goes by unstamped stays unstamped forever.
 *
 * ── THE CONTRACT, WHICH LIVES IN job-board/index.ts ─────────────────────────
 *
 * `resolveCaller(req, body)` there is the ONE resolver, and this module does
 * not ship a second one — two implementations of one definition is how a
 * column starts meaning two things. What it accepts, most trustworthy first:
 *
 *   1. an explicit declaration: `body.caller`, or the `x-rsp-caller` header —
 *      checked against the enum below. THIS is what the helper here sends;
 *   2. a service-role bearer or apikey -> 'maintenance', because only our own
 *      infrastructure holds that credential;
 *   3. a browser-shaped request (Origin or Referer present) -> 'web';
 *   4. otherwise NULL — not a guess. A server-to-server call carrying the anon
 *      key could be public-api, agent-mcp or the digest and the board cannot
 *      tell which; they are byte-identical at that point. Which is exactly why
 *      each of them must declare itself, and why this file exists.
 *
 * THE HEADER NAME IS LOAD-BEARING AND IS DEFINED ONCE, HERE. `x-rsp-caller`
 * misspelled at one call site is not an error anywhere — it is a caller class
 * that silently resolves to NULL forever, and forever is the operative word
 * for an append-only log. This is the same failure this repo has shipped
 * before as a guard whose literal passed while the code behind it was dead.
 * Import the helper; never retype the string.
 *
 * IT IS A HINT, NOT A CREDENTIAL. The anon key is public and a client can send
 * any header it likes, so this says "who claims to be calling" — which is
 * exactly enough for the job: our own monitoring stops being invisible.
 * Nothing is authorised on the strength of it.
 */

/**
 * The closed set, matching the CHECK constraint on
 * job_board_search_events.caller. Five values, each a traffic class worth
 * counting separately — or excluding — when reading demand:
 *
 *   web          the site: a human in a browser.
 *   api          a paying /v1 customer, proxied through public-api.
 *   mcp          an agent, through agent-mcp.
 *   digest       send-search-digest replaying a saved search on a cadence. Our
 *                call on a REAL user's query — neither candidate demand nor
 *                monitoring, so it gets its own value rather than being
 *                flattened into either.
 *   maintenance  our own monitoring: scan-heartbeat's contract battery and the
 *                filter audit's self-calls. Never candidate demand.
 */
export const SEARCH_CALLERS = ["web", "api", "mcp", "digest", "maintenance"] as const;

export type SearchCaller = (typeof SEARCH_CALLERS)[number];

/** The header job-board's resolveCaller actually reads. Lowercase; Headers.get
 *  is case-insensitive, and the resolver lowercases the value besides. */
export const SEARCH_CALLER_HEADER = "x-rsp-caller";

/**
 * THE SAME STAMP UNDER THE OTHER SPELLING, AND WHY BOTH GO OUT.
 *
 * The read side disagrees with itself as shipped: job-board's resolveCaller
 * reads `x-rsp-caller`, while the column comment written in the same wave
 * (20260906216000, job_board_search_events.caller) documents the header as
 * `x-rb-caller`. One of the two will be corrected; nobody yet knows which.
 *
 * The failure if the write side guesses wrong is the worst kind available
 * here: not an error, not a 400, but every api/mcp/digest row quietly
 * attributed as web or null — for however many days pass before someone
 * notices, and those days cannot be re-attributed afterwards. This codebase
 * has shipped that exact shape before (a guard whose literal passed while the
 * code behind it was dead).
 *
 * Two request headers cost nothing, cannot conflict (they carry the identical
 * value), and make the stamp survive the reconciliation whichever way it goes.
 * DELETE THE ALIAS once the two spellings agree — it is a bridge, not a
 * contract.
 */
export const SEARCH_CALLER_HEADER_ALIAS = "x-rb-caller";

/**
 * Spread into a fetch's `headers` at a call site:
 *
 *   headers: { "Content-Type": "application/json", ...searchCallerHeader("api") }
 *
 * A helper rather than a literal at each site so the header names exist in
 * exactly one place — see the note above on why a typo here is silent.
 */
export function searchCallerHeader(caller: SearchCaller): Record<string, string> {
  return { [SEARCH_CALLER_HEADER]: caller, [SEARCH_CALLER_HEADER_ALIAS]: caller };
}
