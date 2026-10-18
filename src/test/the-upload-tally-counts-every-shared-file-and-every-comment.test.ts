// @vitest-environment node
/**
 * THE JOB-BOARD UPLOAD IS TALLIED THE WAY THE DEPLOY TALLIES IT (S12-083).
 *
 * WHAT THIS GUARDS. Past about 4.5 MB the deploy of job-board reports success
 * and the PREVIOUS bundle keeps serving (.27, .29, .32, .60, .79 and .80 all
 * went that way). The deploy's tally is not the import graph: it is the raw
 * size of every file in the function's own folder plus every file in the WHOLE
 * _shared folder, comments and prose included, whether job-board imports the
 * file or not (the .79 refusal: sources.ts + index.ts + all of _shared, 268 KB
 * of it a module job-board never reads). The wave 4 note measured 4,479,387
 * bytes that way, about 20 KB under the line, and the profiles round adds two
 * _shared files (hiring-record-gate.ts and perks-extract.ts, 54,684 bytes on
 * origin/profiles/integration) whichever order the rounds deploy in, which
 * puts the next job-board deploy over it.
 *
 * WHAT IT MEASURES. The folder tally above, plus what other rounds are known
 * to be adding to _shared and have not merged here: every file at least at its
 * measured size on that round's branch (PENDING_SHARED below; a new file counts
 * whole, a grown file counts its growth, and once the branch merges the disk
 * holds that size and the entry adds nothing, so a merge never counts it
 * twice). Wave 4's second round runs six builders on one bundle: the five
 * besides this one add about 109 KB to _shared between them, which with the
 * profiles round's two files put the round-1 trim over the line at
 * integration. The tally must stay HEADROOM_BYTES under the line, the room the
 * S12 fix asked for.
 *
 * TEETH. The folder walk is shown counting a _shared file job-board never
 * imports (a graph walk would miss it, and the deploy does not); the tally is
 * shown counting comment bytes (the raw file is bigger than its code); the gate
 * is shown refusing a tally one byte over it; and the comment runs the trims
 * moved into docs/job-board-index-notes.md are shown to be what keeps the
 * deploy under the line: put back beside their code, the tally is over it.
 * Every pointer left in the code is shown to name a section the doc has.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";

const ROOT = resolve(__dirname, "../..");
const JOB_BOARD = resolve(ROOT, "supabase/functions/job-board");
const SHARED = resolve(ROOT, "supabase/functions/_shared");
const NOTES = resolve(ROOT, "docs/job-board-index-notes.md");

/** The size past which the deploy keeps serving the previous bundle. */
const DEPLOY_LINE_BYTES = 4_500_000;
/** The room the S12-083 fix asked to keep under it. */
const HEADROOM_BYTES = 50_000;
/**
 * _shared files another round has written or grown and not merged here yet,
 * with their size on that round's branch: origin/profiles/integration
 * (2026-10-12) and the wave 4 round 2 builder branches w4b/agents-api,
 * w4b/checkout-catalogue, w4b/generators, w4b/payments-delivery and
 * w4b/account-compliance (2026-10-17). A file counts the bytes its branch
 * has beyond what the disk holds.
 */
const PENDING_SHARED: Record<string, number> = {
  // profiles
  "hiring-record-gate.ts": 11_312,
  "perks-extract.ts": 43_372,
  // w4b/agents-api
  "application-form.ts": 17_557,
  "application-questions.ts": 43_288,
  "self-apply.ts": 12_714,
  // w4b/checkout-catalogue
  "affiliate-commission.ts": 5_276,
  "checkout-buyer.ts": 8_959,
  "consumable-paid.ts": 4_180,
  "customer-ownership.ts": 2_372,
  "pro-cancel.ts": 4_157,
  "product-cuts.ts": 10_139,
  "sales-territory-zones.ts": 1_803,
  "sales-territory.ts": 8_515,
  // w4b/generators
  "model-spend-gate.ts": 27_126,
  "posting-language.ts": 7_332,
  "posting-text.ts": 4_837,
  "resume-grounding.ts": 31_296,
  "writing-allowance.ts": 9_244,
  // w4b/payments-delivery
  "scan-credits.ts": 17_264,
  // w4b/account-compliance
  "account-billing.ts": 6_605,
  "account-proof.ts": 1_632,
  "marketing-pause.ts": 2_100,
  "planted-instructions.ts": 3_317,
  "shortlist-attestation.ts": 935,
  "subscription-notice.ts": 17_344,
};

/** What the pending files add: the bytes each has on its branch beyond what the disk holds. */
function pendingBytes(pending: Record<string, number>, onDisk: (name: string) => number): number {
  let n = 0;
  for (const [name, bytes] of Object.entries(pending)) n += Math.max(0, bytes - onDisk(name));
  return n;
}

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p));
    else out.push(p);
  }
  return out;
}

/** Every file the deploy counts for job-board, and its raw size. */
function uploadTally(): { files: Map<string, number>; pending: number; total: number } {
  const files = new Map<string, number>();
  for (const f of [...filesUnder(JOB_BOARD), ...filesUnder(SHARED)]) files.set(f, statSync(f).size);
  const pending = pendingBytes(PENDING_SHARED, (name) => {
    const p = join(SHARED, name);
    return existsSync(p) ? statSync(p).size : 0;
  });
  const onDisk = [...files.values()].reduce((n, b) => n + b, 0);
  return { files, pending, total: onDisk + pending };
}

/** The local import graph from job-board's entry, as the layoff-filings guard walks it. */
function importGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const walk = (file: string) => {
    if (seen.has(file) || !existsSync(file)) return;
    seen.add(file);
    for (const m of readFileSync(file, "utf8").matchAll(/(?:from|import)\s+"([^"]+)"/g)) {
      if (m[1].startsWith(".")) walk(resolve(dirname(file), m[1]));
    }
  };
  walk(entry);
  return seen;
}

