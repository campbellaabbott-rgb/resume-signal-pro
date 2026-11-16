/**
 * WHICH PGLITE HARNESSES MAKE THE CLIENT ROLES HOLDING NOTHING (S14X-140).
 *
 * A harness that creates anon with no default grants proves no refusal: the
 * role holds nothing, so "permission denied" holds with or without the
 * migration's REVOKE (helpers/supabase-defaults.ts says why, and how to start
 * from Supabase's grants instead). This module reads every file under
 * src/test, in code only (comments removed, strings kept), and says for each
 * one that makes the roles or imports a file that does:
 *
 *   bare       it creates anon and neither applies ALTER DEFAULT PRIVILEGES
 *              nor imports supabase-defaults (or agent-db, whose stand-ins
 *              start from the same defaults);
 *   refuses    it asserts a refusal: "permission denied", 42501, or a
 *              has_*_privilege answer;
 *   bareVia    the bare files it imports (a helper that makes bare roles).
 *
 * The guard (every-pglite-harness-that-creates-the-client-roles-starts-from-
 * supabases-default-grants.test.ts) and the bug round's verify section both
 * read it, so the test and the deploy check count the same thing.
 *
 * The lists below only shrink. A bare file that asserts no refusal is held
 * harmless by name until it is converted; a file that asserts a refusal over
 * a bare helper is named because the helper belongs to another workstream.
 * A new entry on either list is refused; an entry that no longer needs to be
 * on it fails until it is taken off.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { codeOf } from "./strip-comments";

export const REPO_ROOT = resolve(__dirname, "../../..");

const CREATES_ANON = /\bCREATE\s+ROLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?anon"?(?![\w-])/i;
const DEFAULT_GRANTS = /\bALTER\s+DEFAULT\s+PRIVILEGES\b|helpers\/(?:supabase-defaults|agent-db)(?:\.ts)?["']/;
const REFUSAL = /permission denied|42501|has_[a-z_]+_privilege/;
const SPECIFIER = /(?:\bfrom\s+|\bimport\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g;

export interface Harness {
  /** Repository-relative, with forward slashes. */
  file: string;
  bare: boolean;
  refuses: boolean;
  bareVia: string[];
}

const posix = (p: string) => p.split(sep).join("/");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

