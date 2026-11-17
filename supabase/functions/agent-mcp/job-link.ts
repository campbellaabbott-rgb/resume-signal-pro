// A JOB ID, OR THE LINK A PERSON PASTES FOR ONE (connect W1, CJ-04 and BR-03).
//
// One reader for every tool that takes a job: get_job, get_jobs, fetch,
// apply_myself and check_jobs_open. Before it, get_job read only the ?job=
// parameter of a pasted link, so the board's own posting page
// (resumebooster.work/jobs/posting/<source>/<token>/<key>, the page Google and
// AI search show) was refused as "not a job id from this board" while the
// posting was open; and check_jobs_open read no link at all, so a pasted
// ?job= link came back "closed".
//
// Accepted, each turned into the board's own id (<source>:<token>:<key>):
//   - the id itself;
//   - resumebooster.work/jobs?job=<id> (any path on the site with ?job=);
//   - resumebooster.work/jobs/posting/<source>/<token>/<key>[/], each segment
//     URL-decoded, and the older single-segment /jobs/posting/<id>;
//   - an employer's own Greenhouse, Lever or Ashby posting link, whose path
//     names the board token and the posting key the board stores.
//
// parseJobLink (MCP upgrade 3, W1 lane L3) reads the links parseJobId refuses,
// for L5 to wire in. What parseJobId reads it answers with the same id. A
// Workday posting link, or a page carrying gh_jid, is a candidate read once
// and believed only when a card the board serves proves it (jobLinkHeld).
// LinkedIn and job-aggregator links are answered in words, read from the
// link's own text and never opened. Anything else is answered with the kinds
// of link it reads.
//
// Pure: no I/O.

/** The shape of a board id: three or more colon-separated parts, the first two non-empty. */
export function isJobIdShape(id: string): boolean {
  const parts = id.split(":");
  return parts.length >= 3 && !!parts[0] && !!parts[1] && !!parts.slice(2).join(":") && id.length <= 400;
}

const decode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** The board's id for an employer link the board can name, or null. */
function employerLink(u: URL): string | null {
  const host = u.hostname.toLowerCase();
  const seg = u.pathname.split("/").filter(Boolean).map(decode);
  // A tenant in Greenhouse's or Lever's EU region is held under its token with
  // the "eu~" prefix (job-board/normalize.ts greenhouseApi and leverApi), so a
  // link on an EU host names greenhouse:eu~<token>:<id>, never the US id
  // greenhouse:<token>:<id>, which the board does not hold.
  const eu = /(?:^|\.)eu\.(?:greenhouse\.io|lever\.co)$/.test(host) ? "eu~" : "";
  // job-boards(.eu).greenhouse.io/<token>/jobs/<id>, boards(.eu).greenhouse.io/<token>/jobs/<id>
  if (/(?:^|\.)greenhouse\.io$/.test(host)) {
    if (seg.length >= 3 && seg[1] === "jobs" && /^\d+$/.test(seg[2])) return `greenhouse:${eu}${seg[0]}:${seg[2]}`;
    // boards(.eu).greenhouse.io/embed/job_app?for=<token>&token=<id>
    const forToken = u.searchParams.get("for");
    const jobId = u.searchParams.get("token");
    if (forToken && jobId && /^\d+$/.test(jobId)) return `greenhouse:${eu}${forToken}:${jobId}`;
    return null;
  }
  // jobs.lever.co/<token>/<uuid>[/apply], jobs.eu.lever.co/<token>/<uuid>
  if (/(?:^|\.)lever\.co$/.test(host) && seg.length >= 2 && /^[0-9a-f-]{36}$/i.test(seg[1])) return `lever:${eu}${seg[0]}:${seg[1]}`;
  // jobs.ashbyhq.com/<token>/<uuid>[/application]
  if (/(?:^|\.)ashbyhq\.com$/.test(host) && seg.length >= 2 && /^[0-9a-f-]{36}$/i.test(seg[1])) return `ashby:${seg[0]}:${seg[1]}`;
  return null;
}

