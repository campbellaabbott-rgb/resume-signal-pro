// JazzHR — vendor #20 (joined 2026-09-04).
//
// EVERY BOARD IS ONE EMPLOYER'S OWN CAREER PAGE at
//   https://{slug}.applytojob.com/apply/
// served by JazzHR (formerly The Resumator — hence the resumator-* ids in the
// markup). Measured 2026-09-04 across eight boards found through Common Crawl
// (CC-MAIN-2026-34, SURT prefix com,applytojob):
//
//   LIST    /apply/               server-rendered HTML, 200 on 8/8. One
//                                 list-group-item per posting carrying the title,
//                                 the posting URL (/apply/{10-char id}/{Title-Slug})
//                                 and two OPTIONAL attributes: location
//                                 (fa-map-marker) and department (fa-sitemap).
//                                 No date, no employment type, no description.
//                                 NOT PAGINATED — a 70-row board renders all 70.
//                                 A JSON-LD Organization names the employer.
//   DETAIL  /apply/{id}/{slug}    200 on 8/8. A schema.org JobPosting JSON-LD on
//                                 5/8 boards (datePosted, validThrough,
//                                 employmentType FULL_TIME/PART_TIME, the full
//                                 HTML description at 5-17k chars, sometimes
//                                 baseSalary), and on EVERY board a
//                                 #job-description container plus a
//                                 job-attributes block (Location / Type /
//                                 Department / Experience). The date lives only
//                                 in the JSON-LD; boards without it are undated.
//   FEEDS   /apply/feed           410
//           /apply/jobs/feed      302 → app.applytojob.com/notfound.html, HTTP 200
//           /apply/?format=json   the same HTML
//                                 There is no keyless JSON, RSS or XML list.
//                                 JazzHR's documented API (api.resumatorapi.com)
//                                 needs a per-employer key, so the employer's
//                                 career page IS the public feed.
//
// So this is an HTML vendor, like rippling and paylocity before it, and a
// DETAIL-description vendor like breezy: the list fills the row and the sweep
// fills the description (and the posting date, which only the detail carries).
//
// TWO HAZARDS THE PROBE PAID FOR, both handled here rather than in index.ts:
//   * A retired or mistyped board redirects to app.applytojob.com/notfound.html,
//     and that page answers 200. Parsed naively it is an empty board, and an
//     empty board prunes every posting the employer had. It is a FAILED fetch.
//   * The list markup mixes quote styles (double quotes on the <li>, single
//     quotes on the <h3>/<ul>/<i>), so every selector below is quote-agnostic
//     and anchored on class names, never on the surrounding tags.
//
// Pure except for the injected fetch, so vitest exercises the parsers against
// captured fixtures (src/test/fixtures/jazzhr-*.html) without booting Deno.

import type { JobSource } from "../sources.ts";
import { categorize } from "../categories.ts";
import { detectWorkMode, normalizeEmploymentType, safeIso, type EmploymentType, type JobPosting } from "../normalize.ts";

/**
 * Per-visit row ceiling. The list is a single unpaginated page, so this is a
 * memory bound, not a resume point: rows past it are dropped for the visit
 * and `windowed` reports the truncation so the closure prune stays off the
 * board. Mirrors MAX_POSTINGS_PER_VISIT in index.ts (pinned equal by test).
 */
export const JAZZHR_MAX_ROWS = 400;

export interface JazzhrListItem {
  /** The 10-character posting key in the URL — stable across title edits. */
  id: string;
  url: string;
  title: string;
  location: string;
  department: string;
}

export interface JazzhrDetail {
  /** Raw HTML of the posting body; the caller runs htmlToText and caps it. */
  description: string | null;
  /** ISO timestamp from the JSON-LD datePosted, null when the board ships none. */
  postedAt: string | null;
  employmentType: EmploymentType | null;
  /** Only when the JSON-LD states TELECOMMUTE — never inferred from prose. */
  workMode: "remote" | null;
}

/** `host` serves a board from the employer's own domain (JazzHR supports it,
 *  e.g. applicant.abba.ph); the token stays the board's identity. */
