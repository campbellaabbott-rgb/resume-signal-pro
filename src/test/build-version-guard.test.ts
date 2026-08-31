import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

/**
 * sources.ts and BUILD_VERSION must change together.
 *
 * WHAT THIS PREVENTS, learned the expensive way on 2026-08-01. 22 verified
 * Pinpoint boards were merged into sources.ts and deployed. The catalog grew by
 * exactly 22, the tokens were present, and not one posting appeared on the
 * board for hours.
 *
 * The cause: brand-new boards are jumped ahead of the ~28,000-board cold
 * rotation by a bootstrap lane, and that lane is keyed on BUILD_VERSION. With
 * the constant unchanged it never recomputed, so the new boards took their
 * place at the back of a queue that takes days to come round. Catalog correct,
 * board empty — nothing errored, nothing looked wrong, and the only symptom was
 * an absence.
 *
 * The comment in index.ts said to bump BUILD_VERSION when a SHARED MODULE
 * changed. It did not mention sources.ts. A rule that lives only in a comment
 * fails exactly when someone edits the one file the comment forgot to name, so
 * this asserts it instead.
 *
 * WHEN THIS TEST FAILS, that is it working. Bump BUILD_VERSION in
 * supabase/functions/job-board/index.ts, then paste the new hash it prints
 * below. Two deliberate edits, which is the point — the second is the receipt
 * for the first.
 */
const ROOT = resolve(__dirname, "../../supabase/functions/job-board");