/** The board id a pasted id or link names, or null when it names none. */
export function parseJobId(raw: unknown): string | null {
  let s = String(raw ?? "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s) && /^(?:www\.)?resumebooster\.work\//i.test(s)) s = `https://${s}`;
  if (/^https?:\/\//i.test(s)) {
    let u: URL;
    try {
      u = new URL(s);
    } catch {
      return null;
    }
    const fromParam = u.searchParams.get("job");
    if (fromParam && isJobIdShape(fromParam.trim())) return fromParam.trim();
    const seg = u.pathname.split("/").filter(Boolean).map(decode);
    if (seg[0] === "jobs" && seg[1] === "posting") {
      if (seg.length === 5) {
        const id = `${seg[2]}:${seg[3]}:${seg[4]}`;
        return isJobIdShape(id) ? id : null;
      }
      if (seg.length === 3 && isJobIdShape(seg[2])) return seg[2];
      return null;
    }
    return employerLink(u);
  }
  return isJobIdShape(s) ? s : null;
}

// ---------------------------------------------------------------------------
// parseJobLink: the links parseJobId refuses (MCP upgrade 3, W1 lane L3).
// ---------------------------------------------------------------------------

/**
 * Whether parseJobLink reads a Workday posting link as the board's id. It may
 * be on only while scripts/measure-job-link-roundtrip.mjs reads 300 or more
 * live Workday cards, over 50 or more careers sites, back to their own ids at
 * 98% or more in every gated form (F13); the recorded sample
 * (src/test/fixtures/workday-link-roundtrip-*.json) holds the switch to that.
 * Off, a Workday link is answered in words, with a search for its title on
 * the careers site it names.
 *
 * On since the run of 2026-11-17 05:47Z: 300 live cards over 61 careers sites
 * (56 tenants), read in five probe calls at offsets 0 to 2000. Each applyUrl
 * read back to its own id (300/300), and every gated form at 100% on this
 * reader. The run printed 299/300 for the /apply form, a cut this reader made
 * on a path with no place, fixed before commit. The careers site written in
 * other letter case reads 0/300: a known miss, answered with a search.
 */
export const WORKDAY_LINKS_READ: boolean = true;

/** A search the person's AI may run instead of reading the link: a search, never the posting itself. */
export type SuggestedSearch = { query?: string; companies?: string[] };

/** An answer in words, for a link that names no id the board can be asked about. */
export type JobLinkWords = { note: string; suggestedSearch?: SuggestedSearch };

/**
 * What a card's own applyUrl must carry to prove a candidate: Greenhouse's
 * gh_jid, or the Workday requisition as the link's slug writes it (the board's
 * id keeps only what follows the slug's last "_", so R25_1002 and R26_1002 on
 * one careers site share an id).
 */
export type JobLinkProof = { param: "gh_jid"; value: string } | { param: "workdayReq"; value: string };

export type JobLinkReading =
  /** The board's own id, named by the id itself or a link parseJobId reads. */
  | { kind: "id"; id: string }
  /**
   * An id the link probably names. Read it once; it is the posting only when
   * jobLinkHeld says the card proves it, and otherwise the answer is ifNotHeld.
   * A gh_jid candidate needs the card's applyUrl. A Workday candidate is held
   * by its id alone only when the card carries no Workday link of its own.
   */
  | { kind: "candidate"; vendor: "workday" | "greenhouse"; id: string; proof?: JobLinkProof; ifNotHeld: JobLinkWords }
  /** No id to ask the board about: an answer in words. */
  | ({ kind: "words"; site: "linkedin" | "aggregator" | "workday" | "other" } & JobLinkWords);

/**
 * The kinds of link the reader turns into a board id, for a refusal to list.
 * Each says only what the reader checks: a gh_jid link is a guess at the
 * board's name, and it misses for an employer whose Greenhouse board is named
 * otherwise (the board's own cards: wavemm1 for wave.com, flyzipline for
 * zipline.com).
 */
export function linkKindsThatWork(workday: boolean = WORKDAY_LINKS_READ): string {
  const kinds = [
    "Links read as a board id: the id from a search card (e.g. greenhouse:acme:12345)",
    "the posting's resumebooster.work link",
    "an employer's Greenhouse, Lever or Ashby posting link, for an employer the board carries",
    ...(workday ? ["a Workday posting link (myworkdayjobs.com or myworkdaysite.com), for a careers site the board carries under the name the link writes"] : []),
  ];
  return `${kinds.join("; ")}. A link carrying gh_jid=<number> is tried as that Greenhouse posting on the Greenhouse board named like the link's web address, and misses whenever the employer's Greenhouse board is named otherwise; a miss is answered with a search by employer and title.`;
}

/** The path of a link as written, before the URL parser encodes it: what normalizeWorkday joined onto its base. */
const writtenPath = (s: string): string => /^https?:\/\/[^/?#]*([^?#]*)/i.exec(s)?.[1] ?? "";

// Second-level labels of two-part public suffixes (example.co.uk, example.com.au).
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "ac", "gov", "edu", "ltd", "plc"]);

