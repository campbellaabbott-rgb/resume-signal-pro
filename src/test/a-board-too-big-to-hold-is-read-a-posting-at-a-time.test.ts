// @vitest-environment node
/**
 * A BOARD TOO BIG TO HOLD IS READ A POSTING AT A TIME.
 *
 * Measured live 2026-10-01: Anthropic, Databricks, Cloudflare, MongoDB, Okta,
 * SpaceX (greenhouse), OpenAI, Snowflake (ashby) and Palantir (lever) all
 * served ZERO postings. The 4MB byte bound (MAX_RESPONSE_BYTES, 2026-09-06)
 * refuses their list bodies; a refused board is deferred with no rows and no
 * verification stamp, and 48 hours later the nightly verification sweep stamps
 * missing_since on everything it still holds. Two mechanisms:
 *
 *  A. GREENHOUSE has a light list, reached through a persisted light-mode set
 *     that held 50 tokens while 107 boards needed one. In a cyclic rotation a
 *     FIFO smaller than its population misses on EVERY visit, so each board
 *     tripped, enrolled, was evicted by the next 50, and tripped again.
 *  B. LEVER and ASHBY have no lighter form and one document per board, so a
 *     feed over the bound was deferred on every pass, forever.
 *
 * The fix: the set holds 500 (A), and a lever/ashby board the bound refused is
 * re-read in the same visit through slim-stream.ts, which never holds the
 * document — it splits the array a posting at a time, keeps only the fields
 * the normaliser reads, and holds descriptions newest-first under a ceiling (B).
 *
 * What this file proves, each part mutation-checked against the code:
 *   (a) the cap covers the measured population with headroom, by replay;
 *   (b) the splitter agrees with JSON.parse at every chunking and THROWS on
 *       truncation, wrong shape and a missing key (a partial board read as
 *       complete feeds the id-diff prune and the closure log);
 *   (c) the normalisers see the same postings and the stored descriptions are
 *       the same text, on captured lever and ashby payloads;
 *   (d) retention is bounded, the newest descriptions survive, and a stalled
 *       read cannot outlive its deadline;
 *   (e) the retry is wired as a separate statement that never writes the
 *       verdict a failed retry falls back to;
 *   (f) readOversizeBoard and the retry, lifted out of index.ts and RUN: a
 *       spelling of them passed while the recovery was dead or empty;
 *   (g) neither a detail view nor a verify/audit liveness check repeats a
 *       board read the bound refused;
 *   (h) the verifier judges the light set's size only when it can be judged.
 *
 * Since .90 the same reader also streams a greenhouse LIGHT list (never its
 * content list); a-light-list-too-big-to-hold-is-read-a-posting-at-a-time
 * runs that, and (c), (e) and (f) here cover the greenhouse spec too.
 *
 * Every failure that leaves bytes unread must CANCEL the body. Uncancelled,
 * abandoned response bodies were the September slice deaths (heap p50 176 MB
 * against 36 after the fix), so (b) and (f) assert the cancel on the source
 * stream itself — directly, and through the byte bound's pipe.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { transformSync } from "esbuild";
import { codeOf } from "./helpers/strip-comments";
import { JOB_SOURCES } from "../../supabase/functions/job-board/sources";
import { htmlToText, isDatedBefore, normalizeAshby, normalizeGreenhouse, normalizeLever, sanePostedAt } from "../../supabase/functions/job-board/normalize";
import { beforeDeadline, jsonArrayElements, SLIM_SPECS, streamSlim } from "../../supabase/functions/job-board/slim-stream";
import population from "./fixtures/oversize-light-population-2026-10-01.json";
import leverFixture from "./fixtures/oversize-lever-palantir-2026-10-01.json";
import ashbyFixture from "./fixtures/oversize-ashby-openai-2026-10-01.json";

const FN = resolve(__dirname, "../../supabase/functions/job-board");
const CODE = codeOf(readFileSync(`${FN}/index.ts`, "utf8"));
const NORMALIZE = codeOf(readFileSync(`${FN}/normalize.ts`, "utf8"));
const num = (name: string): number => {
  const m = CODE.match(new RegExp(`const ${name} = ([0-9_]+);`));
  expect(m, `const ${name} not found in index.ts`).not.toBeNull();
  return Number(m![1].replace(/_/g, ""));
};
const STORED_DESC_CAP = num("STORED_DESC_CAP");
/** What readOversizeBoard passes; (e) pins that it passes exactly these. */
const opts = (over: Partial<Parameters<typeof streamSlim>[2]> = {}) => ({
  freshCutoffMs: CUTOFF,
  maxBytes: num("SLIM_RETAINED_BYTES"),
  maxElementBytes: num("SLIM_ELEMENT_BYTES"),
  descKeepChars: 2 * STORED_DESC_CAP,
  descCeiling: num("SLIM_DESC_CEILING"),
  deadlineAt: Date.now() + 30_000,
  ...over,
});
// The fixtures were captured 2026-10-01; the window is anchored there so the
// in-fence set does not drain to nothing as the calendar moves on.
const CAPTURED = Date.parse("2026-10-01T20:12:00Z");
const CUTOFF = CAPTURED - 30 * 86_400_000;

const enc = new TextEncoder();
function streamOf(bytes: Uint8Array, chunk: number): ReadableStream<Uint8Array> {
  let o = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (o >= bytes.length) { c.close(); return; }
      c.enqueue(bytes.slice(o, o + chunk));
      o += chunk;
    },
  });
}
/** A source that records what was pulled from it and whether it was cancelled. `stall`: never ends. */
function recorded(chunks: Iterable<Uint8Array>, stall = false) {
  const rec = { pulled: 0, cancelled: false };
  const it = chunks[Symbol.iterator]();
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      const n = it.next();
      if (n.done) {
        if (stall) return new Promise<void>(() => {});
        c.close();
        return;
      }
      rec.pulled += n.value.length;
      c.enqueue(n.value);
    },
    cancel() { rec.cancelled = true; },
  });
  return { stream, rec };
}
function* chunked(bytes: Uint8Array, size: number): Generator<Uint8Array> {
  for (let o = 0; o < bytes.length; o += size) yield bytes.slice(o, o + size);
}
/** Cancellation crosses a pipe and a few promise turns before it reaches the source. */
const settle = () => new Promise((r) => setTimeout(r, 30));
const drain = async (it: AsyncIterable<unknown>) => { for await (const _ of it) { /* drain */ } };

async function collect(doc: string | Uint8Array, key: string | null, chunk: number, maxEl = 1_000_000): Promise<unknown[]> {
  const bytes = typeof doc === "string" ? enc.encode(doc) : doc;
  const dec = new TextDecoder();
  const out: unknown[] = [];
  for await (const el of jsonArrayElements(streamOf(bytes, chunk), key, maxEl, Date.now() + 10_000)) out.push(JSON.parse(dec.decode(el)));
  return out;
}

/**
 * index.ts's own description text for these two vendors, copied verbatim —
 * and (c) pins that index.ts still says exactly this, so the copy cannot drift.
 */
// deno-lint-ignore no-explicit-any
const indexDesc = (vendor: "lever" | "ashby", j: any): string => {
  const text = vendor === "lever"
    ? ((j.descriptionPlain ?? "") + (j.descriptionBodyPlain ? `\n${j.descriptionBodyPlain}` : "")).trim()
    : (j.descriptionPlain ?? (j.descriptionHtml ? htmlToText(j.descriptionHtml) : "")).trim();
  return text.slice(0, STORED_DESC_CAP);
};

