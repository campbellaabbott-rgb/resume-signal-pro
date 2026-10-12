// The pure decisions behind which pages the bake (scripts/prerender-seo.mjs)
// writes, what each one says when it has nothing live to say, and the date the
// sitemap gives it. No network, no filesystem, no build output: every function
// here is called by the bake and run against fixtures by the tests in
// src/test, so a rule printed on a page and the code that applies it are one.

import { createHash } from "node:crypto";

// ---- Every posting page the site has published, and what became of it ----
//
// MEASURED 2026-10-08 (SEO report, F2a): 364 of the 371 posting URLs in the
// last committed sitemap served the homepage copy. Each publish rebuilt the
// posting pages from the COMMITTED public/sitemap.xml, and a hosted build
// never commits what it writes, so the carry list was the one some local bake
// left behind weeks earlier; the previous publish's pages were never asked
// about, and the 300-row carry cap dropped the rest unread.
//
// So the carry base is what the LIVE site published: its sitemap and the
// ledger the previous bake served beside it (PRERENDER_LEDGER_PATH), with the
// committed copies only as a fallback. Every carried posting is re-checked
// with no cap, and one that no longer gets a page keeps a small noindex page
// that says why, for POSTING_STUB_KEEP_DAYS, instead of the homepage.
export const PRERENDER_LEDGER_PATH = "/prerender-ledger.json";
export const POSTING_STUB_KEEP_DAYS = 60;