// Hosts anyone may publish a site under, as the public suffix list's private
// section names them: acme.webflow.io is acme's, never Webflow's.
const SHARED_HOSTS = [
  "github.io", "gitlab.io", "webflow.io", "framer.website", "framer.app", "framer.ai", "notion.site", "vercel.app",
  "netlify.app", "pages.dev", "web.app", "firebaseapp.com", "herokuapp.com", "azurewebsites.net", "onrender.com",
  "fly.dev", "replit.app", "myshopify.com", "wixsite.com", "squarespace.com", "wordpress.com", "blogspot.com",
  "carrd.co", "super.site", "softr.app",
];

/**
 * The label a domain is registered under (careers.stripe.com: stripe;
 * www.example.co.uk: example; acme.webflow.io: acme), with its domain; null
 * for an IP address, a single label or a bare shared host.
 */
function registered(host: string): { label: string; domain: string } | null {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (h.startsWith("[") || h.includes(":") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(h) || SHARED_HOSTS.includes(h)) return null;
  const l = h.split(".").filter(Boolean);
  if (l.length < 2) return null;
  const shared = SHARED_HOSTS.find((sfx) => h.endsWith(`.${sfx}`));
  let i = shared ? l.length - shared.split(".").length - 1 : l.length - 2;
  if (!shared && l.length >= 3 && l[l.length - 1].length === 2 && SECOND_LEVEL.has(l[i])) i--;
  if (i < 0 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(l[i])) return null;
  return { label: l[i], domain: l.slice(i).join(".") };
}

// Job aggregators: a name that is theirs alone matches in any country; a
// common word matches only on the aggregator's own domain.
const AGGREGATOR_LABELS = new Set([
  "indeed", "glassdoor", "ziprecruiter", "simplyhired", "careerbuilder", "jooble", "adzuna", "totaljobs",
  "stepstone", "jobstreet", "naukri", "snagajob", "careerjet", "cv-library", "jobrapido", "welcometothejungle", "wellfound",
  "themuse", "workatastartup",
]);
// Built In's city sites (builtinnyc.com, builtinla.com and the rest).
const BUILT_IN_CITY = /^builtin[a-z]+$/;
const AGGREGATOR_DOMAINS = new Set([
  "monster.com", "monster.co.uk", "monster.ca", "monster.de", "monster.fr", "dice.com", "reed.co.uk", "seek.com.au",
  "seek.co.nz", "talent.com", "lensa.com", "jora.com", "builtin.com", "otta.com", "hiring.cafe",
]);

// Job vendors' own domains: a gh_jid on one names no employer's page to guess from.
const VENDOR_DOMAINS = new Set([
  "myworkdayjobs.com", "myworkdaysite.com", "lever.co", "ashbyhq.com", "smartrecruiters.com", "workable.com",
  "bamboohr.com", "icims.com", "jobvite.com", "recruitee.com", "teamtailor.com", "breezy.hr", "personio.de",
  "personio.com", "pinpointhq.com", "applytojob.com", "jazzhr.com", "successfactors.com", "successfactors.eu",
  "taleo.net", "oraclecloud.com", "ultipro.com", "paylocity.com", "adp.com", "dayforcehcm.com", "rippling.com",
]);

