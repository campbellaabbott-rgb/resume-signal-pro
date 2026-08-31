import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractPaylocityPageData, normalizePaylocity } from "../../supabase/functions/job-board/normalize";

/**
 * PAYLOCITY JOINED AS THE SEVENTEENTH VENDOR, AND ITS FEED IS A WEB PAGE.
 *
 * The board page embeds the full job list as first-party JSON — the same
 * class of channel as Rippling's, and carrying the same trap the personio and
 * rippling incidents already paid for once each: a page that fetches HTTP 200
 * but holds no parseable payload (a bot-wall, a redesign, a detail page) must
 * read as a FAILED fetch, never as an empty board. Failure skips the prune;
 * "empty" runs it — reading the shell as zero would delete a live employer's
 * postings while their board serves them.
 *
 * Shapes below are live-captured 2026-08-30 from three public boards
 * (24 + 21 + 17 postings; Wendy's franchise, a Howard Lake processing plant,
 * RDTS) plus one employer with nothing open. The whole list arrives in one
 * payload — no pagination — so a successful read is a full read.
 */

const root = resolve(__dirname, "../..");
// Comments are stripped before any structural pin, so a guard can only be
// satisfied by code that runs — a hazard well documented in a comment has
// falsified spelling-pinned guards in this repo four times.
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const FN = codeOnly(readFileSync(resolve(root, "supabase/functions/job-board/index.ts"), "utf8"));
const NORM = codeOnly(readFileSync(resolve(root, "supabase/functions/job-board/normalize.ts"), "utf8"));

const wrap = (pageData: unknown) =>
  `<html><head><script>\n    window.pageData = ${JSON.stringify(pageData)};\n  </script></head><body></body></html>`;

// A live-captured list item, verbatim but for the truncated Description the
// adapter deliberately ignores.
const WENDYS_ITEM = {
  JobId: 1966162,
  JobTitle: "Shift Manager",
  LocationName: "301 SOUTH WHITE SANDS ALAMOGORDO, NM",
  ShouldDisplayLocation: true,
  PublishedDate: "2026-08-28T07:19:01-05:00",
  IsInternal: false,
  HiringDepartment: null,
  JobLocation: { City: "ALAMOGORDO", State: "NM", Zip: "88310", Country: "USA" },
  IsRemote: false,
  IndeedRemoteType: 2,
};

describe("an HTML shell must not zero a board", () => {
  it("extracts the embedded list through the tolerant assignment regex", () => {
    const out = extractPaylocityPageData(wrap({ ModuleTitle: "ALL JOBS", Jobs: [WENDYS_ITEM] }));
    expect(out, "a healthy board page must parse").not.toBeNull();
    expect(out!.items).toHaveLength(1);
    expect(out!.moduleTitle, "the board's self-name rides along for census tooling").toBe("ALL JOBS");
  });

  it("the extractor's regex targets the page-global assignment, escaped, in code", () => {
    // The structural half of the pin above: the escaped spelling can only
    // appear inside a regex literal, so this cannot be satisfied by prose.
    expect(NORM.includes("window\\.pageData\\s*=")).toBe(true);
  });

  it("a page with NO parseable payload is a FAILURE, not an empty board", () => {
    expect(extractPaylocityPageData("<html><body>Checking your browser…</body></html>")).toBeNull();
    // The assignment present but holding something JSON.parse refuses.
    expect(extractPaylocityPageData('<script>window.pageData = {not: valid};</script>')).toBeNull();
  });

  it("a DETAIL page's payload — same global, different keys — is still a failure", () => {
    // Live-captured from a posting page: the assignment parses fine and holds
    // no Jobs array. Reading it as an empty board would zero a live employer
    // the moment a token is ever stored pointing at the wrong page.
    expect(extractPaylocityPageData(wrap({ jobTitle: "EPIC CADENCE/ PRELUDE - MAINTENANCE", moduleName: "OCHIN" }))).toBeNull();
    expect(extractPaylocityPageData(wrap({ ModuleTitle: "x", Jobs: "not-an-array" }))).toBeNull();
  });

  it("an employer with nothing open is an HONEST ZERO, not a failure", () => {
    // Live-captured: the Capacity board serves the full payload with an empty
    // Jobs array. The document is the health signal; the jobs inside it are
    // the inventory — different questions, and this one answers "not hiring".
    const out = extractPaylocityPageData(wrap({ ModuleTitle: "Capacity", Jobs: [] }));
    expect(out).not.toBeNull();
    expect(out!.items).toEqual([]);
  });

  it("the fetch throws on a null extract, so the prune never sees a shell as empty", () => {
    expect(FN).toMatch(/const page = extractPaylocityPageData\(html\);\s*\n\s*if \(!page\) throw new Error\("paylocity payload shape unrecognized"\);/);
  });

  it("ids are stable and the apply link is the vendor's own Details page", () => {
    const [j] = normalizePaylocity([WENDYS_ITEM], "Wendy's", "1c38e30f-9af2-4b93-a08f-3ea42d2f6872");
    expect(j.id).toBe("paylocity:1c38e30f-9af2-4b93-a08f-3ea42d2f6872:1966162");
    expect(j.applyUrl).toBe("https://recruiting.paylocity.com/recruiting/jobs/Details/1966162");
    expect(j.source).toBe("paylocity");
    // The feed's stated publish date, kept — the shared 30-day ingest window
    // does the age filtering, the adapter does none of its own.
    expect(j.postedAt).toBe("2026-08-28T12:19:01.000Z");
    // Country arrives structurally as a word, and ships as the ISO-2 the rest
    // of the board speaks.
    expect(j.country).toBe("US");
  });

  it("an item without a JobId is dropped, never shipped with a dangling id", () => {
    const out = normalizePaylocity([{ ...WENDYS_ITEM, JobId: undefined }], "x", "tok");
    expect(out).toEqual([]);
  });

  it("work mode trusts the structured flag and never invents one from prose", () => {
    const remote = normalizePaylocity([{ ...WENDYS_ITEM, IsRemote: true }], "x", "tok")[0];
    expect(remote.workMode).toBe("remote");
    expect(remote.remote).toBe(true);
    // IsRemote false states nothing definitive — IndeedRemoteType read 2 on
    // every observed row, remote or not, so it earns no mapping until it is
    // measured. An onsite-looking street address stays null, and the UI
    // shows nothing.
    const onsite = normalizePaylocity([WENDYS_ITEM], "x", "tok")[0];
    expect(onsite.workMode).toBeNull();
  });

  it("is registered in the vendor dispatch", () => {
    expect(FN).toMatch(/if \(s\.source === "paylocity"\) \{/);
    expect(FN).toMatch(/normalizePaylocity\(items as never, s\.name, s\.token\)/);
  });
});
