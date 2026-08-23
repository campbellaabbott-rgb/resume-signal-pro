// Description-source helpers (task #210-#213).
//
// Live audit 2026-07-24: stored description coverage was 19.8% (113,174 of
// 570,663), and the gap was binary rather than patchy — every vendor whose list
// payload carries the text sat near 100%, every vendor needing a per-posting
// fetch sat at exactly 0%. These two helpers are what unlock the two largest
// zero-coverage vendors (Workday ~313k, Breezy 14.5k), so their edge cases are
// pinned here.
//
// Every fixture below is shaped from a REAL response captured during that
// audit, not invented.
import { describe, it, expect } from "vitest";
import {
  BOARD_DESC_SOURCES,
  DETAIL_DESC_SOURCES,
  NO_DESC_SOURCES,
  jobPostingLdDescription,
  workdayCxsUrl,
} from "../../supabase/functions/job-board/descriptions";

describe("workdayCxsUrl — derive the detail endpoint from the posting URL", () => {
  it("handles the common locale-prefixed form", () => {
    expect(
      workdayCxsUrl("https://cogeco.wd3.myworkdayjobs.com/en-US/Cogeco_Careers/job/Miramar-FL/Engineer--Provisioning_JR9620"),
    ).toBe(
      "https://cogeco.wd3.myworkdayjobs.com/wday/cxs/cogeco/Cogeco_Careers/job/Miramar-FL/Engineer--Provisioning_JR9620",
    );
  });

  it("handles a URL with no locale segment", () => {
    expect(
      workdayCxsUrl("https://rivhs.wd1.myworkdayjobs.com/Non-ProviderRHS/job/Sanders/Food-Service-Person_2025-031054"),
    ).toBe(
      "https://rivhs.wd1.myworkdayjobs.com/wday/cxs/rivhs/Non-ProviderRHS/job/Sanders/Food-Service-Person_2025-031054",
    );
  });

  it("does not mistake the locale for the site name", () => {
    // The bug this guards: treating "en-US" as the site produces a 404 for
    // every locale-prefixed posting, which is most of them.
    const url = workdayCxsUrl("https://db.wd3.myworkdayjobs.com/en-US/DWSWebsite/job/Bangalore/Senior-Analyst_R0416870");
    expect(url).toContain("/wday/cxs/db/DWSWebsite/job/");
    expect(url).not.toContain("en-US");
  });

  it("keeps multi-segment job paths intact", () => {
    expect(workdayCxsUrl("https://acme.wd5.myworkdayjobs.com/en-GB/Careers/job/London/Some/Deep/Path_JR1"))
      .toBe("https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/Careers/job/London/Some/Deep/Path_JR1");
  });

  it("returns null for anything that is not a Workday posting URL", () => {
    for (const bad of [
      "",
      "https://boards.greenhouse.io/acme/jobs/123",
      "https://acme.wd3.myworkdayjobs.com/en-US/Careers", // no /job/ segment
      "https://evil.example.com/acme.wd3.myworkdayjobs.com/job/x",
    ]) {
      expect(workdayCxsUrl(bad), bad).toBeNull();
    }
  });
});

describe("jobPostingLdDescription — Breezy's only description source", () => {
  const jobPosting = (desc: string) =>
    `<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", description: desc })}</script>`;

  it("skips the WebSite node and finds the JobPosting one", () => {
    // The real failure: Breezy pages emit a WebSite node FIRST. Reading only
    // the first ld+json block finds no description and reports the vendor as
    // having none — which is what kept 14,535 rows empty.
    const body = "x".repeat(400);
    const html = `<html><head>
      <script type="application/ld+json">${JSON.stringify({ "@type": "WebSite", name: "Careers" })}</script>
      ${jobPosting(body)}
    </head></html>`;
    expect(jobPostingLdDescription(html)).toBe(body);
  });

  it("accepts single quotes and extra attributes on the script tag", () => {
    const body = "y".repeat(300);
    const html = `<script data-x='1' type='application/ld+json' defer>${JSON.stringify({ "@type": "JobPosting", description: body })}</script>`;
    expect(jobPostingLdDescription(html)).toBe(body);
  });

  it("survives a malformed ld+json block and keeps looking", () => {
    const body = "z".repeat(250);
    const html = `<script type="application/ld+json">{not valid json,,,}</script>${jobPosting(body)}`;
    expect(jobPostingLdDescription(html)).toBe(body);
  });

  it("handles an @graph-style array of nodes", () => {
    const body = "w".repeat(200);
    const html = `<script type="application/ld+json">${JSON.stringify([
      { "@type": "Organization", name: "Acme" },
      { "@type": "JobPosting", description: body },
    ])}</script>`;
    expect(jobPostingLdDescription(html)).toBe(body);
  });

  it("returns null rather than a stub when there is no real body", () => {
    // A 299-char og:description is NOT a job description — returning it would
    // put a truncated teaser into fit scoring and the apply kit.
    expect(jobPostingLdDescription("<html><body>no structured data</body></html>")).toBeNull();
    expect(jobPostingLdDescription(jobPosting("too short"))).toBeNull();
    expect(jobPostingLdDescription("")).toBeNull();
  });

  it("ignores a non-JobPosting node that happens to carry a long description", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "WebSite",
      description: "q".repeat(500),
    })}</script>`;
    expect(jobPostingLdDescription(html)).toBeNull();
  });
});

describe("vendor description classification", () => {
  it("sweeps exactly the vendors that need a per-posting fetch", () => {
    expect([...DETAIL_DESC_SOURCES].sort()).toEqual(
      ["bamboohr", "breezy", "oracle", "smartrecruiters", "workday"].sort(),
    );
  });

  it("keeps rippling out of the sweep so it cannot burn requests re-failing", () => {
    // Rippling's board HTML is client-rendered and carries no JD (verified
    // 2026-07-24). A stored null there is a measured fact, not a backlog item.
    expect([...NO_DESC_SOURCES]).toContain("rippling");
    expect([...DETAIL_DESC_SOURCES]).not.toContain("rippling");
  });

  it("excludes vendors already covered by the list payload", () => {
    for (const v of ["greenhouse", "lever", "ashby", "recruitee", "teamtailor", "personio", "workable", "pinpoint"]) {
      expect([...DETAIL_DESC_SOURCES], v).not.toContain(v);
    }
  });

  it("routes list-payload vendors to the board lane, never the per-posting one", () => {
    // Ingest is insert-only, so rows predating the extraction keep their null
    // and still need a backfill — but sending them through the per-posting
    // phase would re-fetch the ENTIRE board for every single row.
    // icims joined 2026-08-24: its list payload had carried the full
    // description all along and the parser existed — but no ingest branch or
    // sweep membership called it, so 18,713 servable rows (100% of the
    // vendor) stored null. The board lane fills them at ~120/board/pass.
    expect([...BOARD_DESC_SOURCES].sort()).toEqual(["icims", "pinpoint", "workable"]);
    for (const v of BOARD_DESC_SOURCES) {
      expect([...DETAIL_DESC_SOURCES], v).not.toContain(v);
      expect([...NO_DESC_SOURCES], v).not.toContain(v);
    }
  });

  it("keeps the three vendor lanes mutually exclusive", () => {
    const all = [...DETAIL_DESC_SOURCES, ...BOARD_DESC_SOURCES, ...NO_DESC_SOURCES];
    expect(new Set(all).size, "a vendor must belong to exactly one lane").toBe(all.length);
  });
});