describe("(a) the light set holds the population that needs it", () => {
  const cap = num("AUTO_LIGHT_CAP");
  const vendors = [...CODE.match(/const LIGHT_CAPABLE_VENDORS = new Set\(\[([^\]]*)\]\)/)![1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
  // The set's own admission rule (lightBoardRefusal, since .89 keyed by
  // source:token): the census boards are greenhouse boards, so a board is
  // refused only when the catalog holds no greenhouse board on that token or
  // greenhouse stops being light-capable. A twin on another vendor no longer
  // matters: it keeps its own key and stays out of light mode.
  const refused = (token: string) =>
    !vendors.includes("greenhouse") || !JOB_SOURCES.some((s) => s.token === token && s.source === "greenhouse");

  it("both writers persist the newest AUTO_LIGHT_CAP entries — the shape the replay models", () => {
    const writes = CODE.match(/tokens: \[\.\.\.DYNAMIC_LIGHT\]\.slice\(-AUTO_LIGHT_CAP\)/g) ?? [];
    expect(writes.length, "the replay below models append-then-keep-the-newest; the writers must still do that").toBe(2);
  });

  it("replayed over the 107 measured boards for three rotations, no enrollable board misses after the first", () => {
    const boards = population.boards.map((b) => b.token);
    expect(boards.length, "the 2026-10-01 census").toBe(107);
    let row: string[] = [];
    const missesByRotation: number[] = [];
    const missedAfterFirst = new Set<string>();
    for (let rot = 0; rot < 3; rot++) {
      let misses = 0;
      for (const t of boards) {
        if (row.includes(t)) continue;
        misses++;
        if (rot > 0) missedAfterFirst.add(t);
        if (refused(t)) continue; // refused: no slot taken, trips again next visit
        row.push(t);
        row = row.slice(-cap);
      }
      missesByRotation.push(misses);
    }
    const enrollableMissed = [...missedAfterFirst].filter((t) => !refused(t));
    expect(
      enrollableMissed,
      `AUTO_LIGHT_CAP=${cap}: these boards were evicted before their next visit and trip the byte bound again — misses per rotation ${JSON.stringify(missesByRotation)}`,
    ).toEqual([]);
    expect(cap, "four times the measured population, so the next census does not refill it").toBeGreaterThanOrEqual(4 * boards.length);
  });

  it("the set refuses none of the census boards: the shared-token follow-up is done (.89)", () => {
    // lush, samsara, pulse and helsing share their token with personio,
    // pinpoint or ashby. Under a token key going light would have stripped
    // the twin's descriptions, so they were refused and stayed dark; keyed by
    // board, the greenhouse board goes light alone.
    const r = population.boards.map((b) => b.token).filter(refused);
    expect(r, "census boards refused light mode, so they stay over the byte bound").toEqual([]);
  });

  it("saturation is visible: slice_stats carries the set's size beside its cap", () => {
    const i = CODE.indexOf("async function recordSliceStats(");
    const body = CODE.slice(i, CODE.indexOf("\n}\n", i));
    expect(body).toMatch(/lightSet: DYNAMIC_LIGHT\.size,/);
    expect(body).toMatch(/lightCap: AUTO_LIGHT_CAP,/);
  });
});

describe("(b) the splitter agrees with JSON.parse, and refuses what it cannot finish", () => {
  const tricky = [
    { id: "a", text: 'quote " inside', s: "brace } bracket ] open { [", esc: "back\\slash \\\" \\\\", nested: [[1, [2]], { x: [] }] },
    { id: "b", uni: "héllo — 日本語 \u2028 😀", e: "\\u00e9 escaped" },
    { id: "c", empty: {}, arr: [], deep: { a: { b: { c: [{ d: "}" }] } } } },
  ];
  const leverDoc = ` \n${JSON.stringify(tricky, null, 2)}\n `;
  const ashbyDoc = JSON.stringify({ apiVersion: "1", meta: { jobs: [{ id: "decoy" }] }, warnings: [], jobs: tricky, after: "x" });

  for (const chunk of [1, 2, 3, 7, 64, 1e9]) {
    it(`chunk size ${chunk}: lever document-is-the-array and ashby jobs-under-a-key both equal JSON.parse`, async () => {
      expect(await collect(leverDoc, null, chunk)).toEqual(JSON.parse(leverDoc));
      expect(await collect(ashbyDoc, "jobs", chunk)).toEqual(JSON.parse(ashbyDoc).jobs);
    });
  }

  it("a multi-byte character split across chunks decodes intact", async () => {
    const doc = JSON.stringify([{ id: "x", t: "日本語😀é" }]);
    const bytes = enc.encode(doc);
    for (let cut = 1; cut < bytes.length; cut++) {
      const parts = [bytes.slice(0, cut), bytes.slice(cut)];
      const s = new ReadableStream<Uint8Array>({ start(c) { for (const p of parts) c.enqueue(p); c.close(); } });
      const dec = new TextDecoder();
      const got: unknown[] = [];
      for await (const el of jsonArrayElements(s, null, 1e6, Date.now() + 5000)) got.push(JSON.parse(dec.decode(el)));
      expect(got).toEqual(JSON.parse(doc));
    }
  });

  it("an empty array is an empty board, not an error", async () => {
    expect(await collect("[]", null, 1)).toEqual([]);
    expect(await collect('{"jobs":[]}', "jobs", 1)).toEqual([]);
  });

  it("THROWS on a truncated document — at every cut point, including mid-element and after the last element", async () => {
    const whole = JSON.stringify(tricky);
    for (let cut = 1; cut < whole.length; cut++) {
      await expect(collect(whole.slice(0, cut), null, 5), `a document cut at ${cut} of ${whole.length} read as complete`).rejects.toThrow();
    }
    const a = JSON.stringify({ jobs: tricky, after: 1 });
    await expect(collect(a.slice(0, a.indexOf(',"after"')), "jobs", 5), "the jobs array closed but the document did not").rejects.toThrow(/truncated/);
  });

  it("THROWS on the wrong top-level shape, a missing key, and a key only under a nested object", async () => {
    await expect(collect(JSON.stringify({ jobs: tricky }), null, 7), "lever must be an array").rejects.toThrow(/not an array/);
    await expect(collect(JSON.stringify(tricky), "jobs", 7), "ashby must be an object").rejects.toThrow(/not an object/);
    await expect(collect(JSON.stringify({ postings: tricky }), "jobs", 7)).rejects.toThrow(/no "jobs" array/);
    await expect(collect(JSON.stringify({ data: { jobs: tricky } }), "jobs", 7), "a nested jobs key is not the board").rejects.toThrow(/no "jobs" array/);
    await expect(collect(JSON.stringify({ jobs: null }), "jobs", 7)).rejects.toThrow(/no "jobs" array/);
    await expect(collect("", null, 7)).rejects.toThrow();
  });

  it("one element over the per-element budget throws with the oversize marker", async () => {
    const doc = JSON.stringify([{ id: "small" }, { id: "big", pad: "x".repeat(5000) }]);
    for (const chunk of [64, 1e9]) await expect(collect(doc, null, chunk, 2000)).rejects.toThrow(/^OVERSIZE_BODY element \d+ > 2000$/);
  });

  it("a stalled body rejects at its deadline instead of hanging the worker", async () => {
    const stalled = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(enc.encode('[{"id":"1"},')); } });
    const t0 = Date.now();
    const run = (async () => { for await (const _ of jsonArrayElements(stalled, null, 1e6, Date.now() + 200)) { /* drain */ } })();
    await expect(run).rejects.toThrow(/^OVERSIZE_BODY slow/);
    expect(Date.now() - t0, "the deadline must bound every read, not only the gaps between elements").toBeLessThan(1500);
  });

  it("a response that arrives after its deadline is still released", async () => {
    let released: unknown = null;
    const late = new Promise<{ tag: string }>((r) => setTimeout(() => r({ tag: "late" }), 150));
    await expect(beforeDeadline(late, Date.now() + 30, (v) => { released = v; })).rejects.toThrow(/^OVERSIZE_BODY slow/);
    await new Promise((r) => setTimeout(r, 250));
    expect(released, "a response nobody waited for must still reach its release").toEqual({ tag: "late" });
  });

  // Each failure below happens with bytes still unread, which is the only case
  // a cancel can release: a TRUNCATED body has already been read to its end,
  // the source has closed, and cancelling a closed stream calls nothing.
  const tailOf = (n: number) => Array.from({ length: n }, (_, k) => ({ id: `t${k}`, pad: "z".repeat(400) }));
  type Failure = { src: ReturnType<typeof recorded>; run: (s: ReadableStream<Uint8Array>) => Promise<unknown>; marker: RegExp };
  const failures: Array<[string, () => Failure]> = [
    ["a read that misses its deadline", () => ({
      src: recorded([enc.encode('[{"id":"1"},')], true),
      run: (st) => drain(jsonArrayElements(st, null, 1e6, Date.now() + 150)),
      marker: /^OVERSIZE_BODY slow/,
    })],
    ["the wrong top-level shape", () => ({
      src: recorded(chunked(enc.encode(JSON.stringify({ jobs: tailOf(200) })), 64)),
      run: (st) => drain(jsonArrayElements(st, null, 1e6, Date.now() + 5000)),
      marker: /not an array/,
    })],
    ["a document that closes more than it opened", () => ({
      src: recorded(chunked(enc.encode('[{"a":1}]}' + " ".repeat(20_000)), 64)),
      run: (st) => drain(jsonArrayElements(st, null, 1e6, Date.now() + 5000)),
      marker: /closes more than it opened/,
    })],
    ["one element over budget, whole in one chunk (refused at the element's end)", () => ({
      src: recorded(chunked(enc.encode(JSON.stringify([{ id: "small" }, { id: "big", pad: "x".repeat(5000) }, ...tailOf(200)])), 6000)),
      run: (st) => drain(jsonArrayElements(st, null, 2000, Date.now() + 5000)),
      marker: /^OVERSIZE_BODY element \d+ > 2000$/,
    })],
    ["one element over budget, across chunks (refused as it accumulates)", () => ({
      src: recorded(chunked(enc.encode(JSON.stringify([{ id: "big", pad: "x".repeat(5000) }, ...tailOf(200)])), 64)),
      run: (st) => drain(jsonArrayElements(st, null, 2000, Date.now() + 5000)),
      marker: /^OVERSIZE_BODY element \d+ > 2000$/,
    })],
    ["the consumer giving up mid-feed (streamSlim's metadata budget)", () => ({
      src: recorded(chunked(enc.encode(JSON.stringify(Array.from({ length: 2000 }, (_, k) => ({ id: `p${k}`, text: "T".repeat(200), hostedUrl: `https://jobs.lever.co/x/p${k}`, createdAt: CUTOFF - 86_400_000 })))), 4096)),
      run: (st) => streamSlim(st, SLIM_SPECS.lever, opts({ maxBytes: 20_000 })),
      marker: /^OVERSIZE_BODY slim \d+ > 20000$/,
    })],
  ];
  for (const [name, make] of failures) {
    it(`CANCELS the body on ${name} — an abandoned response is the slice-death leak`, async () => {
      const { src, run, marker } = make();
      await expect(run(src.stream)).rejects.toThrow(marker);
      await settle();
      expect(src.rec.cancelled, "the reader was abandoned with bytes unread and never cancelled").toBe(true);
    });
  }

  it("one huge element is refused as it arrives, not after all of it has been buffered", async () => {
    const MAX = 20_000, CH = 1000;
    const a = enc.encode("a".repeat(CH));
    const { stream, rec } = recorded((function* () {
      yield enc.encode('[{"id":"x","pad":"');
      for (let k = 0; k < 2000; k++) yield a; // 2 MB of one string
      yield enc.encode('"}]');
    })());
    await expect(drain(jsonArrayElements(stream, null, MAX, Date.now() + 10_000))).rejects.toThrow(/^OVERSIZE_BODY element \d+ > 20000$/);
    expect(rec.pulled, "bytes pulled before the refusal: the element bound must act per chunk, not at the element's end").toBeLessThanOrEqual(MAX + 4 * CH);
    await settle();
    expect(rec.cancelled, "and the 2 MB it did not read are released").toBe(true);
  });
});

