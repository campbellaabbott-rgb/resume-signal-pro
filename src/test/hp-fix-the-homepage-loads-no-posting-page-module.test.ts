/**
 * THE HOMEPAGE LOADS NO POSTING-PAGE MODULE (review round of 2026-10-26).
 *
 * src/components/jobs/posting-page.ts is the posting page's whole pure half
 * (its URL, head copy, structured data and honesty gates): about 11.9 kB
 * gzip. "/" pulled all of it in for one constant (the board's 30-day window,
 * in the FAQ and the sources section) and one six-line function (a card's
 * address), which put all of it in the static closure of "/" (the review
 * round measured 11 kB off that closure once it was gone; step 15's
 * JavaScript cap, which this was measured against, was retired by the owner
 * on 2026-10-27). The homepage carries a copy of each, held equal to the
 * original here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { BOARD_FRESH_WINDOW_DAYS, postingPagePath } from "@/components/jobs/posting-page";
import { HOME_BOARD_FRESH_WINDOW_DAYS, homePostingPath } from "@/lib/home/posting-href";
import { codeOf } from "./helpers/strip-comments";

const ROOT = resolve(__dirname, "../..");
const files = (dir: string) => readdirSync(resolve(ROOT, dir)).filter((f) => /\.tsx?$/.test(f)).map((f) => `${dir}/${f}`);

describe("the homepage's copies", () => {
  it("the window and the card address are the posting page's own", () => {
    expect(HOME_BOARD_FRESH_WINDOW_DAYS).toBe(BOARD_FRESH_WINDOW_DAYS);
    for (const id of [
      "workday:american~wd1~AU:R12345", "greenhouse:acme:4567", "smartrecruiters:Salomon:744000154823724",
      "oracle:jpm~CX_1001:210.5", "lever:a.b:c", "ashby:x:y.z", "usajobs:usajobs:812345600",
      "bad id", "a:b", "a:b:c:d", "a:b c:d", "", "x:y:z/w", "x:y:<z>",
    ]) expect(homePostingPath(id), id).toBe(postingPagePath(id));
  });

  it("no homepage module imports the posting page's module", () => {
    const importing = ["src/components/home", "src/lib/home", "src/pages/home"].flatMap(files)
      .filter((f) => /from ["']@\/components\/jobs\/posting-page["']/.test(codeOf(readFileSync(resolve(ROOT, f), "utf8"))));
    expect(importing).toEqual([]);
  });
});
