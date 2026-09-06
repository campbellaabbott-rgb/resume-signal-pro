import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  CATALOG,
  CATALOG_TUPLES,
  CODE_SOURCE,
  MIN_EXPECTED_BOARDS,
  VENDOR_KINDS,
  stripTsComments,
} from "./helpers/catalog";

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
 *
 * 2026-09-06 — HOW THIS FILE READS THE CATALOG NOW. Every check here used to
 * rebuild the catalog from its own regex over sources.ts. When the catalog was
 * repacked into 406 packed string literals (to get the bundle back under the
 * ~4.5MB deploy cap), those regexes did not fail — they went BLIND, seeing 465
 * boards out of 44,544 and cheerfully reporting "no demo tenants" and "no
 * duplicates" about 1% of the registry. The catalog is now read through the one
 * shared parser in ./helpers/catalog, which knows all three entry forms and
 * refuses to hand back a short list. Nothing below may re-derive the catalog
 * from source text: a screen that can only see the boards written in one syntax
 * is the failure this whole file exists to prevent.
 */

describe("a demo board is not an employer", () => {
  it("found the registry at all", () => {
    // The property is COVERAGE, not syntax: this fails when the reader has gone
    // blind to part of the catalog, and does NOT fail when the catalog is
    // rewritten into a new entry form (the reader is taught the form, and a form
    // it does not know throws out of the helper rather than being skipped).
    expect(
      CATALOG.length,
      "the catalog reader has gone blind — every screen below is now judging a fraction of the registry",
    ).toBeGreaterThanOrEqual(MIN_EXPECTED_BOARDS);

    // A parse can also be long and junk: 44k half-read records would satisfy a
    // count floor while every screen below matched on garbage.
    const malformed = CATALOG.filter(
      (e) => !e.name.trim() || !e.token.trim() || !VENDOR_KINDS.includes(e.source),
    );
    expect(
      malformed.slice(0, 10).map((e) => `#${e.index} (${e.form}) ${JSON.stringify(e)}`),
      "entries parsed with a blank field or an unknown vendor — the reader is mis-splitting records",
    ).toEqual([]);
  });

  it("no registered token looks like a vendor demo or test tenant", () => {
    // Validated against the full registry before adoption: exactly the five
    // known demo boards matched and zero real employers did — the boundary
    // anchors are what keep "testronic" and "sandboxx" safe.
    //
    // 2026-09-06: that validation was done when the scanner could see the whole
    // registry in s() form, and it holds again now — re-run over all 44,544
    // boards, this pattern still matches zero. Note what it CANNOT see, and see
    // the vendor-own-tenant check below: the anchors that protect "Sandboxx" and
    // "SandboxAQ" also let "leverdemo" and "krakensandbox" through.
    const pat = /(^|[-_])(example|demo|sandbox|test)([-_]|$)/i;
    const hits = CATALOG.filter((e) => pat.test(e.token));
    expect(
      hits.map((e) => `${e.name} (${e.source}:${e.token}) #${e.index} ${e.form}`),
      "vendor demo tenants serve fictional postings; delete the row and its stored postings",
    ).toEqual([]);
  });

  it("no board is a vendor's own demo or training tenant", () => {
    // NEW 2026-09-06, and it is red on arrival — this is a live defect the old
    // scanner could not see, not a test problem.
    //
    // The anchored screen above is anchored on purpose (real employers are named
    // Sandboxx, SandboxAQ, Testlio, Brinqa), which means it cannot match a token
    // that welds the vendor's name to "demo". Over the full catalog exactly two
    // boards are a VENDOR's own tenant, and both were live-verified today
    // against api.lever.co/v0/postings:
    //
    //   lever:leverdemo    "Lever Demo 2"  — 12 postings, e.g. "Approved
    //                      Professional 3", "Customer Success Manager AH Test"
    //   lever:leverdemo-8  "Lever Implementation Training Environment" — 429
    //                      postings, including "[TEMPLATE] Customer Experience
    //                      Specialist" and "***POSTING TEMPLATE - ENGINEERING"
    //
    // Both also sit in HOT_TOKENS, so 441 fictional postings are re-crawled
    // every ~10 minutes in the fastest lane. This is "King of Rohan" again and
    // "Lever Test 23" again, in one entry.
    //
    // The screen is deliberately narrow — the vendor's OWN name welded to a
    // demo/test word — so it needs no judgement call about whether an employer
    // is real, and it returns zero false positives across all 44,544 boards.
    const vendorOwn = CATALOG.filter((e) => {
      const token = e.token.toLowerCase();
      return VENDOR_KINDS.some((vendor) =>
        new RegExp(`(^|[.\\-_])${vendor}(demo|test|sandbox|sample|example)`).test(token) ||
        new RegExp(`(demo|test|sandbox|sample|example)[.\\-_]?${vendor}([.\\-_]|$)`).test(token),
      );
    });
    expect(
      vendorOwn.map((e) => `${e.name} (${e.source}:${e.token}) #${e.index} ${e.form}`),
      "a vendor's own demo/training tenant is not an employer; delete the row, its stored postings and its HOT_TOKENS entry",
    ).toEqual([]);
  });

  it("the removed demo and duplicate boards stay removed", () => {
    // 2026-08-31 charter change: the operator widened the board to carry
    // staffing agencies, so the AGENCY names that used to sit in this list
    // (liquidpersonnel, crisprecruit, unitedplacementgroup, cogentanalytics)
    // are no longer pinned removed — they may legitimately re-merge. What
    // stays pinned is what is junk under ANY charter: vendor demo tenants
    // serving fictional postings, and duplicate boards that double-count.
    //
    // 2026-09-06: this used to ask whether the byte sequence `"levertest"`
    // appeared in the file. After the repack a packed token is written bare
    // between separators, with no quotes anywhere near it, so every one of these
    // seven pins had become unfalsifiable — they could not have failed if the
    // board came back. The property was never "the string is absent from the
    // file"; it is "the board is not REGISTERED", so ask the registry.
    const registeredTokens = new Set(CATALOG.map((e) => e.token));
    for (const token of [
      "rohansrecruiterssandbox", "examplecorpsandbox", "levertest",
      "n2alljobs", "morrisgroupsite",
      "jobs.mastec.com", "ashby-embed-demo-org",
    ]) {
      expect(registeredTokens.has(token), `${token} was re-registered`).toBe(false);
    }
    // The two token strings that legitimately survive on OTHER vendors:
    // ashby's "pulse" is a real employer, and greenhouse's "example" only as
    // part of longer tokens. Assert the removed PAIRS, not the bare strings.
    //
    // 2026-09-03: greenhouse:pulse ("Pulse Healthcare") is BACK and stays —
    // live-verified against boards-api.greenhouse.io/v1/boards/pulse: 200, a
    // first-party employer name, and real postings (permanent roles, Qatar
    // and UK locations, NHS/private metadata). Whatever census round removed
    // it was wrong about this one: it is a healthcare staffing board, which
    // the 2026-08-31 charter now carries WITH disclosure. It is catalogued
    // plainly; if it is ever tagged agency the disclosure covers it. The old
    // assertion also only matched the s(...) spelling, so the board sat in
    // the catalog as an object literal while this test read green — and after
    // the repack it matched no spelling at all. Both pins are now pair
    // lookups against the parsed registry, which is syntax-independent.
    expect(
      CATALOG.filter((e) => e.source === "greenhouse" && e.token === "example")
        .map((e) => `${e.name} #${e.index} ${e.form}`),
      "the greenhouse demo tenant is back on the board",
    ).toEqual([]);
    expect(
      CATALOG.filter((e) => e.name === "Democorp").map((e) => `${e.source}:${e.token} #${e.index}`),
      "Democorp is back on the board",
    ).toEqual([]);
  });

  it("no two boards of one vendor share a token", () => {
    const seen = new Map<string, string>();
    const dups: string[] = [];
    for (const entry of CATALOG) {
      const k = `${entry.source}:${entry.token}`;
      const first = seen.get(k);
      if (first !== undefined) dups.push(`${k} as both ${first} and "${entry.name}" (#${entry.index})`);
      else seen.set(k, `"${entry.name}" (#${entry.index})`);
    }
    expect(dups, "one feed registered twice makes every posting a double").toEqual([]);
  });

  it("every hot token is a registered board", () => {
    // "Lever Test 23" sat in the 10-minute re-crawl set with ZERO postings —
    // a hot slot spent on a test tenant. Heat must not outlive registration.
    //
    // Read from the comment-stripped source: a HOT_TOKENS block quoted in a
    // comment (this repo has been bitten seven times by exactly that) would
    // otherwise be matched instead of the live one.
    const hotBlock = /HOT_TOKENS: Set<string> = new Set\(\[([\s\S]*?)\]\)/.exec(CODE_SOURCE)?.[1] ?? "";
    expect(hotBlock, "HOT_TOKENS not found").not.toBe("");
    const hot = [...hotBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    // An empty or near-empty hot list means the matcher rotted, and a rotted
    // matcher passes this test vacuously — the same blindness, one file over.
    expect(hot.length, "the HOT_TOKENS matcher has rotted").toBeGreaterThan(20);
    const registered = new Set(CATALOG_TUPLES.map(([, , t]) => t));
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
    // 2026-09-06: the pinpoint side of this had gone blind too — the old
    // scanner could see a handful of pinpoint boards, so "none of the 111 are
    // registered" was a statement about a sliver. All 481 pinpoint boards are
    // visible through the shared reader now, and none of the 111 is among them.
    const registered = new Set(CATALOG.filter((e) => e.source === "pinpoint").map((e) => e.token));
    expect(migTokens.length).toBe(111);
    expect(
      registered.size,
      "zero pinpoint boards parsed — the reader cannot see the vendor this test screens",
    ).toBeGreaterThan(0);
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

describe("a high-water mark above the real catalog turns the prune off", () => {
  // The stale-bundle guard is a STRICT less-than:
  //     if (JOB_SOURCES.length < highwater) -> skip the orphan prune
  // so a mark ONE larger than the catalog does not degrade the prune, it
  // disables it. That shipped: the demo-sandbox migration clamped the mark
  // to 31,709 against a real catalog of 31,708 (hand-counted with a looser
  // regex than the bundle's own), and every pass afterwards logged "orphan
  // prune SKIPPED". This asserts what nobody checked — that a high-water
  // literal never exceeds the catalog the bundle actually carries. It keeps
  // holding as the catalog GROWS, because the guard re-stamps upward on its
  // own; only a literal above the catalog is a defect.
  //
  // 2026-09-06: the comparison is against the TRUE catalog size from the shared
  // reader. Under the old scanner this test read the catalog as 465 boards, so
  // it demanded that the clamp be at most 465 — it had inverted into a demand to
  // turn the prune off. A size this test gets wrong is worse than no test.
  const MIG_DIR = resolve(__dirname, "../../supabase/migrations");
  const highWaterMigs = readdirSync(MIG_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => ({ f, sql: readFileSync(resolve(MIG_DIR, f), "utf8") }))
    .filter(({ sql }) => /catalog_highwater/.test(sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")));

  it("found the high-water migrations at all", () => {
    expect(highWaterMigs.length, "the migration matcher has rotted").toBeGreaterThan(0);
  });

  it("the guard's own state is published, so the next off-by-one is visible", () => {
    // The 31,709-vs-31,708 defect could not be confirmed from outside at all:
    // job_board_meta is service-role-only, so the only evidence that the
    // prune had stopped was a log line. status now carries the mark and a
    // derived boolean, which is what made this verifiable.
    //
    // Comment-stripped through the shared blanker (the local `//.*$` strip this
    // used to do cuts a line in half at any `//` inside a string — a URL, a
    // regex — and can blank live code out of the text being asserted on).
    const code = stripTsComments(
      readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8"),
    );
    expect(code).toMatch(/catalogHighwater:/);
    expect(code).toMatch(/orphanPruneBlocked: JOB_SOURCES\.length < /);
    expect(code).toMatch(/eq\("k", "catalog_highwater"\)/);
  });

  it("the LAST clamp in migration order is at or below the real catalog", () => {
    // The NET clamp is what production holds — migrations run in filename
    // order and a later one corrects an earlier one, so the last is the
    // live value. Checked this way on purpose: the migration that shipped
    // the bad 31,709 has already run, and rewriting an applied migration
    // would make the file lie about what production executed. Its
    // correction sits in 20260824040000 instead, and THIS assertion is what
    // fails if a future clamp is typed too high.
    const last = [...highWaterMigs].sort((a, b) => a.f.localeCompare(b.f)).pop()!;
    const sql = last.sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
    const literals = [...sql.matchAll(/LEAST\(\(v->>'size'\)::int,\s*(\d+)\)/g)].map((m) => Number(m[1]));
    expect(literals.length, `${last.f} is the newest high-water migration but writes no clamp`).toBeGreaterThan(0);
    for (const literal of literals) {
      expect(
        literal,
        `${last.f} clamps the high-water to ${literal}, but the catalog carries ${CATALOG.length} boards — a mark above the catalog disables the orphan prune outright (strict <)`,
      ).toBeLessThanOrEqual(CATALOG.length);
    }
  });
});