describe("(c) the normalisers see the same postings, and the stored text is the same text", () => {
  // The two description expressions this file copies, pinned where they live.
  it("index.ts still builds lever and ashby descriptions exactly as indexDesc does", () => {
    expect(CODE).toContain('const text = ((j.descriptionPlain ?? "") + (j.descriptionBodyPlain ? `\\n${j.descriptionBodyPlain}` : "")).trim();');
    expect(CODE).toContain('const text = (j.descriptionPlain ?? (j.descriptionHtml ? htmlToText(j.descriptionHtml) : "")).trim();');
    expect(CODE).toContain("descs.set(`lever:${s.token}:${j.id}`, text.slice(0, STORED_DESC_CAP));");
    expect(CODE).toContain("descs.set(`ashby:${s.token}:${j.id}`, text.slice(0, STORED_DESC_CAP));");
  });

  it("the allowlists keep every field the normalisers read — derived from normalize.ts, not listed", () => {
    for (const [vendor, fn] of [["lever", "normalizeLever"], ["ashby", "normalizeAshby"], ["greenhouse", "normalizeGreenhouse"]] as const) {
      const i = NORMALIZE.indexOf(`export function ${fn}(`);
      expect(i, `${fn} not found`).toBeGreaterThan(0);
      // A filter over the normaliser's OUTPUT rows (greenhouse drops a row with no applyUrl) reads no feed field.
      // Cut only that exact tail: any other shape stays in and fails closed.
      const body = NORMALIZE.slice(i, NORMALIZE.indexOf("\n}\n", i)).replace(/\}\)\.filter\(\(j\) => j\.applyUrl !== ""\);$/, "});");
      const read = new Set([...body.matchAll(/\bj\.(\w+)/g)].map((m) => m[1]));
      expect(read.size, `${fn}: the field derivation found nothing`).toBeGreaterThan(5);
      const missing = [...read].filter((f) => !SLIM_SPECS[vendor].keep.includes(f));
      expect(missing, `${fn} reads these fields and the streamed ${vendor} row drops them`).toEqual([]);
      // A bare `j` handed to a helper would hide the fields it reads.
      const bare = [...body.matchAll(/\bj\b(?!\s*(?:\.|\?\.))/g)].filter((m) => !/\(j\)\s*=>/.test(body.slice(m.index! - 1, m.index! + 8)) && !/^const j of /.test(body.slice(m.index! - 6, m.index! + 5)));
      expect(bare.map((m) => body.slice(m.index! - 20, m.index! + 20)), `${fn} passes the whole posting somewhere the derivation cannot see`).toEqual([]);
    }
    const sub = [...NORMALIZE.matchAll(/\bj\.compensation\?\.(\w+)/g)].map((m) => m[1]);
    const slim = { compensation: Object.fromEntries([...sub, "compensationTiers"].map((k) => [k, k])) };
    SLIM_SPECS.ashby.reduce!(slim);
    expect(Object.keys(slim.compensation).sort(), "the ashby compensation cut keeps what normalizeAshby reads").toEqual([...new Set(sub)].sort());
  });

  // Synthetic rows beside the captured ones: an undated lever posting (an
  // undated posting is kept by the ingest and so needs its text), one with no
  // URL (dropped by the normaliser), one whose text is past the keep cap; an
  // ashby posting with HTML only, an unlisted one, and one whose plain text is
  // EMPTY beside HTML — index.ts takes the empty plain text (it tests for
  // absence, not emptiness), so the stream must store nothing there either.
  const longText = "word ".repeat(6000);
  const lever = [
    ...leverFixture,
    { id: "undated", text: "Analyst", hostedUrl: "https://jobs.lever.co/x/undated", createdAt: 0, descriptionPlain: "  undated text  ", categories: { team: "Ops" } },
    { id: "nourl", text: "No URL", createdAt: CAPTURED - 86_400_000, descriptionPlain: "x" },
    { id: "long", text: "Writer", hostedUrl: "https://jobs.lever.co/x/long", createdAt: CAPTURED - 86_400_000, descriptionPlain: longText, descriptionBodyPlain: "tail" },
  ];
  const ashby = {
    ...ashbyFixture,
    jobs: [
      ...ashbyFixture.jobs,
      { id: "htmlonly", title: "Designer", jobUrl: "https://jobs.ashbyhq.com/x/htmlonly", publishedAt: new Date(CAPTURED - 86_400_000).toISOString(), descriptionHtml: "<p>Design &amp; build</p><ul><li>one</li></ul>" },
      { id: "unlisted", title: "Hidden", jobUrl: "https://jobs.ashbyhq.com/x/unlisted", isListed: false, publishedAt: new Date(CAPTURED).toISOString(), descriptionPlain: "hidden" },
      { id: "emptyplain", title: "Analyst", jobUrl: "https://jobs.ashbyhq.com/x/emptyplain", publishedAt: new Date(CAPTURED - 2 * 86_400_000).toISOString(), descriptionPlain: "", descriptionHtml: "<p>Only the HTML says anything</p>" },
    ],
  };

  for (const [vendor, doc] of [["lever", lever], ["ashby", ashby]] as const) {
    it(`${vendor}: normaliser output and in-fence description text are identical to the whole-body read`, async () => {
      const N = vendor === "lever" ? normalizeLever : normalizeAshby;
      const bytes = enc.encode(JSON.stringify(doc));
      for (const chunk of [3, 61, 4096]) {
        const { raw } = await streamSlim(streamOf(bytes, chunk), SLIM_SPECS[vendor], opts());
        const whole = JSON.parse(JSON.stringify(doc));
        expect(N(raw as never, "Co", "tok")).toEqual(N(whole, "Co", "tok"));
        // deno-lint-ignore no-explicit-any
        const streamed: any[] = vendor === "lever" ? (raw as any[]) : (raw as { jobs: any[] }).jobs;
        // deno-lint-ignore no-explicit-any
        const wholeRows: any[] = vendor === "lever" ? whole : whole.jobs;
        let inFence = 0;
        for (const p of N(whole, "Co", "tok")) {
          if (isDatedBefore(sanePostedAt(p.postedAt), CUTOFF)) continue; // the ingest drops it; its text is never stored
          inFence++;
          const id = p.id.split(":")[2];
          const k = wholeRows.findIndex((j) => String(j.id) === id);
          expect(indexDesc(vendor, streamed[k]), `${vendor} ${id}: stored description differs`).toBe(indexDesc(vendor, wholeRows[k]));
        }
        expect(inFence, "the in-fence set is empty — this comparison would pass on nothing").toBeGreaterThanOrEqual(4);
        // And an aged posting carries no text at all.
        for (const p of N(whole, "Co", "tok")) {
          if (!isDatedBefore(sanePostedAt(p.postedAt), CUTOFF)) continue;
          const k = wholeRows.findIndex((j) => String(j.id) === p.id.split(":")[2]);
          expect(streamed[k].descriptionPlain, `${p.id} is aged and must not hold a description`).toBeUndefined();
        }
      }
    });
  }
});

