/**
 * ONE TIMEOUT POLICY FOR THE FULL-PAGE-MOUNT GUARDS.
 *
 * WHY THIS EXISTS. Twelve files mounted a whole page in jsdom and each carried
 * its own hand-copied waiting budget: `const SLOW = { timeout: 4000 }` in
 * eight of them, 5000 in two, 8000 in one, seven inline `{ timeout: 5000 }`
 * literals in another. None of those numbers was a measurement -- 4000 was a
 * convention copied forward -- and every one of them was wrong in the same
 * way, which is the argument helpers/catalog.ts already makes about four
 * guards with four matchers.
 *
 * THE WAY THEY WERE WRONG. vitest's default per-test budget is 5 s for the
 * WHOLE case. A per-assertion budget of 4000-8000 ms sits at or above it, so
 * the per-assertion number was unreachable: the case always died on the test
 * budget first. What the gate then printed was
 *
 *     Error: Test timed out in 5000ms.
 *
 * which names neither the control under test nor the thing it was waiting
 * for. A late render and a broken control produced the same sentence, so the
 * only way to tell a flake from a regression at the push gate was to re-run
 * it -- and the gate was bypassed with --no-verify instead. A budget that
 * cannot be reached is not a budget; it is a guard that reports its own
 * exhaustion as a verdict about the code, which is the same shape as the
 * consumer search in agent-visibility.test.ts that could not read its own
 * directory and called four live modules dead.
 *
 * MEASURED, NOT CHOSEN. Full suite on 2026-09-30 with the machine deliberately
 * loaded (8 spinning cores on an 8-core box), slowest single case per file:
 *
 *     a-sort-claim-must-name-the-set-it-ordered            6020 ms  <- FAILED
 *     a-count-beside-a-name-is-a-promise-about-the-board   3724 ms
 *     a-board-wide-count-under-a-narrowed-page             3636 ms
 *     what-the-my-jobs-views-took-off-the-page             3474 ms
 *     a-card-that-could-not-be-scored-must-say-so          3222 ms
 *     a-field-curve-that-timed-out-live...hourly-cache     2674 ms
 *     a-posted-wage-is-stated-pay-in-every-runtime         2309 ms
 *     two-blue-buttons-are-no-hierarchy                    1753 ms
 *     a-cap-of-ours-is-not-a-closure-of-theirs             1559 ms
 *     a-requisition-number-is-not-a-place                  1081 ms
 *     a-deliberate-fallback-must-not-read-as-an-outage      873 ms
 *     explore-claims                                        248 ms
 *
 * One file was over the 5 s ceiling and four more were within 1.4x of it.
 * Nothing in the suite controls how loaded the machine is, so 1.4x is not
 * headroom -- it is the next file to fail. The suite already holds single
 * cases at 19.9 s, 12.7 s and 11.2 s under the same load, so 30 s is this
 * suite's own working range and not a new indulgence.
 *
 * WHY A LONGER WAIT CANNOT HIDE A BUG HERE. The sibling this policy is taken
 * from, every-control-in-the-picture-sends-what-it-names.test.tsx, could only
 * raise its budget once its waits counted the requests a click caused, because
 * a value-based wait over a GROWING RECORD (invoke.mock.calls) cannot tell "the
 * new request has not arrived" from "it arrived saying something else", and a
 * bigger number turns the first into a wrong-value report. That hazard needs an
 * accumulating log. The waits in these twelve files are assertions about
 * document.body -- a single current value, not a record -- and every one of
 * them is POSITIVE: it waits for something to appear, or for a value already
 * proved non-null to clear. waitFor re-runs the assertion until it passes, so a
 * larger budget forgives a late render and cannot forgive a wrong one; a page
 * that renders the wrong text never satisfies it, it only fails later and says
 * so by name. The `not.toContain` assertions are read AFTER a positive wait has
 * proved the page rendered, so a longer positive wait makes them stricter, not
 * weaker.
 *
 * WHAT THIS IS NOT. It is not a licence to widen the budget when a control is
 * slow for a reason. If a case needs more than this, the thing to find out is
 * what it is waiting for -- explore-claims was re-reading all 707 migrations
 * on each of 25 calls, and that was fixed by not doing it rather than by
 * waiting longer for it.
 */

/**
 * The per-test budget, for `vi.setConfig(MOUNT_TEST_BUDGET)` at the top of a
 * full-page-mount file. It has to exceed the SUM of the waits one case can
 * chain (three of them, in the worst file here), not just the longest.
 *
 * Deliberately set per file rather than in vitest.config.ts: the other ~480
 * test files in this suite mount nothing and should keep failing fast at the
 * default 5 s.
 */
export const MOUNT_TEST_BUDGET = { testTimeout: 30_000 } as const;

/**
 * The per-assertion budget, passed as waitFor's second argument. Below
 * MOUNT_TEST_BUDGET so a single stuck wait still fails as itself -- naming the
 * assertion that never came true -- instead of being cut short by the test
 * budget and reported as "Test timed out".
 */
export const SLOW = { timeout: 15_000 } as const;