/** Whole UTC days from one ISO date to another, or null when either is unreadable. */
export const dayDiff = (from, to) => {
  const a = Date.parse(`${String(from).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(to).slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86_400_000) : null;
};

/**
 * What one board detail read says about a carried posting: "found" (the board
 * still lists it), "gone" (the board answered that it does not: aged out, a
 * watched close, a description with no listed row, or no such posting), or
 * "unchecked" (no answer we can read: a refusal, an error, a timeout). Only a
 * real answer may retire a page.
 */
export function postingCheckState(status, body) {
  if (status === 200 && body && typeof body === "object") {
    if (body.job && typeof body.job === "object") return "found";
    if (body.job === null) return "gone";
  }
  if (status === 404) return "gone";
  return "unchecked";
}

/**
 * The posting paths a bake must account for. `recheck` maps every posting
 * path the ledger or a sitemap names (other than a kept stub) to the day it
 * was first published; `stubs` holds the ledger's gone postings still inside
 * the keep window, re-written without a re-check. A gone entry past the
 * window is dropped: by then a crawler has read its noindex, and the address
 * falls back to the homepage's canonical. A sitemap path the ledger names in
 * ANY state is the ledger's to decide, never re-added from a sitemap: an
 * expired gone path still named by a stale sitemap was re-read on every bake.
 */
export function postingCarryBase({ ledger, sitemaps = [], idFromPath, today, keepDays = POSTING_STUB_KEEP_DAYS }) {
  const recheck = new Map();
  const stubs = new Map();
  // PAST THE KEEP WINDOW A PAGE BECOMES A TOMBSTONE, NOT THE HOMEPAGE (SEO
  // report 2026-10-12, SEO-002). A gone page past the window used to be
  // dropped, and its address fell back to index.html: an indexable copy of the
  // homepage at a URL a crawler already held. A tombstone is a file of under a
  // kilobyte that says noindex, kept for as long as the ledger names it.
  const tombstones = new Map();
  const postings = ledger && typeof ledger === "object" && ledger.postings && typeof ledger.postings === "object" ? ledger.postings : {};
  const named = new Set();
  for (const [path, e] of Object.entries(postings)) {
    if (!idFromPath(path) || !e || typeof e !== "object") continue;
    named.add(path);
    if (e.state === "tombstone") { tombstones.set(path, { ...e }); continue; }
    // A seeded entry (a URL published before the ledger existed, never re-read)
    // keeps its "no longer has a page of its own" page without a board read,
    // exactly as a gone one does: re-checking 459 of them a bake would spend the
    // whole read budget on URLs that serve no page either way.
    if (e.state === "gone" || e.state === "seeded" || e.seed === true) {
      const age = dayDiff(e.since, today);
      if (age !== null && age >= 0 && age <= keepDays) stubs.set(path, { ...e });
      else tombstones.set(path, { ...e });
      continue;
    }
    if (!recheck.has(path)) recheck.set(path, typeof e.first === "string" ? e.first : today);
  }
  for (const xml of sitemaps) {
    for (const m of String(xml || "").matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const path = m[1].trim().replace(/^https?:\/\/[^/]+/, "");
      if (!idFromPath(path) || named.has(path) || recheck.has(path)) continue;
      recheck.set(path, today);
    }
  }
  return { recheck, stubs, tombstones };
}

/**
 * The ledger with every seeded posting URL the ledger does not already name
 * added as a "seeded" entry (`seed: true`): its page says it no longer has a
 * page of its own, and nothing about the posting, because it was never re-read;
 * the ledger keeps it apart from a checked removal. The seed
 * is the list of posting URLs this site published before the ledger existed
 * (scripts/seo-seed/), which served the homepage copy. A URL any sitemap still
 * names is left to the carry rule: it may be a live page. Idempotent: a path
 * the ledger names, in any state, is never seeded again.
 */
export function seedPostingLedger({ ledger, seedPaths = [], sitemaps = [], idFromPath, today }) {
  const base = ledger && typeof ledger === "object" ? ledger : {};
  const postings = { ...(base.postings && typeof base.postings === "object" ? base.postings : {}) };
  const inSitemap = new Set();
  for (const xml of sitemaps) {
    for (const m of String(xml || "").matchAll(/<loc>([^<]+)<\/loc>/g)) inSitemap.add(m[1].trim().replace(/^https?:\/\/[^/]+/, ""));
  }
  let added = 0;
  for (const raw of seedPaths) {
    const path = String(raw ?? "").trim().replace(/^https?:\/\/[^/]+/, "").replace(/\/+$/, "");
    if (!path || !idFromPath(path) || postings[path] || inSitemap.has(path)) continue;
    postings[path] = { state: "seeded", seed: true, since: today, first: today, title: null, company: null, token: null };
    added++;
  }
  return { ledger: { ...base, postings }, added };
}

// ---- The ceiling on the live posting set ----
//
// postingFreshBudget (below postingRowEligible) never adds a new page past
// the bake's POSTING_PAGE_CEILING, but carried pages had no bound at all, so
// the live set's bound was max(ceiling, carried). These two close it: when
// the carried pages alone are past the ceiling, the ones whose employer date
// is oldest (the soonest to leave the 30-day window anyway) give up their
// page first, to the honest "retired" page, never to the homepage; and the
// sitemap never names more posting pages than the ceiling, whatever reaches
// it (the design upgrade's README, decision 5, saw 454 advertised against a
// stated 400).

/**
 * The carried live pages that must give up their page so the live set fits
 * under the ceiling: the oldest employer-dated first. Returns NEW lists of the
 * ones to keep and the ones to retire, each in the order given (the caller
 * empties and refills its own array from them).
 */
export function postingCeilingSplit(carried, { ceiling, dateOf }) {
  const list = Array.isArray(carried) ? carried : [];
  if (list.length <= ceiling) return { keep: [...list], retire: [] };
  const ranked = list.map((x, i) => ({ x, i, d: String(dateOf(x) ?? "") })).sort((a, b) => (a.d === b.d ? a.i - b.i : a.d < b.d ? -1 : 1));
  const retire = new Set(ranked.slice(0, list.length - ceiling).map((r) => r.i));
  return { keep: list.filter((_, i) => !retire.has(i)), retire: list.filter((_, i) => retire.has(i)) };
}

/** The sitemap's posting entries, never more than the ceiling: the rest are dropped and counted. */
export function capPostingEntries(entries, { isPosting, ceiling }) {
  let n = 0;
  const kept = [];
  const dropped = [];
  for (const e of entries) {
    if (isPosting(e)) {
      if (n >= ceiling) { dropped.push(e); continue; }
      n++;
    }
    kept.push(e);
  }
  return { kept, dropped };
}

// ---- A file of under a kilobyte for an address whose page has done its work ----
/**
 * The tombstone a published address keeps once its noindex page has been
 * read for its keep window: noindex, no canonical, one link to where the
 * reader can go instead. Written as is, never through the app template (19
 * KB), so the ledger can keep every such address for as long as it names it.
 */
export function tombstoneHtml({ token = null, esc }) {
  const href = token ? `/jobs?company=${encodeURIComponent(String(token))}` : "/jobs";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>No longer a page on this site</title><meta name="robots" content="noindex, follow"></head><body><h1>No longer a page on this site</h1><p>This address had a page here once. It has none now. <a href="${esc(href)}">Search the live job board</a>.</p></body></html>`;
  return html;
}

// ---- Once-published company pages (SEO-002) ----
//
// MEASURED 2026-10-12: /jobs/company/NBCUniversal3 answered 200 with the
// homepage copy, robots "index, follow" and a canonical to "/". It was in the
// sitemap of 2026-10-11 and the bake of 10-12 did not choose it, because the
// company set is the top 500 by open roles and moves every bake. 1,017 more
// company URLs from the committed sitemaps of the last months did the same.
// A company page this bake does not choose now keeps a page of its own,
// marked noindex, decided here; the ledger's `companies` map remembers each.
export const COMPANY_STUB_KEEP_DAYS = 60;

/** The token a company path names, or null. */
export function companyTokenOf(path) {
  const m = /^\/jobs\/company\/([^/?#]+)\/?$/.exec(String(path ?? "").trim());
  if (!m) return null;
  let t;
  try { t = decodeURIComponent(m[1]); } catch { return null; }
  return /^[A-Za-z0-9._~-]+$/.test(t) ? t : null;
}

/**
 * Every company path this site has published or still links: the previous
 * ledger's companies map and pages, the sitemaps it is handed, and the seed
 * (scripts/seo-seed/). Normalised to the path without a trailing slash.
 */
export function onceCompanyPaths({ ledger = null, sitemaps = [], seedPaths = [] }) {
  const out = new Set();
  const add = (p) => {
    const path = String(p ?? "").trim().replace(/^https?:\/\/[^/]+/, "").replace(/\/+$/, "");
    if (companyTokenOf(path)) out.add(path);
  };
  const l = ledger && typeof ledger === "object" ? ledger : {};
  for (const p of Object.keys(l.companies && typeof l.companies === "object" ? l.companies : {})) add(p);
  for (const p of Object.keys(l.pages && typeof l.pages === "object" ? l.pages : {})) add(p);
  for (const xml of sitemaps) for (const m of String(xml || "").matchAll(/<loc>([^<]+)<\/loc>/g)) add(m[1]);
  for (const p of seedPaths) add(p);
  return out;
}

/**
 * What a published company path this bake did not choose becomes:
 * "noindex" (the board still carries the token and a listing read inside its
 * age limit is on hand, so the page is its old page marked noindex, with no new
 * board read), "stub" (a short noindex page saying it no longer has a page of
 * its own, for COMPANY_STUB_KEEP_DAYS) or "tombstone" (under a kilobyte, kept).
 */
export function companyCarryState({ prior, today, onBoard, cachedYoung, keepDays = COMPANY_STUB_KEEP_DAYS }) {
  const p = prior && typeof prior === "object" ? prior : {};
  if (p.state === "tombstone") return "tombstone";
  if (p.state === "stub") {
    const age = dayDiff(p.since, today);
    if (age !== null && age > keepDays) return "tombstone";
  }
  if (onBoard && cachedYoung) return "noindex";
  if (p.state === "stub") return "stub";
  return "stub";
}

/** The ledger entry for one company path: a state that holds keeps the day it began. */
export function companyLedgerEntry({ prior, state, today, token, name = null, title = null, seed = false }) {
  const p = prior && typeof prior === "object" ? prior : {};
  const since = p.state === state && typeof p.since === "string" ? p.since : today;
  const out = { state, since, first: typeof p.first === "string" ? p.first : today, token };
  const nm = typeof name === "string" && name.trim() ? name.trim().slice(0, 80) : (typeof p.name === "string" ? p.name : null);
  if (nm) out.name = nm;
  if (typeof title === "string" && title) out.titleHash = createHash("sha1").update(title).digest("hex").slice(0, 12);
  if (seed || p.seed === true) out.seed = true;
  return out;
}

/**
 * The short noindex page a published company address keeps once this site no
 * longer gives the employer a page of its own. It says only that, and links
 * the live board filtered to the board: never "this employer stopped hiring",
 * which nothing here checked.
 */
export function companyStubPage({ path, token, name = null, esc }) {
  const nm = typeof name === "string" && name.trim() ? name.trim() : null;
  const board = `/jobs?company=${encodeURIComponent(String(token))}`;
  const head = nm ? `${nm} no longer has a page of its own here` : "This employer no longer has a page of its own here";
  return {
    path,
    robots: "noindex, follow",
    title: head,
    description: `${nm ?? "This employer"} no longer has a page of its own on this site. Its openings, where the board still carries any, are on the live board.`,
    content: `
            <p><a href="/jobs">All openings</a> · <a href="/companies">Companies with a page of their own</a></p>
            <h1>${esc(head)}</h1>
            <p>This site gives a page of its own to a bounded set of employers, chosen again at every build, and ${nm ? esc(nm) : "this employer"} is not in the current set. This page states nothing about its openings. <a href="${esc(board)}">Its openings on the live board</a>, where the board still carries any, are counted when you open them.</p>
            <p><a href="/jobs">Search the live board</a></p>
          `,
  };
}

// ---- Duplicate company pages: one keeps its index (SEO-036) ----
//
// duplicateSkeletons noindexed EVERY page of a group whose text matched once
// names and numbers were out, so two boards carrying one feed both lost their
// pages (Martin Brower and Reyes Beverage Group, 498 roles each, 2026-10-11).
// Now one member of each group stays indexable: one already indexable on the
// live site (all of them, in this round, if several were: owner decision D7),
// otherwise the one with the most open roles. A member under the SAME name
// canonicalises to it; a member under a DIFFERENT name is noindex, follow with
// no canonical, because a canonical between two employers tells a crawler one
// is the other. A group whose every member fails the name gate keeps none.

/** The groups of keys that share a skeleton: two or more each. */
export function duplicateSkeletonGroups(items) {
  const by = new Map();
  for (const { key, skeleton } of items) by.set(skeleton, [...(by.get(skeleton) ?? []), key]);
  return [...by.values()].filter((ks) => ks.length > 1);
}

/**
 * What each member of each duplicate group does: { role: "keep" } stays
 * indexable, { role: "canonical", to } names the keeper, { role: "noindex" }
 * is marked noindex with no canonical.
 */
export function resolveDuplicateGroups({ groups, wasIndexable = () => false, openOf = () => 0, nameKeyOf, failsGate = () => false }) {
  const out = new Map();
  for (const g of groups) {
    const eligible = g.filter((k) => !failsGate(k));
    if (!eligible.length) { for (const k of g) out.set(k, { role: "noindex" }); continue; }
    const already = eligible.filter((k) => wasIndexable(k));
    const keepers = already.length
      ? already
      : [eligible.reduce((best, k) => ((openOf(k) ?? 0) > (openOf(best) ?? 0) ? k : best), eligible[0])];
    const keepSet = new Set(keepers);
    for (const k of g) {
      if (keepSet.has(k)) { out.set(k, { role: "keep" }); continue; }
      const sameName = keepers.find((x) => nameKeyOf(x) === nameKeyOf(k));
      out.set(k, sameName && !failsGate(k) ? { role: "canonical", to: sameName } : { role: "noindex" });
    }
  }
  return out;
}

/**
 * The sitemaps a bake carries posting URLs from. The committed sitemap is a
 * fallback for a bake that could not read the live ledger: a hosted build
 * never updates it, so once the live ledger is read it names nothing the
 * ledger does not already decide, only stale paths to re-read.
 */
export const carrySitemaps = ({ ledgerSource, liveSitemap, committedSitemap }) =>
  ledgerSource === "live" ? [liveSitemap ?? ""] : [liveSitemap ?? "", committedSitemap ?? ""];

/**
 * The noindex page a posting URL keeps once the posting has no live page
 * here. Three states, each saying only what the bake knows: "gone" (the board
 * answered that it no longer serves it), "retired" (still on the board, but
 * no longer carrying everything a page of its own must state, or another
 * page already carries the same requisition) and "unchecked" (the board did
 * not answer when this was built). Never the homepage, never indexed.
 */
export function postingStubPage({ path, id, state, since, title, company, companyLink, windowDays, duplicateOf = null, basis = null, ceiling = null, esc }) {
  const t = typeof title === "string" && title.trim() ? title.trim() : null;
  const c = typeof company === "string" && company.trim() ? company.trim() : null;
  const what = t ? `${esc(t)}${c ? ` at ${esc(c)}` : ""}` : "This posting";
  const board = `/jobs?job=${encodeURIComponent(id)}`;
  const head = state === "gone"
    ? "This posting is no longer listed"
    : state === "retired" ? "This posting no longer has a page of its own" : "We could not re-check this posting";
  // A RETIRED PAGE SAYS ONLY WHAT THE BAKE KNOWS ABOUT IT. A seeded URL (one
  // published before the ledger existed) was never re-read, so its page may
  // not say it is still on the board; a page retired at the ceiling was, but
  // gave its place to a newer posting, which is all its page says.
  const retiredLead = duplicateOf
    ? `${what} is the same requisition as <a href="${duplicateOf}">another page on this site</a>, which now carries it.`
    : basis === "seed"
      ? `${what} had a page on this site once. This site no longer gives it one, and this page states nothing about it: whether it is still open was not checked. <a href="${board}">The live board checks it when you open it</a>.`
      : basis === "ceiling"
        ? `${what} is still on the live board, but this site keeps at most ${typeof ceiling === "number" ? ceiling : "a fixed number of"} posting pages and gives the places to the most recently posted ones, so this page states nothing more about it. <a href="${board}">Open it on the live board</a>.`
        : `${what} is still on the live board, but no longer carries everything a page of its own must state, so this page states nothing more about it. <a href="${board}">Open it on the live board</a>.`;
  const lead = state === "gone"
    ? `${what} is no longer listed on this board${since ? ` (recorded ${esc(since)})` : ""}. That is a statement about this board, not about the employer: the posting may have been taken down, or the date the employer put on it passed the board's ${windowDays}-day window.`
    : state === "retired"
      ? retiredLead
      : `When this page was built the board did not answer for this posting, so this page states nothing about it. <a href="${board}">The live board checks it when you open it</a>.`;
  return {
    path,
    robots: "noindex, follow",
    title: t ? `${head} — ${t}` : head,
    description: state === "gone" ? `${t ? `${t}${c ? ` at ${c}` : ""}` : "This posting"} is no longer listed on this board. Browse the live openings instead.` : `${head}. Browse the live openings on the board.`,
    content: `
            <p><a href="/jobs">All openings</a></p>
            <h1>${head}</h1>
            <p>${lead}</p>
            <p>${companyLink ? `${companyLink} · ` : ""}<a href="/jobs">Search the live board</a></p>
          `,
  };
}

/**
 * The ledger entry for a posting URL that keeps a noindex page, and the
 * names that page prints: this bake's answer over the previous ledger's
 * entry. The employer is named by its own name (F1): a gone payload and an
 * older ledger carry the stored name ("Ms"), which the page and its meta
 * description printed. A state that holds keeps its first date.
 */
export function postingStubEntry({ stub, prior, today, first = null, employerName, tokenOf }) {
  const p = prior && typeof prior === "object" ? prior : {};
  const state = stub.seed === true ? "seeded" : stub.state;
  const since = p.state === state && typeof p.since === "string" ? p.since : today;
  const token = stub.job?.token ?? p.token ?? tokenOf(stub.id) ?? null;
  const company = employerName(token, stub.company ?? p.company ?? null) || null;
  const out = { state, since, first: p.first ?? first ?? today, title: stub.title ?? p.title ?? null, company, token };
  // A seeded URL keeps its own state ("seeded") and mark while it is carried:
  // it was never re-read, so the IndexNow ping never reports it as a removal
  // (scripts/indexnow-ping.mjs pings "gone" and "retired" only, S11-155).
  if (stub.seed === true || (p.seed === true && p.state === state)) out.seed = true;
  if (typeof stub.basis === "string") out.basis = stub.basis;
  return out;
}

/**
 * WHO IS ONE EMPLOYER, for the bake. The layoff matcher's employer segment
 * (20260918100400, "WHO IS ONE EMPLOYER"): the client segment on a UKG token
 * (recruiting~CLIENT~uuid, recruiting2~CLIENT~uuid), the whole token on an EU
 * pod board (eu~slug), and otherwise the first '~' segment, which is the
 * tenant on Workday and Oracle and the token itself on a plain slug.
 *
 * The site's key is source + segment: employer_key(source, token) in SQL
 * (20261012100000), mirrored by employerKey in src/lib/employer-key.ts. The
 * companies facet the bake reads carries no source, and this module runs
 * under plain node on the hosted builder, where it cannot import that
 * TypeScript file, so the token's own shape stands in for the source: a
 * Workday token (tenant~wdN~site) never shares a key with an Oracle tenant
 * or a plain slug whose text matches its first segment, which is exactly the
 * merge that put Blackstone Inc.'s figures on a "Blackstone Shooting Sports"
 * board. Two facet entries never share a plain token, so a plain token is its
 * own employer here, as it is under the source-qualified key.
 *
 * Over the whole catalogue this key never joins two boards employerKey keeps
 * apart (the guard in
 * src/test/two-employers-sharing-a-name-are-not-one-employers-boards.test.ts
 * runs both over every board one hiring system carries). It may keep apart a
 * few boards employerKey joins: an ADP client's bare id and its id~site
 * boards, because a bare id could equally be a Paylocity board. Keeping apart
 * only costs pooling; joining would print one employer's openings as
 * another's.
 */
export function bakeEmployerKey(token) {
  const t = String(token ?? "").trim();
  const parts = t.split("~");
  const first = parts[0];
  if ((first === "recruiting" || first === "recruiting2") && parts.length >= 2) return `ukg:${first}~${parts[1]}`;
  if (first === "eu" && parts.length >= 2) return `eu:${t}`;
  if (parts.length >= 3 && /^wd\d+$/.test(parts[1])) return `workday:${first}`;
  if (parts.length >= 3) return `tenant3:${first}`;
  if (parts.length === 2) return `tenant2:${first}`;
  return `slug:${t}`;
}

/**
 * The employer boards that get a page this bake, ranked and gated on OPEN
 * roles (the count /jobs/company/{token} serves), each with the token of the
 * indexable page it canonicalises to (`primary`).
 *
 * SIBLINGS ARE ONE EMPLOYER UNDER ONE NAME: the same bakeEmployerKey and the
 * same normalised name. One employer running several boards under its name
 * gets one indexable page, the board with the most open roles; the rest
 * canonicalise to it, and only they pool their openings into it
 * (`employerPrimary` is that board, `sameEmployer` is true).
 *
 * TWO EMPLOYERS UNDER ONE NAME ARE NOT SIBLINGS. Grouping on the name alone
 * told crawlers, and the page's own pooled openings told readers, that every
 * board printing "Accenture" was one employer. They are kept apart now: the
 * smaller employer's page still canonicalises to the larger one, so no two
 * indexable pages share a title, but `sameEmployer` is false, it pools none of
 * the larger employer's openings, and nothing links it as that employer's
 * page. `displayName` gives the name; `unreadable` flags a board whose name is
 * still a system code, which gets a page but never an indexable one.
 */
export function selectLanders(companyFacet, { openOf, displayName = (c) => c.name.trim(), unreadable = () => false, max = 500, min = 8 }) {
  const size = (c) => (typeof c.open === "number" ? c.open : (c.count ?? 0));
  const top = (Array.isArray(companyFacet) ? companyFacet : [])
    // Tilde is allowed: Oracle/Workday compound tokens (tenant~dc~site) are
    // valid URL path segments, the list API accepts them, and the SPA route
    // serves them 200 (verified on Hilton, efet~us2~CX_1, 2026-07-26).
    .filter((c) => c && typeof c.token === "string" && /^[A-Za-z0-9._~-]+$/.test(c.token)
      && typeof c.name === "string" && c.name.trim()
      && (typeof openOf(c) === "number" ? openOf(c) >= min : (typeof c.count === "number" && c.count >= min)))
    .sort((a, b) => (openOf(b) ?? b.count ?? 0) - (openOf(a) ?? a.count ?? 0))
    .slice(0, max)
    .map((c) => {
      const open = openOf(c);
      const name = displayName(c);
      return { token: c.token, name, stored: c.name.trim(), open: typeof open === "number" ? open : null, count: typeof c.count === "number" ? c.count : null, unreadable: !!unreadable(c, name) };
    });
  const nameKey = (c) => c.name.toLowerCase().replace(/\s+/g, " ").trim();
  const groupKey = (c) => `${bakeEmployerKey(c.token)}\u0000${nameKey(c)}`;
  // One employer under one name: its largest board.
  const primaryByGroup = new Map();
  for (const c of top) {
    const prev = primaryByGroup.get(groupKey(c));
    if (!prev || size(c) > size(prev)) primaryByGroup.set(groupKey(c), c);
  }
  // Across employers sharing a name: the largest of their primaries carries
  // the one indexable page for that title.
  const largestByName = new Map();
  for (const p of primaryByGroup.values()) {
    const prev = largestByName.get(nameKey(p));
    if (!prev || size(p) > size(prev)) largestByName.set(nameKey(p), p);
  }
  return top.map((c) => {
    const own = primaryByGroup.get(groupKey(c));
    const named = largestByName.get(nameKey(c));
    const employerKey = bakeEmployerKey(c.token);
    return { ...c, employerKey, employerPrimary: own.token, primary: named.token, sameEmployer: bakeEmployerKey(named.token) === employerKey };
  });
}

/**
 * The boards whose openings an employer page pools: its own employer's boards
 * under its name (one bakeEmployerKey, one name), never a different employer
 * that merely shares the name.
 */
export function employerBoardsOf(landers, token) {
  const c = landers.find((x) => x.token === token);
  if (!c) return [];
  const own = c.employerPrimary ?? c.primary;
  return landers.filter((x) => (x.employerPrimary ?? x.primary) === own).map((x) => x.token);
}

/**
 * The employer page a board's postings link as their employer's own: the page
 * it canonicalises to, unless that page belongs to a different employer
 * sharing its name, in which case there is none (null) and the caller links
 * the live board filtered to the board itself.
 */
export function employerPageOf(landers, token) {
  const c = landers.find((x) => x.token === token);
  if (!c || c.sameEmployer === false) return null;
  return c.primary;
}

/**
 * The employer pages a bake writes, named and judged as the bake does: `D` is
 * the bake's bundle of the app's own modules. F1: the name is D.boardName's,
 * and a board whose printed name is still its tenant code gets a page that is
 * never indexable.
 */
export const bakeLanders = (companyFacet, { D, openOf, max, min, nameOf = null }) => selectLanders(companyFacet, {
  openOf,
  // SEO-006: `nameOf` is the bake's repaired name (scripts/prerender-names.mjs
  // bakeEmployerName: "Chubb External" prints as "Chubb"); the code-shape test
  // reads both the repaired and the app's own name.
  displayName: (c) => (nameOf ? nameOf(c) : D.boardName(c.token, c.name)),
  unreadable: (c, name) => D.isCodeShapedName(c.token, name) || (nameOf ? D.isCodeShapedName(c.token, D.boardName(c.token, c.name)) : false),
  ...(max ? { max } : {}),
  ...(min ? { min } : {}),
});

/**
 * Rule 1 of the posting rule: a row may get a page of its own only when it
 * carries everything the page must state, under its employer's own name (F1),
 * from the employer itself (a staffing agency's row is not: the page says the
 * posting came from the employer's own system and names the row's company as
 * the hiring organisation), with a place, and still live. The description
 * gate needs the detail read and is applied after it.
 */
export const postingRowEligible = (j, D) => !!(j
  && typeof j.id === "string"
  && D.postingPagePath(j.id)
  && typeof j.title === "string" && j.title.trim()
  && typeof j.company === "string" && j.company.trim()
  && !D.isCodeShapedName(j.token ?? D.postingPathParts(j.id)?.token ?? null, D.postingEmployer(j))
  && j.agency !== true
  && j.country
  && (j.workMode === "remote" || j.location)
  && D.isPostingLive(j));

/**
 * HOW MANY NEW POSTING PAGES ONE BAKE MAY ADD (rule 3 of the bake's posting
 * block). The carried set has no cap: every URL the live site published is
 * re-checked and keeps its page while the posting lives (L13-36). The budget
 * for postings that never had a page is `cap` less the carried live pages,
 * never below `reserve` (so the set keeps moving), and never past `ceiling`
 * live pages in all. So `cap` is the size the set aims at, NOT a bound on it:
 * with 300 or more carried pages the reserve takes the set past `cap`, and the
 * bound on the live set is max(ceiling, carried live).
 *
 * The 2026-10-11 bake carried 454 live pages and added 46: 500, the ceiling,
 * against a `cap` of 400 that a guard still read as the bound.
 */
export function postingFreshBudget({ carriedLive, cap, reserve, ceiling }) {
  return Math.max(0, Math.min(ceiling - carriedLive, Math.max(cap - carriedLive, reserve)));
}

/**
 * A fixed number of board reads for one bake. Every read takes one; once it
 * is spent, take() answers false and the caller treats the read as not made.
 * The build server's address has one day row at the board's build cap, so a
 * bake that could make unbounded reads could exhaust that day for the next.
 */
export function callBudget(limit) {
  let used = 0;
  return {
    take() { if (used >= limit) return false; used++; return true; },
    get used() { return used; },
    get left() { return limit - used; },
  };
}

// ---- The date the sitemap gives a page ----
//
// MEASURED 2026-10-08 (SEO report, S3): all 1,267 sitemap entries carried the
// publish date, so every page claimed to change on every publish and search
// engines learn to ignore a date like that. A page's date now moves only when
// what it says moves: the fingerprint of its served text, with every date
// stamp taken out (a "built on" line changing is not the page changing), is
// kept in the ledger beside the date it last changed. A page with a date of
// its own (a guide's dateModified) carries that date instead.

/**
 * A fingerprint of what a page says, blind to the date stamps in it. With
 * `blindCounts`, blind to every number too: on a page whose figures are
 * counts measured at the build (a company page, a field page, the board),
 * a count moving is not the page changing (SEO-025: every one of the 484
 * company pages and 17 field pages was re-dated, and pinged, on every bake).
 */
export function contentFingerprint(text, { blindCounts = false } = {}) {
  let blind = String(text ?? "")
    .replace(/\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z| UTC)?)?/g, "<date>");
  // Only the text is blinded, never a tag: a listed opening's link carries its
  // id, and a different opening listed is the page changing.
  if (blindCounts) blind = blind.split(/(<[^>]*>)/).map((part) => (part.startsWith("<") ? part : part.replace(/\d[\d,.]*\+?/g, "<n>"))).join("");
  return createHash("sha1").update(blind).digest("hex").slice(0, 16);
}

/** Page families whose numbers are counts measured at the build, not what the page says. */
export const COUNT_BEARING = (path) => path === "/" || path === "/jobs" || path === "/companies" || path === "/explore" || path === "/agents"
  || String(path).startsWith("/jobs/company/") || String(path).startsWith("/jobs/field/");

/** The ledger's fingerprint version: 2 is count-blind on COUNT_BEARING pages. */
export const FINGERPRINT_VERSION = 2;

/**
 * The dates one page carries: `changed`, the day its fingerprint last moved,
 * and `lastmod`, the sitemap's date, which is `changed` or, for a page with a
 * date of its own (a guide's `updated`), the later of the two, so a guide
 * whose text moved without its stated date moving still says it changed.
 * `fp` is this bake's fingerprint (version FINGERPRINT_VERSION); `legacyFp`
 * the old algorithm's, compared only against a ledger entry written before the
 * version existed, so the switch itself re-dates nothing.
 */
export function pageDates({ fp, legacyFp, prior, today, stated = null }) {
  const p = prior && typeof prior === "object" ? prior : null;
  const same = !!p && (p.fpv === FINGERPRINT_VERSION ? p.fp === fp : p.fp === legacyFp);
  const priorChanged = p && typeof p.changed === "string" ? p.changed : p && typeof p.lastmod === "string" ? p.lastmod : null;
  const changed = same && priorChanged && priorChanged <= today ? priorChanged : today;
  const st = typeof stated === "string" && /^\d{4}-\d{2}-\d{2}/.test(stated) ? (stated.slice(0, 10) > today ? today : stated.slice(0, 10)) : null;
  // A stated page the ledger has never seen takes its stated date: the build
  // day is not the day a guide changed.
  const lastmod = st ? (!p ? st : (st > changed ? st : changed)) : changed;
  return { lastmod, changed: st && !p ? st : changed, fp, fpv: FINGERPRINT_VERSION };
}

/**
 * The lastmod for one page: its own stated date when it has one, else the
 * date the ledger recorded when its fingerprint last changed, else today.
 */
export function pageLastmod({ fingerprint, prior, today, stated = null }) {
  if (typeof stated === "string" && /^\d{4}-\d{2}-\d{2}/.test(stated)) {
    const d = stated.slice(0, 10);
    return d > today ? today : d;
  }
  if (prior && typeof prior === "object" && prior.fp === fingerprint && typeof prior.lastmod === "string" && prior.lastmod <= today) {
    return prior.lastmod;
  }
  return today;
}

// ---- What a company page says about its own employer (SEO report, S1) ----
//
// 485 of the 487 company pages were one template paragraph with the name and
// the count swapped, linking only to themselves. Each now lists that
// employer's own openings: the posting pages this bake wrote for it, then the
// board's own listing of its newest roles, each linked to the posting on the
// live board. The listing costs one board read per employer, so a bake reads
// LANDER_OPENINGS_READS of them (never-read or oldest first) and keeps every
// answer in the ledger for LANDER_OPENINGS_MAX_AGE_DAYS; the rest of the
// reads stay with the posting pages, inside the build cap. Where its roles
// are and in which fields (get_company_intel) are printed too, but a place
// and a field are shared by hundreds of employers, so they do not make a
// page its own: fewer than LANDER_MIN_OPENINGS openings on an answered
// listing, or a page whose text matches another page's once names and
// numbers are taken out, goes out as noindex.
export const LANDER_OPENINGS_READS = 100;
export const LANDER_OPENINGS_MAX_AGE_DAYS = 14;
export const LANDER_OPENINGS_SHOWN = 10;
export const LANDER_MIN_OPENINGS = 3;

/** Up to three named places and three named fields from one get_company_intel answer. */
export function landerFacts(intel, { countryName, fieldLabel }) {
  const rows = (v, key) => (Array.isArray(v) ? v : [])
    .filter((r) => r && typeof r[key] === "string" && r[key] && typeof r.n === "number" && r.n > 0)
    .slice(0, 3);
  const countries = rows(intel?.countries, "country")
    .map((r) => ({ code: r.country, name: countryName(r.country) }))
    .filter((r) => r.name);
  const fields = rows(intel?.categories, "category")
    .filter((r) => r.category !== "other")
    .map((r) => ({ slug: r.category, label: fieldLabel(r.category) }))
    .filter((r) => r.label);
  return { countries, fields };
}

/** The rows of one company-filtered board list read, or null when the answer cannot be read. */
export function openingsFromList(status, body) {
  if (status !== 200 || !body || typeof body !== "object" || !Array.isArray(body.jobs)) return null;
  return body.jobs
    .filter((r) => r && typeof r.id === "string" && r.id && typeof r.title === "string" && r.title.trim())
    .slice(0, LANDER_OPENINGS_SHOWN)
    .map((r) => ({ id: r.id, title: r.title.trim(), place: typeof r.location === "string" ? r.location.trim() : "" }));
}

const youngEntry = (e, today, maxAgeDays) => {
  const age = e && typeof e === "object" && Array.isArray(e.rows) ? dayDiff(e.at, today) : null;
  return age !== null && age >= 0 && age <= maxAgeDays ? e : null;
};

/** The employer boards whose listing this bake reads: never read (or too old to print) first, then the oldest, each in rank order. */
export function openingsToRead({ tokens, cache, today, max = LANDER_OPENINGS_READS, maxAgeDays = LANDER_OPENINGS_MAX_AGE_DAYS }) {
  const c = cache && typeof cache === "object" ? cache : {};
  return tokens
    .map((t, i) => ({ t, i, at: youngEntry(c[t], today, maxAgeDays)?.at ?? "" }))
    .sort((a, b) => (a.at === b.at ? a.i - b.i : a.at < b.at ? -1 : 1))
    .slice(0, Math.max(0, max))
    .map((x) => x.t);
}

/** The listing cache the next bake reads: this bake's answers over the young entries it kept, for the boards still chosen. */
export function nextOpeningsCache({ prior, reads, tokens, today, maxAgeDays = LANDER_OPENINGS_MAX_AGE_DAYS }) {
  const out = {};
  for (const t of tokens) {
    if (reads.has(t)) out[t] = { at: today, rows: reads.get(t) };
    else {
      const e = youngEntry(prior?.[t], today, maxAgeDays);
      if (e) out[t] = { at: e.at, rows: e.rows };
    }
  }
  return out;
}

/**
 * The openings one company page lists: the posting pages this bake wrote for
 * the employer first, then its listing from the cache, each linked to the
 * posting on the live board. `answered` is true only when there is a listing
 * young enough to print: a posting page or two with no listing read says
 * nothing about how many roles the employer lists.
 */
export function landerOpenings({ postings = [], cached = null, today, maxAgeDays = LANDER_OPENINGS_MAX_AGE_DAYS, limit = LANDER_OPENINGS_SHOWN }) {
  const e = youngEntry(cached, today, maxAgeDays);
  const out = [];
  const ids = new Set();
  for (const p of postings) {
    if (out.length >= limit) break;
    if (p.id) ids.add(p.id);
    out.push({ href: p.path, title: p.title, place: p.place ?? "" });
  }
  for (const r of e ? e.rows : []) {
    if (out.length >= limit) break;
    if (ids.has(r.id)) continue;
    ids.add(r.id);
    out.push({ href: `/jobs?job=${encodeURIComponent(r.id)}`, title: r.title, place: r.place ?? "" });
  }
  return { openings: out, at: e ? e.at : null, answered: !!e };
}

/** True when a company page lists enough of its own openings to be a page of its own. */
export const landerHasOwnContent = ({ openings }) => (openings?.length ?? 0) >= LANDER_MIN_OPENINGS;

/** A page's text with its name, numbers and dates taken out: two pages with the same skeleton say the same thing. */
export const landerSkeleton = (html, names = []) => {
  let t = String(html ?? "").replace(/<[^>]*>/g, " ").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");
  for (const n of names.filter(Boolean).sort((a, b) => b.length - a.length)) t = t.split(n).join("X");
  return t.replace(/\d[\d,.\-]*/g, "N").replace(/\s+/g, " ").trim();
};

/** The keys whose skeleton another page also has: none of them says anything of its own. */
export function duplicateSkeletons(items) {
  const by = new Map();
  for (const { key, skeleton } of items) by.set(skeleton, [...(by.get(skeleton) ?? []), key]);
  return new Set([...by.values()].filter((ks) => ks.length > 1).flat());
}

/**
 * What llms-full.txt says /companies is: the employers this bake gave a page
 * of their own, counted, never "every employer with open roles" (about 470
 * of some 31,000 boards; register L4-11).
 */
export const companiesLlmsLine = ({ site, count }) =>
  `- Companies with a page of their own: ${site}/companies — ${typeof count === "number" ? `the ${count.toLocaleString("en-US")} employers` : "the employers"} this site gives a page, A–Z, each linked with the open-role count measured when the index was built. The board itself carries far more employers, every one searchable at ${site}/jobs.`;

/**
 * The /companies line of the hand-written public/llms.txt, which said "each
 * with its live count" over counts measured when the index was built, and
 * named no number of employers at all. The committed file carries the line
 * without a number; each bake restates it with the number of employer pages
 * that same bake made indexable (the A–Z /companies lists exactly those), and
 * a bake that counted none takes the number out rather than leaving the last
 * one standing.
 */
export const LLMS_TXT_COMPANIES = /The (?:[\d,]+ )?employers this site gives a page of their own/;
export const llmsTxtCompaniesCount = (text, count) => String(text).replace(
  LLMS_TXT_COMPANIES,
  typeof count === "number" && Number.isFinite(count)
    ? `The ${count.toLocaleString("en-US")} employers this site gives a page of their own`
    : "The employers this site gives a page of their own",
);

/**
 * One company page. `robots` is decided by the caller (landerRobots); a page
 * that is not its employer's primary board canonicalises to the primary.
 *
 * THE NUMBER IN THE <title> IS THE NUMBER THE DESTINATION SERVES, OR THERE
 * IS NO NUMBER (`openN` is the board's servable count; null prints none). The
 * basis is printed as prose: it was a capitalised code annotation, "THE
 * COUNT'S BASIS: ... so the number below it is the number this page states",
 * in the visible body of ~490 pages (L4-12).
 */
export function companyLanderPage({ token, name, primaryToken, robots = null, canonicalTo = null, openN, countedOn = null, facts, openings = [], openingsAt = null, sources, boardCompanies, site, esc, possessive, fmt, href: hrefOf }) {
  const nm = name;
  const isPrimary = primaryToken === token;
  const hasN = typeof openN === "number";
  const href = hrefOf(token);
  const poss = possessive(nm);
  const pages = openings.filter((p) => String(p.href).startsWith("/jobs/posting/"));
  const factsHtml = [
    facts?.countries?.length
      ? `<h2>Where ${esc(poss)} open roles are</h2>
            <p>The countries holding the most of its roles on this board: ${facts.countries.map((x) => `<a href="${href}?country=${encodeURIComponent(x.code)}">${esc(x.name)}</a>`).join(", ")}.</p>`
      : "",
    facts?.fields?.length
      ? `<h2>The fields ${esc(nm)} is hiring in</h2>
            <p>The fields holding the most of its roles on this board: ${facts.fields.map((x) => `<a href="${href}?category=${encodeURIComponent(x.slug)}">${esc(x.label)}</a>`).join(", ")}. Fields are our own sorting of each posting's title, never a label the employer applied.</p>`
      : "",
    openings.length
      ? `<h2>Openings at ${esc(nm)}</h2>
            <p>${openingsAt ? `From ${esc(poss)} listing on this board, read ${esc(openingsAt)}, newest first` : `${esc(poss)} openings with a page of their own on this site`}; the live board re-checks a posting when you open it.</p>
            <ul>${openings.map((p) => `<li><a href="${esc(p.href)}">${esc(p.title)}</a>${p.place ? ` — ${esc(p.place)}` : ""}</li>`).join("")}</ul>`
      : "",
  ].filter(Boolean).join("\n            ");
  // 68-char SERP budget: the name always stays whole; the source phrase gives
  // way first, then the count. NEVER "verified": the board reads each
  // employer's own feed, it does not verify each role (owner, 2026-10-12).
  // The count's basis (what an open role is, and the day it was counted) is
  // the first sentence of the body.
  const title = (() => {
    if (!hasN) return `${nm} jobs: open roles from their own hiring system`.length <= 68 ? `${nm} jobs: open roles from their own hiring system` : `${nm} jobs`;
    const full = `${nm} jobs: ${fmt(openN)} open roles from their own hiring system`;
    if (full.length <= 68) return full;
    const short = `${nm} jobs: ${fmt(openN)} open roles`;
    return short.length <= 68 ? short : `${nm} jobs`;
  })();
  const counted = countedOn ? `, counted ${esc(countedOn)}` : "";
  return {
    path: `/jobs/company/${token}`,
    canonical: canonicalTo ? `/jobs/company/${canonicalTo}` : isPrimary ? null : `/jobs/company/${primaryToken}`,
    robots: canonicalTo ? null : isPrimary ? robots : null,
    title,
    description: hasN
      ? `${fmt(openN)} open roles at ${nm}, read from ${poss} own hiring system. Check your resume's fit free before you apply.`
      : `Open roles at ${nm}, read from ${poss} own hiring system. Check your resume's fit free before you apply.`,
    content: `
            <h1>Open roles at ${esc(nm)}</h1>
            <p>${hasN ? `${fmt(openN)} open ${esc(nm)} roles${counted}` : `Open ${esc(nm)} roles`}, pulled straight from ${esc(poss)} own hiring system (one of ${sources}). Applying happens on ${esc(poss)} own site.${hasN ? ` An open role here is a posting ${esc(nm)} has not taken down whose date falls inside the last 30 days: the employer's own date, or for a posting with no date, the day we last saw it in their feed. That is the same rule the live board page applies. The count was measured when this page was built and moves as roles open and close.` : ` This build could not read a count it can stand behind for ${esc(nm)}, so it states none rather than a figure the live board would contradict.`}</p>
            ${factsHtml}
            <p><a href="${href}">Browse all ${esc(nm)} openings on the live board</a> — filter by role, location, experience, and remote, and check any posting against your resume with the <a href="/">free resume scan</a> before you spend an application on it.</p>
            <p>See <a href="/jobs">the full job board</a>${boardCompanies ? ` for openings across ${fmt(boardCompanies)} company job boards with roles open${countedOn ? ` (counted ${esc(countedOn)})` : " when this page was built"}` : ""}.</p>
          `,
    jsonLd: [{
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: `Open roles at ${nm}`,
      description: `Open ${nm} roles from ${poss} official job board, re-checked throughout the day.`,
      url: `${site}${href}`,
      about: { "@type": "Organization", name: nm },
      isPartOf: { "@type": "WebSite", name: "Resume Booster", url: site },
      // Only the openings that are pages of their own: a board link is the board.
      ...(pages.length ? { mainEntity: { "@type": "ItemList", itemListElement: pages.map((p, i) => ({ "@type": "ListItem", position: i + 1, url: `${site}${p.href}`, name: p.title })) } } : {}),
    }, {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Job board", item: `${site}/jobs` },
        { "@type": "ListItem", position: 2, name: `${nm} jobs`, item: `${site}${href}` },
      ],
    }],
  };
}

/**
 * Whether a company page may be indexed. Never when its name is still a
 * tenant code; never when the board ANSWERED and it has nothing of its own to
 * say; never when its text is another page's (`duplicate`). A listing not
 * read yet, or a failed read, proves nothing, so the page keeps its index on
 * the count alone rather than a flaky read noindexing hundreds of pages and
 * tripping the sitemap ratchet.
 */
export function landerRobots({ isPrimary, unreadable, answered, ownContent, duplicate = false }) {
  if (!isPrimary) return null;
  return unreadable || duplicate || (answered && !ownContent) ? "noindex, follow" : null;
}

/**
 * True when "nothing of its own" answers are too many to be about the
 * employers: every company page is for an employer with 8+ open roles, so
 * when more than a quarter of the answered pages list too few openings (or
 * match another page), the read is broken and none is noindexed for it (that
 * would also trip the sitemap ratchet and lose the whole sitemap). Measured
 * on a mock bake whose intel answered empty: 460 of 489, and the ratchet
 * refused.
 */
export const landerThinBreaker = ({ answered, thin }) => answered >= 20 && thin > answered * 0.25;

/**
 * The two noindex rules' breakers. The duplicate rule is judged together
 * with the thin pages it would add to, so the two can never noindex more
 * than a quarter of the pages between them: the sitemap ratchet refuses a
 * fifth fewer standing URLs, and a refused sitemap leaves the stale one.
 */
export function landerBreakers({ answered, thin, candidates, dupes }) {
  const thinBreaker = landerThinBreaker({ answered: answered.length, thin: thin.length });
  const dupeBreaker = landerThinBreaker({ answered: candidates.length, thin: new Set([...dupes, ...(thinBreaker ? [] : thin)]).size });
  return { thinBreaker, dupeBreaker };
}
