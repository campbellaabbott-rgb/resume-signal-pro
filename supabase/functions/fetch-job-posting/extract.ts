/**
 * WHAT A POSTING SAYS, AS PLAIN TEXT (sweep S11-032, owner decision
 * 2026-10-11): the schema.org JobPosting a page carries for search engines,
 * or the vendor's own public API for the posting, whichever the vendor
 * offers. Nothing else on a page is read: no navigation, no cookie banner,
 * no "similar jobs".
 *
 * Measured 2026-10-11 against one live posting per vendor the board reads
 * (one GET each): Ashby, Breezy, Lever, Paylocity, Personio, Pinpoint,
 * Recruitee, Teamtailor and Workday pages carry a JobPosting; Greenhouse,
 * SmartRecruiters, BambooHR, Rippling, Oracle, ADP and UKG pages do not, and
 * their public APIs (the ones the board already reads) carry the text. A
 * Recruitee posting link redirects to the employer's own domain, which the
 * host list refuses, so Recruitee is read through its API. iCIMS, Workable,
 * JazzHR and USAJOBS pages are tried for a JobPosting; where there is none
 * the person is asked to paste the text.
 *
 * Pure, so vitest runs every parser on captured shapes.
 */

export interface Posting {
  title: string | null;
  company: string | null;
  /** The description as plain text, paragraphs on their own lines. */
  text: string;
}

/** Shorter than this is a teaser, not a job description. */
export const MIN_DESCRIPTION_CHARS = 200;
/** The most text handed back; the scan reads less than this. */
export const MAX_DESCRIPTION_CHARS = 20_000;

const NAMED: Readonly<Record<string, string>> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", rsquo: "’", lsquo: "‘",
  rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", hellip: "…", bull: "•",
  middot: "·", eacute: "é", egrave: "è", agrave: "à", uuml: "ü", ouml: "ö",
  auml: "ä", szlig: "ß", ccedil: "ç", ntilde: "ñ", euro: "€", pound: "£",
};

function unescapeOnce(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ent: string) => {
    if (ent[0] === "#") {
      const n = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return NAMED[ent.toLowerCase()] ?? whole;
  });
}

// EVERY SCAN HERE IS ONE PASS (review of S11-032). A lazy [\s\S]*? run from
// each of N unclosed openers reads to the end of the page N times: 560 KB of
// unclosed ld+json script tags took 2.9 s, and the 3 MB cap let in pages worth
// about 80 s of CPU on a host an employer controls. Blocks are found with
// indexOf, and a tag pattern never runs across another "<".

/**
 * Script, style, noscript and template bodies and comments, dropped in one
 * pass. An unclosed one runs to the end of the page, as a browser reads it.
 */
function dropBlocks(s: string): string {
  const lower = s.toLowerCase();
  const opener = /<(script|style|noscript|template)\b|<!--/g;
  let out = "";
  let at = 0;
  for (;;) {
    opener.lastIndex = at;
    const m = opener.exec(lower);
    if (!m) return out + s.slice(at);
    out += `${s.slice(at, m.index)} `;
    const end = lower.indexOf(m[1] ? `</${m[1]}` : "-->", m.index + m[0].length);
    if (end < 0) return out;
    if (!m[1]) { at = end + 3; continue; }
    const gt = lower.indexOf(">", end);
    if (gt < 0) return out;
    at = gt + 1;
  }
}

/**
 * HTML (or HTML escaped once more, as Greenhouse's API sends it) to plain
 * text: block ends and list items become line breaks, every tag goes, spaces
 * collapse. Script and style bodies are dropped, never read as text.
 */