export function jazzhrHost(s: Pick<JobSource, "token" | "host">): string {
  return s.host ?? `${s.token}.applytojob.com`;
}
export const jazzhrListUrl = (s: Pick<JobSource, "token" | "host">): string => `https://${jazzhrHost(s)}/apply/`;
export const jazzhrPostingUrl = (s: Pick<JobSource, "token" | "host">, externalId: string): string =>
  `https://${jazzhrHost(s)}/apply/${externalId}`;

const unescapeEntities = (s: string): string =>
  s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const clean = (s: string): string => unescapeEntities(s).replace(/\s+/g, " ").trim();
// The same rule normalize.ts applies to every apply URL: http upgrades to
// https (JazzHR emits http:// hrefs on the list), anything else drops the row.
const safeUrl = (u: string): string =>
  /^https:\/\//i.test(u) ? u : /^http:\/\//i.test(u) ? "https://" + u.slice(7) : "";

// One block per posting starts at its heading; the block runs to the next
// heading (or the end), which is where its location/department <li>s sit.
const HEADING = /list-group-item-heading/g;
const ANCHOR = /<a\s[^>]*href=["']([^"']*\/apply\/([A-Za-z0-9]{6,})(?:\/[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/;
const LOCATION = /fa-map-marker['"]?\s*><\/i>\s*([^<]*)/;
const DEPARTMENT = /fa-sitemap['"]?\s*><\/i>\s*([^<]*)/;

/** The postings on a career page, in page order. Pure; tolerant of the
 *  quote mix and of either attribute being absent. */
export function parseJazzhrList(html: string): JazzhrListItem[] {
  const starts: number[] = [];
  for (const m of html.matchAll(HEADING)) starts.push(m.index ?? 0);
  const out: JazzhrListItem[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < starts.length; i++) {
    const block = html.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : undefined);
    const a = ANCHOR.exec(block);
    if (!a) continue;
    const id = a[2];
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      url: a[1],
      title: clean(a[3]),
      location: clean(LOCATION.exec(block)?.[1] ?? ""),
      department: clean(DEPARTMENT.exec(block)?.[1] ?? ""),
    });
  }
  return out;
}

/** The employer as the page names itself: the JSON-LD Organization, else the
 *  "<title>{Name} - Career Page</title>". Used by the census, not by ingest —
 *  the catalog entry is the name the board serves under. */
export function parseJazzhrOrgName(html: string): string | null {
  for (const node of jsonLdNodes(html)) {
    if (node["@type"] === "Organization" && typeof node.name === "string" && node.name.trim()) return clean(node.name);
  }
  const t = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const name = t ? clean(t).replace(/\s*-\s*Career Page\s*$/i, "") : "";
  return name || null;
}

/** True when the body is a JazzHR career page at all — an empty board still
 *  carries its title; the notfound page and a vendor error page do not. */
export function isJazzhrCareerPage(html: string): boolean {
  // Not HEADING: a /g regex's .test() carries lastIndex between calls, so the
  // verdict on one page would depend on the page checked before it.
  return /-\s*Career Page\s*<\/title>/i.test(html) || /list-group-item-heading/.test(html);
}

export function normalizeJazzhr(items: JazzhrListItem[], company: string, token: string): JobPosting[] {
  return (Array.isArray(items) ? items : [])
    .map((it) => {
      const title = it.title ?? "";
      const location = it.location ?? "";
      const dept = it.department || null;
      const workMode = detectWorkMode(location, title);
      return {
        id: `jazzhr:${token}:${it.id}`,
        source: "jazzhr" as const,
        token,
        company,
        title,
        location,
        workMode,
        remote: workMode === "remote",
        department: dept,
        // The list states no date. The detail's datePosted is stamped by the
        // description sweep (fetchVendorDetail returns it); undated until then
        // is honest, like BambooHR.
        postedAt: null,
        category: categorize(title, dept),
        salary: null,
        employmentType: null, // structured on the detail only — same sweep
        applyUrl: safeUrl(it.url ?? ""),
      };
    })
    .filter((j) => j.applyUrl !== "" && j.title !== "" && j.id !== `jazzhr:${token}:`);
}

