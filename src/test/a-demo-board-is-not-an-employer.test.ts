import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
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

describe("a demo sandbox is not an employer, even when a real company owns it", () => {
  // 111 pinpoint tenants of REAL companies served only Pinpoint's 6 canned
  // seed titles — trial sandboxes that passed the name/token blocklist
  // because only their CONTENT was canned. Verified as a full subset on
  // removal day (469 rows, 6 distinct titles, 0 real). The registry entry,
  // the stored rows, and the census door all closed in one commit; these
  // pins keep all three closed.
  const MIG_DIR = resolve(__dirname, "../../supabase/migrations");
  const MIG = readFileSync(
    resolve(MIG_DIR, readdirSync(MIG_DIR).find((f) => f.includes("a_demo_sandbox_is_not_an_employer"))!),
    "utf8",
  );
  const migTokens = [...MIG.matchAll(/^\s*'([a-z0-9.-]+)',?$/gm)].map((m) => m[1]);

  it("all 111 removed tokens are out of the registry", () => {
    const registered = new Set(BOARDS.filter(([src]) => src === "pinpoint").map(([, , t]) => t));
    expect(migTokens.length).toBe(111);
    const still = migTokens.filter((t) => registered.has(t));
    expect(still, "a deleted board still registered re-ingests its fake postings next pass").toEqual([]);
  });

  it("the delete is keyed (source, token) and never touches the closure machinery", () => {
    const sql = MIG.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
    expect(sql).toMatch(/source = 'pinpoint'/);
    expect(sql).not.toMatch(/missing_since/i);
    expect(sql).not.toMatch(/job_board_(closures|exits)/i);
    // The high-water lowering rides the same migration, idempotently.
    expect(sql).toMatch(/LEAST\(\(v->>'size'\)::int, 31709\)/);
  });

  it("the census door is closed by content fingerprint, full-subset only", () => {
    const merge = readFileSync(resolve(__dirname, "../../scripts/merge-all.mjs"), "utf8");
    expect(merge).toMatch(/PINPOINT_DEMO_TITLES = new Set\(/);
    expect(merge).toMatch(/titles\.length > 0 && titles\.every\(\(t\) => PINPOINT_DEMO_TITLES\.has\(t\)\)/);
    expect(merge).toMatch(/vendor === "pinpoint" && b\.count <= 12/);
  });
});
