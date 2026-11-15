// The crawler copy's shared sentences and the site's own entity graph, for
// the bake (scripts/prerender-seo.mjs, scripts/prerender-pages.mjs) and the
// tests that read what it writes (src/test/seo-bake-*). Pure: no network, no
// filesystem. One spelling of each sentence, so the posting pages, the company
// pages, the board, the field pages, the data pages and both llms files cannot
// say different things about where the jobs come from (SEO round 2026-10-18).

/**
 * WHERE THE JOBS COME FROM, in the one sentence every page uses (R5a). The
 * pages said "never an aggregator, never a repost" (500 posting pages) and
 * "No aggregators" (/jobs and 17 field pages), beside a pane that warns a
 * posting may be an employer's re-post and beside boards the site itself
 * labels as a staffing agency's or a federal listing site's. This is what the
 * board does, and nothing more.
 */
export const SOURCE_SENTENCE = "read from employers' own hiring systems, not copied from other job boards";

/** The one-posting form, for a page whose employer is named: "Read from Acme's own hiring system, not copied from another job board." */
export const postingSourceSentence = (possessiveName) => `Read from ${possessiveName} own hiring system, not copied from another job board.`;

/** The board-wide form: the sentence, plus the two kinds of board that are not one employer's own. */
export const BOARD_SOURCE_SENTENCE = `${SOURCE_SENTENCE}; a staffing agency's board and a federal listing site, where the board carries one, are labelled as what they are`;

/**
 * THE RE-CHECK, WITH ITS CONDITIONS (R6a, and one spelling with React, R6).
 * "The live board re-checks a posting when you open it" sat unconditionally
 * on 1,002 company pages and 500 posting pages. The live board asks the
 * employer's system again only when our last read of that posting's feed is
 * older than RECHECK_AFTER_HOURS (VERIFY_ON_VIEW_AFTER_HOURS in
 * src/lib/seo/source-copy.ts, the threshold Jobs.tsx applies, held equal by
 * src/test/seo-integration-one-re-check-sentence.test.ts), and only where
 * that system answers a single-posting read. React's posting note
 * (jobPostingPage.sourceNote) states the same rule; this clause completes
 * "the live board …".
 */
export const RECHECK_AFTER_HOURS = 6;
export const RECHECK_CLAUSE = `asks the employer's system again when you open a posting whose feed it last read more than ${RECHECK_AFTER_HOURS} hours ago, where that system allows it`;

