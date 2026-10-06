// @vitest-environment node
import { describe, expect, it } from "vitest";
import { normalizeGreenhouse } from "../../supabase/functions/job-board/normalize";
import { SLIM_SPECS, streamSlim } from "../../supabase/functions/job-board/slim-stream";
import { constOf, runVisit } from "./helpers/slice-worker";

/**
 * A GREENHOUSE LIGHT LIST TOO BIG TO HOLD IS READ A POSTING AT A TIME (job-board .90, F3).
 *
 * Two greenhouse boards were dark for good: their LIGHT lists (no
 * descriptions) are themselves over the 4 MB byte bound, liquidpersonnel
 * 13.9 MB and pulse 20.6 MB on 2026-10-06, and the streamed reader (n411)
 * had specs for lever and ashby only. Both served 0 rows against ~204 and
 * ~76 postings inside the 30-day window. The bulk is `metadata`: on the live
 * pulse list's first posting, 7,019 of 7,666 bytes (78 custom fields); the
 * fields the normaliser reads are 405.
 *
 * Now a greenhouse board streams its light list with metadata and
 * data_compliance dropped. Two rules hold it in place, both run here, not
 * spelled: the content list (descriptions) is never streamed, and a light
 * list it cannot finish throws, so a partial board never reads as complete
 * (a partial read feeds the id-diff prune and the closure log).
 *
 * The rows are synthetic, shaped like the live pulse list (same keys, a
 * comparable metadata block), so no employer's contact data is committed.
 */

const enc = new TextEncoder();
const CAPTURED = Date.parse("2026-10-06T12:00:00Z");
const CUTOFF = CAPTURED - 30 * 86_400_000;
const opts = (over: Partial<Parameters<typeof streamSlim>[2]> = {}) => ({
  freshCutoffMs: CUTOFF,
  maxBytes: constOf("SLIM_RETAINED_BYTES"),
  maxElementBytes: constOf("SLIM_ELEMENT_BYTES"),
  descKeepChars: 2 * constOf("STORED_DESC_CAP"),
  descCeiling: constOf("SLIM_DESC_CEILING"),
  deadlineAt: Date.now() + 30_000,
  ...over,
});
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

/** 78 custom fields, like the live list: about 6 KB a posting that nothing reads. */
const METADATA = Array.from({ length: 78 }, (_, i) => ({
  id: 4_565_018_003 + i * 1_000,
  name: `Custom field ${i} sub sector`,
  value: i % 5 === 0 ? ["Option A", "Option B"] : i % 3 === 0 ? `Value ${i}` : null,
  value_type: i % 5 === 0 ? "multi_select" : "single_select",
}));
type Row = Record<string, unknown>;
const ghRow = (k: number, o: Row = {}): Row => ({
  absolute_url: `https://job-boards.greenhouse.io/pulse/jobs/${7_820_220_003 + k}`,
  data_compliance: [{ type: "gdpr", requires_consent: false, requires_processing_consent: false, requires_retention_consent: false, retention_period: null, demographic_data_consent_applies: false }],
  internal_job_id: 5_802_143_003 + k,
  location: { name: k % 4 ? "London, United Kingdom" : "Remote" },
  metadata: METADATA,
  id: 7_820_220_003 + k,
  updated_at: "2026-09-29T01:15:54-04:00",
  requisition_id: String(35_687 + k),
  title: `Consultant Psychiatrist ${k}`,
  company_name: "Pulse Healthcare",
  first_published: k % 3 === 0 ? "2026-07-29T09:04:16-04:00" : `2026-09-${String(10 + (k % 18)).padStart(2, "0")}T09:04:16-04:00`,
  language: "en",
  application_deadline: null,
  ...o,
});
/**
 * A light list, plus the rows that exercise every branch of normalizeGreenhouse: five titles on one
 * careers-index URL (rebuilt per job), a row with departments, one with content, one with no URL.
 */
const feed = (n: number) => {
  const jobs: Row[] = Array.from({ length: n }, (_, k) => ghRow(k));
  for (let k = 0; k < 5; k++) jobs.push(ghRow(n + k, { absolute_url: "https://careers.example.test/jobs", title: `Index role ${k}` }));
  jobs.push(ghRow(n + 5, { departments: [{ id: 1, name: "Nursing", child_ids: [], parent_id: null }] }));
  jobs.push(ghRow(n + 6, { content: "&lt;p&gt;A description the light list never carries&lt;/p&gt;" }));
  jobs.push(ghRow(n + 7, { absolute_url: "" }));
  return { jobs, meta: { total: jobs.length } };
};

