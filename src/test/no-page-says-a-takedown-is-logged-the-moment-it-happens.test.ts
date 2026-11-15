/**
 * NO PAGE SAYS A TAKEDOWN IS LOGGED THE MOMENT IT HAPPENS (B09, CLAIM-11).
 *
 * /hiring-trends told crawlers that the board records a takedown at the
 * instant a company takes a posting down, while /ghost-job-index printed how
 * far behind the re-reads run (a median of 279 minutes and 7.7 hours at the
 * 95th percentile on 2026-11-07): a takedown is logged when the next read of
 * that company's feed finds the posting gone. The bake's copy now says so,
 * and both claim sweeps refuse the instant wording wherever it is written:
 * the bake's (BANNED_SOURCE_PHRASES, over every written page and both llms
 * files) and the app's (BANNED_SOURCE_CLAIMS, over the pages' source and every
 * locale string). The app's also refuses calling a takedown a fill.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BANNED_SOURCE_CLAIMS } from "@/lib/seo/source-copy";
import { bannedSourcePhrasesIn } from "../../scripts/prerender-copy.mjs";
import { codeOf } from "./helpers/strip-comments";

const ROOT = resolve(__dirname, "../..");
const appRefuses = (s: string) => BANNED_SOURCE_CLAIMS.some((re) => re.test(s));
const bakeRefuses = (s: string) => (bannedSourcePhrasesIn(s) as unknown[]).length > 0;

const INSTANT = [
  "We log every posting the moment a company takes it down.",
  "the moment an employer removes a role, we record it",
  "We record it the moment the posting comes down.",
];
const HONEST = [
  "We record a takedown when the next read of that company's feed finds the posting gone.",
  "At the moment the board serves 900,000 postings.",
  "a role taken down for good within 14 days",
];

describe("the claim sweeps", () => {
  it("both refuse a takedown logged at the instant it happens", () => {
    for (const s of INSTANT) {
      expect(appRefuses(s), s).toBe(true);
      expect(bakeRefuses(s), s).toBe(true);
    }
  });

  it("the app's refuses calling a takedown a fill", () => {
    for (const s of ["which employers actually fill roles", "How often roles are actually filled, by field"]) expect(appRefuses(s), s).toBe(true);
  });

  it("neither refuses the honest wording, or 'the moment' meaning now", () => {
    for (const s of HONEST) {
      expect(appRefuses(s), s).toBe(false);
      expect(bakeRefuses(s), s).toBe(false);
    }
  });
});

describe("/hiring-trends' crawler copy", () => {
  const code = codeOf(readFileSync(resolve(ROOT, "scripts/prerender-seo.mjs"), "utf8"));
  const block = code.slice(code.indexOf('path: "/hiring-trends"'), code.indexOf('path: "/hiring-trends"') + 6000);

  it("says a takedown is recorded on the next read, and points at the lag the Ghost Job Index prints", () => {
    expect(block).toContain("We record a takedown when the next read of that company's feed finds the posting gone");
    expect(block).toMatch(/<a href="\/ghost-job-index"[^>]*>Ghost Job Index<\/a> prints how far behind those re-reads run/);
    expect(bakeRefuses(block)).toBe(false);
  });
});