/** The phrases no crawler page and no llms file may carry (R5a): each is a promise the board cannot keep for every row. */
export const BANNED_SOURCE_PHRASES = [
  ["'never an aggregator'", /\bnever an aggregator\b/i],
  ["'never a repost'", /\bnever a repost\b/i],
  ["'no aggregators'", /\bno aggregators\b/i],
  ["'never aggregators'", /\bnever aggregators\b/i],
  ["an unconditional re-check", /\bre-checks a posting when you open it(?!, where the employer)/i],
  // A board-wide list holds the federal listing site and staffing agencies'
  // boards: no sentence may say every row is an employer's own (/companies
  // said both until the round's review).
  ["a blanket 'every posting comes from the company's own hiring system'", /\bevery posting comes from the company's own hiring system\b/i],
  ["a board-wide 'each read from the employer's own hiring system'", /\beach read from the employer's own hiring system\b/i],
  // B09 (CLAIM-11): a takedown is logged when a LATER READ of the feed finds
  // the posting gone, hours or days after the employer took it down; no
  // sentence may say it is recorded at the instant it happens.
  ["an instant takedown record", /\bthe moment (?:a|an|the) (?:company|employer)s? (?:takes|took|removes|pulls)\b/i],
  ["a takedown read as an instant", /\bthe moment (?:a|an|the) (?:posting|role|job) (?:comes|came|goes|went) down\b/i],
];

/** Every banned source phrase one text carries, as [claim, matched text]. */
export function bannedSourcePhrasesIn(text) {
  const t = String(text ?? "");
  const out = [];
  for (const [claim, re] of BANNED_SOURCE_PHRASES) { const m = re.exec(t); if (m) out.push([claim, m[0]]); }
  return out;
}

/**
 * THE HOSTS A SEEKER-FACING PAGE MAY NAME (owner, 2026-09-18; R7a): Claude,
 * ChatGPT and Claude Code. Every other host lives in the install repository's
 * README, never on /agents or in the llms files.
 */
export const SEEKER_HOSTS_LABEL = "Claude, ChatGPT and Claude Code";
// "Cursor pagination" is the API's, not the editor.
export const OFF_PAGE_HOST_NAMES = /\b(?:Cursor(?! pagination)|VS Code|Visual Studio Code|Cline|Windsurf|Gemini CLI|Codex CLI)\b/;

// ---- The site's own entity graph (SEO-011a) ----
//
// No page carried an Organization, an @id or a logo: every publisher, creator
// and isPartOf was an inline object naming "Resume Booster", so nothing tied
// the guides, the data pages and the board to one entity. The bake now writes
// ONE Organization (and the template's one WebSite) into every page head and
// points everything that means us at them by @id. Owner decision: the
// Organization carries no legalName, address, contactPoint or sameAs until
// the owner supplies them (SEO-045); the software's own links (the install
// repository, the registry entry) ride on the MCP server's own node on
// /agents, because they describe the software, not the organisation.

export const ORG_ID = (site) => `${site}/#org`;
export const WEBSITE_ID = (site) => `${site}/#website`;

/**
 * B03 (GEO-04): what the Organization IS, in one sentence, and which of the
 * things called "Resume Booster" it is. On 2026-11-07 five web searches for
 * this site returned none of its pages and showed resumebooster.io and
 * ResumeBoostAI instead, and nothing the site served said which one it was.
 * The second sentence is the one /about already publishes (about.lead).
 * Neither names a person, a company or an address (SEO-045 stands).
 */
export const ORG_DESCRIPTION = "Resume Booster is a free job board of live jobs read from employers' own hiring systems and USAJOBS, with a free resume checker; you apply on the employer's own site.";
export const ORG_DISAMBIGUATION = "The job board and free resume scanner at resumebooster.work: an independent site, not affiliated with any employer or hiring system it reads, and not the same product as resumebooster.io or ResumeBoostAI.";

/** The one Organization node. Nothing beyond what is true and public. */
export const orgNode = (site) => ({
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": ORG_ID(site),
  name: "Resume Booster",
  alternateName: "resumebooster.work",
  url: `${site}/`,
  logo: `${site}/icons/icon-512.png`,
  description: ORG_DESCRIPTION,
  disambiguatingDescription: ORG_DISAMBIGUATION,
});

/** A reference to the Organization, with its name inline for a reader that does not resolve @id (Article author and publisher). */
export const orgRef = (site) => ({ "@type": "Organization", "@id": ORG_ID(site), name: "Resume Booster", url: `${site}/` });

/** A reference to the WebSite node the template carries. */
export const websiteRef = (site) => ({ "@type": "WebSite", "@id": WEBSITE_ID(site), name: "Resume Booster", url: site });

/**
 * The template's WebSite block with its @id and its publisher set to the
 * Organization: parsed and re-serialised, so the SearchAction the template
 * owns stays exactly as written. Returns the HTML unchanged when the block is
 * not there or does not parse.
 */
export function withWebsiteGraph(html, site) {
  return String(html).replace(/<script type="application\/ld\+json">\s*(\{[\s\S]*?\})\s*<\/script>/, (whole, body) => {
    let j;
    try { j = JSON.parse(body); } catch { return whole; }
    if (!j || j["@type"] !== "WebSite") return whole;
    const out = { "@context": j["@context"] ?? "https://schema.org", "@type": "WebSite", "@id": WEBSITE_ID(site), ...j, publisher: { "@id": ORG_ID(site) } };
    out["@id"] = WEBSITE_ID(site);
    return `<script type="application/ld+json">${JSON.stringify(out).replace(/</g, "\\u003c")}</script>`;
  });
}

// ---- One reading of the board's size per bake (SEO-026) ----

/**
 * The board's size as this bake read it, and the day: every surface that
 * prints a board total prints it from here, with "as of <day>". `trackedTotal`
 * is the table's row count, which is the open postings plus the closed ones
 * still awaiting removal (closures delete rows); it is never printed as "roles
 * tracked in all, including roles since closed", which the table cannot hold.
 */
export function boardSnapshot({ openTotal, trackedTotal, boards, measuredAt }) {
  const n = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
  return { openTotal: n(openTotal), trackedTotal: n(trackedTotal), boards: n(boards), measuredAt: typeof measuredAt === "string" && measuredAt ? measuredAt : null };
}

/** "as of 2026-10-18", or the words for a reading with no day. */
export const asOfPhrase = (snap) => (snap && snap.measuredAt ? `as of ${snap.measuredAt}` : "as of the last build that could read the board");

// ---- The Wilson interval for a share (SEO-009) ----

/** The 95% Wilson score interval for k successes in n trials, as whole-number percentages [low, high], or null. */
export function wilsonPct(k, n, z = 1.96) {
  if (!(typeof k === "number" && typeof n === "number" && n > 0 && k >= 0 && k <= n)) return null;
  const p = k / n;
  const den = 1 + (z * z) / n;
  const mid = (p + (z * z) / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  const lo = Math.max(0, mid - half);
  const hi = Math.min(1, mid + half);
  return [Math.floor(lo * 1000) / 10, Math.ceil(hi * 1000) / 10];
}

// ---- A description kept whole to its last sentence that fits (B09) ----
//
// The bake keeps a description another module owns to its last whole
// sentence under the snippet budget, and it used to find sentences with
// /[^.!?]+[.!?]+/: every "vs." and "e.g." was a sentence end, so a guide
// whose description ran past 160 characters went out as a fragment ending
// "Resume vs." or one with a bracket it never closed (DESC-10, 2026-11-07).
// A period ends a sentence here only where the word before it is not an
// abbreviation and not a lone initial, and any end needs the next sentence to
// begin like one (a capital, a digit, an opening quote or bracket); "etc."
// ends one only before a capital. A cut that leaves a bracket open is never
// returned. The old pattern also skipped text it could not match, so "the
// U.S. Department" became "S. Department": every cut here is a prefix.

/** Words a period after which never ends a sentence (lower-cased, inner periods kept). */
const NEVER_ENDS = new Set([
  "vs", "v", "e.g", "i.e", "cf", "viz", "u.s", "u.k", "u.s.a", "e.u", "inc", "ltd", "llc", "co", "corp", "st", "mt", "ft",
  "dr", "mr", "mrs", "ms", "jr", "sr", "prof", "no", "nos", "approx", "a.m", "p.m", "ph.d", "m.d", "b.a", "b.s", "m.s", "m.a",
  "al", "fig", "dept", "est", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
]);
/** Words a period after which ends a sentence only when a capital follows. */
const ENDS_BEFORE_CAPITAL = new Set(["etc"]);

/** The offsets just past each sentence end in `text` (its closing quotes and brackets included). */
export function sentenceEnds(text) {
  const t = String(text ?? "");
  const ends = [];
  const re = /([.!?]+)(["'”’)\]]*)(?=\s|$)/g;
  let m;
  while ((m = re.exec(t))) {
    const end = m.index + m[0].length;
    const next = t.slice(end).trimStart().charAt(0);
    if (m[1] === ".") {
      const word = (/([A-Za-z][A-Za-z.]*)$/.exec(t.slice(0, m.index)) || [])[1] || "";
      const w = word.toLowerCase();
      if (NEVER_ENDS.has(w)) continue;
      if (/^[A-Z]$/.test(word)) continue;
      if (ENDS_BEFORE_CAPITAL.has(w) && !/[A-Z0-9"“(\[]/.test(next)) continue;
    }
    // The next sentence must begin like one: a capital, a digit, a currency
    // sign, an opening quote or bracket ("the US?” — and ..." goes on).
    if (next && !/[\p{Lu}0-9"'\u201c\u2018(\[{$\u20ac\u00a3\u20b9]/u.test(next)) continue;
    ends.push(end);
  }
  return ends;
}

/** Every bracket opened in `s` is closed in it, in order. */
export function bracketsBalanced(s) {
  const stack = [];
  for (const c of String(s ?? "")) {
    if (c === "(" || c === "[") stack.push(c);
    else if (c === ")" || c === "]") { if (stack.pop() !== (c === ")" ? "(" : "[")) return false; }
  }
  return stack.length === 0;
}

/**
 * `text` itself when it fits `max`; else its longest run of whole sentences
 * that fits and closes every bracket it opens; else `text` unchanged, which
 * the clamp then logs for the description's owner.
 */
export function fitSentence(text, max = 160) {
  const t = String(text ?? "");
  if (t.length <= max) return t;
  let best = "";
  for (const end of sentenceEnds(t)) {
    const cut = t.slice(0, end).trim();
    if (cut.length > max) break;
    if (bracketsBalanced(cut)) best = cut;
  }
  return best || t;
}