describe("SLIM_SPECS.greenhouse, run over a light list", () => {
  it("keeps what normalizeGreenhouse reads and drops metadata and data_compliance: the same postings from a fraction of the bytes", async () => {
    const doc = feed(300);
    const bytes = enc.encode(JSON.stringify(doc));
    const whole = JSON.parse(JSON.stringify(doc));
    const expected = normalizeGreenhouse(whole, "Pulse", "pulse");
    expect(expected.length, "the comparison would pass on nothing").toBeGreaterThan(300);
    expect(expected.filter((p) => p.applyUrl.startsWith("https://job-boards.greenhouse.io/pulse/jobs/") && p.title.startsWith("Index role")).length, "the index-URL rebuild is exercised").toBe(5);
    expect(expected.some((p) => p.department === "Nursing"), "a department is exercised").toBe(true);
    for (const chunk of [7, 4096, 1e9]) {
      const { raw, stats } = await streamSlim(streamOf(bytes, chunk), SLIM_SPECS.greenhouse, opts());
      expect(normalizeGreenhouse(raw as never, "Pulse", "pulse"), `chunk ${chunk}`).toEqual(expected);
      const rows = (raw as { jobs: Row[] }).jobs;
      expect(rows.length, "every posting, including the ones the normaliser drops").toBe(doc.jobs.length);
      for (const r of rows) {
        expect(Object.keys(r).filter((k) => k === "metadata" || k === "data_compliance" || k === "content"), `row ${r.id} kept a field nothing reads`).toEqual([]);
        expect(r.descriptionPlain, "a light list holds no description text").toBeUndefined();
      }
      expect(stats.descKept).toBe(0);
      expect(stats.slimBytes, "metadata was most of the bytes").toBeLessThan(stats.bytes / 10);
    }
  });

  it("a light list it cannot finish throws at every cut point, never returning part of the board", async () => {
    // Short metadata so every 7th byte can be a cut point inside the test's budget.
    const small = { jobs: Array.from({ length: 6 }, (_, k) => ghRow(k, { metadata: METADATA.slice(0, 2) })), meta: { total: 6 } };
    const whole = JSON.stringify(small);
    for (let cut = 1; cut < whole.length; cut += 7) {
      await expect(streamSlim(streamOf(enc.encode(whole.slice(0, cut)), 64), SLIM_SPECS.greenhouse, opts()), `cut at ${cut} of ${whole.length}`).rejects.toThrow(/^stream: /);
    }
    const jobsClosed = whole.slice(0, whole.indexOf(',"meta"'));
    await expect(streamSlim(streamOf(enc.encode(jobsClosed), 64), SLIM_SPECS.greenhouse, opts()), "the jobs array closed, the document did not").rejects.toThrow(/truncated/);
    await expect(streamSlim(streamOf(enc.encode(JSON.stringify(feed(3).jobs)), 512), SLIM_SPECS.greenhouse, opts())).rejects.toThrow(/not an object/);
    await expect(streamSlim(streamOf(enc.encode(JSON.stringify({ meta: { total: 0 } })), 512), SLIM_SPECS.greenhouse, opts())).rejects.toThrow(/no "jobs" array/);
  });

  it("kept fields past the retained budget, or one posting past the element budget, throw with the oversize marker", async () => {
    const budget = constOf("SLIM_RETAINED_BYTES");
    // Generated lazily: about 4.6 MB of kept fields the reader must refuse, not cut short.
    let k = 0;
    const n = 8_000;
    const lazy = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(enc.encode('{"jobs":[')); },
      pull(c) {
        if (k >= n) { c.enqueue(enc.encode('],"meta":{"total":8000}}')); c.close(); return; }
        c.enqueue(enc.encode((k ? "," : "") + JSON.stringify(ghRow(k, { title: `${"T".repeat(400)} ${k}` }))));
        k++;
      },
    });
    await expect(streamSlim(lazy, SLIM_SPECS.greenhouse, opts())).rejects.toThrow(new RegExp(`^OVERSIZE_BODY slim \\d+ > ${budget}$`));
    expect(k, "refused as the budget was crossed, not after reading the whole list").toBeLessThan(n);
    const big = enc.encode(JSON.stringify({ jobs: [ghRow(0), ghRow(1, { metadata: [{ value: "x".repeat(50_000) }] })] }));
    await expect(streamSlim(streamOf(big, 4096), SLIM_SPECS.greenhouse, opts({ maxElementBytes: 20_000 }))).rejects.toThrow(/^OVERSIZE_BODY element \d+ > 20000$/);
  });
});