/** Updated together with BUILD_VERSION, never on its own. */
const PINNED = {
  // 2026-08-10.1: +11 of the 14 HELD Workable boards (~1,786 postings), finally
  // given a real verdict — Workable stopped throttling, so the description
  // screen could actually read them. Three were confirmed mills and stay out:
  // solution-sft (597p, hospital nurse placement), gotham-enterprises (563p,
  // near-identical therapist ads + on-behalf language), ubteam (122p, 6/12
  // recruiting-on-behalf). Two lessons paid for in this batch: rimkus's 8/12
  // "our client" hits were a CONSULTANCY describing its own service work
  // (context read, kept), and 4chain's Schwertfels-shaped salary-band titles
  // carried zero placement language in two languages across 40 ads (kept).
  // Evidence convicts; names alone do not.
  // 2026-08-10.2: +Domino's (smartrecruiters:dominos, 24,566 postings) — the
  // hold from 2026-08-07 released on the middle path: merged into the board
  // and search, excluded from EDITORIAL stats via showcase_excluded, and kept
  // out of the hot tier through both doors (velocity RPC and size ranking).
  // Same commit: +11 of the held Workable boards.
  // 2026-08-10.3: SR_CAP 800 -> 2,000. sources.ts is UNCHANGED by that (the
  // hash below still pins the Domino's + Workable merge); the bump is for the
  // fetcher itself, so the deployed bundle is identifiable when checking
  // whether the larger window actually landed.
  // 2026-08-11.1: 29 boards renamed in sources.ts. Most were the slug
  // title-cased and rendered that way on company cards — "Thehartford",
  // "Hdsupply", "Nyp", "Umd", "Ummh", "Ncsecu". Four were worse than cosmetic:
  // Fabletics, Savage X Fenty and JustFab all sat under the parent slug
  // "Justfab", and PHP Agency / Ritter / Connexion Point under
  // "Integritymarketing" — and get_size_segments merges boards BY DISPLAY NAME,
  // so those distinct employers were being counted as one company.
  // Ships with NAME_SYNC_VERSION 2, because the refresh is insert-only and a
  // rename reaches stored rows through that sweep or not at all.
  // 2026-08-11.2: 9 more board renames (8 employers; Embry-Riddle has two
  // boards). These became visible only AFTER the Explore migrations landed —
  // "Transparent about pay" rendered for the first time and the size bands
  // re-cut on served counts, surfacing cards that had never been on screen.
  // Every name was verified against the employer's own board or careers site;
  // two differed from the obvious guess (Alignment Health, not Healthcare;
  // AnewHealth, not ExactCare). Ships with NAME_SYNC_VERSION 3.
  // 2026-08-11.3: name-sync repair only — sources.ts is UNCHANGED (the hash
  // below still pins the v3 renames). Measured after the v2 sweep ran: tokens
  // 1-14 renamed, 15-29 untouched, and the run would have stamped itself
  // complete over its own failures. The sweep now skips already-correct boards,
  // narrows each UPDATE to rows that differ, and refuses to stamp its version
  // when any board failed. Bumped so the deploy is externally identifiable.
  // 2026-08-12.1: +18 iCIMS employers / 9,282 postings (round 2, two-hop CDX
  // discovery — see the block comment above the iCIMS entries in sources.ts).
  // This test is the reason they will actually appear: the bootstrap lane is
  // keyed on BUILD_VERSION, and 18 new boards behind a 28,000-board cold
  // rotation would have been days of "catalog correct, board empty" — the exact
  // Pinpoint failure this guard was written for, reproduced at 18x the size.
  //
  // Same bump also carries the structured-sweep lane, which is index.ts-only.
  // 2026-08-12.2: structured-sweep kick MOVED out of the starved tail of
  // maybeKickMaintenance up to the independent-track block. sources.ts is
  // UNCHANGED (the hash below still pins the iCIMS round-2 merge); the bump is
  // so the fix is externally identifiable. The lane had deployed and never run
  // — four status polls over 13 minutes, structuredSweep all-null — because two
  // branches above it return after kicking.
  // 2026-08-12.3: the lane still never ran after .2, and the reorder was not
  // the whole bug. `id` is source:token:externalId, so ordering by id orders by
  // VENDOR, and every vendor sorts before "workday" — an empty cursor made hop
  // one scan ~300k non-matching rows and time out. Every later hop would have
  // been fine, so it could only fail at the one hop it could never get past.
  // Cursor now seeds to `workday:`, the walk is bounded above at `workday;`,
  // and the progress row is stamped BEFORE the work so a dead hop stops looking
  // identical to a hop that was never kicked. sources.ts UNCHANGED.
  // 2026-08-12.5 (.4 was minted and reverted with the backlog-policy change):
  // structured-sweep totals become CUMULATIVE through the chain and the
  // done-stamp reports {doneAt, scanned, filled} instead of erasing the pass's
  // evidence — the first real pass finished in ~7 minutes and left a bare
  // {doneAt}, making "small eligible set" and "early termination"
  // indistinguishable. sources.ts UNCHANGED.
  // 2026-08-12.6: the sweep's progress stamp gains firstId/lastId/pageLen —
  // the id window each hop actually visited. The 17:50 pass "completed"
  // against 148,776 eligible rows with the id-prefix assumption verified
  // correct, so the only remaining way to see where the walk went is for the
  // walk to report it. sources.ts UNCHANGED.
  // 2026-08-12.7: the sweep's upper-bound sentinel ";" -> "~". The semicolon
  // is truncated in the REST query string (proven live: lt.workday; matches
  // zero rows, lt.workday~ matches), so the bounded window was empty and two
  // passes stamped doneAt over 148,776 untouched rows. sources.ts UNCHANGED.
  // 2026-08-12.8: structured-sweep hop 120 -> 24 (id-ordered hops cluster on
  // one tenant; a hanging board = 15 waves x 20s = past the wall clock — two
  // passes died mid-hop), and the start-stamp carries its cursor so a dead
  // hop resumes in place instead of from the range start. sources.ts UNCHANGED.
  // 2026-08-13.1: +795 boards / ~6,392 postings across the FOUR SENDABLE
  // vendors (breezy +186, teamtailor +33, pinpoint +288, personio +288) —
  // direct apply-agent inventory, ~19% on top of its 34.5k. Wayback CDX
  // round, every board probed live, names from the employer's own payload or
  // careers-page title (skip-on-doubt), 7 staffing-named boards held out, 52
  // exact-name duplicates skipped. The bump is what puts these into the
  // bootstrap lane instead of a days-long cold rotation.
  // 2026-08-13.2: round 2 of the sendable census. Common Crawl 504s on
  // wildcard host queries (recorded so it is not retried blind); a deeper
  // Wayback pull found breezy/teamtailor already saturated by round 1 and
  // added 19 personio boards. Small by design — the namespaces are close to
  // exhausted, which is itself the finding.
  // 2026-08-17.1: the data-integrity round. sources.ts is UNCHANGED (the hash
  // below still pins the round-2 sendable census); this bump is so the fixes
  // are externally identifiable, and because POSTED_BACKFILL_VERSION 6 -> 7
  // re-arms a sweep that must not run on the old code. Five defects, all
  // measured live: (1) the backfill's draw ran with an EMPTY cursor, so it
  // could not use the primary key and timed out at 3.1-3.3s against a ~3s
  // statement timeout — seeded to `${phase}:` it returns in 0.23s; (2) a draw
  // timeout was read as "phase exhausted" and, on the terminal phase, wrote an
  // unconditional completion stamp recording backlogAtSweep 43,118 rows that
  // nothing had touched — poisoning the growth re-arm into a ratchet; (3) the
  // Workday work-mode classifier tested five substrings against a
  // TENANT-AUTHORED free-text field and matched 0 of 154 sampled postings, so
  // the structured sweep reported 154,003 scanned / 0 filled; (4) `filled`
  // counted update ATTEMPTS, since PostgREST returns no error on a zero-row
  // match; (5) pinpoint sat at exactly 0% dated because a note concluded "no
  // sweep can fix them" from inspecting one endpoint — postings.json has no
  // date, but every posting PAGE carries an employer-stated datePosted in its
  // JSON-LD, and the list already hands us the URL.
  // 2026-08-19.1: +PetSmart (icims, 10,911 postings measured — the census
  // find that also exposed the windowing bug: the global 12-page cap would
  // have served 1,200 of them, so JobSource gained a per-tenant `pages`
  // budget) and +USAJOBS, the first SINGLE-SOURCE vendor on the board (one
  // national federal feed, agency-as-employer, never agent-sendable).
  // 2026-08-21.1: index.ts only — sources.ts is UNCHANGED (the hash below still
  // pins the PetSmart + USAJOBS merge), so no board is waiting on the bootstrap
  // lane and this bump carries no catalog risk. Three search fixes ride on it,
  // all measured live before and after:
  //   - the PGRST203 overload drop, which had left every ranked search falling
  //     through to the recency path with the fuzzy and semantic tiers dead;
  //   - close matches reordered above description-only rows, after "maneger"
  //     was measured putting 7 Dutch care postings above 39 Managers;
  //   - a pay figure typed alone ("120000", "80k") now filters instead of being
  //     searched as text — it returned 0 against a floor that counts 13,381.
  // The bump was applied by the deploy rather than by hand, which is exactly
  // the case this guard exists to catch: the version moved and its receipt did
  // not, so the failure is the test working.
  // 2026-08-21.2: index.ts only — sources.ts UNCHANGED, so no board is waiting
  // on the bootstrap lane. Bumped for a reason this guard did not anticipate:
  // NOT to make a change work, but to make a deploy IDENTIFIABLE. Three commits
  // (intent-to-filter, filter coverage, the servable headline) sat undeployed
  // while the version string read the same as the build that was live, so
  // "is it deployed?" could only be answered by probing behaviour — the exact
  // rung-2 pain the version exists to remove. A version that does not move
  // across a deploy boundary cannot answer the one question it is for.
  // 2026-08-21.3: index.ts only, sources.ts UNCHANGED. Carries the exact-word
  // tier's company half, the possessive variant, and the deadline raise. Bumped
  // as a matter of course this time — the .2 bump had to be made retroactively
  // after three commits shipped undeployed behind an unchanged version string,
  // and "is it live?" cost six behavioural probes to answer.
  sourcesHash: "0612c4ff593f4e54",
  // 2026-08-21.4: disables the exact-word tier's company matcher, whose index
  // never built. Bumped so the mitigation is externally identifiable.
  // 2026-08-21.5: routed retrieval. index.ts + two new modules; sources.ts
  // UNCHANGED, so nothing waits on the bootstrap lane.
  // 2026-08-25.19: the at-cap fast lane. index.ts only, sources.ts UNCHANGED,
  // so no board is waiting on the bootstrap lane. Cadence only — the deep
  // cursor plumbing from .16 is untouched. .18 made the rotation observable
  // and what it showed was boards 66 / sumOffset 33,000, exactly 66 x 500: not
  // one capped board had ever reached a second window, because the cold
  // rotation revisits a board only every ~11.4h. The deep_cursor map is now
  // fed back into the slice as a fourth source, capped at 25 and rotated.
  // Judge this bump ONLY by deepCursor.maxOffset exceeding 500.
  // 2026-08-25.20: ranked search was DOWN and silent. index.ts only,
  // sources.ts UNCHANGED. `facetHead` hoists (it is a function declaration) but
  // closes over `const FACET_COMPANY_LIMIT`, which sat ~300 lines BELOW the
  // ranked return — so the ranked path read it from the temporal dead zone,
  // threw ReferenceError, and the enclosing catch served the recency fallback
  // without a word. Measured live on .19: `ranked: true` appeared on NO query,
  // and title-tier-empty searches served 0 rows against 741 real description
  // matches. The const moves above the ranked path, the catch now logs and
  // publishes `rankedFellBack`, and a guard pins the declaration order.
  // 2026-08-25.21: DEEP_PER_SLICE 25 -> 8. index.ts only, sources.ts UNCHANGED.
  // The fast lane worked (CVS 630 -> 2,499 stored, boards-still-filling 123 ->
  // 44) but at four times the rotation cost: measured live, 46.0 boards/min
  // before the lane against 11.4 with it, i.e. an 11.4h cold cycle stretched to
  // 46.2h. A deep board is a 500-posting Workday window with descriptions, not
  // a cheap bootstrap probe, so 25 of them tripled a slice.
  // 2026-08-25.22: the headline count refreshes every 15 min instead of once
  // per rotation pass. index.ts only, sources.ts UNCHANGED. Bumped for the
  // reason this guard's .2 entry records — a version that does not move across
  // a deploy boundary cannot answer "is it live?", and the behaviour here is
  // otherwise invisible from outside except as a timestamp moving sooner.
  // 2026-08-25.23: publishes coverage.tracked — the corpus INCLUDING closed
  // postings — beside the servable headline. index.ts only, sources.ts
  // UNCHANGED. The headline itself does not move: tracked is a second figure
  // with its own label, never a replacement, and it is omitted rather than
  // defaulted when the count has not been taken.
  // 2026-08-25.24: deep pages are scored. Past the 200-row seam the tail was
  // served in raw ts_rank_cd order, which rewards repetition — the ordering
  // that buries a posting titled exactly "Sales Associate". index.ts only,
  // sources.ts UNCHANGED.
  // 2026-08-25.25: the vector tier reaches THIN pages, not only empty ones —
  // a query landing three weak matches got no help before. Retrieval is now a
  // single shared helper used by both entry points, so the four properties
  // that make it safe (bounded, filter-safe, lexically anchored, anchored on
  // surviving rows) cannot drift between two copies. index.ts only,
  // sources.ts UNCHANGED.
  // 2026-08-25.26: the retry lane. A failed fetch cost a board a FULL rotation
  // (8.2h measured) before anything tried again, which is what put the
  // freshness p95 at 20.7h against a healthy p50 of 4.9h — the tail was never
  // rotation speed, it was boards waiting a lap for a second chance. Retries
  // now start at 15 min and back off per streak into dormancy. Capped at 5,
  // deliberately the smallest lane on the slice. index.ts + dormancy.ts;
  // sources.ts UNCHANGED.
  // 2026-08-25.27: chain liveness. `cursor` and `lastSliceAgeMin` read
  // identically whether slices come from a self-sustaining chain or from one
  // cron kick every ten minutes — a 5-8x throughput difference reported as the
  // same numbers, which cost an hour of cursor sampling to resolve and gave the
  // wrong answer first. status.chainKick now says what happened to the last
  // kick. index.ts only, sources.ts UNCHANGED.
  // 2026-08-25.28: the count deadline stops escalating. Missing the 1.5s race
  // fell back to the UNBOUNDED inline exact count and re-fetched the page,
  // so a 190ms overrun cost 5.4s instead of 0.4s (reproduced live). A timeout
  // now means "no count", which the client already renders honestly.
  // index.ts only, sources.ts UNCHANGED.
  // 2026-08-25.29: the bare word "remote" becomes a filter. It was ANDed
  // against the job title, so q="remote python" found 3 postings where the
  // remote filter finds 200. The exclusion was deliberate but rested on a
  // figure about a different column; measured, the ambiguity it feared is
  // 2.7% (168 of 6,119 "remote"-titled jobs are not work_mode=remote).
  // remote/hybrid/onsite lift, and every remote phrase moves off the narrower
  // `remote` boolean onto workMode. index.ts only, sources.ts UNCHANGED.
  // 2026-08-25.30: the semantic rescue tier could not report its own failure.
  // search_jobs_semantic is answering 57014 on real embeddings; the tier's 5s
  // deadline wins the race first, so withDeadline hands back { data: null }
  // with NO error and the tier returned [] — identical to "looked, found
  // nothing". The page then claimed the corpus had no answer. semanticDegraded
  // now names the four infrastructure failures and is surfaced on the response
  // like rankedFellBack. index.ts only, sources.ts UNCHANGED.
  // 2026-08-25.31: the request clock started after the 1.3-1.6MB facet read, so
  // a median ~958ms of every list request was outside tookMs/phaseMs entirely.
  // Split in two rather than moved: reqStart also fed budgetLeft(), which sizes
  // six downstream deadlines, and moving it earlier would have silently
  // shortened all six. Reporting now counts the meta read; the budget still
  // starts where the work does. The head-term ring is also issued before
  // search_jobs instead of after it (~473ms of the pair), catching at creation
  // so an early rejection is not unhandled. index.ts only, sources.ts UNCHANGED.
  // 2026-08-25.32: work mode becomes a list ("remote or hybrid" was unaskable —
  // 5,241 postings in GB against the 1,476 a searcher could reach), and a pay
  // ceiling stops cancelling includeUnstatedPay (design at a $100k floor: 3,375
  // with the toggle, 404 once a ceiling is added — the pay-floor NULL discard
  // re-armed by a second predicate). index.ts + filters.ts; sources.ts UNCHANGED.
  // 2026-08-25.33: the routed window follows the page (everything past row 400
  // was unreachable — 84.9% of "cdl", 92.4% of "sales rep"); re-ranking scores
  // against alias expansions instead of sorting the rows they fetched to the
  // bottom; the facet row is cached in-isolate for 60s (median 863ms, ~47% of a
  // plain browse); the semantic tier stands down for 10 min after a failure
  // instead of paying 5.0s per search; a resolved rankErr is reported; and every
  // phase mark carries an outcome. index.ts + search-routing.ts, sources.ts UNCHANGED.
  // 2026-08-25.34: exclusions. "engineer not manager" returned managers — the
  // words were dropped from the tsquery and the rest re-read as a conjunction,
  // giving the opposite of the request. Split before anything is searched and
  // applied at attachRecheckedAt, the one function every posting path already
  // calls, as an EXPLICIT parameter (module state would leak one visitor's
  // exclusions into another's results). index.ts + search-routing.ts, sources.ts UNCHANGED.
  // 2026-08-25.35: filterCoverage stops going dark. A failed count returned
  // null and null publishes as "no figure", so a timed-out count DELETED a
  // disclosure instead of reporting a problem — live it was publishing one of
  // its four figures, leaving a pay-floor searcher (~20% of the board) and a
  // work-mode searcher (~28%) told nothing at all. Errors are logged, the
  // previous figure is carried forward, and staleParts names what is stale.
  // index.ts only, sources.ts UNCHANGED.
  // 2026-08-25.36: the serving path stops reading the 1.3-1.6MB facet row — the
  // refresh pass now writes a small `refresh_head` row carrying exactly what it
  // uses. The 60s in-isolate cache shipped in .33 was INERT (module state does
  // not survive between requests here: 14 consecutive requests, zero hits), and
  // so was the semantic cooldown; both are removed rather than left reading as
  // protection. index.ts only, sources.ts UNCHANGED.
  // 2026-08-25.37: no job-board change; version moved with the batch that fixed
  // check-alerts, send-scan-report and the multi-select "Clear all".
  // 2026-08-27.38: the location-split tier — a zero-title-count query whose
  // tail names a place ("nurse london") is split and re-run as q+location,
  // disclosed as locationSplit. The eighth list exit.
  // 2026-08-27.39: salaryCeiling/payBasis/maxYears/department/vendors moved
  // out of the blind set — extraFilterParams beside every payParams spread,
  // vendors merged into p_sources. Pairs with 20260827210000.
  // 2026-08-27.40: the split gate fires on a THIN title segment (total < 30,
  // acceptance 2x + floor 15) — the total===0 gate was verified dead on
  // "nurse london" the day .39 went live: the company name carried the city.
  // 2026-08-27.41: coverage from get_filter_coverage() (one scan, nine
  // figures — three of four separate counts were dying of timeouts), the five
  // pinned constants demoted to deploy-window fallbacks, and the wrap writer
  // stamps wrapMin so the freshness SLA can anchor on measurement.
  // 2026-08-27.42: census CC-MAIN-2026-34 merged — 1,031 boards (~34k visible
  // postings) after blocklist/collision/mill screening; three titles-only
  // "clears" (Gotham, Symicor, UBT) were convicted by reading real posting
  // text and excluded. The bump is load-bearing: without it the new boards
  // queue invisibly behind the full cold rotation (2026-08-01).
  // 2026-08-27.43: the homepage said "200 companies" — two response sites
  // published the head row's truncated facet length as the employer count,
  // and the head row lacked coverage.tracked so trackedTotal vanished. Pairs
  // with 20260828001000 (the headline patcher now patches both rows).
  // 2026-08-28.44: Oracle tranche 1 — 38 boards / ~80k postings behind names
  // resolved from each tenant's own recruitingCESites branding (Kroger,
  // AutoZone, Providence, Quest Diagnostics...), gov/mill-screened on real
  // posting text, tranche-capped to the ceiling raise (750k -> 800k on
  // remeasured 9.4KB/row bytes at the 12GB plan).
  // 2026-08-28.45: earned did-you-mean (thin exact pools, trigram-supported
  // corrections within two edits, curated map keeps precedence) + slice_stats
  // EMA instrumentation exposed on status.
  // 2026-08-28.46: the .45 did-you-mean was DEAD ON ARRIVAL — gated on the
  // RPC's total_rows, which its own LIMIT caps below the gate; proven by an
  // adversarial review and a live probe in the same hour. Now derived from
  // the augmentation's already-fetched rows (zero extra RPCs), Unicode-safe,
  // keyed to the emitter; slice timing moved to terminal returns.
  // 2026-08-28.47: employment-type filter end-to-end — nine vendors' 
  // structured fields captured at normalize, all three RPCs re-issued with
  // p_employment_type (the one-function-one-signature guard caught that a
  // verbatim body copy dropped only the PRE-210000 overloads), coverage,
  // UI toggles/chips/URL/zero-help, saved searches and the digest.
  // 2026-08-28.48: "part time nurse" lifts into the employment-type filter —
  // but ONLY once cached coverage crosses 0.25 (against a thin corpus the
  // lift would replace a working literal search with a near-empty filter);
  // and the did-you-mean presence veto became a 3x support ratio, which
  // generalises the curated "manger" employer-typo entry.
  // 2026-08-28.49: the prev-row select gains employment_type — without it
  // put() compared against undefined and re-patched every typed row on every
  // visit, an eternal write amplification measured live as DB pressure.
  // 2026-08-29.50: corrections capped at 1,000 per board visit — the
  // employment-type first-fill wave saturated writes (slices 23s->99s, the
  // facets cron 8 ticks behind); the remainder patches on the next rotation
  // visit, so the wave completes gently instead of all at once.
  // 2026-08-29.51: the six-lens accuracy sweep — the ring-merged seam moves to
  // RING_WINDOW with deep pages deduping the ring (no duplicate past offset
  // 200, no unreachable top-200 row), the routed blockFull nextOffset lands on
  // the block boundary, the six employment-type lifts trade literal 0x08 bytes
  // for real \b anchors, filterViolations learns multi-select and
  // employmentType/postedAfter, counts withdraw under exclusions, facet counts
  // bind every list filter, and the fuzzy total is tested against the RPC's
  // own 60-row cap.
  // 2026-08-29.52: the pass-end no longer returns early when the facets
  // aggregate fails — the freshness sweep, date hygiene, capacity governor and
  // refresh stamps run regardless (facet fields carried forward; orphan prune
  // alone stays gated on FRESH facets). Live incident: facets timing out from
  // ~09:52Z silently switched off all maintenance for 4+ hours and tripped
  // {facets_cache, freshness_cap} together — that pairing was this return.
  // 2026-08-29.53: `explain: true` returns a read-only decision trace (route,
  // filters applied vs ignored, ranking regime, seam) before any SQL runs —
  // the board explaining its own reasoning, exposed as the debug_search MCP
  // tool and the /v1/explain endpoint.
  // 2026-08-30.1: adaptive load shedding. The rotation reads the slice EMA it
  // already records and, while the database is distressed, takes fewer boards
  // per hop, runs fewer workers and stops paying for the deep lane — lifting
  // the levels itself as the EMA recovers. Shipped beside the autovacuum
  // tuning migration during a live 30-second-browse incident.
  // 2026-08-30.2: attachRecheckedAt is bounded (it was 15,104ms of a 30,728ms
  // response for a single-token primary-key probe), and the bootstrap/retry
  // lanes shed alongside the slice so shedding cannot invert the hop.
  // 2026-08-30.3: the job_board_meta read — the only unmarked awaited I/O on
  // the cheapest path, and the home of the 13.6s that no phase accounted for —
  // is deadlined and published as phaseMs.meta_read; the first-boot seed no
  // longer runs a full refresh inline on a visitor's request; includeUnstatedPay
  // stops making the bare board count itself; a null count publishes null.
  // 2026-08-30.4: .3 regressed the board. Its 800ms meta deadline sat BELOW the
  // ~958ms median this file already published for that read, so it expired on
  // healthy requests — stripping the headline, employer count, categories and
  // refreshedAt — and the "no meta = first boot" branch then fired a FORCED
  // refresh on each one, turning traffic into load. Budget is 3s, a timeout is
  // told apart from an absent row, and a timeout never seeds.
  // 2026-08-30.5: shedding fails CLOSED. Its signal read returned "healthy" on
  // error/timeout, so at peak distress the shedder switched itself off —
  // measured as browse latency rising 27s->42s->66s with it deployed. Ships
  // beside the emergency ingest-pause migration (resume held as .sql.hold).
  // 2026-08-30.6: every decoration on the serving path is bounded (fuzzy
  // augment gate+deadline, fuzzy rescue on the ladder budget, browse top-up
  // bounded+marked); the past-the-end exit stops answering filtered requests
  // with the bare board's total; sort=newest stops issuing cursors its own
  // reader refuses.
  //
  // 2026-08-30.7: sources.ts CHANGED — +360 Oracle boards / 42,773 postings
  // (the corporate tranche of the round-3 census, screened inside
  // merge-oracle's own expand=requisitionList sampler; 9 gov boards, 22 name
  // collisions, 7 blocked names, 4 mill-unreadable dropped and logged). They
  // enter via the bootstrap lane this hash exists to arm — which is exactly
  // why the bump and the merge share a commit. Rode along: sweep-3 rotation
  // hardening in index.ts (hot-phase shed lever, stale shed signal fails
  // closed, mid-hot death resumes instead of restarting, raceMeta reads a
  // resolved-with-error as META_TIMEOUT so a flaky read cannot fire a forced
  // seed, chain kicks stamped before the fetch, isIngestPaused bounded +
  // retried + loud) and four ranking-core fixes in search-routing.ts (the
  // one-letter scorer hang, 16 place-name/common-word alias keys guarded,
  // "not" claims exactly one token with a stopword veto, scoreTitle splits
  // query tokens the way titles are split and folds diacritics).
  //
  // 2026-08-30.8: sources.ts CHANGED twice over. +166 boards from the round-3
  // census tail (the >=100p candidates all went through the description
  // screen; four staffing operations and one returning placement agency were
  // convicted and now live in merge-all's MILL_BLOCK, so a titles-only screen
  // degradation can never re-admit them), MINUS unitedplacementgroup (merged
  // back in error the same day it was flagged — NAME_BLOCK now knows the word
  // "placement"). And the union type gained "paylocity": the 17th source's
  // adapter landed (embedded window.pageData extraction, an HTML shell is a
  // FAILED fetch and never an empty board, IsInternal postings excluded,
  // detail-page JSON-LD feeds the description sweep, two live-verified
  // canaries). No paylocity boards ride this bump — the census sweep runs
  // separately and its tranche will force the next one.
  //
  // 2026-08-30.9: the biggest single catalog step since launch — sources.ts
  // gained 2,590 boards in one bump. +732 Oracle boards (~122k postings) from
  // the per-site split of multi-brand tenants: resolve-oracle-sites.mjs reads
  // each ambiguous tenant's recruitingCESites and emits one candidate per
  // BRANDED ACTIVE site (the token's third segment is the site), which is how
  // Macy's/Bloomingdale's/bluemercury stop hiding behind one unnameable
  // tenant. +1,858 Paylocity boards (~40k postings), the 17th source's first
  // tranche, every >=100p board description-screened (61 cleared, 3 franchise
  // operators excluded). Seven windowed giants (Kroger 12,350 advertised,
  // AutoZone, JCPenney, UHS, Foot Locker, Landry's, Lifepoint) get per-board
  // pages overrides — fetchOracle honors s.pages now, same contract as the
  // icims/PetSmart precedent. The corpus governor steps 800k -> 1M (disk grew
  // 12 -> 20GB; migration 20260830260000 tells the storage alarm). The
  // bootstrap lane this hash arms is about to swallow ~2,600 boards — the
  // shed system is what keeps that survivable.
  //
  // 2026-08-30.10: the crawl-waves 25/21 harvest. Older Common Crawl waves
  // see boards the newest wave missed: 16.5k net-new candidates verified
  // overnight became +2,657 catalog boards (~43k postings) — 2,397 more
  // Paylocity (the vendor's cross-wave footprint keeps growing), 81 Oracle
  // via the same resolve-then-split pipeline as .9, and 179 across ten other
  // vendors. Screens stayed honest: Fosad Consulting, IOTA GROUP, TechBiz
  // Global and a tobacco chain posting one title 114 times were convicted on
  // evidence and now live in MILL_BLOCK; an unreadable Paylocity board HOLDs
  // out rather than riding in on a thin sample.
  //
  // 2026-08-30.11: the iCIMS unlock ships. The CNAME census (customer career
  // domains point at career.page / jibeapply.com — the vendor's fetchable
  // front door, unlike its own 404ing subdomains) yielded 190 clean boards
  // (~99k postings; Costco 19.8k, Ulta 10k) after 23 alias kills, three
  // evidence convictions (CTG staffing, and the State Farm / Principal
  // agent-office pattern), and a mill-screen precision fix: the phrases now
  // demand RECRUITMENT SYNTAX, because "foster our client's success" and
  // "offsites on behalf of the MD" convicted Booking.com, Tufts and S&P
  // Global on service prose while the singular "position for our client"
  // still convicts CTG at 10/12. +231 teamtailor tenants resolved from
  // custom domains rode along. In index.ts, fetchOracle's page walk went
  // chunked: the .9 pages overrides made Kroger a 160-second serial hot
  // slice that pinned the shed at L2 and stalled the bootstrap drain — the
  // reviewer called this exact cost when the override landed.
  //
  // 2026-08-30.12: two vendors' worth of reach in one bump. EU-hosted
  // greenhouse/lever tenants fetch from the EU hosts via an eu~ token prefix
  // (the workday compound-token pattern; hostname derivation has exactly one
  // seam, in normalize.ts — the API host is boards.eu.greenhouse.io, and the
  // context that said boards-api.eu was refuted live). ADP Workforce Now
  // lands as the 18th source with its full census pipeline; its boards merge
  // in the next bump. sources.ts grew ~1,700 boards: the waves-17/12 harvest
  // (Paylocity 1,464 more; an 83-site Oracle DEMO instance and the Quess
  // staffing conglomerate were caught and killed — dev tokens are blocked
  // now, and a tenant whose "brands" all report one identical count is a
  // shared requisition pool, not employers), plus 142 EU tenants (184 EU
  // arms of carried employers deduped away). Giants round 2: Costco 208
  // pages (~18.6k standing gap), Ulta 105, JCPenney 65 -> 72.
  //
  // 2026-08-30.13: ADP's first boards. 1,082 verified live; 463 merged with
  // real employer names, all 20 >=100-posting boards cleared by the
  // full-text detail screen. The 606 "blockedName" drops are NOT mills —
  // they are boards whose welcome-text carries no employer name at all
  // (measured: only 3 of 1,082 verified names actually match the agency
  // regexes). They are recoverable by a per-board name resolver reading the
  // posting payload, the same move that unlocked Oracle — until then,
  // nameless stays unmerged, because an employer name comes from the
  // employer.
  //
  // 2026-08-30.14: THE CHARTER WIDENS. The operator reversed the
  // corporate-only bar: staffing agencies and government employers are
  // carried now. The screens did not die — they changed jobs: phrase
  // evidence prints (clear~, and rides the cleared entry for a future
  // disclosure badge) but no longer excludes; MILL_BLOCK shrank to the junk
  // ledger (duplicate-title spam, double-counting boards, demo tenants) —
  // junk is junk under any charter, and Great Clips' 6,913 copies of two
  // titles stayed out while Collabera, CTG, Quess, EXL, the health
  // authorities and the school districts came in (220 boards re-admitted
  // across every retained census round). +352 ADP boards named from their
  // employers' own JD prose (City Barbeque, Jeni's, Fresh Del Monte — the
  // resolver reads what the employer wrote, 3 contradiction flags held out
  // rather than guessed) and +42 prefix-sweep custom domains. The corpus
  // governor steps 1M -> 1.2M on the SAME disk: 69% of plan, inside the 75%
  // alarm — the "needs a resize" belief was arithmetic timidity.
  //
  // 2026-08-30.15: the Workday deep unlock. The fetcher pages in 4-concurrent
  // chunks and honors per-board pages overrides; instead of hand-picking
  // giants, a measured sweep probed all 3,698 carried tenants' advertised
  // totals and widened every board past its window — 305 overrides in all
  // (Dollar Tree 24,251 advertised vs the 500 default window; CVS Health
  // 19,192 vs 678 stored; O'Reilly 18,283). Roughly 226k postings lived past
  // the old cap. This fills the 1.2M governor: the next inventory beyond it
  // waits on the 1.5M disk step. Overrides cap at 250 pages — beyond 5,000
  // postings/pass the offset rotation still wraps, and the shed system
  // remains the governor of wall-time.
  //
  // 2026-08-30.16: the search-upgrade round, measured end to end. The
  // snapshot harness's very first battery convicted three defects: the
  // routed path's bare 7s deadline let a four-token exclusion query burn
  // 9.4s (now shape-sized: 2.5s for >=3 tokens, 7s kept for the abbreviation
  // shape it was built for); the zero-result rescue ladder paid a cold embed
  // for pages two tiers had already proven empty (it declines now — single-
  // token only, the reviewer's narrowing); and exclusion searches served no
  // figure at all (they publish a labelled totalBeforeExclusions ceiling,
  // rendered in all nine locales). Agency disclosure ships the transparency
  // answer to the charter change: 139 boards tagged (the first draft tagged
  // 226 — "talent"/"workforce" were catching employers' own in-house
  // portals), a badge, an opt-in excludeAgencies filter, and migration
  // 20260831120000 whose malformed-patch guard is a spelling whitelist,
  // because a bad string throws before COALESCE can help. +285 ADP boards
  // named from their employers' own prose rode along.
  buildVersion: "2026-08-30.16",
};

describe("sources.ts and BUILD_VERSION move together", () => {
  it("has a BUILD_VERSION matching the one pinned here", () => {
    const idx = readFileSync(resolve(ROOT, "index.ts"), "utf8");
    const m = /BUILD_VERSION = "([^"]+)"/.exec(idx);
    expect(m, "BUILD_VERSION not found in index.ts").toBeTruthy();
    expect(
      m![1],
      "BUILD_VERSION changed but PINNED.buildVersion in this test did not — update it",
    ).toBe(PINNED.buildVersion);
  });

  it("fails when sources.ts changes without a BUILD_VERSION bump", () => {
    const hash = createHash("sha256")
      .update(readFileSync(resolve(ROOT, "sources.ts")))
      .digest("hex")
      .slice(0, 16);
    expect(
      hash,
      `sources.ts changed. New boards will NOT enter the bootstrap lane until ` +
        `BUILD_VERSION is bumped — they queue behind ~28,000 boards instead.\n` +
        `  1. bump BUILD_VERSION in supabase/functions/job-board/index.ts\n` +
        `  2. set PINNED.sourcesHash here to: ${hash}\n` +
        `  3. set PINNED.buildVersion to the new version`,
    ).toBe(PINNED.sourcesHash);
  });
});
