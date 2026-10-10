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
  const postings = ledger && typeof ledger === "object" && ledger.postings && typeof ledger.postings === "object" ? ledger.postings : {};
  const named = new Set();
  for (const [path, e] of Object.entries(postings)) {
    if (!idFromPath(path) || !e || typeof e !== "object") continue;
    named.add(path);
    if (e.state === "gone") {
      const age = dayDiff(e.since, today);
      if (age !== null && age >= 0 && age <= keepDays) stubs.set(path, { ...e });
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
  return { recheck, stubs };
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
export function postingStubPage({ path, id, state, since, title, company, companyLink, windowDays, duplicateOf = null, esc }) {
  const t = typeof title === "string" && title.trim() ? title.trim() : null;
  const c = typeof company === "string" && company.trim() ? company.trim() : null;
  const what = t ? `${esc(t)}${c ? ` at ${esc(c)}` : ""}` : "This posting";
  const board = `/jobs?job=${encodeURIComponent(id)}`;
  const head = state === "gone"
    ? "This posting is no longer listed"
    : state === "retired" ? "This posting no longer has a page of its own" : "We could not re-check this posting";
  const lead = state === "gone"
    ? `${what} is no longer listed on this board${since ? ` (recorded ${esc(since)})` : ""}. That is a statement about this board, not about the employer: the posting may have been taken down, or the date the employer put on it passed the board's ${windowDays}-day window.`
    : state === "retired"
      ? (duplicateOf
        ? `${what} is the same requisition as <a href="${duplicateOf}">another page on this site</a>, which now carries it.`
        : `${what} is still on the live board, but no longer carries everything a page of its own must state, so this page states nothing more about it. <a href="${board}">Open it on the live board</a>.`)
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
  const since = p.state === stub.state && typeof p.since === "string" ? p.since : today;
  const token = stub.job?.token ?? p.token ?? tokenOf(stub.id) ?? null;
  const company = employerName(token, stub.company ?? p.company ?? null) || null;
  return { state: stub.state, since, first: p.first ?? first ?? today, title: stub.title ?? p.title ?? null, company, token };
}

/**
 * The employer boards that get a page this bake, ranked and gated on OPEN
 * roles (the count /jobs/company/{token} serves), each with the token of its
 * employer's indexable board: one employer running several boards gets one
 * indexable page, the board with the most open roles, and the rest
 * canonicalise to it. Grouped on the name the page renders. `displayName`
 * gives that name; `unreadable` flags a board whose name is still a system
 * code, which gets a page but never an indexable one.
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
  const primaryByName = new Map();
  for (const c of top) {
    const key = c.name.toLowerCase();
    const prev = primaryByName.get(key);
    if (!prev || size(c) > size(prev)) primaryByName.set(key, c);
  }
  return top.map((c) => ({ ...c, primary: primaryByName.get(c.name.toLowerCase()).token }));
}

/**
 * The employer pages a bake writes, named and judged as the bake does: `D` is
 * the bake's bundle of the app's own modules. F1: the name is D.boardName's,
 * and a board whose printed name is still its tenant code gets a page that is
 * never indexable.
 */
export const bakeLanders = (companyFacet, { D, openOf, max, min }) => selectLanders(companyFacet, {
  openOf,
  displayName: (c) => D.boardName(c.token, c.name),
  unreadable: (c, name) => D.isCodeShapedName(c.token, name),
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

/** A fingerprint of what a page says, blind to the date stamps in it. */
export function contentFingerprint(text) {
  const blind = String(text ?? "")
    .replace(/\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z| UTC)?)?/g, "<date>");
  return createHash("sha1").update(blind).digest("hex").slice(0, 16);
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
 * One company page. `robots` is decided by the caller (landerRobots); a page
 * that is not its employer's primary board canonicalises to the primary.
 *
 * THE NUMBER IN THE <title> IS THE NUMBER THE DESTINATION SERVES, OR THERE
 * IS NO NUMBER (`openN` is the board's servable count; null prints none). The
 * basis is printed as prose: it was a capitalised code annotation, "THE
 * COUNT'S BASIS: ... so the number below it is the number this page states",
 * in the visible body of ~490 pages (L4-12).
 */
export function companyLanderPage({ token, name, primaryToken, robots = null, openN, facts, openings = [], openingsAt = null, sources, boardCompanies, site, esc, possessive, fmt, href: hrefOf }) {
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
  // 68-char SERP budget: the name always stays whole; the count phrase gives
  // way first, "Verified" before "Openings".
  const title = (() => {
    if (!hasN) return `${nm} Jobs — Open Roles From Their Own Job Board`.length <= 68 ? `${nm} Jobs — Open Roles From Their Own Job Board` : `${nm} Jobs`;
    const full = `${nm} Jobs — ${fmt(openN)} Verified Openings`;
    if (full.length <= 68) return full;
    const short = `${nm} Jobs — ${fmt(openN)} Openings`;
    return short.length <= 68 ? short : `${nm} Jobs`;
  })();
  return {
    path: `/jobs/company/${token}`,
    canonical: isPrimary ? null : `/jobs/company/${primaryToken}`,
    robots: isPrimary ? robots : null,
    title,
    description: hasN
      ? `Browse ${fmt(openN)} open roles at ${nm}, pulled straight from ${poss} own job board and re-checked continuously. Check your resume's fit free, then apply on ${poss} own site.`
      : `Browse open roles at ${nm}, pulled straight from ${poss} own job board and re-checked continuously. Check your resume's fit free, then apply on ${poss} own site.`,
    content: `
            <h1>Open roles at ${esc(nm)}</h1>
            <p>${hasN ? `${fmt(openN)} verified ${esc(nm)} openings right now` : `Verified ${esc(nm)} openings`}, pulled straight from ${esc(poss)} own official job board (one of ${sources}) and re-checked continuously. Every role belongs to ${esc(nm)}, and applying happens on ${esc(poss)} own site.${hasN ? ` An open role here is a posting ${esc(nm)} has not taken down and whose date falls inside the last 30 days, the same rule the live board page applies. The count was measured when this page was built and moves as roles open and close.` : ` This build could not read a count it can stand behind for ${esc(nm)}, so it states none rather than a figure the live board would contradict.`}</p>
            ${factsHtml}
            <p><a href="${href}">Browse all ${esc(nm)} openings on the live board</a> — filter by role, location, experience, and remote, and check any posting against your resume with the <a href="/">free resume scan</a> before you spend an application on it.</p>
            <p>See <a href="/jobs">the full job board</a>${boardCompanies ? ` for openings across ${fmt(boardCompanies)} company job boards with roles open now` : ""}.</p>
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
