import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  JAZZHR_MAX_ROWS,
  fetchJazzhr,
  isJazzhrCareerPage,
  jazzhrListUrl,
  jazzhrPostingUrl,
  normalizeJazzhr,
  parseJazzhrDetail,
  parseJazzhrList,
  parseJazzhrOrgName,
} from "../../supabase/functions/job-board/vendors/jazzhr";
import { htmlToText } from "../../supabase/functions/job-board/normalize";
import { BOARD_DESC_SOURCES, DETAIL_DESC_SOURCES } from "../../supabase/functions/job-board/descriptions";
import { BOARD_VENDORS } from "../../supabase/functions/job-board/filters";
import { CANARIES, rawItemCount } from "../../supabase/functions/job-board/vendor-canary";
import { ATS_VENDORS, BOARD_SOURCE_LIST, UNMEASURED_ATS_SOURCES } from "../config/ats-vendors";

/**
 * JAZZHR JOINED AS THE TWENTIETH VENDOR, AND ITS PUBLIC FEED IS A WEB PAGE.
 *
 * Every JazzHR board is one employer's own career page at
 * {slug}.applytojob.com/apply/. Probed 2026-09-04 across eight boards found
 * through Common Crawl: the list is server-rendered HTML (title, posting URL,
 * optional location and department — no date, no type, no description, no
 * pagination even at 70 rows); the posting page carries the rest, as a
 * schema.org JobPosting JSON-LD on five of eight boards and a #job-description
 * container on all eight; and every feed guess is dead (/apply/feed 410,
 * /apply/jobs/feed → notfound.html served at HTTP 200, ?format=json → the
 * same HTML). Everything below runs against trimmed captures of those pages.
 *
 * The vendor re-runs two traps older vendors already paid for: a 200 whose
 * body is the vendor's notfound page must be a FAILED fetch and never an empty
 * board (or the prune deletes a live employer), and a single unpaginated page
 * still needs the shared per-visit ceiling, reported honestly as windowed.
 */

const root = resolve(__dirname, "../..");
const fx = (f: string) => readFileSync(resolve(__dirname, "fixtures", f), "utf8");
// Comments are stripped before any structural pin — a hazard well documented
// in a comment has falsified spelling-pinned guards in this repo four times.
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const FN = codeOnly(readFileSync(resolve(root, "supabase/functions/job-board/index.ts"), "utf8"));
const SOURCES = codeOnly(readFileSync(resolve(root, "supabase/functions/job-board/sources.ts"), "utf8"));

const TOKEN = "addictionrecoverycare";
const SRC = { name: "Addiction Recovery Care", source: "jazzhr" as const, token: TOKEN };
const page = (body: string, url = `https://${TOKEN}.applytojob.com/apply/`, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, url, text: async () => body }) as unknown as Response;
const fetching = (res: Response) => async () => res;