describe("(d) retention is bounded and the newest descriptions survive", () => {
  const leverRow = (k: number, createdAt: number, descChars: number) =>
    JSON.stringify({ id: `p${k}`, text: `Role ${k}`, hostedUrl: `https://jobs.lever.co/x/p${k}`, createdAt, categories: { team: "T", location: "L" }, descriptionPlain: "d".repeat(descChars), lists: [{ text: "x", content: "y".repeat(400) }] });
  /** A lever document generated lazily, so the test never holds it either. */
  const lazyLever = (n: number, at: (k: number) => number, descChars: number) => {
    let k = 0;
    return new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(enc.encode("[")); },
      pull(c) {
        if (k >= n) { c.enqueue(enc.encode("]")); c.close(); return; }
        c.enqueue(enc.encode((k ? "," : "") + leverRow(k, at(k), descChars)));
        k++;
      },
    });
  };

  it("budgets from source: retained plus one element fits the per-response bound; the read fits the slice clock", () => {
    expect(num("SLIM_RETAINED_BYTES") + num("SLIM_ELEMENT_BYTES")).toBeLessThanOrEqual(num("MAX_RESPONSE_BYTES"));
    expect(num("SLIM_DESC_CEILING")).toBeLessThanOrEqual(num("SLIM_RETAINED_BYTES"));
    expect(num("STREAM_READ_BUDGET_MS")).toBeLessThan(num("SLICE_WALL_BUDGET_MS"));
  });

  it("a 40MB feed completes inside the retained budget, aged postings hold no text, and the newest texts are the ones kept", async () => {
    const n = 4000;
    // In-window and aged interleaved, and the in-window dates a PERMUTATION of
    // arrival order (7919 and 4001 are both prime): older postings keep
    // arriving after newer ones while the ceiling binds, so both halves of
    // newest-first are exercised — a newer arrival displaces an older text,
    // and an older arrival displaces nothing.
    const at = (k: number) => (k % 3 === 0 ? CUTOFF - 86_400_000 * (1 + (k % 7)) : CUTOFF + ((k * 7919) % 4001) * 600_000);
    const { raw, stats } = await streamSlim(lazyLever(n, at, 9000), SLIM_SPECS.lever, opts());
    expect(stats.bytes, "the generator really produced ~40MB").toBeGreaterThan(38_000_000);
    expect(stats.slimBytes).toBeLessThanOrEqual(num("SLIM_RETAINED_BYTES"));
    expect(stats.descDropped, "the ceiling must actually bind for this to test anything").toBeGreaterThan(0);
    const rows = raw as Array<{ id: string; createdAt: number; descriptionPlain?: string }>;
    expect(rows.length).toBe(n);
    const arrivals = rows.filter((r) => r.createdAt >= CUTOFF).map((r) => r.createdAt);
    expect(arrivals.some((t, i) => i > 0 && t < arrivals[i - 1]), "arrival order is date order: an older arrival after a newer one is untested").toBe(true);
    const kept = rows.filter((r) => r.descriptionPlain !== undefined);
    const droppedFresh = rows.filter((r) => r.descriptionPlain === undefined && r.createdAt >= CUTOFF);
    expect(rows.filter((r) => r.createdAt < CUTOFF && r.descriptionPlain !== undefined), "aged postings hold no text").toEqual([]);
    expect(Math.min(...kept.map((r) => r.createdAt)), "a newer description was given up while an older one was kept")
      .toBeGreaterThanOrEqual(Math.max(...droppedFresh.map((r) => r.createdAt)));
  });

  it("metadata alone over the budget rejects with the oversize marker", async () => {
    await expect(streamSlim(lazyLever(400, () => CUTOFF, 10), SLIM_SPECS.lever, opts({ maxBytes: 20_000 }))).rejects.toThrow(/^OVERSIZE_BODY slim \d+ > 20000$/);
  });

  it("one element over the element budget rejects with the oversize marker", async () => {
    await expect(streamSlim(lazyLever(3, () => CUTOFF, 50_000), SLIM_SPECS.lever, opts({ maxElementBytes: 20_000 }))).rejects.toThrow(/^OVERSIZE_BODY element \d+ > 20000$/);
  });

  /** A lever document generated lazily from a row function. */
  const lazyDoc = (n: number, row: (k: number) => Record<string, unknown>) => {
    let k = 0;
    return new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(enc.encode("[")); },
      pull(c) {
        if (k >= n) { c.enqueue(enc.encode("]")); c.close(); return; }
        c.enqueue(enc.encode((k ? "," : "") + JSON.stringify(row(k))));
        k++;
      },
    });
  };
  /** ~370 chars of kept metadata and no text: the pressure that rises after the texts are held. */
  const agedRow = (k: number) => ({ id: `a${k}`, text: `Role ${"x".repeat(150)}`, hostedUrl: `https://jobs.lever.co/x/a${k}`, createdAt: CUTOFF - 3 * 86_400_000, categories: { team: "T".repeat(40), location: "L".repeat(40) } });
  /** What streamSlim counts as metadata, recomputed from its output: each row without its text. */
  const metaOf = (rows: Array<Record<string, unknown>>) =>
    rows.reduce((a, r) => { const { descriptionPlain: _d, ...m } = r; return a + JSON.stringify(m).length; }, 0);
  const textOf = (rows: Array<Record<string, unknown>>) => rows.reduce((a, r) => a + String(r.descriptionPlain ?? "").length, 0);

  it("UNDATED texts are bounded too: metadata outranks every held text, so retained never passes the budget", async () => {
    // An undated posting is kept by the ingest, so it holds its text — and it
    // ranks as the newest, so newest-first never gives it up. Held early, then
    // metadata climbs: the first version could not evict them and finished
    // with 4.8 MB retained against a 3 MB budget, without throwing.
    const U = 240;
    const row = (k: number) => (k < U ? { id: `u${k}`, text: `Undated ${k}`, hostedUrl: `https://jobs.lever.co/x/u${k}`, descriptionPlain: "u".repeat(10_000) } : agedRow(k));
    const { raw, stats } = await streamSlim(lazyDoc(U + 6400, row), SLIM_SPECS.lever, opts());
    const rows = raw as Array<Record<string, unknown>>;
    const meta = metaOf(rows);
    expect(meta, "metadata must climb far enough to need the texts' room, or this binds nothing").toBeGreaterThan(num("SLIM_DESC_CEILING") - U * 10_000);
    expect(meta).toBeLessThan(num("SLIM_RETAINED_BYTES"));
    expect(stats.slimBytes, "slimBytes is what the rows actually hold").toBe(meta + textOf(rows));
    expect(stats.slimBytes, "retained past SLIM_RETAINED_BYTES, and nothing threw").toBeLessThanOrEqual(num("SLIM_RETAINED_BYTES"));
    expect(stats.slimBytes).toBeLessThanOrEqual(Math.max(num("SLIM_DESC_CEILING"), meta));
  });

  it("while metadata stays under the ceiling, metadata plus held texts stays under it too", async () => {
    const row = (k: number) => (k < 240 ? { id: `d${k}`, text: `Dated ${k}`, hostedUrl: `https://jobs.lever.co/x/d${k}`, createdAt: CUTOFF + k * 3_600_000, descriptionPlain: "d".repeat(10_000) } : agedRow(k));
    const { raw, stats } = await streamSlim(lazyDoc(240 + 6400, row), SLIM_SPECS.lever, opts());
    const rows = raw as Array<Record<string, unknown>>;
    const meta = metaOf(rows);
    expect(meta, "the case this covers: metadata alone under the ceiling").toBeLessThan(num("SLIM_DESC_CEILING"));
    expect(meta + 240 * 10_000, "and all the texts together would not fit beside it").toBeGreaterThan(num("SLIM_DESC_CEILING"));
    expect(stats.slimBytes).toBe(meta + textOf(rows));
    expect(stats.slimBytes, "the texts held before the metadata arrived were never given back").toBeLessThanOrEqual(num("SLIM_DESC_CEILING"));
    expect(stats.descDropped).toBeGreaterThan(0);
  });

  it("an undated text is given up only after every dated one", async () => {
    // 100 undated and 300 dated in-window postings, interleaved and all held
    // at first; then metadata forces about a third of the texts out.
    const row = (k: number) => k >= 400 ? agedRow(k)
      : k % 4 === 0 ? { id: `u${k}`, text: `Undated ${k}`, hostedUrl: `https://jobs.lever.co/x/u${k}`, descriptionPlain: "u".repeat(5000) }
      : { id: `d${k}`, text: `Dated ${k}`, hostedUrl: `https://jobs.lever.co/x/d${k}`, createdAt: CUTOFF + ((k * 37) % 400) * 3_600_000, descriptionPlain: "d".repeat(5000) };
    const { raw } = await streamSlim(lazyDoc(400 + 3000, row), SLIM_SPECS.lever, opts());
    const rows = (raw as Array<{ id: string; createdAt?: number; descriptionPlain?: string }>).slice(0, 400);
    const undated = rows.filter((r) => r.createdAt === undefined);
    const dated = rows.filter((r) => r.createdAt !== undefined);
    const droppedDated = dated.filter((r) => r.descriptionPlain === undefined);
    expect(droppedDated.length, "the ceiling must bind for the order to matter").toBeGreaterThan(0);
    expect(undated.filter((r) => r.descriptionPlain === undefined).map((r) => r.id), "an undated text was given up while a dated one was still held").toEqual([]);
    const keptDated = dated.filter((r) => r.descriptionPlain !== undefined);
    expect(Math.max(...droppedDated.map((r) => r.createdAt!)), "and among dated texts, the oldest went first").toBeLessThanOrEqual(Math.min(...keptDated.map((r) => r.createdAt!)));
  });

  it("the ashby compensation cut is made IN the stream, so the tiers never sit in retained memory", async () => {
    const tiers = Array.from({ length: 20 }, (_, t) => ({ id: `tier${t}`, title: "Band", components: [{ compensationType: "Salary", interval: "1 YEAR", minValue: 1e5, maxValue: 2e5, currencyCode: "USD", summary: "x".repeat(200) }] }));
    const doc = {
      jobs: Array.from({ length: 50 }, (_, k) => ({
        id: `j${k}`, title: `Role ${k}`, jobUrl: `https://jobs.ashbyhq.com/x/j${k}`, publishedAt: new Date(CUTOFF - 86_400_000).toISOString(),
        compensation: { compensationTierSummary: "$100K - $200K", scrapeableCompensationSalarySummary: "$100K - $200K", compensationTiers: tiers, summaryComponents: tiers[0].components },
      })),
    };
    const { raw, stats } = await streamSlim(streamOf(enc.encode(JSON.stringify(doc)), 4096), SLIM_SPECS.ashby, opts());
    for (const j of (raw as { jobs: Array<{ compensation: object }> }).jobs) {
      expect(Object.keys(j.compensation).sort(), "a streamed row kept compensation the normaliser never reads").toEqual(["compensationTierSummary", "scrapeableCompensationSalarySummary"]);
    }
    expect(stats.slimBytes, "and the retained count is of the cut rows").toBeLessThan(50 * 400);
  });
});