const words = (site: "linkedin" | "aggregator" | "workday" | "other", note: string, suggestedSearch?: SuggestedSearch): JobLinkReading =>
  ({ kind: "words", site, note, ...(suggestedSearch ? { suggestedSearch } : {}) });

/** The longest search a link's words make, as L1 caps an alias. */
const SEARCH_CHARS = 80;

/** Words from a link slug, dashes as spaces: at most twelve of them and SEARCH_CHARS characters. */
function slugWords(s: string): string {
  const all = decode(s).replace(/[-+_]+/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 12);
  let out = "";
  for (const w of all) {
    const next = out ? `${out} ${w}` : w;
    if (next.length > SEARCH_CHARS) return out || Array.from(w).slice(0, SEARCH_CHARS).join("");
    out = next;
  }
  return out;
}

/** A LinkedIn link, answered from its own words and never opened. */
function linkedInWords(u: URL): JobLinkReading {
  const seg = u.pathname.split("/").filter(Boolean).map(decode);
  const v = seg.findIndex((s, i) => s.toLowerCase() === "jobs" && seg[i + 1]?.toLowerCase() === "view");
  // Only /jobs/view/<title>-at-<company>-<number> names a title. A bare
  // number, the off-site Apply link's "externalApply", or anything else names
  // none.
  const raw = v >= 0 ? seg[v + 2] ?? "" : "";
  const num = /-\d+$/.exec(raw);
  const slug = num && /[a-z]/i.test(raw.slice(0, num.index)) ? raw.slice(0, num.index) : "";
  let at = -1;
  for (const m of slug.matchAll(/-at-/gi)) at = m.index ?? at;
  const title = slugWords(at > 0 ? slug.slice(0, at) : slug);
  const company = at > 0 ? slugWords(slug.slice(at + 4)) : "";
  if (!title) {
    return words("linkedin", "This is a LinkedIn link, which is never opened here, and this reader finds no title in it: ask the person for the title and employer, then search.");
  }
  const caution = "LinkedIn posts are often agencies or reposts; check the employer and title before applying.";
  if (!company) {
    return words("linkedin", `This is a LinkedIn link, which is never opened here. suggestedSearch is a search for this title, not this posting, and the link names no employer this reader could find: ask the person for it. ${caution}`, { query: title });
  }
  return words("linkedin", `This is a LinkedIn link, which is never opened here. suggestedSearch is a search for this title at this employer, not this posting; ${caution}`, { query: title, companies: [company] });
}

const WD_JOBS_HOST = /^([a-z0-9][a-z0-9-]*)\.(wd\d{1,3})\.myworkdayjobs\.com$/;
const WD_SITE_HOST = /^(wd\d{1,3})\.myworkdaysite\.com$/;
// en, en-US, zh-Hans-CN.
const WD_LOCALE = /^[a-z]{2,3}(?:-[a-z0-9]{2,4}){0,2}$/i;

/**
 * A Workday posting link as the board forms its id (job-board/normalize.ts
 * normalizeWorkday: workday:<tenant>~<dc>~<site>:<req>, the requisition being
 * what follows the external path's last "_"). The tenant and data centre are
 * lowercased; the site is kept as written. Pages after the posting's own
 * (/apply, /login, /applyManually) are not part of it. `req` is the
 * requisition as the slug writes it, everything after its first "_".
 */