describe("a career page with no feed behind it", () => {
  it("reads the live rows: the URL key is the id, then title, location, department", () => {
    const rows = parseJazzhrList(fx("jazzhr-list.html"));
    expect(rows.map((r) => r.id)).toEqual(["sf4i9HFuTa", "WbdogO3ePy", "Tg23QkBXzM", "7vqozGIHcS"]);
    expect(rows[0].title).toBe("Admissions Clerk");
    expect(rows[0].url).toMatch(/^https?:\/\/addictionrecoverycare\.applytojob\.com\/apply\/sf4i9HFuTa\/Admissions-Clerk$/);
    expect(rows[0].location).toBe("St. Catharine, KY");
    expect(rows[0].department).toBe("Crown Recovery Center");
    // Two rows share a title on the live board — identity is the URL key,
    // never the title, so both survive.
    expect(rows[1].title).toBe(rows[2].title);
    expect(rows[1].id).not.toBe(rows[2].id);
    expect(rows[3]).toMatchObject({ title: "Benefits Verification Clerk", location: "St. Catharine, KY", department: "Operations" });
  });

  it("names the employer from the page's own JSON-LD, not from the slug", () => {
    expect(parseJazzhrOrgName(fx("jazzhr-list.html"))).toBe("Addiction Recovery Care");
    // The title tag is the fallback, minus the vendor's suffix.
    expect(parseJazzhrOrgName("<html><head><title>A. Duda &amp; Sons Inc. - Career Page</title></head></html>")).toBe("A. Duda & Sons Inc.");
    expect(parseJazzhrOrgName("<html></html>")).toBeNull();
  });

  it("normalizes to stable ids and an https apply link, and invents nothing", () => {
    const jobs = normalizeJazzhr(parseJazzhrList(fx("jazzhr-list.html")), SRC.name, TOKEN);
    expect(jobs).toHaveLength(4);
    const j = jobs[0];
    expect(j.id).toBe(`jazzhr:${TOKEN}:sf4i9HFuTa`);
    expect(j.source).toBe("jazzhr");
    expect(j.token).toBe(TOKEN);
    expect(j.company).toBe("Addiction Recovery Care");
    expect(j.applyUrl).toMatch(/^https:\/\//);
    expect(j.location).toBe("St. Catharine, KY");
    expect(j.department).toBe("Crown Recovery Center");
    // The list states none of these; the sweep fills date and description
    // from the posting page. Undated and untyped until then is honest.
    expect(j.postedAt).toBeNull();
    expect(j.employmentType).toBeNull();
    expect(j.salary).toBeNull();
    expect(j.workMode).toBeNull();
    expect(j.remote).toBe(false);
    expect(typeof j.category).toBe("string");
  });

  it("upgrades an http href, drops a row with no title or no usable link, reads remote from explicit text only", () => {
    const jobs = normalizeJazzhr([
      { id: "AAAAAAAAAA", url: "http://x.applytojob.com/apply/AAAAAAAAAA/Role", title: "Remote Analyst", location: "Remote", department: "" },
      { id: "BBBBBBBBBB", url: "https://x.applytojob.com/apply/BBBBBBBBBB/Role", title: "", location: "", department: "" },
      { id: "CCCCCCCCCC", url: "javascript:void(0)", title: "Bad Link", location: "", department: "" },
    ], "X", "x");
    expect(jobs.map((j) => j.id)).toEqual(["jazzhr:x:AAAAAAAAAA"]);
    expect(jobs[0].applyUrl).toBe("https://x.applytojob.com/apply/AAAAAAAAAA/Role");
    expect(jobs[0].workMode).toBe("remote");
    expect(jobs[0].remote).toBe(true);
    expect(jobs[0].department).toBeNull();
  });

  it("an empty board is empty; a retired board is a FAILED fetch, never an empty one", async () => {
    const empty = await fetchJazzhr(SRC, fetching(page(fx("jazzhr-list-empty.html"))));
    expect(empty.jobs).toEqual([]);
    expect(empty.feedTotal).toBe(0);
    expect(empty.windowed).toBe(false);
    expect(empty.raw).toEqual({ items: [] });
    // The vendor answers a dead slug with a 302 to app.applytojob.com/notfound.html
    // — and that page is HTTP 200. Parsed naively it reads as "no openings"
    // and the closure prune deletes everything the employer had.
    await expect(fetchJazzhr(SRC, fetching(page(fx("jazzhr-notfound.html"), "http://app.applytojob.com/notfound.html"))))
      .rejects.toThrow(/HTTP 404/);
    expect(isJazzhrCareerPage(fx("jazzhr-notfound.html"))).toBe(false);
    // A 200 that is not a career page at all (a maintenance interstitial, a
    // reshaped template) is the personio/rippling/paylocity/adp rule again.
    await expect(fetchJazzhr(SRC, fetching(page("<html><body>Back soon</body></html>"))))
      .rejects.toThrow(/shape unrecognized/);
    await expect(fetchJazzhr(SRC, fetching(page("", undefined, 503)))).rejects.toThrow(/HTTP 503/);
  });

  it("fetches the board's own host and hands back the shared envelope", async () => {
    let asked = "";
    const r = await fetchJazzhr(SRC, async (url) => { asked = url; return page(fx("jazzhr-list.html")); });
    expect(asked).toBe(`https://${TOKEN}.applytojob.com/apply/`);
    expect(jazzhrListUrl({ token: "acme" })).toBe("https://acme.applytojob.com/apply/");
    // `host` serves a board from the employer's own domain, token unchanged.
    expect(jazzhrListUrl({ token: "abba", host: "applicant.abba.ph" })).toBe("https://applicant.abba.ph/apply/");
    expect(jazzhrPostingUrl({ token: "acme" }, "sf4i9HFuTa")).toBe("https://acme.applytojob.com/apply/sf4i9HFuTa");
    expect(r.jobs).toHaveLength(4);
    expect(r.raw.items).toHaveLength(4);
    expect(r.feedTotal).toBe(4);
    expect(r.windowed).toBe(false);
    // The canary counts the same envelope, so "fetched OK, parsed nothing"
    // is visible as raw > 0 with normalized = 0.
    expect(rawItemCount("jazzhr", r.raw)).toBe(4);
  });

  it("caps a visit at the shared ceiling and reports the window honestly", async () => {
    const rows = Array.from({ length: JAZZHR_MAX_ROWS + 1 }, (_, i) => {
      const id = `K${String(i).padStart(9, "0")}`;
      return `<li class="list-group-item"><h3 class='list-group-item-heading'><a href="https://big.applytojob.com/apply/${id}/Role">Role ${i}</a></h3></li>`;
    }).join("\n");
    const html = `<html><head><title>Big - Career Page</title></head><body><ul>${rows}</ul></body></html>`;
    const r = await fetchJazzhr({ ...SRC, token: "big" }, fetching(page(html, "https://big.applytojob.com/apply/")));
    expect(r.jobs).toHaveLength(JAZZHR_MAX_ROWS);
    expect(r.feedTotal).toBe(JAZZHR_MAX_ROWS + 1);
    expect(r.windowed).toBe(true);
    // The ceiling is index.ts's MAX_POSTINGS_PER_VISIT, mirrored here so the
    // adapter needs nothing private from index.ts. Two constants, one value.
    const m = /const MAX_POSTINGS_PER_VISIT = ([\d_]+);/.exec(FN);
    expect(m, "MAX_POSTINGS_PER_VISIT not found in index.ts").toBeTruthy();
    expect(JAZZHR_MAX_ROWS).toBe(Number(m![1].replace(/_/g, "")));
  });

  it("the posting page carries what the list withholds: date, type, description", () => {
    const d = parseJazzhrDetail(fx("jazzhr-detail.html"));
    expect(d.postedAt).toBe("2026-07-31T00:00:00.000Z");
    expect(d.employmentType).toBe("full_time");
    expect(d.workMode).toBeNull(); // no TELECOMMUTE stated — nothing inferred
    expect(d.description).not.toBeNull();
    expect(htmlToText(d.description!)).toMatch(/^Are you looking for the best place to work\?/);
  });

  it("without a JobPosting JSON-LD the container and attributes still answer, and the date is honestly null", () => {
    // aliz: an Organization JSON-LD only — three of the eight probed boards
    // ship no JobPosting node at all.
    const d = parseJazzhrDetail(fx("jazzhr-detail-no-jsonld.html"));
    expect(d.postedAt).toBeNull();
    expect(d.employmentType).toBe("full_time"); // the attributes block's "Full Time"
    expect(d.description).not.toBeNull();
    expect(htmlToText(d.description!)).toMatch(/^Aliz is conquering the world/);
    expect(d.description).not.toMatch(/page-footer/);
  });

  it("TELECOMMUTE is the one structured work mode the vendor states, and an array-valued type is read", () => {
    const ld = { "@context": "https://schema.org", "@type": "JobPosting", title: "Analyst", description: "<p>Body text long enough to count as a description.</p>", datePosted: "2026-09-01", employmentType: ["PART_TIME"], jobLocationType: "TELECOMMUTE" };
    const html = `<html><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body></body></html>`;
    const d = parseJazzhrDetail(html);
    expect(d.workMode).toBe("remote");
    expect(d.employmentType).toBe("part_time");
    expect(d.postedAt).toBe("2026-09-01T00:00:00.000Z");
    expect(parseJazzhrDetail("<html><body>nothing</body></html>")).toEqual({ description: null, postedAt: null, employmentType: null, workMode: null });
  });

  it("is wired: dispatch, the detail branch, the description lane, the vendor lists, the label", () => {
    expect(FN).toMatch(/if \(s\.source === "jazzhr"\) \{/);
    expect(FN).toMatch(/await fetchJazzhr\(s, fetchWithTimeout\)/);
    expect(FN).toMatch(/else if \(src\.source === "jazzhr"\) \{/);
    expect(FN).toMatch(/parseJazzhrDetail\(await res\.text\(\)\)/);
    // The date the list never had reaches the row through the sweep.
    expect(FN).toMatch(/postedAt = d\.postedAt;/);
    expect(FN).toMatch(/workMode = d\.workMode;/);
    // Detail-description vendor, appended last; never a list-payload vendor.
    expect(DETAIL_DESC_SOURCES[DETAIL_DESC_SOURCES.length - 1]).toBe("jazzhr");
    expect([...BOARD_DESC_SOURCES]).not.toContain("jazzhr");
    expect(BOARD_VENDORS).toContain("jazzhr");
    expect(SOURCES).toMatch(/\| "jazzhr"/);
    // Unmeasured, so no tier: the board serves it, the agent claims nothing.
    expect(UNMEASURED_ATS_SOURCES.map((v) => v.key)).toContain("jazzhr");
    expect(ATS_VENDORS.map((v) => v.key)).not.toContain("jazzhr");
    expect(BOARD_SOURCE_LIST).toContain("JazzHR");
    const automation = codeOnly(readFileSync(resolve(root, "supabase/functions/_shared/apply-automation.ts"), "utf8"));
    expect(automation, "an unmeasured vendor must not carry a tier").not.toMatch(/\bjazzhr:\s*\{\s*tier:/);
  });

  it("ships two canaries that are catalogue boards, and a first tranche of verified employers", () => {
    const canaries = CANARIES.filter((c) => c.vendor === "jazzhr");
    expect(canaries).toHaveLength(2);
    const entries = [...SOURCES.matchAll(/s\("((?:[^"\\]|\\.)*)",\s*"jazzhr",\s*"([^"]+)"\)/g)].map((m) => ({ name: m[1], token: m[2] }));
    expect(entries.length).toBeGreaterThanOrEqual(25);
    const tokens = new Set(entries.map((e) => e.token));
    expect(tokens.size, "duplicate jazzhr token").toBe(entries.length);
    for (const c of canaries) expect(tokens.has(c.token), `canary ${c.token} must be a catalogue board`).toBe(true);
    for (const e of entries) {
      // The vendor's internal customer-id alias of a board is not an identity.
      expect(e.token).not.toMatch(/^\d{14}_[a-z0-9]{16}$/);
      expect(e.token).toMatch(/^[a-z0-9][a-z0-9-]{1,60}$/);
      expect(e.name).not.toMatch(/Career Page/i);
      expect(e.name.trim().length).toBeGreaterThan(1);
    }
  });

  it("the census screens boards with the catalog's own staffing vocabulary, same spelling", () => {
    const census = readFileSync(resolve(root, "scripts/census-jazzhr.mjs"), "utf8");
    const tag = readFileSync(resolve(root, "scripts/tag-agencies.mjs"), "utf8");
    const rx = (s: string) => /const AGENCY_NAME = (\/.*\/i);/.exec(s)?.[1];
    expect(rx(census), "census-jazzhr.mjs has no AGENCY_NAME").toBeTruthy();
    expect(rx(census)).toBe(rx(tag));
    // And it never re-probes what the catalog already carries.
    expect(census).toMatch(/"jazzhr",\\s\*"\(\[\^"\]\+\)"/);
  });
});
