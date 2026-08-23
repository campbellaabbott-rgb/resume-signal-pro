import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * "KING OF ROHAN" WAS A LIVE, SERVABLE JOB.
 *
 * Three Greenhouse demo tenants, one Lever test board and one Ashby demo org
 * were registered as employers, and the fictional postings served — verified
 * live, POST {"q":"King of Rohan"} returned a card with a working apply URL,
 * on a board whose header promises zero ghost jobs. Alongside them, five
 * recruitment agencies had passed the corporate-only policy, two of them
 * promoted into the 10-minute re-crawl set, and three employers were
 * registered twice under different display names so the same requisition
 * rendered as two cards with byte-identical apply URLs.
 *
 * The census merges add boards mechanically, which is exactly how these got
 * in. This file is the door they came through, closed.
 */
const SRC = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/sources.ts"), "utf8");

const BOARDS: Array<[string, string, string]> = [
  ...[...SRC.matchAll(/s\("([^"]+)",\s*"(\w+)",\s*"([^"]+)"\)/g)].map((m) => [m[1], m[2], m[3]] as [string, string, string]),
  ...[...SRC.matchAll(/\{ name: "([^"]+)", source: "(\w+)", token: "([^"]+)" \}/g)].map((m) => [m[1], m[2], m[3]] as [string, string, string]),
];

describe("a demo board is not an employer", () => {
  it("found the registry at all", () => {
    expect(BOARDS.length, "the source-entry matchers have rotted").toBeGreaterThan(20_000);
  });

  it("no registered token looks like a vendor demo or test tenant", () => {
    // Validated against the full registry before adoption: exactly the five
    // known demo boards matched and zero real employers did — the boundary
    // anchors are what keep "testronic" and "sandboxx" safe.
    const pat = /(^|[-_])(example|demo|sandbox|test)([-_]|$)/i;
    const hits = BOARDS.filter(([, , t]) => pat.test(t));
    expect(
      hits.map(([n, s, t]) => `${n} (${s}:${t})`),
      "vendor demo tenants serve fictional postings; delete the row and its stored postings",
    ).toEqual([]);
  });

  it("the removed agency and duplicate boards stay removed", () => {
    for (const tok of [
      '"rohansrecruiterssandbox"', '"examplecorpsandbox"', '"levertest"',
      '"liquidpersonnel"', '"crisprecruit"', '"cogentanalytics"',
      '"unitedplacementgroup"', '"n2alljobs"', '"morrisgroupsite"',
      '"jobs.mastec.com"', '"ashby-embed-demo-org"',
    ]) {
      expect(SRC.includes(tok), `${tok} was re-registered`).toBe(false);
    }
    // The two token strings that legitimately survive on OTHER vendors:
    // ashby's "pulse" is a real employer, and greenhouse's "example" only as
    // part of longer tokens. Assert the removed PAIRS, not the bare strings.
    expect(/s\("Pulse Healthcare", "greenhouse", "pulse"\)/.test(SRC)).toBe(false);
    expect(/s\("Democorp", "greenhouse", "example"\)/.test(SRC)).toBe(false);
  });

  it("no two boards of one vendor share a token", () => {
    const seen = new Map<string, string>();
    const dups: string[] = [];
    for (const [name, src, tok] of BOARDS) {
      const k = `${src}:${tok}`;
      if (seen.has(k)) dups.push(`${k} as both "${seen.get(k)}" and "${name}"`);
      else seen.set(k, name);
    }
    expect(dups, "one feed registered twice makes every posting a double").toEqual([]);
  });

  it("every hot token is a registered board", () => {
    // "Lever Test 23" sat in the 10-minute re-crawl set with ZERO postings —
    // a hot slot spent on a test tenant. Heat must not outlive registration.
    const hotBlock = /HOT_TOKENS: Set<string> = new Set\(\[([\s\S]*?)\]\)/.exec(SRC)?.[1] ?? "";
    expect(hotBlock, "HOT_TOKENS not found").not.toBe("");
    const hot = [...hotBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const registered = new Set(BOARDS.map(([, , t]) => t));
    const orphans = hot.filter((t) => !registered.has(t));
    expect(orphans, "hot tokens with no board burn the fastest crawl slots on nothing").toEqual([]);
  });
});
