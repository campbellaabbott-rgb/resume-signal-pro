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
 *       verdict a failed retry falls back to.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { JOB_SOURCES } from "../../supabase/functions/job-board/sources";
import { htmlToText, isDatedBefore, normalizeAshby, normalizeLever, sanePostedAt } from "../../supabase/functions/job-board/normalize";
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
  // The set's own admission rule (lightTokenRefusal): every board carrying the
  // token must be light-capable, or the token is refused and holds no slot.
  const refused = (token: string) => {
    const vs = JOB_SOURCES.filter((s) => s.token === token).map((s) => s.source);
    return vs.length === 0 || vs.some((v) => !vendors.includes(v));
  };

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

  it("the boards the set refuses are the named shared-token follow-up, and no others", () => {
    const r = population.boards.map((b) => b.token).filter(refused);
    // greenhouse tokens shared with personio, pinpoint or ashby: light mode is
    // keyed by token, so going light would strip the other vendor's
    // descriptions. Out of scope for this fix; listed for its follow-up.
    for (const t of r) expect(["lush", "samsara", "pulse", "helsing"], `${t} is refused light mode and stays dark`).toContain(t);
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
    for (const [vendor, fn] of [["lever", "normalizeLever"], ["ashby", "normalizeAshby"]] as const) {
      const i = NORMALIZE.indexOf(`export function ${fn}(`);
      expect(i, `${fn} not found`).toBeGreaterThan(0);
      const body = NORMALIZE.slice(i, NORMALIZE.indexOf("\n}\n", i));
      const read = new Set([...body.matchAll(/\bj\.(\w+)/g)].map((m) => m[1]));
      expect(read.size, `${fn}: the field derivation found nothing`).toBeGreaterThan(5);
      const missing = [...read].filter((f) => !SLIM_SPECS[vendor].keep.includes(f));
      expect(missing, `${fn} reads these fields and the streamed ${vendor} row drops them`).toEqual([]);
      // A bare `j` handed to a helper would hide the fields it reads.
      const bare = [...body.matchAll(/\bj\b(?!\s*(?:\.|\?\.))/g)].filter((m) => !/\(j\)\s*=>/.test(body.slice(m.index! - 1, m.index! + 8)));
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
  // ashby posting with HTML only, and an unlisted one.
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
    // in-fence and aged interleaved, out of date order, so eviction is exercised
    const at = (k: number) => (k % 3 === 0 ? CUTOFF - 86_400_000 * (1 + (k % 7)) : CUTOFF + ((k * 7919) % 2_000_000_000));
    const { raw, stats } = await streamSlim(lazyLever(n, at, 9000), SLIM_SPECS.lever, opts());
    expect(stats.bytes, "the generator really produced ~40MB").toBeGreaterThan(38_000_000);
    expect(stats.slimBytes).toBeLessThanOrEqual(num("SLIM_RETAINED_BYTES"));
    expect(stats.descDropped, "the ceiling must actually bind for this to test anything").toBeGreaterThan(0);
    const rows = raw as Array<{ id: string; createdAt: number; descriptionPlain?: string }>;
    expect(rows.length).toBe(n);
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
    expect(Object.keys(SLIM_SPECS).sort(), "a vendor with a spec needs a normaliser branch above").toEqual(["ashby", "lever"]);
  });
});
