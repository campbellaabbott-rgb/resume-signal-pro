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
// Workday posting link, or an employer's page carrying gh_jid, is a candidate
// read once and believed only when the board holds it (jobLinkHeld). LinkedIn
// and job-aggregator links are answered in words, read from the link's own
// text and never opened. Anything else is answered with the kinds that work.
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
 * live Workday cards back to their own ids at 98% or more in every pasted form
 * (F13); the recorded sample (src/test/fixtures/workday-link-roundtrip-*.json)
 * holds the switch to that. Off, a Workday link is answered in words, with a
 * search for its title on the careers site it names. The first run
 * (2026-11-17) read 240 cards, every form of every one read back to its own
 * id, short of the 300 the gate asks for: off until a run of 300 passes.
 */
export const WORKDAY_LINKS_READ: boolean = false;

/** A search the person's AI may run instead of reading the link: a search, never the posting itself. */
export type SuggestedSearch = { query?: string; companies?: string[] };

/** An answer in words, for a link that names no id the board can be asked about. */
export type JobLinkWords = { note: string; suggestedSearch?: SuggestedSearch };

export type JobLinkReading =
  /** The board's own id, named by the id itself or a link parseJobId reads. */
  | { kind: "id"; id: string }
  /**
   * An id the link probably names. Read it once; it is the posting only when
   * jobLinkHeld says the card proves it, and otherwise the answer is ifNotHeld.
   * A gh_jid candidate needs the card's applyUrl, so an exists answer alone
   * proves only a Workday candidate.
   */
  | { kind: "candidate"; vendor: "workday" | "greenhouse"; id: string; proof?: { param: "gh_jid"; value: string }; ifNotHeld: JobLinkWords }
  /** No id to ask the board about: an answer in words. */
  | ({ kind: "words"; site: "linkedin" | "aggregator" | "workday" | "other" } & JobLinkWords);

/** The kinds of link the reader turns into a posting, for a refusal to list. */
export function linkKindsThatWork(workday: boolean = WORKDAY_LINKS_READ): string {
  return [
    "Links that work: the id from a search card (e.g. greenhouse:acme:12345)",
    "the posting's resumebooster.work link",
    "an employer's Greenhouse, Lever or Ashby posting link",
    ...(workday ? ["a Workday posting link (myworkdayjobs.com or myworkdaysite.com), when the board carries that careers site"] : []),
    "and an employer's own careers page whose link carries gh_jid=<number>, when the board holds that Greenhouse posting.",
  ].join("; ");
}

/** The path of a link as written, before the URL parser encodes it: what normalizeWorkday joined onto its base. */
const writtenPath = (s: string): string => /^https?:\/\/[^/?#]*([^?#]*)/i.exec(s)?.[1] ?? "";

// Second-level labels of two-part public suffixes (example.co.uk, example.com.au).
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "ac", "gov", "edu", "ltd", "plc"]);

/** The label a domain is registered under (careers.stripe.com: stripe; www.example.co.uk: example), with its suffix. */
function registered(host: string): { label: string; domain: string } | null {
  const l = host.toLowerCase().replace(/\.$/, "").split(".").filter(Boolean);
  if (l.length < 2) return null;
  let i = l.length - 2;
  if (l.length >= 3 && l[l.length - 1].length === 2 && SECOND_LEVEL.has(l[i])) i--;
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(l[i])) return null;
  return { label: l[i], domain: l.slice(i).join(".") };
}

// Job aggregators: a name that is theirs alone matches in any country; a
// common word matches only on the aggregator's own domain.
const AGGREGATOR_LABELS = new Set([
  "indeed", "glassdoor", "ziprecruiter", "simplyhired", "careerbuilder", "jooble", "adzuna", "totaljobs",
  "stepstone", "jobstreet", "naukri", "snagajob", "careerjet", "cv-library", "jobrapido", "welcometothejungle", "wellfound",
]);
const AGGREGATOR_DOMAINS = new Set([
  "monster.com", "monster.co.uk", "monster.ca", "monster.de", "monster.fr", "dice.com", "reed.co.uk", "seek.com.au",
  "seek.co.nz", "talent.com", "lensa.com", "jora.com", "builtin.com", "otta.com", "hiring.cafe",
]);

const words = (site: "linkedin" | "aggregator" | "workday" | "other", note: string, suggestedSearch?: SuggestedSearch): JobLinkReading =>
  ({ kind: "words", site, note, ...(suggestedSearch ? { suggestedSearch } : {}) });

/** Words from a link slug, dashes as spaces, at most twelve of them. */
const slugWords = (s: string): string => decode(s).replace(/[-+_]+/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 12).join(" ");