function workdayLink(u: URL, written: string): { id: string; token: string; title: string; req: string | null } | null {
  const seg = writtenPath(written).split("/").filter(Boolean);
  const host = u.hostname.toLowerCase();
  let tenant = "";
  let dc = "";
  let rest: string[] = [];
  const jobsHost = WD_JOBS_HOST.exec(host);
  const siteHost = WD_SITE_HOST.exec(host);
  if (jobsHost) {
    tenant = jobsHost[1];
    dc = jobsHost[2];
    rest = seg;
  } else if (siteHost) {
    // [/<locale>]/recruiting/<tenant>/<site>/...
    const r = seg.findIndex((s) => s.toLowerCase() === "recruiting");
    if (r < 0 || r > 1 || (r === 1 && !WD_LOCALE.test(seg[0])) || !seg[r + 1]) return null;
    tenant = seg[r + 1].toLowerCase();
    dc = siteHost[1];
    rest = seg.slice(r + 2);
  } else {
    return null;
  }
  // [<locale>/]<site>/job/<place>/<slug> or [<locale>/]<site>/details/<slug>
  const kindAt = (i: number) => /^(?:job|details)$/i.test(rest[i] ?? "");
  const k = kindAt(1) ? 0 : kindAt(2) && WD_LOCALE.test(rest[0] ?? "") ? 1 : -1;
  if (k < 0) return null;
  // The posting's own path is the kind, then [<place>/]<slug>: it ends at the
  // slug, the last of those carrying "_" (a place may carry one too; a page
  // after the posting, such as apply or login, carries none). A slug with no
  // "_" keeps the whole path, as normalizeWorkday does.
  const posting = rest.slice(k + 1, k + 1 + (rest[k + 1].toLowerCase() === "job" ? 3 : 2));
  let end = -1;
  for (let i = 1; i < posting.length; i++) if (posting[i].includes("_")) end = i;
  const tail = end > 0 ? posting.slice(0, end + 1) : posting;
  if (tail.length < 2) return null;
  const req = `/${tail.join("/")}`.split("_").pop() ?? "";
  const token = `${tenant}~${dc}~${rest[k]}`;
  const id = `workday:${token}:${req}`;
  if (!req || !isJobIdShape(id)) return null;
  const slug = tail[tail.length - 1];
  const under = slug.indexOf("_");
  return { id, token, title: slugWords(slug.split("_")[0]), req: under >= 0 ? slug.slice(under + 1) : null };
}

/** The requisition a Workday link's slug writes, or null when it is no Workday posting link. */
function workdayReqOf(link: string): string | null {
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return null;
  }
  return workdayLink(u, link)?.req ?? null;
}

/** Greenhouse's own board page for one posting: boards(.eu).greenhouse.io/<token>?gh_jid=<id>. */
function greenhouseBoardPage(u: URL): string | null {
  const host = u.hostname.toLowerCase();
  if (!/(?:^|\.)greenhouse\.io$/.test(host)) return null;
  const seg = u.pathname.split("/").filter(Boolean).map(decode);
  const n = (u.searchParams.get("gh_jid") ?? "").trim();
  if (seg.length !== 1 || seg[0].toLowerCase() === "embed" || !/^\d{1,20}$/.test(n)) return null;
  const eu = /(?:^|\.)eu\.greenhouse\.io$/.test(host) ? "eu~" : "";
  const id = `greenhouse:${eu}${seg[0]}:${n}`;
  return isJobIdShape(id) ? id : null;
}

/** A page off Greenhouse carrying gh_jid=<number>, and the label its domain is registered under. */
function greenhouseOffSite(u: URL): { label: string; n: string } | null {
  const n = (u.searchParams.get("gh_jid") ?? "").trim();
  if (!/^\d{1,20}$/.test(n) || /(?:^|\.)greenhouse\.io$/.test(u.hostname.toLowerCase())) return null;
  const reg = registered(u.hostname);
  return reg && !VENDOR_DOMAINS.has(reg.domain) ? { label: reg.label, n } : null;
}

/** True when an applyUrl names Greenhouse posting n: its gh_jid, or Greenhouse's own page or embed for it. */
function namesGreenhousePosting(applyUrl: string, n: string): boolean {
  let u: URL;
  try {
    u = new URL(applyUrl);
  } catch {
    return false;
  }
  if (u.searchParams.get("gh_jid") === n) return true;
  if (!/(?:^|\.)greenhouse\.io$/.test(u.hostname.toLowerCase())) return false;
  const seg = u.pathname.split("/").filter(Boolean);
  return (seg.length >= 3 && seg[1] === "jobs" && seg[2] === n) || u.searchParams.get("token") === n;
}

/**
 * True when a card the board served proves a reading: the same id and, for a
 * gh_jid candidate, an applyUrl that names the same Greenhouse posting; for a
 * Workday candidate, a Workday applyUrl (when the card has one) whose slug
 * carries the same requisition.
 */