export function htmlToText(html: string): string {
  let s = html || "";
  // Escaped markup (&lt;p&gt;) is unescaped first so its tags are seen as tags.
  if (/&lt;\/?[a-z]/i.test(s)) s = unescapeOnce(s);
  s = dropBlocks(s)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^<>]*>/gi, "\n• ")
    .replace(/<\/(p|div|li|ul|ol|h[1-6]|tr|section|article|blockquote)\s*>/gi, "\n")
    .replace(/<[^<>]+>/g, " ");
  s = unescapeOnce(s);
  return s
    .replace(/\r/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const clip = (t: string): string => (t.length > MAX_DESCRIPTION_CHARS ? `${t.slice(0, MAX_DESCRIPTION_CHARS).trimEnd()}…` : t);

function posting(title: unknown, company: unknown, html: string): Posting | null {
  const text = htmlToText(html);
  if (text.length < MIN_DESCRIPTION_CHARS) return null;
  const str = (x: unknown) => (typeof x === "string" && x.trim() ? htmlToText(x).slice(0, 300) : null);
  return { title: str(title), company: str(company), text: clip(text) };
}

const isJobPosting = (t: unknown): boolean =>
  t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"));

/** Every object node in a parsed ld+json value: arrays, @graph and one level of nesting. */
function nodes(v: unknown, out: Array<Record<string, unknown>> = [], depth = 0): Array<Record<string, unknown>> {
  if (depth > 4 || v === null || typeof v !== "object") return out;
  if (Array.isArray(v)) { for (const x of v) nodes(x, out, depth + 1); return out; }
  const o = v as Record<string, unknown>;
  out.push(o);
  if (Array.isArray(o["@graph"])) nodes(o["@graph"], out, depth + 1);
  return out;
}

/** Each ld+json script body on a page, in order, found in one pass. */
function ldJsonBodies(html: string): string[] {
  const lower = html.toLowerCase();
  const out: string[] = [];
  let at = 0;
  for (;;) {
    const open = lower.indexOf("<script", at);
    if (open < 0) return out;
    const gt = lower.indexOf(">", open);
    if (gt < 0) return out;
    const close = lower.indexOf("</script", gt);
    if (close < 0) return out;
    // S12-038: USAJOBS writes the plus as an entity, type="application/ld&#x2B;json".
    if (/type\s*=\s*["']?application\/ld(?:\+|&#x0*2b;|&#0*43;|&plus;)json/.test(lower.slice(open, gt))) out.push(html.slice(gt + 1, close));
    at = close + 8;
  }
}

/** The page's schema.org JobPosting, read as a search engine reads it; null when it has none. */
export function jobPostingFromHtml(html: string): Posting | null {
  for (const body of ldJsonBodies(html || "")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.trim().replace(/^<!\[CDATA\[|\]\]>$/g, ""));
    } catch {
      continue;
    }
    for (const n of nodes(parsed)) {
      if (!isJobPosting(n["@type"]) || typeof n.description !== "string") continue;
      const org = n.hiringOrganization as { name?: unknown } | string | undefined;
      const company = typeof org === "string" ? org : org?.name;
      const p = posting(n.title, company, n.description);
      if (p) return p;
    }
  }
  return null;
}

// ── vendor APIs ──────────────────────────────────────────────────────────────

/** A posting's public API URL and how to read it. */
export interface ApiPlan {
  url: string;
  read: (body: string) => Posting | null;
}

const json = (body: string): Record<string, unknown> | null => {
  try {
    const v = JSON.parse(body);
    return v && typeof v === "object" ? v as Record<string, unknown> : null;
  } catch {
    return null;
  }
};
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const join = (...parts: unknown[]): string => parts.map(str).filter(Boolean).join("\n");
const seg = (u: URL): string[] => u.pathname.split("/").filter(Boolean).map((s) => {
  try { return decodeURIComponent(s); } catch { return s; }
});
const SAFE = /^[A-Za-z0-9._~-]{1,200}$/;

/**
 * The vendor API that serves this posting's text, derived from the posting
 * link; null when the vendor has none (its page is read instead).
 */
export function apiPlanFor(u: URL, vendor: string): ApiPlan | null {
  const host = u.hostname.toLowerCase();
  const p = seg(u);
  if (vendor === "greenhouse") {
    // boards|job-boards[.eu].greenhouse.io/{token}/jobs/{id}, or the embed form ?for={token}&token={id}.
    let token = "", id = "";
    if (p[0] === "embed") { token = u.searchParams.get("for") ?? ""; id = u.searchParams.get("token") ?? ""; }
    else if (p[1] === "jobs") { token = p[0] ?? ""; id = p[2] ?? ""; }
    if (!SAFE.test(token) || !/^\d{1,20}$/.test(id)) return null;
    const api = host.includes(".eu.") ? "boards.eu.greenhouse.io" : "boards-api.greenhouse.io";
    return {
      url: `https://${api}/v1/boards/${encodeURIComponent(token)}/jobs/${id}?questions=false`,
      read: (b) => { const j = json(b); return j ? posting(j.title, j.company_name, str(j.content)) : null; },
    };
  }
  if (vendor === "lever") {
    // jobs[.eu].lever.co/{token}/{uuid}[/apply]
    const [token, id] = p;
    if (!SAFE.test(token ?? "") || !/^[0-9a-f-]{36}$/i.test(id ?? "")) return null;
    const api = host.includes(".eu.") ? "api.eu.lever.co" : "api.lever.co";
    return {
      url: `https://${api}/v0/postings/${encodeURIComponent(token)}/${id}?mode=json`,
      read: (b) => {
        const j = json(b);
        if (!j) return null;
        const lists = Array.isArray(j.lists)
          ? (j.lists as Array<{ text?: unknown; content?: unknown }>).map((l) => `<h3>${str(l.text)}</h3><ul>${str(l.content)}</ul>`).join("")
          : "";
        const desc = str(j.description) || str(j.descriptionPlain).replace(/\n/g, "<br>");
        return posting(j.text, null, `${desc}${lists}${str(j.additional) || str(j.additionalPlain).replace(/\n/g, "<br>")}`);
      },
    };
  }
  if (vendor === "smartrecruiters") {
    // jobs.smartrecruiters.com/{company}/{id}[-slug]
    const company = p[0] ?? "";
    const id = /^(\d{6,20})/.exec(p[1] ?? "")?.[1] ?? "";
    if (host === "api.smartrecruiters.com" || !SAFE.test(company) || !id) return null;
    return {
      url: `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings/${id}`,
      read: (b) => {
        const j = json(b);
        const s = ((j?.jobAd as { sections?: Record<string, { text?: unknown }> } | undefined)?.sections) ?? {};
        return j ? posting(j.name, (j.company as { name?: unknown } | undefined)?.name, join(s.jobDescription?.text, s.qualifications?.text, s.additionalInformation?.text)) : null;
      },
    };
  }
  if (vendor === "bamboohr") {
    // {t}.bamboohr.com/careers/{id}, or the older /jobs/view.php?id={id}
    const id = p[0] === "careers" ? p[1] ?? "" : u.searchParams.get("id") ?? "";
    if (!/^\d{1,10}$/.test(id)) return null;
    return {
      url: `https://${host}/careers/${id}/detail`,
      read: (b) => {
        const o = ((json(b)?.result as { jobOpening?: Record<string, unknown> } | undefined)?.jobOpening) ?? null;
        return o ? posting(o.jobOpeningName, null, str(o.description)) : null;
      },
    };
  }
  if (vendor === "rippling") {
    // ats.rippling.com/{token}/jobs/{uuid}
    const [token, jobs, id] = p;
    if (host !== "ats.rippling.com" || jobs !== "jobs" || !SAFE.test(token ?? "") || !/^[0-9a-f-]{36}$/i.test(id ?? "")) return null;
    return {
      url: `https://api.rippling.com/platform/api/ats/v1/board/${encodeURIComponent(token)}/jobs/${id}`,
      read: (b) => {
        const j = json(b);
        const d = (j?.description ?? {}) as { role?: unknown; company?: unknown };
        return j ? posting(j.name, null, join(d.role, d.company)) : null;
      },
    };
  }
  if (vendor === "recruitee") {
    // {t}.recruitee.com/o/{slug}: the link itself redirects to the employer's domain.
    const slug = p[0] === "o" ? p[1] ?? "" : "";
    if (!SAFE.test(slug)) return null;
    return {
      url: `https://${host}/api/offers/${encodeURIComponent(slug)}`,
      read: (b) => {
        const j = json(b);
        const o = ((j?.offer ?? j) ?? null) as Record<string, unknown> | null;
        return o ? posting(o.title, o.company_name, join(o.description, o.requirements)) : null;
      },
    };
  }
  if (vendor === "workday") {
    // {tenant}.wd{n}.myworkdayjobs.com/[{locale}/]{site}/job/{...path}, and
    // (S12-028) the two shapes an address bar shows: /{site}/details/{slug}
    // and wd{n}.myworkdaysite.com/[{locale}/]recruiting/{tenant}/{site}/....
    // CXS reads a job by its slug alone (/job/{slug}, measured 2026-10-12 on
    // CVS Health: the same 12,230-byte posting as /job/{place}/{slug}).
    const m = /^([a-z0-9][a-z0-9-]*)\.(wd\d+)\.myworkdayjobs\.com$/.exec(host);
    const site = /^(wd\d+)\.myworkdaysite\.com$/.exec(host);
    const pm = m
      ? /^\/(?:[a-z]{2}-[a-z]{2}\/)?([^/?#]+)\/(job|details)(\/[^?#]+)$/i.exec(u.pathname)
      : site ? /^\/(?:[a-z]{2}-[a-z]{2}\/)?recruiting\/([a-z0-9][a-z0-9-]*)\/([^/?#]+)\/(job|details)(\/[^?#]+)$/i.exec(u.pathname) : null;
    if (!pm) return null;
    const [tenant, board, kind, rest] = m ? [m[1], pm[1], pm[2], pm[3]] : [pm[1], pm[2], pm[3], pm[4]];
    const path = kind.toLowerCase() === "details" ? `/job/${rest.split("/").filter(Boolean).pop() ?? ""}` : `/job${rest}`;
    if (!SAFE.test(tenant) || path === "/job/") return null;
    return {
      url: `https://${host}/wday/cxs/${tenant}/${board}${path}`,
      read: (b) => {
        const i = (json(b)?.jobPostingInfo ?? null) as Record<string, unknown> | null;
        return i ? posting(i.title, null, str(i.jobDescription)) : null;
      },
    };
  }
  if (vendor === "oracle") {
    // {tenant}.fa.{region}.oraclecloud.com/hcmUI/CandidateExperience/{lang}/sites/{site}/job/{id}
    // S12-028: and .../sites/{site}/requisitions/preview/{id}, the link a preview shows.
    const si = p.indexOf("sites");
    const site = si >= 0 ? p[si + 1] ?? "" : "";
    const id = si < 0 ? "" : p[si + 2] === "job" ? p[si + 3] ?? ""
      : p[si + 2] === "requisitions" && p[si + 3] === "preview" ? p[si + 4] ?? "" : "";
    if (!SAFE.test(site) || !/^\d{1,15}$/.test(id)) return null;
    const finder = `ById;Id="${id}",siteNumber=${site}`;
    return {
      url: `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=${encodeURIComponent(finder)}`,
      read: (b) => {
        const it = ((json(b)?.items as Array<Record<string, unknown>> | undefined) ?? [])[0];
        return it ? posting(it.Title, null, join(it.ExternalDescriptionStr, it.ExternalResponsibilitiesStr, it.ExternalQualificationsStr)) : null;
      },
    };
  }
  if (vendor === "workable") {
    // S12-038: apply.workable.com/{account}/j/{shortcode}; the account-less
    // /j/{shortcode} redirects to it, and readPosting plans again from there.
    const at = p.indexOf("j");
    const account = at === 1 ? p[0] : "";
    const code = at === 1 ? p[2] ?? "" : "";
    if (host !== "apply.workable.com" || !SAFE.test(account) || !/^[A-Z0-9]{6,20}$/i.test(code)) return null;
    return {
      url: `https://apply.workable.com/api/v2/accounts/${encodeURIComponent(account)}/jobs/${code}`,
      read: (b) => { const j = json(b); return j ? posting(j.title, null, join(j.description, j.requirements, j.benefits)) : null; },
    };
  }
  if (vendor === "adp") {
    // workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=&ccId=&jobId=
    const cid = u.searchParams.get("cid") ?? "";
    const ccId = u.searchParams.get("ccId") ?? "";
    const jobId = u.searchParams.get("jobId") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(cid) || !/^[\w-]{1,40}$/.test(ccId) || !/^\d{1,15}$/.test(jobId)) return null;
    return {
      url: `https://workforcenow.adp.com/mascsr/default/careercenter/public/events/staffing/v1/job-requisitions/${jobId}?cid=${cid}&ccId=${encodeURIComponent(ccId)}&lang=en_US&locale=en_US`,
      read: (b) => { const j = json(b); return j ? posting(j.requisitionTitle, null, str(j.requisitionDescription)) : null; },
    };
  }
  return null;
}

/**
 * S12-028: VENDORS WHOSE PAGES CARRY NO POSTING TEXT (measured 2026-10-11, the
 * header above): their API is the only way to the description. A link of one
 * of these vendors that names no API plan cannot be read, so it is answered
 * before the meters are charged.
 */
export const API_ONLY_VENDORS: ReadonlySet<string> = new Set(["greenhouse", "smartrecruiters", "bamboohr", "rippling", "oracle", "adp"]);
export function unreadableShape(u: URL, vendor: string): boolean {
  return API_ONLY_VENDORS.has(vendor) && apiPlanFor(u, vendor) === null;
}

/**
 * Vendor pages that state the posting in their own markup instead of a
 * JobPosting: UKG embeds the opportunity as a script argument, JazzHR wraps
 * the description in #job-description.
 */
export function vendorPageText(html: string, vendor: string): Posting | null {
  if (vendor === "ukg") {
    const page = html || "";
    const at = page.indexOf("CandidateOpportunityDetail({");
    const end = at < 0 ? -1 : page.indexOf("});", at);
    const j = end < 0 ? null : json(page.slice(at + "CandidateOpportunityDetail(".length, end + 1));
    return j ? posting(j.Title, null, str(j.Description)) : null;
  }
  if (vendor === "jazzhr") {
    const start = /id=["']job-description["'][^<>]*>/i.exec(html || "");
    if (!start) return null;
    const rest = html.slice((start.index ?? 0) + start[0].length);
    const end = /<div[^<>]*class=["'][^"']*col-xs-5|class=["']page-footer|id=["']job-application|id=["']resumator-mobile-apply-button/i.exec(rest);
    // The page title reads "<role> - <employer> - Career Page".
    const head = (/<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? "").split(" - ");
    return posting(head[0] || null, head.length > 2 ? head[1] : null, end ? rest.slice(0, end.index) : rest.slice(0, 200_000));
  }
  return null;
}