describe("the visit, run: a greenhouse board streams its light list, and never its content list", () => {
  const rows = (n: number) => ({ jobs: Array.from({ length: n }, (_, i) => ({ id: String(i) })), raw: { jobs: [] } });
  const PULSE = { source: "greenhouse", token: "pulse" };
  const LIQUID = { source: "greenhouse", token: "liquidpersonnel" };
  const SPEECHIFY = { source: "greenhouse", token: "speechify" };
  /** The streamed read: it answers only for the light list; a content-list stream would be a test failure below. */
  const lightStream = (n: number) => ({ light }: { light: boolean }) => (light ? rows(n) : null);

  it("an already-light board whose light list is over the bound is streamed in the same visit and lands", async () => {
    const x = await runVisit({ board: PULSE, failReason: "oversize 20.6MB", lightAtStart: true, slimSpecs: SLIM_SPECS, stream: lightStream(76), inFlightReserve: 7, reserve: 40 });
    expect(x.streamCalls, "one streamed read, of the light list, under the board's reservation").toEqual([{ light: true, reserveDuring: 47 }]);
    expect(x.inFlightReserve).toBe(7);
    expect(x.fetchCalls, "no light re-read: the read that failed was the light list").toEqual([]);
    expect(x.r?.jobs.length).toBe(76);
    expect(x.fetchedInSlice).toBe(76);
    expect(x.boardsDone).toBe(1);
    expect(x.deferred).toEqual([]);
    expect(x.failed).toEqual([]);
    expect([...x.registry.keys()], "a board that read is not registered oversize").toEqual([]);
  });

  it("content list over the bound, then light list over the bound: enrol, re-read light, stream light, land", async () => {
    const x = await runVisit({ board: LIQUID, failReason: "oversize 31.0MB", reread: () => ({ read: null, reason: "oversize 13.9MB" }), slimSpecs: SLIM_SPECS, stream: lightStream(204) });
    expect(x.enrolCalls).toBe(1);
    expect(x.fetchCalls.map((c) => c.light), "the light re-read").toEqual([true]);
    expect(x.streamCalls.map((c) => c.light), "then the light list streamed").toEqual([true]);
    expect(x.r?.jobs.length).toBe(204);
    expect(x.boardsDone, "one board, counted once").toBe(1);
    expect(x.deferred).toEqual([]);
    expect(x.registry.size).toBe(0);
    expect(x.stats).toEqual({ enrolled: 1, reread: 1, ok: 0, deferred: 0 });
  });

  it("streams only a light list this visit read under the start gate: refused, gated or unread boards stream nothing", async () => {
    // Positive controls first, or code that never streams passes every "nothing" below.
    expect((await runVisit({ board: PULSE, failReason: "oversize 20.6MB", lightAtStart: true, slimSpecs: SLIM_SPECS, stream: lightStream(76) })).streamCalls.length, "control: a light list streams").toBe(1);
    const lever = await runVisit({ board: { source: "lever", token: "palantir" }, failReason: "oversize 6.0MB", slimSpecs: SLIM_SPECS, stream: () => rows(10) });
    expect(lever.streamCalls, "control: lever streams as before, with no light mode").toEqual([{ light: false, reserveDuring: 47 }]);
    expect(lever.r?.jobs.length).toBe(10);

    const refused = await runVisit({ board: SPEECHIFY, failReason: "oversize 6.1MB", refuse: true, reread: () => ({ read: rows(246) }), slimSpecs: SLIM_SPECS, stream: lightStream(246) });
    expect(refused.light).toBe(false);
    expect(refused.streamCalls, "the set refused the board, so its list URL is still the content list: never streamed").toEqual([]);
    expect(refused.deferred).toEqual([SPEECHIFY.token]);
    expect(refused.registry.get(SPEECHIFY.token)?.mb).toBe(6.1);

    for (const gate of ["landed", "reserve", "wall", "heap"]) {
      const x = await runVisit({ board: SPEECHIFY, failReason: "oversize 6.1MB", gate, reread: () => ({ read: rows(246) }), slimSpecs: SLIM_SPECS, stream: lightStream(246) });
      expect(x.light, `${gate}: enrolled, so its next visit reads light`).toBe(true);
      expect(x.fetchCalls, `${gate}: the light re-read was refused`).toEqual([]);
      expect(x.streamCalls, `${gate}: so the stream must not read the light list in its place, past the gate`).toEqual([]);
      expect(x.r).toBeNull();
      expect(x.deferred).toEqual([SPEECHIFY.token]);
      expect(x.failed).toEqual([]);
    }
  });

  it("a streamed light read that fails leaves the board deferred at the light list's size, never failed", async () => {
    const x = await runVisit({ board: PULSE, failReason: "oversize 20.6MB", lightAtStart: true, slimSpecs: SLIM_SPECS, stream: () => null });
    expect(x.streamCalls.length, "the stream was tried").toBe(1);
    expect(x.r).toBeNull();
    expect(x.deferred).toEqual([PULSE.token]);
    expect(x.failed, "a deferral, never a vendor failure").toEqual([]);
    expect(x.registry.get(PULSE.token)?.mb).toBe(20.6);
    expect(x.inFlightReserve).toBe(7);
  });
});