export function jobLinkHeld(reading: JobLinkReading, card: { id?: unknown; applyUrl?: unknown } | null | undefined): boolean {
  if (!card || reading.kind === "words" || String(card.id ?? "") !== reading.id) return false;
  if (reading.kind === "id" || !reading.proof) return true;
  const applyUrl = String(card.applyUrl ?? "");
  if (reading.proof.param === "gh_jid") return namesGreenhousePosting(applyUrl, reading.proof.value);
  const own = workdayReqOf(applyUrl);
  return own === null || own.toLowerCase() === reading.proof.value.toLowerCase();
}

/**
 * What a pasted id or link names: the board's id, a candidate to read once, or
 * an answer in words. Nothing is fetched. `workday` overrides the switch (the
 * measurement reads with it on).
 */
export function parseJobLink(raw: unknown, o: { workday?: boolean } = {}): JobLinkReading {
  const workday = o.workday ?? WORKDAY_LINKS_READ;
  const exact = parseJobId(raw);
  if (exact) return { kind: "id", id: exact };
  let s = String(raw ?? "").trim();
  if (!/^https?:\/\//i.test(s) && /^[a-z0-9-]+(?:\.[a-z0-9-]+)+\.?(?:[/?#]|$)/i.test(s)) s = `https://${s}`;
  let u: URL | null = null;
  if (/^https?:\/\//i.test(s)) {
    try {
      u = new URL(s);
    } catch {
      u = null;
    }
  }
  if (!u) return words("other", `That is not a job id from this board. ${linkKindsThatWork(workday)}`);
  const written = parseJobId(s) ?? greenhouseBoardPage(u);
  if (written) return { kind: "id", id: written };
  const host = u.hostname.toLowerCase();
  const reg = registered(host);
  if (reg?.label === "linkedin" || host === "lnkd.in") return linkedInWords(u);
  if (reg && (AGGREGATOR_LABELS.has(reg.label) || BUILT_IN_CITY.test(reg.label) || AGGREGATOR_DOMAINS.has(reg.domain))) {
    return words("aggregator", `We don't read that site (${host}): ask the person for the title and employer, then search.`);
  }
  const wd = workdayLink(u, s);
  if (wd) {
    const search: SuggestedSearch = { ...(wd.title ? { query: wd.title } : {}), companies: [wd.token] };
    const onSite = "suggestedSearch searches the careers site this link names for its title, which is a search, not this posting; check the employer and title before applying. If the board answers that it does not carry that careers site, search by the employer's name and the title instead.";
    if (!workday) return words("workday", `This Workday link is not read here as a board id, and the board may still carry the posting. ${onSite}`, search);
    return {
      kind: "candidate",
      vendor: "workday",
      id: wd.id,
      ...(wd.req ? { proof: { param: "workdayReq" as const, value: wd.req } } : {}),
      ifNotHeld: {
        note: `No posting the board holds proved to be the one this Workday link names: it may have closed, or be on a careers site the board does not carry or names in other letter case. Search by employer and title instead: ${onSite}`,
        suggestedSearch: search,
      },
    };
  }
  const gh = greenhouseOffSite(u);
  if (gh) {
    const id = `greenhouse:${gh.label}:${gh.n}`;
    if (isJobIdShape(id)) {
      return {
        kind: "candidate",
        vendor: "greenhouse",
        id,
        proof: { param: "gh_jid", value: gh.n },
        ifNotHeld: {
          note: `This link carries Greenhouse posting ${gh.n}, tried under the Greenhouse board named like the link's web address ("${gh.label}"), which is a guess: no card there proved to be this posting, and the board may still carry it under another board name. Search by employer and title instead: suggestedSearch names the employer as the web address does; ask the person for the title.`,
          suggestedSearch: { companies: [gh.label] },
        },
      };
    }
  }
  return words("other", `This kind of link is not read here as a board id, and the board may still carry the posting. ${linkKindsThatWork(workday)} Otherwise ask the person for the title and employer, then search.`);
}
