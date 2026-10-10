import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { contentFingerprint, pageLastmod } from "../../scripts/prerender-pages.mjs";

/**
 * WHAT WAS WRONG, measured 2026-10-08 (SEO report S3): every one of the 1,267
 * sitemap entries carried the publish date (`grep -o '<lastmod>[^<]*'
 * sitemap.xml | sort | uniq -c` gave `1267 2026-10-08`). A date that moves on
 * every publish says nothing, and search engines learn to ignore it. A page's
 * date now moves only when what it says moves, and a guide carries the date
 * its own markup states.
 */

const TODAY = "2026-10-09";

describe("a page's sitemap date is the day what it says last changed", () => {
  it("an unchanged page keeps the date it last changed, a changed one takes today", () => {
    const fp = contentFingerprint("<h1>Resume keywords for nursing</h1><p>58 industries</p>");
    expect(pageLastmod({ fingerprint: fp, prior: { fp, lastmod: "2026-09-01" }, today: TODAY })).toBe("2026-09-01");
    expect(pageLastmod({ fingerprint: fp, prior: { fp: "different", lastmod: "2026-09-01" }, today: TODAY })).toBe(TODAY);
    expect(pageLastmod({ fingerprint: fp, prior: undefined, today: TODAY }), "a page the ledger never saw").toBe(TODAY);
  });

  it("a stated date wins, and is never later than today", () => {
    expect(pageLastmod({ fingerprint: "x", prior: { fp: "x", lastmod: "2026-09-01" }, today: TODAY, stated: "2026-07-06" })).toBe("2026-07-06");
    expect(pageLastmod({ fingerprint: "x", prior: null, today: TODAY, stated: "2027-01-01" })).toBe(TODAY);
  });

  it("a page's own date stamp changing is not the page changing; a number changing is", () => {
    const a = contentFingerprint("Built 2026-10-08. Measured 2026-10-08 00:05 UTC. 1,028,735 open roles.");
    const b = contentFingerprint("Built 2026-10-09. Measured 2026-10-09 06:41 UTC. 1,028,735 open roles.");
    const c = contentFingerprint("Built 2026-10-09. Measured 2026-10-09 06:41 UTC. 1,031,002 open roles.");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("the bake gives each entry its own date", () => {
  const bake = codeOf(readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8"));
  it("writes lastmodOf(path) per entry and no single build date", () => {
    expect(bake).toMatch(/<lastmod>\$\{lastmodOf\(e\.path\)\}<\/lastmod>/);
    expect(bake).not.toMatch(/<lastmod>\$\{LASTMOD\}<\/lastmod>/);
    expect(bake, "a guide's entry carries its own updated date").toMatch(/lastmod: g\.updated,/);
  });
});