export type JazzhrFetch = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * One board, one request. Same return shape fetchBoard hands back for every
 * vendor: normalized jobs, the raw envelope the canary counts ({ items }),
 * and honest windowing.
 */
export async function fetchJazzhr(
  s: JobSource,
  get: JazzhrFetch = fetch,
): Promise<{ jobs: JobPosting[]; raw: { items: JazzhrListItem[] }; windowed: boolean; feedTotal: number }> {
  const res = await get(jazzhrListUrl(s), { headers: { Accept: "text/html" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  // A retired board redirects to the vendor's notfound page, which answers
  // 200 — the personio/rippling/paylocity rule: an unrecognized body on a
  // healthy status is a FAILED fetch, never an employer with nothing open.
  let finalHost = "";
  try { finalHost = new URL(res.url).hostname; } catch { /* a fake Response may carry no url */ }
  if (/^app\.applytojob\.com$/i.test(finalHost) || /notfound\.html/i.test(res.url ?? "")) {
    throw new Error("HTTP 404 (board redirected to notfound.html)");
  }
  if (!isJazzhrCareerPage(html)) throw new Error("jazzhr payload shape unrecognized");
  const rows = parseJazzhrList(html);
  const items = rows.slice(0, JAZZHR_MAX_ROWS);
  return {
    jobs: normalizeJazzhr(items, s.name, s.token),
    raw: { items },
    windowed: rows.length > items.length,
    feedTotal: rows.length,
  };
}

// ── detail page ──────────────────────────────────────────────────────────────

function jsonLdNodes(html: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    let parsed: unknown;
    try { parsed = JSON.parse(m[1].trim()); } catch { continue; }
    const nodes = Array.isArray(parsed) ? parsed : [parsed];
    for (const n of nodes) {
      if (n && typeof n === "object") {
        out.push(n as Record<string, unknown>);
        const g = (n as { "@graph"?: unknown })["@graph"];
        if (Array.isArray(g)) for (const x of g) if (x && typeof x === "object") out.push(x as Record<string, unknown>);
      }
    }
  }
  return out;
}

// The description container is followed by the sidebar column on most boards
// and by the footer on the rest; the earliest of these ends the body.
const DESC_START = /id=["']job-description["'][^>]*>/i;
const DESC_END = /<div[^>]*class=["'][^"']*col-xs-5|class=["']page-footer|id=["']job-application|id=["']resumator-mobile-apply-button/i;
const EMPLOYMENT = /resumator-job-employment[^>]*>\s*(?:<i[^>]*><\/i>)?\s*([^<]+)/i;

/** Everything the posting page states that the list did not. */
export function parseJazzhrDetail(html: string): JazzhrDetail {
  const jp = jsonLdNodes(html).find((n) => n["@type"] === "JobPosting");
  let description: string | null = null;
  let postedAt: string | null = null;
  let employmentType: EmploymentType | null = null;
  let workMode: "remote" | null = null;
  if (jp) {
    if (typeof jp.description === "string" && jp.description.trim().length > 0) description = jp.description;
    postedAt = safeIso(jp.datePosted);
    employmentType = normalizeEmploymentType(Array.isArray(jp.employmentType) ? jp.employmentType[0] : jp.employmentType);
    if (String(jp.jobLocationType ?? "").toUpperCase() === "TELECOMMUTE") workMode = "remote";
  }
  if (!description) {
    const start = DESC_START.exec(html);
    if (start) {
      const rest = html.slice((start.index ?? 0) + start[0].length);
      const end = DESC_END.exec(rest);
      const body = (end ? rest.slice(0, end.index) : rest).trim();
      if (body) description = body;
    }
  }
  if (!employmentType) employmentType = normalizeEmploymentType(clean(EMPLOYMENT.exec(html)?.[1] ?? ""));
  return { description, postedAt, employmentType, workMode };
}