/** A LinkedIn link, answered from its own words and never opened. */
function linkedInWords(u: URL): JobLinkReading {
  const seg = u.pathname.split("/").filter(Boolean).map(decode);
  const v = seg.findIndex((s, i) => s.toLowerCase() === "jobs" && seg[i + 1]?.toLowerCase() === "view");
  // /jobs/view/<title>-at-<company>-<number>; a bare number names nothing.
  const slug = (v >= 0 ? seg[v + 2] ?? "" : "").replace(/-?\d+$/, "");
  const at = slug.lastIndexOf("-at-");
  const title = slugWords(at > 0 ? slug.slice(0, at) : slug);
  const company = at > 0 ? slugWords(slug.slice(at + 4)) : "";
  if (!title) {
    return words("linkedin", "This is a LinkedIn link, which is never opened here, and it names no title or employer: ask the person for the title and employer, then search.");
  }
  const caution = "LinkedIn posts are often agencies or reposts; check the employer and title before applying.";
  if (!company) {
    return words("linkedin", `This is a LinkedIn link, which is never opened here. suggestedSearch is a search for this title, not this posting, and the link names no employer: ask the person for it. ${caution}`, { query: title });
  }
  return words("linkedin", `This is a LinkedIn link, which is never opened here. suggestedSearch is a search for this title at this employer, not this posting; ${caution}`, { query: title, companies: [company] });
}

const WD_JOBS_HOST = /^([a-z0-9][a-z0-9-]*)\.(wd\d{1,3})\.myworkdayjobs\.com$/;
const WD_SITE_HOST = /^(wd\d{1,3})\.myworkdaysite\.com$/;
const WD_LOCALE = /^[a-z]{2,3}(?:-[a-z0-9]{2,4})?$/i;

/**
 * A Workday posting link as the board forms its id (job-board/normalize.ts
 * normalizeWorkday: workday:<tenant>~<dc>~<site>:<req>, the requisition being
 * what follows the external path's last "_"). The tenant and data centre are
 * lowercased; the site is kept as written.
 */
function workdayLink(u: URL, written: string): { id: string; token: string; title: string } | null {
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
  const kindAt = (i: number) => /^(?:job|details)$/.test(rest[i] ?? "");
  const k = kindAt(1) ? 0 : kindAt(2) && WD_LOCALE.test(rest[0] ?? "") ? 1 : -1;
  if (k < 0) return null;
  let tail = rest.slice(k + 1);
  const apply = tail.indexOf("apply", 2);
  if (apply > 0) tail = tail.slice(0, apply);
  if (tail.length < 2) return null;
  const req = `/${tail.join("/")}`.split("_").pop() ?? "";
  const token = `${tenant}~${dc}~${rest[k]}`;
  const id = `workday:${token}:${req}`;
  if (!req || !isJobIdShape(id)) return null;
  return { id, token, title: slugWords(tail[tail.length - 1].split("_")[0]) };
}

/** An employer's own careers page carrying Greenhouse's gh_jid=<number>, and the label its domain is registered under. */
function greenhouseOwnPage(u: URL): { label: string; n: string } | null {
  const n = (u.searchParams.get("gh_jid") ?? "").trim();
  if (!/^\d{1,20}$/.test(n) || /(?:^|\.)greenhouse\.io$/.test(u.hostname.toLowerCase())) return null;
  const reg = registered(u.hostname);
  return reg ? { label: reg.label, n } : null;
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
 * gh_jid candidate, an applyUrl that names the same Greenhouse posting.
 */
export function jobLinkHeld(reading: JobLinkReading, card: { id?: unknown; applyUrl?: unknown } | null | undefined): boolean {
  if (!card || reading.kind === "words" || String(card.id ?? "") !== reading.id) return false;
  return reading.kind === "id" || !reading.proof || namesGreenhousePosting(String(card.applyUrl ?? ""), reading.proof.value);
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
  const written = parseJobId(s);
  if (written) return { kind: "id", id: written };
  const host = u.hostname.toLowerCase();
  const reg = registered(host);
  if (reg?.label === "linkedin" || host === "lnkd.in") return linkedInWords(u);
  if (reg && (AGGREGATOR_LABELS.has(reg.label) || AGGREGATOR_DOMAINS.has(reg.domain))) {
    return words("aggregator", `We don't read that site (${host}): ask the person for the title and employer, then search.`);
  }
  const wd = workdayLink(u, s);
  if (wd) {
    const search: SuggestedSearch = { ...(wd.title ? { query: wd.title } : {}), companies: [wd.token] };
    const onSite = "suggestedSearch searches the careers site this link names for its title, which is a search, not this posting; check the employer and title before applying.";
    if (!workday) return words("workday", `This is a Workday posting link, which the board does not read as a posting yet. ${onSite}`, search);
    return {
      kind: "candidate",
      vendor: "workday",
      id: wd.id,
      ifNotHeld: {
        note: `The board holds no posting at this Workday link: it may have closed, or be on a careers site the board does not carry. Search by employer and title instead: ${onSite}`,
        suggestedSearch: search,
      },
    };
  }
  const gh = greenhouseOwnPage(u);
  if (gh) {
    const id = `greenhouse:${gh.label}:${gh.n}`;
    if (isJobIdShape(id)) {
      return {
        kind: "candidate",
        vendor: "greenhouse",
        id,
        proof: { param: "gh_jid", value: gh.n },
        ifNotHeld: {
          note: `This is the employer's own page for Greenhouse posting ${gh.n}, and the board holds no posting it can show is that one. Search by employer and title instead: suggestedSearch names the employer as the link's domain does; ask the person for the title.`,
          suggestedSearch: { companies: [gh.label] },
        },
      };
    }
  }
  return words("other", `This link names no posting this board can look up. ${linkKindsThatWork(workday)} Otherwise ask the person for the title and employer, then search.`);
}