const POINTER = /^([ \t]*)\/\/ Rationale: docs\/job-board-index-notes\.md#([a-z0-9-]+)[ \t]*$/gm;

/** Each section of the notes doc: its slug and the comment text it holds (the lines after its "above" line). */
function noteSections(): Map<string, string> {
  const doc = readFileSync(NOTES, "utf8");
  const out = new Map<string, string>();
  const parts = doc.split(/^## /m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf("\n");
    const slug = part.slice(0, nl).trim();
    const rest = part.slice(nl + 1).replace(/^\n+/, "");
    // The first paragraph names the code line the run stood above; the rest is the run.
    const cut = rest.indexOf("\n\n");
    out.set(slug, cut < 0 ? "" : rest.slice(cut + 2).replace(/\n+$/, ""));
  }
  return out;
}

describe("the job-board upload, tallied the deploy's way", () => {
  const { files, pending, total } = uploadTally();
  const ceiling = DEPLOY_LINE_BYTES - HEADROOM_BYTES;

  it(`stays ${HEADROOM_BYTES.toLocaleString("en-US")} bytes under the ${DEPLOY_LINE_BYTES.toLocaleString("en-US")}-byte line, counting the _shared files other rounds are adding`, () => {
    const biggest = [...files.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([f, n]) => `${relative(ROOT, f)} ${n.toLocaleString("en-US")}`).join(", ");
    expect(
      total,
      `job-board's upload is ${total.toLocaleString("en-US")} bytes (${files.size} files on disk, ${pending.toLocaleString("en-US")} pending from other rounds; biggest: ${biggest}). ` +
        `Over ${ceiling.toLocaleString("en-US")} the next deploy has less than the agreed room; over ${DEPLOY_LINE_BYTES.toLocaleString("en-US")} it reports success and serves the PREVIOUS bundle. ` +
        "Move comment runs out with scripts/trim-job-board-comments.mjs before adding code.",
    ).toBeLessThanOrEqual(ceiling);
  });

  it("TEETH: the tally counts a _shared file job-board never imports, which a graph walk would miss", () => {
    const graph = importGraph(join(JOB_BOARD, "index.ts"));
    expect(graph.size, "the import walk found nothing: it is not reading index.ts").toBeGreaterThan(20);
    const unimported = [...files.keys()].filter((f) => f.startsWith(SHARED) && !graph.has(f));
    expect(unimported.length, "every _shared file is imported by job-board, so this cannot show the folder is counted").toBeGreaterThan(0);
    const missed = unimported.reduce((n, f) => n + (files.get(f) ?? 0), 0);
    expect(missed, "the unimported _shared files weigh nothing").toBeGreaterThan(10_000);
    expect(total - missed, "the tally is the folder, not the graph").toBeLessThan(total);
  });

  it("TEETH: the tally counts comment bytes, which an esbuild size would not", () => {
    const raw = readFileSync(join(JOB_BOARD, "index.ts"), "utf8");
    const counted = files.get(join(JOB_BOARD, "index.ts"));
    expect(counted).toBe(Buffer.byteLength(raw, "utf8"));
    expect(Buffer.byteLength(codeOf(raw), "utf8"), "index.ts has no comments left to count").toBeLessThan(counted! - 50_000);
  });

  it("TEETH: a pending file counts whole while it is missing, its growth while it is smaller, and nothing once it has landed", () => {
    const disk: Record<string, number> = { "grown.ts": 1_000, "landed.ts": 5_000 };
    const sizeOf = (name: string) => disk[name] ?? 0;
    expect(pendingBytes({ "missing.ts": 700 }, sizeOf)).toBe(700);
    expect(pendingBytes({ "grown.ts": 1_250 }, sizeOf)).toBe(250);
    expect(pendingBytes({ "landed.ts": 5_000 }, sizeOf)).toBe(0);
    expect(pendingBytes({ "missing.ts": 700, "grown.ts": 1_250, "landed.ts": 5_000 }, sizeOf)).toBe(950);
    expect(pending, "no other round's growth is counted: the pending list is not being read").toBeGreaterThan(100_000);
  });

  it("TEETH: the gate refuses a tally one byte over it", () => {
    expect(() => expect(ceiling + 1).toBeLessThanOrEqual(ceiling)).toThrow();
  });

  it("every pointer the trims left names a section of the notes doc, and putting the runs back puts the upload over the line", () => {
    const sections = noteSections();
    expect(sections.size, "the notes doc has no sections").toBeGreaterThan(400);
    let pointers = 0;
    let restored = 0;
    const dangling: string[] = [];
    for (const f of filesUnder(JOB_BOARD)) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(POINTER)) {
        pointers++;
        const body = sections.get(m[2]);
        if (body === undefined) { dangling.push(`${relative(ROOT, f)} #${m[2]}`); continue; }
        // A lower bound on the run that stood there: each line back under "// ", no indent.
        const lines = body.split("\n");
        restored += Buffer.byteLength(body, "utf8") + 3 * lines.length - Buffer.byteLength(m[0], "utf8");
      }
    }
    expect(dangling, "a pointer names a section the notes doc does not have").toEqual([]);
    expect(pointers, "no pointers found: the pattern is not reading the code").toBeGreaterThan(400);
    expect(
      total + restored,
      `with the ${pointers} moved runs back beside their code the upload would be ${(total + restored).toLocaleString("en-US")} bytes, under the line: the notes doc is not what keeps the deploy serving, and this test no longer proves anything about it`,
    ).toBeGreaterThan(DEPLOY_LINE_BYTES);
  });
});