describe("(e) the retry is a separate statement that never writes the failure verdict", () => {
  const call = "r = await fetchBoard(s, (m) => { failReason = m; }, deepCursors.get(s.token) ?? 0);";
  const fetchAt = CODE.indexOf(call);
  const countAt = CODE.indexOf("if (r) fetchedInSlice += r.jobs.length;");
  const between = CODE.slice(fetchAt, countAt);
  const retryAt = between.indexOf("if (!r && ");
  const retry = between.slice(retryAt);
  const condition = retry.slice(0, retry.indexOf(") {\n"));

  it("sits after the pinned fetch and before the landed-postings count", () => {
    expect(fetchAt, "the pinned worker fetch call is gone").toBeGreaterThan(0);
    expect(countAt).toBeGreaterThan(fetchAt);
    expect(retryAt, "no retry statement between the fetch and the count").toBeGreaterThan(0);
    expect(retry).toMatch(/r = await readOversizeBoard\(s, Date\.now\(\) \+ STREAM_READ_BUDGET_MS, freshCutoffMs\);/);
  });

  it("starts only on an oversize verdict, for a vendor it can stream, inside the slice clock", () => {
    expect(condition).toContain('failReason.startsWith("oversize")');
    expect(condition).toContain("SLIM_SPECS[s.source]");
    expect(condition, "a 30s read started near the wall overruns the window every surviving slice has finished in")
      .toContain("Date.now() - sliceWallStart + STREAM_READ_BUDGET_MS <= SLICE_WALL_BUDGET_MS");
    expect(condition, "and not past the heap gate that stops new boards").toContain("< HEAP_SOFT_LIMIT_MB");
  });

  it("never assigns failReason: a failed retry is today's named deferral, never a vendor failure", () => {
    expect(retry, "the retry wrote the verdict the oversize branch keys on").not.toMatch(/failReason\s*=[^=]/);
    expect(retry, "its reservation is taken and released like the fetch's").toMatch(/inFlightReserve \+= reserve;\s*try \{ r = await readOversizeBoard\([^;]*\); \}\s*finally \{ inFlightReserve -= reserve; \}/);
  });

  it("readOversizeBoard has one caller, streams through the bounded fetch under the deadline, and swallows every failure", () => {
    expect((CODE.match(/readOversizeBoard\(/g) ?? []).length, "a declaration and exactly one caller").toBe(2);
    const i = CODE.indexOf("async function readOversizeBoard(");
    const body = CODE.slice(i, CODE.indexOf("\n}\n", i));
    expect(body).toMatch(/await beforeDeadline\(fetchWithTimeout\(listUrl\(s\), undefined, STREAM_WIRE_BYTES\), deadlineAt, discardBody\)/);
    expect(body).toMatch(/streamSlim\(res\.body, spec, \{/);
    for (const opt of ["freshCutoffMs,", "maxBytes: SLIM_RETAINED_BYTES,", "maxElementBytes: SLIM_ELEMENT_BYTES,", "descKeepChars: 2 * STORED_DESC_CAP,", "descCeiling: SLIM_DESC_CEILING,", "deadlineAt,"]) {
      expect(body, `streamSlim must be called with ${opt}`).toContain(opt);
    }
    expect(body, "a non-JSON or failed response is released and refused").toMatch(/discardBody\(res\);/);
    expect(body).toMatch(/s\.source === "lever" \? normalizeLever\(/);
    expect(body).toMatch(/s\.source === "ashby" \? normalizeAshby\(/);
    expect(body, "every failure becomes null, which the oversize branch defers").toMatch(/\} catch \(e\) \{[\s\S]*return null;\s*\}$/);
    expect(body).not.toMatch(/failReason|onFail/);
    expect(Object.keys(SLIM_SPECS).sort(), "a vendor with a spec needs a normaliser branch above; (f) runs each").toEqual(["ashby", "greenhouse", "lever"]);
  });
});

// ── lifting shipped code out of index.ts ────────────────────────────────────
// index.ts cannot be imported (it calls Deno.serve at load and imports from
// esm.sh), so the parts under test are cut out of it, transpiled, and run. Cut
// from the RAW text: esbuild drops the comments itself, and the shared
// stripper collapses a `catch { /* note */ }` as if it were a JSX comment
// brace, which leaves source that does not parse. A miss throws: the code
// moved, and this harness must be re-pointed on purpose, not pass on nothing.
const RAW_INDEX = readFileSync(`${FN}/index.ts`, "utf8");
const constDecl = (name: string): string => {
  const m = RAW_INDEX.match(new RegExp(`^const ${name}\\b[^;\\n]*;`, "m"));
  if (!m) throw new Error(`const ${name} not found at the top level of index.ts — re-anchor this harness`);
  return m[0];
};
const fnDecl = (head: string): string => {
  const i = RAW_INDEX.indexOf(`\n${head}`);
  if (i < 0) throw new Error(`${head} not found at the top level of index.ts — re-anchor this harness`);
  return RAW_INDEX.slice(i + 1, RAW_INDEX.indexOf("\n}\n", i) + 2);
};
const toJs = (ts: string): string => {
  try {
    return transformSync(ts, { loader: "ts" }).code;
  } catch (e) {
    throw new Error(`the lifted source does not compile (${e instanceof Error ? e.message : String(e)})\n--- lifted ---\n${ts}`);
  }
};

describe("(f) readOversizeBoard and the worker's retry, executed — not spelled", () => {
  type Board = { source: string; token: string; name: string };
  type Read = { jobs: unknown[]; raw: unknown } | null;
  /** The shipped reader over the shipped byte bound and fetch wrapper, with only the network stubbed. */
  const shippedReader = (fetchStub: (url: string, init?: RequestInit) => Promise<Response>) => {
    const ts = [
      ...["OVERSIZE_MARKER", "MAX_RESPONSE_BYTES", "STREAM_WIRE_BYTES", "SLIM_ELEMENT_BYTES", "SLIM_RETAINED_BYTES", "SLIM_DESC_CEILING", "STORED_DESC_CAP", "FETCH_TIMEOUT_MS"].map(constDecl),
      ...["function discardBody(", "function boundBody(", "async function fetchWithTimeout(", "async function readOversizeBoard("].map(fnDecl),
    ].join("\n");
    const warned: string[] = [];
    const urls: string[] = [];
    const listUrl = (s: Board) => { urls.push(`${s.source}:${s.token}`); return `https://feed.test/${s.source}/${s.token}`; };
    const read = new Function("fetch", "listUrl", "beforeDeadline", "SLIM_SPECS", "streamSlim", "normalizeLever", "normalizeAshby", "normalizeGreenhouse", "console", `${toJs(ts)}\nreturn readOversizeBoard;`)(
      fetchStub, listUrl, beforeDeadline, SLIM_SPECS, streamSlim, normalizeLever, normalizeAshby, normalizeGreenhouse,
      { warn: (...a: unknown[]) => warned.push(a.map(String).join(" ")), log: () => {}, error: () => {} },
    ) as (s: Board, deadlineAt: number, freshCutoffMs: number) => Promise<Read>;
    return { read, warned, urls };
  };
  const respond = (body: ReadableStream<Uint8Array> | null, o: { status?: number; type?: string; length?: number } = {}) => {
    const headers = new Headers({ "content-type": o.type ?? "application/json; charset=utf-8" });
    if (o.length !== undefined) headers.set("content-length", String(o.length));
    return new Response(body, { status: o.status ?? 200, headers });
  };

  // Feeds past MAX_RESPONSE_BYTES, so a reader that lost its wire bound and
  // fell back to the per-response one refuses them.
  const PALANTIR: Board = { source: "lever", token: "palantir-token", name: "Palantir Display Name" };
  const OPENAI: Board = { source: "ashby", token: "openai-token", name: "OpenAI Display Name" };
  const leverFeed = [
    ...leverFixture,
    ...Array.from({ length: 700 }, (_, k) => ({
      id: `syn${k}`, text: `Engineer ${k}`, hostedUrl: `https://jobs.lever.co/palantir/syn${k}`,
      createdAt: k % 3 === 0 ? CUTOFF - 86_400_000 * (1 + (k % 20)) : CUTOFF + ((k * 7919) % 701) * 3_000_000,
      categories: { team: "Eng", location: "Denver, CO", commitment: "Full-time" }, workplaceType: k % 2 ? "onsite" : "hybrid",
      descriptionPlain: `Role ${k}. ` + "p".repeat(1500), descriptionBodyPlain: k % 5 ? "Benefits." : undefined,
      lists: [{ text: "Responsibilities", content: "<li>" + "r".repeat(6000) + "</li>" }],
    })),
  ];
  const ashbyFeed = {
    ...ashbyFixture,
    jobs: [
      ...ashbyFixture.jobs,
      ...Array.from({ length: 600 }, (_, k) => ({
        id: `syn${k}`, title: `Researcher ${k}`, jobUrl: `https://jobs.ashbyhq.com/openai/syn${k}`, location: "San Francisco",
        publishedAt: new Date(k % 3 === 0 ? CUTOFF - 86_400_000 * (1 + (k % 20)) : CUTOFF + ((k * 7919) % 601) * 3_000_000).toISOString(),
        isListed: k % 50 !== 0, employmentType: "FullTime", compensation: { compensationTierSummary: "$300K - $400K", compensationTiers: [{ summary: "c".repeat(300) }] },
        descriptionPlain: `Research ${k}. ` + "q".repeat(1500), descriptionHtml: "<p>" + "h".repeat(6500) + "</p>",
      })),
    ],
  };
  const leverBytes = enc.encode(JSON.stringify(leverFeed));
  const ashbyBytes = enc.encode(JSON.stringify(ashbyFeed));
  const slimOpts = () => opts({ deadlineAt: Date.now() + 30_000 });

  it("the test feeds are past the per-response bound, so only the wire bound lets them through", () => {
    expect(leverBytes.length).toBeGreaterThan(num("MAX_RESPONSE_BYTES"));
    expect(ashbyBytes.length).toBeGreaterThan(num("MAX_RESPONSE_BYTES"));
  });

  for (const [board, bytes, whole, N] of [
    [PALANTIR, leverBytes, leverFeed, normalizeLever],
    [OPENAI, ashbyBytes, ashbyFeed, normalizeAshby],
  ] as const) {
    it(`${board.source}: a streamed board returns the postings a whole-body read would, under the board's own name and token`, async () => {
      const { read, warned, urls } = shippedReader(async () => respond(recorded(chunked(bytes, 65_536)).stream));
      const r = await read(board, Date.now() + 30_000, CUTOFF);
      expect(r, `readOversizeBoard returned null: ${warned.join(" | ")}`).not.toBeNull();
      // deno-lint-ignore no-explicit-any
      const expected = (N as any)(JSON.parse(JSON.stringify(whole)), board.name, board.token);
      expect(expected.length, "the comparison would pass on nothing").toBeGreaterThan(500);
      expect(r!.jobs).toEqual(expected);
      const direct = await streamSlim(streamOf(bytes, 65_536), SLIM_SPECS[board.source], slimOpts());
      expect(r!.raw, "raw is what the worker reads descriptions from").toEqual(direct.raw);
      expect(urls, "it re-requests the board's own list").toEqual([`${board.source}:${board.token}`]);
    });
  }

  it("greenhouse: a light list past the bound streams to the postings a whole-body read would, without metadata, and a cut one is refused", async () => {
    const PULSE: Board = { source: "greenhouse", token: "pulse-token", name: "Pulse Display Name" };
    const meta = Array.from({ length: 78 }, (_, i) => ({ id: 4_565_018_003 + i, name: `Custom field ${i}`, value: i % 3 ? null : `Value ${i}`, value_type: "single_select" }));
    const feed = {
      jobs: Array.from({ length: 900 }, (_, k) => ({
        absolute_url: `https://job-boards.greenhouse.io/pulse/jobs/${7_820_220_003 + k}`, internal_job_id: 5_802_143_003 + k, location: { name: "London" },
        metadata: meta, data_compliance: [{ type: "gdpr", requires_consent: false }], id: 7_820_220_003 + k, updated_at: "2026-09-29T01:15:54-04:00",
        requisition_id: String(35_687 + k), title: `Consultant ${k}`, company_name: "Pulse Healthcare",
        first_published: new Date(CUTOFF + (k - 300) * 3_000_000).toISOString(), language: "en", application_deadline: null,
      })),
      meta: { total: 900 },
    };
    const bytes = enc.encode(JSON.stringify(feed));
    expect(bytes.length, "past the per-response bound, so only the stream reads it").toBeGreaterThan(num("MAX_RESPONSE_BYTES"));
    const { read, warned, urls } = shippedReader(async () => respond(recorded(chunked(bytes, 65_536)).stream));
    const r = await read(PULSE, Date.now() + 30_000, CUTOFF);
    expect(r, `readOversizeBoard returned null: ${warned.join(" | ")}`).not.toBeNull();
    expect(r!.jobs.length).toBe(900);
    expect(r!.jobs).toEqual(normalizeGreenhouse(JSON.parse(JSON.stringify(feed)), PULSE.name, PULSE.token));
    const kept = (r!.raw as { jobs: Array<Record<string, unknown>> }).jobs;
    expect(kept.filter((j) => "metadata" in j || "data_compliance" in j).length, "the slim rows carry metadata").toBe(0);
    expect(urls, "it re-requests the board's own list").toEqual([`greenhouse:${PULSE.token}`]);
    const cut = shippedReader(async () => respond(recorded(chunked(bytes.slice(0, Math.floor(bytes.length * 0.6)), 65_536)).stream));
    expect(await cut.read(PULSE, Date.now() + 5_000, CUTOFF), "60% of a light list is not the board").toBeNull();
  });

  // Each refusal must come back null (the oversize branch then defers the
  // board, exactly as before) inside its deadline, and release what it did not read.
  const refusals: Array<[string, () => { res: () => Promise<Response>; rec?: { cancelled: boolean; pulled: number }; deadlineMs?: number; unread: boolean }]> = [
    ["a truncated body", () => ({ res: async () => respond(recorded(chunked(leverBytes.slice(0, Math.floor(leverBytes.length * 0.6)), 65_536)).stream), unread: false })],
    ["HTTP 500 carrying a well-formed feed", () => { const src = recorded(chunked(leverBytes, 65_536)); return { res: async () => respond(src.stream, { status: 500 }), rec: src.rec, unread: true }; }],
    ["a 200 that is not JSON, even with a feed-shaped body", () => { const src = recorded(chunked(leverBytes, 65_536)); return { res: async () => respond(src.stream, { type: "text/html; charset=utf-8" }), rec: src.rec, unread: true }; }],
    ["a body that stalls", () => { const src = recorded([leverBytes.slice(0, 65_536)], true); return { res: async () => respond(src.stream), rec: src.rec, deadlineMs: 300, unread: true }; }],
    ["a declared length past the wire bound", () => { const src = recorded(chunked(leverBytes, 65_536)); return { res: async () => respond(src.stream, { length: num("STREAM_WIRE_BYTES") + 1 }), rec: src.rec, unread: true }; }],
    ["metadata past the retained budget", () => {
      const rows = Array.from({ length: 4000 }, (_, k) => ({ id: `m${k}`, text: "T".repeat(1000), hostedUrl: `https://jobs.lever.co/x/m${k}`, createdAt: CUTOFF - 86_400_000 }));
      const src = recorded(chunked(enc.encode(JSON.stringify(rows)), 65_536));
      return { res: async () => respond(src.stream), rec: src.rec, unread: true };
    }],
    ["one posting past the element budget", () => {
      const rows = [{ id: "big", text: "Big", hostedUrl: "https://jobs.lever.co/x/big", createdAt: CUTOFF, pad: "x".repeat(num("SLIM_ELEMENT_BYTES") + 10) }, ...leverFeed];
      const src = recorded(chunked(enc.encode(JSON.stringify(rows)), 65_536));
      return { res: async () => respond(src.stream), rec: src.rec, unread: true };
    }],
  ];
  for (const [name, make] of refusals) {
    it(`refuses ${name}: null inside the deadline, and the unread body is released`, async () => {
      const { res, rec, deadlineMs = 5000, unread } = make();
      const { read } = shippedReader(res);
      const t0 = Date.now();
      expect(await read(PALANTIR, t0 + deadlineMs, CUTOFF)).toBeNull();
      expect(Date.now() - t0, "past its deadline").toBeLessThan(deadlineMs + 1000);
      if (unread) {
        await settle();
        expect(rec!.cancelled, "the response was abandoned with bytes unread and never cancelled").toBe(true);
      }
    });
  }

  it("refuses headers that arrive after the deadline, and releases the late response when it lands", async () => {
    const src = recorded(chunked(leverBytes, 65_536));
    const { read } = shippedReader(() => new Promise((r) => setTimeout(() => r(respond(src.stream)), 400)));
    const t0 = Date.now();
    expect(await read(PALANTIR, t0 + 150, CUTOFF)).toBeNull();
    expect(Date.now() - t0).toBeLessThan(400);
    await new Promise((r) => setTimeout(r, 500));
    expect(src.rec.cancelled, "a response nobody waited for must still be released").toBe(true);
  });

  it("refuses a body past the wire bound while it streams, having read no more than the bound", async () => {
    // The bar the fix committed to (n411), not the constant read back: a test
    // that reads the bound from the source follows a loosened bound wherever
    // it goes, and this one then passed on the deadline instead.
    const WIRE = 64_000_000;
    expect(num("STREAM_WIRE_BYTES"), "the wire bound is looser than the 64 MB the fix committed to").toBeLessThanOrEqual(WIRE);
    const pad = enc.encode(`,{"id":"w","text":"W","hostedUrl":"https://jobs.lever.co/x/w","createdAt":${CUTOFF - 86_400_000},"lists":"${"l".repeat(500_000)}"}`);
    const src = recorded((function* () {
      yield enc.encode(`[{"id":"w0","text":"W","hostedUrl":"https://jobs.lever.co/x/w0","createdAt":${CUTOFF}}`);
      for (let sent = 0; sent < WIRE + 4_000_000; sent += pad.length) yield pad;
      yield enc.encode("]");
    })());
    const { read } = shippedReader(async () => respond(src.stream));
    expect(await read(PALANTIR, Date.now() + 20_000, CUTOFF)).toBeNull();
    expect(src.rec.pulled, "the bound stops the transfer, it does not merely judge it afterwards").toBeLessThan(WIRE + 3 * pad.length);
    await settle();
    expect(src.rec.cancelled).toBe(true);
  }, 30_000);

  // THE RETRY, lifted whole: the statement between the pinned fetch and the
  // landed-postings count, run with the worker's own names bound to a stub.
  const retryBlock = (() => {
    const a = CODE.indexOf("r = await fetchBoard(s, (m) => { failReason = m; }, deepCursors.get(s.token) ?? 0);");
    const b = CODE.indexOf("if (r) fetchedInSlice += r.jobs.length;", a);
    const seg = CODE.slice(a, b);
    const i = seg.indexOf("if (!r && ");
    if (a < 0 || b < 0 || i < 0) throw new Error("the worker's retry statement moved — re-anchor this harness");
    return seg.slice(i);
  })();
  const WALL = num("SLICE_WALL_BUDGET_MS"), BUDGET = num("STREAM_READ_BUDGET_MS"), HEAP = num("HEAP_SOFT_LIMIT_MB");
  const runRetry = async (o: { r?: unknown; failReason: string; source: string; elapsedMs?: number; heapMb?: number | null; result?: Read; light?: boolean; lightOversize?: boolean }) => {
    const calls: Array<{ reserveDuring: number; args: unknown[] }> = [];
    const fn = new Function(`${toJs(`async function __retry(env) {
      let r = env.r, failReason = env.failReason, inFlightReserve = env.inFlightReserve;
      const { s, reserve, sliceWallStart, freshCutoffMs, SLIM_SPECS, STREAM_READ_BUDGET_MS, SLICE_WALL_BUDGET_MS, HEAP_SOFT_LIMIT_MB, memStamp, isLight, lightOversize } = env;
      const readOversizeBoard = (...a) => env.read(inFlightReserve, a);
      ${retryBlock}
      return { r, failReason, inFlightReserve };
    }`)}\nreturn __retry;`)() as (env: unknown) => Promise<{ r: unknown; failReason: string; inFlightReserve: number }>;
    const s = { source: o.source, token: "tok", name: "Name" };
    const out = await fn({
      r: o.r ?? null, failReason: o.failReason, inFlightReserve: 7, reserve: 40, s,
      sliceWallStart: Date.now() - (o.elapsedMs ?? 1000), freshCutoffMs: 123_456,
      SLIM_SPECS, STREAM_READ_BUDGET_MS: BUDGET, SLICE_WALL_BUDGET_MS: WALL, HEAP_SOFT_LIMIT_MB: HEAP,
      memStamp: () => ({ heapMb: o.heapMb === null ? undefined : (o.heapMb ?? 40) }),
      isLight: () => o.light === true, lightOversize: o.lightOversize === true,
      read: async (reserveDuring: number, args: unknown[]) => { calls.push({ reserveDuring, args }); return o.result === undefined ? { jobs: [1], raw: [] } : o.result; },
    });
    return { ...out, calls, s };
  };

  it("runs on an oversize verdict for lever, ashby and a greenhouse light list the bound refused, under the reserve, with the worker's cutoff, and lands its result", async () => {
    for (const [source, light] of [["lever", false], ["ashby", false], ["greenhouse", true]] as const) {
      const t0 = Date.now();
      const x = await runRetry({ failReason: "oversize 6.2MB", source, light, lightOversize: light });
      expect(x.calls.length, `${source}: the retry did not run`).toBe(1);
      const [s, deadlineAt, cutoff] = x.calls[0].args as [unknown, number, number];
      expect(s).toBe(x.s);
      expect(deadlineAt - t0).toBeGreaterThanOrEqual(BUDGET - 50);
      expect(deadlineAt - t0).toBeLessThanOrEqual(BUDGET + 1000);
      expect(cutoff, "the ingest's own cutoff, not a recomputed one").toBe(123_456);
      expect(x.calls[0].reserveDuring, "the read runs under the board's reservation").toBe(47);
      expect(x.inFlightReserve, "and gives it back").toBe(7);
      expect(x.r).toEqual({ jobs: [1], raw: [] });
      expect(x.failReason, "the retry never rewrites the verdict").toBe("oversize 6.2MB");
    }
    const failed = await runRetry({ failReason: "oversize 6.2MB", source: "lever", result: null });
    expect(failed.r, "a failed retry leaves the board to the oversize branch").toBeNull();
    expect(failed.failReason).toBe("oversize 6.2MB");
    expect(failed.inFlightReserve).toBe(7);
  });

  it("does not run for anything else: another vendor, a landed read, another failure, a late slice, a full heap", async () => {
    const none = async (o: Parameters<typeof runRetry>[0], why: string) => {
      const x = await runRetry(o);
      expect(x.calls.length, why).toBe(0);
      expect(x.inFlightReserve).toBe(7);
      return x;
    };
    await none({ failReason: "oversize 4.0MB", source: "greenhouse" }, "a greenhouse board that is not light: its list URL is the content list, never streamed");
    await none({ failReason: "oversize 4.0MB", source: "greenhouse", light: true }, "enrolled this visit, light list not read (the start gate refused): no stream past the gate");
    await none({ failReason: "oversize 4.0MB", source: "greenhouse", lightOversize: true }, "light list refused, but no longer light: the URL would be the content list");
    await none({ failReason: "oversize 4.0MB", source: "workable" }, "no spec, no stream");
    const landed = { jobs: [9], raw: [] };
    expect((await none({ r: landed, failReason: "", source: "lever" }, "the first read landed")).r).toBe(landed);
    for (const f of ["HTTP 500", "timeout", "network", ""]) await none({ failReason: f, source: "lever" }, `a "${f}" failure is not a size verdict`);
    await none({ failReason: "oversize 6.2MB", source: "lever", elapsedMs: WALL - BUDGET + 2000 }, "too close to the wall for a full read");
    expect((await runRetry({ failReason: "oversize 6.2MB", source: "lever", elapsedMs: WALL - BUDGET - 2000 })).calls.length, "a read that fits the slice clock runs").toBe(1);
    await none({ failReason: "oversize 6.2MB", source: "lever", heapMb: HEAP }, "the heap gate that stops new boards stops this too");
    expect((await runRetry({ failReason: "oversize 6.2MB", source: "lever", heapMb: HEAP - 1 })).calls.length).toBe(1);
    expect((await runRetry({ failReason: "oversize 6.2MB", source: "lever", heapMb: null })).calls.length, "an unreadable heap does not block it").toBe(1);
  });
});

describe("(g) neither a detail view nor a liveness check repeats a board read the bound refused", () => {
  // A streamed board serves rows whose text the retention ceiling gave up, and
  // a detail view of one fetches the whole board for one posting — refused
  // again, up to 4 MB downloaded for ashby, on every view.
  type Board = { source: string; token: string };
  const shippedDetailRead = (fetchBoard: (s: Board, onFail?: (m: string) => void) => Promise<unknown>, clock: { t: number }) =>
    new Function("fetchBoard", "Date", `${toJs([constDecl("DETAIL_BOARD_REFUSED"), constDecl("DETAIL_BOARD_REFUSED_TTL_MS"), fnDecl("async function readBoardForDetail(")].join("\n"))}\nreturn readBoardForDetail;`)(
      fetchBoard, { now: () => clock.t },
    ) as (s: Board) => Promise<unknown>;

  it("remembers an oversize refusal per board for its TTL, and nothing else", async () => {
    const clock = { t: 1_000_000 };
    const asked: string[] = [];
    const verdicts: Record<string, string | null> = { "lever:big": "oversize 6.2MB", "ashby:big": "oversize 4.0MB", "lever:flaky": "HTTP 500", "ashby:slow": "timeout", "lever:fine": null };
    const read = shippedDetailRead(async (s, onFail) => {
      const key = `${s.source}:${s.token}`;
      asked.push(key);
      const v = verdicts[key];
      if (v === null) return { jobs: [], raw: [{ id: "1" }] };
      onFail?.(v);
      return null;
    }, clock);
    const twice = async (b: Board) => { await read(b); return read(b); };

    expect(await twice({ source: "lever", token: "big" })).toBeNull();
    expect(await twice({ source: "ashby", token: "big" })).toBeNull();
    expect(asked.filter((k) => k.endsWith(":big")), "the second view repeated a read the bound had just refused").toEqual(["lever:big", "ashby:big"]);

    await twice({ source: "lever", token: "flaky" });
    await twice({ source: "ashby", token: "slow" });
    expect(asked.filter((k) => k === "lever:flaky" || k === "ashby:slow").length, "a transient failure is asked again, as before").toBe(4);

    expect(await twice({ source: "lever", token: "fine" })).toEqual({ jobs: [], raw: [{ id: "1" }] });
    expect(asked.filter((k) => k === "lever:fine").length, "a board that answers is read every time; its text is getDescription's cache").toBe(2);

    const ttl = new Function(`${toJs(constDecl("DETAIL_BOARD_REFUSED_TTL_MS"))}\nreturn DETAIL_BOARD_REFUSED_TTL_MS;`)() as number;
    expect(ttl, "hours, not seconds and not days").toBeGreaterThanOrEqual(3_600_000);
    expect(ttl).toBeLessThanOrEqual(24 * 3_600_000);
    clock.t += ttl - 1;
    await read({ source: "lever", token: "big" });
    expect(asked.filter((k) => k === "lever:big").length, "still inside the TTL").toBe(1);
    clock.t += 2;
    await read({ source: "lever", token: "big" });
    expect(asked.filter((k) => k === "lever:big").length, "a board that shrinks back under the bound must be asked again once the entry lapses").toBe(2);
  });

  /** checkLive and the reader it calls, lifted together; only the vendor fetches are stubbed. */
  const shippedLiveCheck = (fetchBoard: (s: Board, onFail?: (m: string) => void) => Promise<unknown>, clock: { t: number }) => {
    const ts = [
      "const liveBoardMemo = new Map();",
      constDecl("DETAIL_BOARD_REFUSED"), constDecl("DETAIL_BOARD_REFUSED_TTL_MS"),
      fnDecl("async function readBoardForDetail("), fnDecl("async function checkLive("),
    ].join("\n");
    const notHere = (name: string) => () => { throw new Error(`a membership vendor reached ${name}`); };
    return new Function("fetchBoard", "Date", "fetchWithTimeout", "greenhouseApi", "leverApi", "workdayCxsUrl", `${toJs(ts)}\nreturn { checkLive, liveBoardMemo };`)(
      fetchBoard, { now: () => clock.t }, notHere("fetchWithTimeout"), notHere("greenhouseApi"), notHere("leverApi"), notHere("workdayCxsUrl"),
    ) as { checkLive: (s: Board & { name: string }, id: string, applyUrl: string | null) => Promise<boolean | null>; liveBoardMemo: Map<string, unknown> };
  };

  it("checkLive's membership check, which verify and the audit run per id, does not repeat it either", async () => {
    // Every ashby posting falls through to board membership. verify clears the
    // per-request memo and then probes up to twelve ids one after another, and
    // the memo holds only boards that answered — so five ids on a refused board
    // were five refused downloads, each read to the bound and each answering null.
    const clock = { t: 1_000_000 };
    const asked: string[] = [];
    const answers: Record<string, string | { jobs: Array<{ id: string }>; raw: unknown }> = {
      "ashby:big": "oversize 4.0MB",
      "workable:big": "oversize 5.1MB",
      "ashby:flaky": "HTTP 500",
      "ashby:open": { jobs: [], raw: { jobs: [{ id: "a" }, { id: "b" }] } },
      "workable:open": { jobs: [{ id: "workable:open:w1" }], raw: {} },
    };
    const { checkLive, liveBoardMemo } = shippedLiveCheck(async (s, onFail) => {
      const key = `${s.source}:${s.token}`;
      asked.push(key);
      const a = answers[key];
      if (typeof a !== "string") return a;
      onFail?.(a);
      return null;
    }, clock);
    const count = (k: string) => asked.filter((x) => x === k).length;
    /** The verify action's loop, as index.ts runs it: memo cleared, then one probe per id in turn. */
    const verify = async (b: Board, ids: string[]) => {
      liveBoardMemo.clear();
      const out: Array<boolean | null> = [];
      for (const id of ids) out.push(await checkLive({ ...b, name: b.token }, id, null));
      return out;
    };
    const big: Board = { source: "ashby", token: "big" };

    expect(await verify(big, ["1", "2", "3", "4", "5"]), "a refused board is unknown, never closed").toEqual([null, null, null, null, null]);
    expect(count("ashby:big"), "each verify id repeated the read the bound had just refused").toBe(1);
    expect(await verify(big, ["6", "7"])).toEqual([null, null]);
    expect(count("ashby:big"), "the next verify request repeated it").toBe(1);
    expect(await verify({ source: "workable", token: "big" }, ["1", "2", "3"])).toEqual([null, null, null]);
    expect(count("workable:big"), "every membership vendor, not only ashby").toBe(1);

    expect(await verify({ source: "ashby", token: "open" }, ["a", "z", "b"]), "a board that answers still answers membership").toEqual([true, false, true]);
    expect(await verify({ source: "workable", token: "open" }, ["w1", "w2"])).toEqual([true, false]);
    expect(count("ashby:open"), "read once per request, from the memo after that").toBe(1);
    expect(await verify({ source: "ashby", token: "open" }, ["a"])).toEqual([true]);
    expect(count("ashby:open"), "and read again by the next request: a board that answers is never carried across requests").toBe(2);

    expect(await verify({ source: "ashby", token: "flaky" }, ["1", "2"])).toEqual([null, null]);
    expect(count("ashby:flaky"), "a transient failure is asked again, as before").toBe(2);

    const ttl = new Function(`${toJs(constDecl("DETAIL_BOARD_REFUSED_TTL_MS"))}\nreturn DETAIL_BOARD_REFUSED_TTL_MS;`)() as number;
    clock.t += ttl + 1;
    expect(await verify(big, ["8"])).toEqual([null]);
    expect(count("ashby:big"), "the refusal lapses with its TTL, as the detail read's does").toBe(2);
  });

  it("the lever/ashby branch of the detail read goes through it, and never fetches the board directly", () => {
    const i = CODE.indexOf("async function fetchVendorDetail(");
    const fn = CODE.slice(i, CODE.indexOf("\n}\n", i));
    const at = fn.indexOf('} else if (src.source === "lever" || src.source === "ashby") {');
    expect(at, "the lever/ashby detail branch moved — re-anchor").toBeGreaterThan(0);
    const branch = fn.slice(at, fn.indexOf("return { text, postedAt", at));
    expect(branch).toMatch(/const r = await readBoardForDetail\(src\);/);
    expect(branch, "a direct board fetch here repeats the refused read on every view").not.toMatch(/fetchBoard\(/);
  });
});

describe("(h) the verifier judges the light set's size only once it can be judged", () => {
  // At publish the persisted light set holds what .81 wrote — at most 50 — and
  // it grows by one per over-bound visit, so a size bar printed as a verdict
  // right after a good deploy reads as a broken fix.
  const SCRIPT = readFileSync(resolve(__dirname, "../../scripts/verify-deploy.sh"), "utf8");
  const s7i = SCRIPT.slice(SCRIPT.indexOf('echo "== 7i.'), SCRIPT.indexOf('echo "done."'));
  const body = /node -e '([^']*)'/.exec(s7i)?.[1] ?? "";
  const run = (sliceStats: Record<string, unknown>) => {
    const dir = mkdtempSync(join(tmpdir(), "vd7i-"));
    const f = join(dir, "status.json");
    writeFileSync(f, JSON.stringify({ version: "2026-09-09.84", sliceStats: { wallStopped: false, heapMb: 40, ...sliceStats }, chainKick: { status: 200 }, oversizeBoards: [], lastRotationAgeMin: 12 }));
    const js = body.split("/tmp/vd_7i_status.json").join(f).split("/tmp/vd_status.json").join(join(dir, "absent.json"));
    return execFileSync(process.execPath, ["-e", js], { encoding: "utf8" }).split("\n").filter((l) => /lightSet/.test(l));
  };

  it("the section's status body is found and reads the status file", () => {
    expect(body).toContain("/tmp/vd_7i_status.json");
    expect(body).toMatch(/lightSet/);
  });

  it("~50 at publish is INFO, not FAIL; 103 is a PASS", () => {
    const atPublish = run({ lightSet: 50, lightCap: 500 });
    expect(atPublish.filter((l) => l.startsWith("FAIL")), "a good deploy prints FAIL before the set could have grown").toEqual([]);
    expect(atPublish.some((l) => l.startsWith("INFO") && /full cold rotation/.test(l)), "and the reader is told when to judge it").toBe(true);
    const grown = run({ lightSet: 103, lightCap: 500 });
    expect(grown.length).toBeGreaterThan(0);
    expect(grown.every((l) => l.startsWith("PASS")), grown.join("\n")).toBe(true);
  });

  it("saturation and absence are judged at once", () => {
    expect(run({ lightSet: 500, lightCap: 500 }).some((l) => l.startsWith("FAIL")), "a full set is a FAIL whenever it is seen").toBe(true);
    expect(run({}).some((l) => l.startsWith("FAIL")), "a status without the fields is a FAIL").toBe(true);
  });
});
