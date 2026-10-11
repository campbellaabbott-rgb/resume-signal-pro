/**
 * /v1 needs two of the board's rules and cannot import them: an edge bundle
 * carries its own directory and _shared, nothing else (board-domains.ts says
 * why). So the location rule (job-board/location-match.ts, L13-01) and the
 * employment-type domain (job-board/filters.ts) are mirrored into _shared, and
 * this holds each copy to the board's: same file, same answers, same list.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as board from "../../supabase/functions/job-board/location-match";
import * as copy from "../../supabase/functions/_shared/location-match";
import { EMPLOYMENT_TYPES as BOARD_TYPES } from "../../supabase/functions/job-board/filters";
import { EMPLOYMENT_TYPES as SHARED_TYPES } from "../../supabase/functions/_shared/board-domains";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("the API's copy of the board's location rule", () => {
  it("is the board's file, byte for byte", () => {
    expect(read("supabase/functions/_shared/location-match.ts")).toBe(read("supabase/functions/job-board/location-match.ts"));
  });

  it.each([", OR", ", DE", ", TX", "Oregon", "San Jose", "Berlin"])("builds the same branch for %s", (term) => {
    expect(copy.locationBranch(term)).toBe(board.locationBranch(term));
    expect(copy.isStateCodeAlias(term)).toBe(board.isStateCodeAlias(term));
    for (const place of ["Portland, OR", "Orlando, FL", "Berlin, DE", "Dover, DE", "Austin, TX"]) {
      expect(copy.partMatchesTerm(place, term)).toBe(board.partMatchesTerm(place, term));
    }
  });
});

describe("the API's employment types are the board's", () => {
  it("lists the same domain", () => {
    expect([...SHARED_TYPES]).toEqual([...BOARD_TYPES]);
  });
});
