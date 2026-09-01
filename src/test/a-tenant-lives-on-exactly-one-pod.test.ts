import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeUkg, ukgBoardParams } from "../../supabase/functions/job-board/normalize";

/**
 * UKG PRO RECRUITING, THE NINETEENTH SOURCE — AND WHY ITS TOKEN HAS THREE PARTS.
 *
 * Verified live 2026-09-01 before a line was written: the candidate portal's
 * own list endpoint answers an unauthenticated POST with
 * { opportunities[], totalCount }, no cookie, no CSRF token, no account. The
 * probed board reported 98 postings whose newest PostedDate was that morning.
 *
 * NONE OF THE THREE TOKEN PARTS IS DERIVABLE FROM THE OTHERS, which is the
 * whole reason the token is compound rather than a tenant code:
 *   * the POD is part of the hostname and a tenant lives on exactly one of
 *     them — the two probed boards sit on different pods;
 *   * the BOARD GUID is not guessable. A fabricated GUID against a real tenant
 *     answered 404, which is how this was established rather than assumed.
 * The census reads all three from the crawled URL, so a discovered board is
 * immediately fetchable with nothing left to resolve.
 *
 * The name is the other hard part, and it comes from the employer either way:
 * no payload on this vendor carries a company name (the detail JSON's
 * board-name fields are null), but the board page renders the employer's own
 * logo with its own alt text. That is verify-all's business; what this file
 * pins is the shape the adapter depends on.
 */
const ROOT = resolve(__dirname, "../..");
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const FN = strip(readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8"));

describe("a tenant lives on exactly one pod", () => {
  it("refuses a token that cannot name a board", () => {
    expect(ukgBoardParams("recruiting2~SUB1000SUBZ~ffaa667e-61b4-4b38-b427-2cb6982a41a3")).toEqual({
      pod: "recruiting2", tenant: "SUB1000SUBZ", board: "ffaa667e-61b4-4b38-b427-2cb6982a41a3",
    });
    expect(ukgBoardParams("SUB1000SUBZ"), "a bare tenant cannot address a board").toBeNull();
    expect(ukgBoardParams("recruiting2~SUB1000SUBZ"), "no guid, no board").toBeNull();
    // A pod is a hostname component; anything else is a malformed token, not a
    // new pod to trust into a URL.
    expect(ukgBoardParams("evil.example.com~T~ffaa667e-61b4-4b38-b427-2cb6982a41a3")).toBeNull();
  });

  it("builds the apply link on the board's own pod", () => {
    const [job] = normalizeUkg(
      [{ Id: "abc", Title: "Product Marketing Manager", PostedDate: "2026-09-01T13:42:45.528Z",
         Locations: [{ Address: { City: "Madison", State: { Code: "WI" }, Country: { Code: "USA" } } }] }],
      "Sub-Zero Group", "recruiting2~SUB1000SUBZ~ffaa667e-61b4-4b38-b427-2cb6982a41a3",
    );
    expect(job.applyUrl).toBe(
      "https://recruiting2.ultipro.com/SUB1000SUBZ/JobBoard/ffaa667e-61b4-4b38-b427-2cb6982a41a3/OpportunityDetail?opportunityId=abc",
    );
    expect(job.id).toBe("ukg:recruiting2~SUB1000SUBZ~ffaa667e-61b4-4b38-b427-2cb6982a41a3:abc");
    expect(job.location).toBe("Madison, WI");
  });

  it("maps the ALPHA-3 country the feed states onto the alpha-2 the column holds", () => {
    // "USA" stored verbatim is a code no filter matches — the paylocity trap,
    // one letter longer.
    const country = (code: string) => normalizeUkg(
      [{ Id: "x", Title: "T", Locations: [{ Address: { City: "C", Country: { Code: code } } }] }],
      "Co", "recruiting~T~ffaa667e-61b4-4b38-b427-2cb6982a41a3",
    )[0].country;
    expect(country("USA")).toBe("US");
    expect(country("GBR")).toBe("GB");
    expect(country("CAN")).toBe("CA");
  });

  it("drops a posting it cannot address, rather than serving a dead link", () => {
    expect(normalizeUkg(
      [{ Title: "No id here" }, { Id: "ok", Title: "" }],
      "Co", "recruiting~T~ffaa667e-61b4-4b38-b427-2cb6982a41a3",
    )).toEqual([]);
  });

  it("treats an unrecognised payload as a FAILED fetch, never an empty board", () => {
    // The zeroing hazard every vendor here has to answer: a bot-wall or a
    // reshape that parses as 200 must not look like an employer who stopped
    // hiring, because that prunes a live board.
    expect(FN).toMatch(/throw new Error\("ukg payload shape unrecognized"\)/);
    expect(FN).toMatch(/if \(all\.length === 0 && feedTotal > 0\) throw new Error\(`empty page but total=\$\{feedTotal\}`\)/);
  });

  it("pages by Top/Skip and honours a per-board window override", () => {
    expect(FN).toMatch(/const ukgPageCap|Math\.max\(1, s\.pages \?\? UKG_PAGE_CAP\)/);
    expect(FN).toMatch(/Top: UKG_PAGE, Skip: page \* UKG_PAGE/);
  });
});