function resolveImport(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/**
 * Classify `sources` (absolute path -> text). Only files that create anon,
 * start from the default grants, or import a bare file are returned. Exported so the guard can feed it a
 * fixture and see it catch one.
 */
export function classify(sources: Map<string, string>, root = REPO_ROOT): Harness[] {
  const code = new Map<string, string>();
  for (const [p, s] of sources) code.set(p, codeOf(s));
  const bare = new Set<string>();
  for (const [p, c] of code) if (CREATES_ANON.test(c) && !DEFAULT_GRANTS.test(c)) bare.add(p);
  const out: Harness[] = [];
  for (const [p, c] of code) {
    const via: string[] = [];
    for (const m of c.matchAll(SPECIFIER)) {
      const r = resolveImport(p, m[1]) ?? resolve(dirname(p), m[1]);
      const hit = [r, `${r}.ts`, `${r}.tsx`].find((x) => bare.has(x));
      if (hit && hit !== p) via.push(posix(relative(root, hit)));
    }
    if (!CREATES_ANON.test(c) && !DEFAULT_GRANTS.test(c) && via.length === 0) continue;
    out.push({ file: posix(relative(root, p)), bare: bare.has(p), refuses: REFUSAL.test(c), bareVia: [...new Set(via)].sort() });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Every harness under src/test of the checkout at `root`. Pass the root
 * outside vitest (tsx -e evaluates with the caller's directory as __dirname).
 */
export function scan(root = REPO_ROOT): Harness[] {
  const files = walk(join(root, "src/test"));
  return classify(new Map(files.map((f) => [f, readFileSync(f, "utf8")])), root);
}

/**
 * Bare files that assert no refusal, held by name until each is converted.
 * Shrink only: convert one, then take it off.
 */
export const BARE_WITHOUT_A_REFUSAL: readonly string[] = [
  "src/test/a-company-lander-printed-another-employers-figures.test.ts",
  "src/test/a-day-thirty-gate-must-have-seen-the-cohort-produce-an-event.test.ts",
  "src/test/a-day-thirty-share-needs-thirty-days-of-reading-in-full.test.ts",
  "src/test/a-federal-wage-filing-printed-under-an-employer-that-never-filed-it.test.ts",
  "src/test/a-final-rollup-month-forgets-the-takedowns-a-repair-marked.test.ts",
  "src/test/a-free-account-read-the-closure-log-in-bulk-and-a-dark-feed-read-as-a-takedown.test.ts",
  "src/test/a-half-written-period-is-never-the-one-the-reader-serves.test.ts",
  "src/test/a-paid-delivery-gave-up-after-forty-five-minutes-and-told-nobody.test.ts",
  "src/test/a-relisted-posting-read-came-down-and-the-agents-mirror-filled-the-members-tracker.test.ts",
  "src/test/a-twins-read-kept-a-deferred-boards-rows-out-of-the-48h-sweep.test.ts",
  "src/test/a-week-reaching-past-the-fence-drew-half-its-postings.test.ts",
  "src/test/an-api-key-and-a-connector-were-taken-with-no-terms.test.ts",
  "src/test/an-exit-cost-filing-was-printed-and-counted-as-a-workforce-reduction.test.ts",
  "src/test/helpers/email-ops-db.ts",
  "src/test/helpers/field-curve-fixture.ts",
  "src/test/helpers/mail-door-db.ts",
  "src/test/helpers/seen-again-fixture.ts",
  "src/test/one-feed-is-read-once-and-a-pooling-site-ranks-last.test.ts",
  "src/test/one-row-per-asked-token-and-no-row-is-never-a-refusal-to-sponsor.test.ts",
  "src/test/the-closure-split-is-counted-from-an-index-of-its-basis.test.ts",
  "src/test/the-employer-check-re-read-every-carried-employer-once-per-employer-on-the-board.test.ts",
  "src/test/the-employer-name-normaliser-is-one-rule-in-two-runtimes.test.ts",
  "src/test/the-ledger-order-of-the-fix-round-keeps-each-migration-behind-what-it-needs.test.ts",
  "src/test/the-mirror-runs-before-the-matcher-it-feeds.test.ts",
  "src/test/the-ontario-reader-is-asked-real-postings-not-read-as-text.test.ts",
  "src/test/the-orphan-cleanup-deleted-every-boards-own-stamp-each-night.test.ts",
  "src/test/the-scope-migrations-wait-for-a-first-slice-and-the-message-says-so.test.ts",
  "src/test/the-third-day-thirty-chain-on-one-page-gets-the-same-control.test.ts",
  "src/test/today-on-the-takedown-ticker-was-since-midnight-utc.test.ts",
  "src/test/w4b-payments-mail-watch-rings-when-a-mail-class-stops.test.ts",
];

/**
 * Files that assert a refusal over one of the four bare helpers above. The
 * refusal proves nothing until the helper starts from Supabase's grants; the
 * helpers are not the bug round's ci-tooling files, so they are named here
 * instead of converted. Shrink only.
 */
export const REFUSES_OVER_A_BARE_HELPER: readonly string[] = [
  "src/test/a-cheap-domain-does-not-make-its-owner-an-employer.test.ts",
  "src/test/a-claim-mail-the-provider-refused-is-never-reported-sent.test.ts",
  "src/test/a-confirmed-free-key-scores-fit-twenty-five-times-a-day.test.ts",
  "src/test/a-digest-is-sent-by-the-scheduler-once.test.ts",
  "src/test/a-key-link-the-provider-refused-does-not-use-up-the-mailbox.test.ts",
  "src/test/a-key-nobody-can-get-is-not-a-product.test.ts",
  "src/test/a-payout-request-is-a-row-the-owner-can-act-on.test.ts",
  "src/test/a-pulse-confirmation-that-never-left-locked-its-address-out.test.ts",
  "src/test/a-pulse-goes-only-to-an-address-that-clicked.test.ts",
  "src/test/a-report-mail-counts-the-inbox-not-the-header.test.ts",
  "src/test/a-role-that-closed-twice-is-one-relisted-role-not-two-fills.test.ts",
  "src/test/a-saved-search-mails-what-is-new-to-the-board-and-an-unanswered-count-is-not-zero.test.ts",
  "src/test/a-sentinel-anyone-can-run-is-a-load-generator-and-a-cached-scan-proves-nothing.test.ts",
  "src/test/one-refused-sender-must-not-starve-the-queue-behind-it.test.ts",
  "src/test/the-field-curve-the-page-waited-a-minute-for-joins-the-hourly-cache.test.ts",
];

/**
 * A bare harness that asserts a refusal and is converted by another lane of
 * the same round, with the lane named. Tolerated in either state; the bug
 * round's verify section counts it without exception. Empty since the round's
 * integration: the one entry, the score benchmark, starts from
 * helpers/supabase-defaults.ts on the merged tree.
 */
export const CONVERTED_BY_ANOTHER_LANE: Readonly<Record<string, string>> = {};

/** What the guard refuses, one line each; empty when every rule holds. */
export function violations(harnesses: Harness[]): string[] {
  const bad: string[] = [];
  const byFile = new Map(harnesses.map((h) => [h.file, h]));
  for (const h of harnesses) {
    if (h.bare && h.refuses && !(h.file in CONVERTED_BY_ANOTHER_LANE)) {
      bad.push(`${h.file} creates the client roles holding nothing and asserts a refusal: start it from helpers/supabase-defaults.ts`);
    }
    if (h.bare && !h.refuses && !BARE_WITHOUT_A_REFUSAL.includes(h.file) && !(h.file in CONVERTED_BY_ANOTHER_LANE)) {
      bad.push(`${h.file} creates the client roles holding nothing: start it from helpers/supabase-defaults.ts (the list of bare harnesses only shrinks)`);
    }
    if (!h.bare && h.refuses && h.bareVia.length > 0 && !REFUSES_OVER_A_BARE_HELPER.includes(h.file)) {
      bad.push(`${h.file} asserts a refusal over ${h.bareVia.join(", ")}, which creates the client roles holding nothing`);
    }
  }
  for (const f of BARE_WITHOUT_A_REFUSAL) {
    const h = byFile.get(f);
    if (!h || !h.bare) bad.push(`${f} no longer creates bare roles: take it off BARE_WITHOUT_A_REFUSAL`);
  }
  for (const f of REFUSES_OVER_A_BARE_HELPER) {
    const h = byFile.get(f);
    if (!h || !h.refuses || h.bareVia.length === 0) bad.push(`${f} no longer asserts a refusal over a bare helper: take it off REFUSES_OVER_A_BARE_HELPER`);
  }
  return bad;
}
