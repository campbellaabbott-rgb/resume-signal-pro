// @vitest-environment node
/**
 * W4-3 (board .103): THE NAMES STEP CLOSES ON ITS OWN CLOCK, AND THE NEXT TAIL
 * RESUMES FROM ITS CURSOR.
 *
 * The pass-end tail's last step, names, held the tail open on 11-15 and on
 * 11-17 from 18:32:40 to 20:06:09Z. Its hops can die inside one board's
 * updates, and a re-kicked hop restarted from the cursor the dead hop never
 * wrote (name_sync_progress was written only at a hop's end). Now:
 *   - once PASS_END_NAME_HOPS x NAME_SYNC_UNTIL_MS (4 x 90 s = 6 min) has
 *     passed since the step was first kicked with the tail still open on it,
 *     the once-a-minute resume check closes it ok:false, resumable:true;
 *   - a hop still running when that happens neither writes its receipt nor
 *     kicks another hop;
 *   - the hop writes its cursor every 10 s as it goes, carrying the retries it
 *     has not reached, so the next hop or the next pass resumes near where
 *     this one got to.
 * Every function here is lifted from the raw source and run (helpers/lift-index.ts).
 */
import { describe, expect, it } from "vitest";
import { compile, fnSource } from "./helpers/lift-index";
import * as PE from "../../supabase/functions/job-board/pass-end";
import { nameSyncQueue } from "../../supabase/functions/job-board/name-sync";

const T = Date.parse("2026-11-17T18:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
/** A pass whose tail reached names: capacity finished at T, names kicked then. */
const openOnNames = (namesStart = T + 1_000) => ({
  startedAt: iso(T - 3_600_000), next: "names", nextKickedAt: iso(namesStart),
  steps: { capacity: { startedAt: iso(T - 60_000), doneAt: iso(T), ok: true }, names: { startedAt: iso(namesStart), hops: 1 } },
});

describe("the names step's own clock (pass-end.ts)", () => {
  it("runs out PASS_END_NAME_HOPS x the hop clock after the capacity step finished, not before", () => {
    const f = (PE as Record<string, unknown>).namesOutOfTime as ((v: unknown, now: number, hop: number) => boolean) | undefined;
    expect(typeof f, "pass-end.ts has no namesOutOfTime").toBe("function");
    expect(f!(openOnNames(), T + 4 * 90_000 - 1, 90_000)).toBe(false);
    expect(f!(openOnNames(), T + 4 * 90_000, 90_000)).toBe(true);
    // No capacity receipt: counted from the names step's own start.
    const noCap = { ...openOnNames(T + 5_000), steps: { names: { startedAt: iso(T + 5_000) } } };
    expect(f!(noCap, T + 360_000, 90_000)).toBe(false);
    expect(f!(noCap, T + 365_000, 90_000)).toBe(true);
    // A finished tail, or one still on another step, is never closed by it.
    expect(f!({ ...openOnNames(), doneAt: iso(T + 10_000) }, T + 3_600_000, 90_000)).toBe(false);
    expect(f!({ ...openOnNames(), next: "sweep" }, T + 3_600_000, 90_000)).toBe(false);
  });
});

function resumeWorld(row: Record<string, unknown>, now: number) {
  const stamps: Array<Record<string, unknown>> = [];
  const kicks: string[] = [];
  class FakeDate extends Date {
    constructor(...a: unknown[]) { super(...((a.length ? a : [now]) as [number])); }
    static now() { return now; }
  }
  const scope: Record<string, unknown> = {
    client: {}, Date: FakeDate, passEndCheckedAt: 0,
    readMetaRow: async () => ({ read: true, v: row }),
    stampPassEnd: async (_c: unknown, v: Record<string, unknown>) => { stamps.push(v); },
    kickPassEndStep: (step: string) => { kicks.push(step); },
    namesOutOfTime: (PE as Record<string, unknown>).namesOutOfTime, stalledPassEndStep: PE.stalledPassEndStep, withStepReceipt: PE.withStepReceipt,
    PASS_END_RETRIES: PE.PASS_END_RETRIES, PASS_END_NAME_HOPS: PE.PASS_END_NAME_HOPS, NAME_SYNC_UNTIL_MS: 90_000,
    console: { warn: () => {}, log: () => {} },
  };
  return { scope, stamps, kicks, run: () => compile(fnSource("maybeResumePassEnd"), "return maybeResumePassEnd(client);")(scope) };
}

describe("the resume check closes a names step past its clock", () => {
  it("6 min after capacity finished, with the tail still on names: closed ok:false, resumable:true, and nothing is kicked", async () => {
    const w = resumeWorld(openOnNames(), T + 15 * 60_000);
    await w.run();
    expect(w.kicks).toEqual([]);
    expect(w.stamps).toHaveLength(1);
    const v = w.stamps[0] as { next: unknown; doneAt: string; steps: { names: Record<string, unknown> } };
    expect(v.next).toBeNull();
    expect(Date.parse(v.doneAt)).toBe(T + 15 * 60_000);
    expect(v.steps.names).toMatchObject({ ok: false, resumable: true, doneAt: iso(T + 15 * 60_000) });
    expect(PE.passEndDone(v as PE.PassEndRow)).toBe(true);
  });

  it("inside its clock the step is left alone", async () => {
    const w = resumeWorld(openOnNames(), T + 5 * 60_000);
    await w.run();
    expect([w.stamps, w.kicks]).toEqual([[], []]);
  });
});

describe("a names hop still running when the tail was closed", () => {
  it("writes no receipt and kicks no next hop", async () => {
    const startedAt = iso(T - 3_600_000);
    const open = openOnNames();
    const closed = PE.withStepReceipt(open as PE.PassEndRow, "names", { doneAt: iso(T + 400_000), ok: false, resumable: true } as PE.StepReceipt, { next: null, doneAt: iso(T + 400_000) });
    let passEndReads = 0;
    const stamps: unknown[] = [];
    const kicks: string[] = [];
    const scope: Record<string, unknown> = {
      client: {},
      readMetaRow: async (_c: unknown, k: string) => k === "pass_end_ctx"
        ? { read: true, v: { startedAt, hop: 9, refreshedAt: startedAt, freshCutoffMs: 0, failedSources: [], failedCount: 0 } }
        : { read: true, v: passEndReads++ === 0 ? open : closed },
      stampPassEnd: async (_c: unknown, v: unknown) => { stamps.push(v); },
      breadcrumb: async () => {},
      passEndNames: async () => ({ ok: false, detail: "name sync v4: 3 renamed, 0 already correct, 0 failed, 9 waiting", stop: "clock" }),
      kickPassEndStep: (s: string) => { kicks.push(s); },
      maybeKickMaintenance: async () => {},
      nextPassEndStep: PE.nextPassEndStep, withStepReceipt: PE.withStepReceipt,
      console: { log: () => {}, warn: () => {} },
    };
    const r = await compile(`${fnSource("passEndReceipt")}\n${fnSource("runPassEndStep")}`, `return runPassEndStep(client, "names", ${JSON.stringify(startedAt)});`)(scope) as Record<string, unknown>;
    expect(kicks).toEqual([]);
    expect(stamps).toHaveLength(1); // the hop's opening receipt, written before the close
    expect(r.next).toBeNull();
  });
});

describe("the names hop writes its cursor as it goes", () => {
  it("every 10 s of its clock, carrying the retries it has not reached yet", async () => {
    let now = 1_000_000;
    const upserts: Array<{ k: string; v: { after: string; retry: string[] } }> = [];
    const renamed = new Set<string>();
    const meta: Record<string, unknown> = { name_sync_progress: { version: 4, after: "t10", retry: ["t01", "t02", "t03", "t04", "t05"] } };
    class FakeDate extends Date {
      constructor(...a: unknown[]) { super(...((a.length ? a : [now]) as [number])); }
      static now() { return now; }
    }
    const chain = (table: string) => {
      let k = "", tok = "", op = "select";
      const q: Record<string, unknown> = {
        select: () => q, like: () => q, limit: () => q, neq: () => q,
        eq: (c: string, v: string) => { if (c === "k") k = v; if (c === "company_token") tok = v; return q; },
        update: () => { op = "update"; return q; },
        delete: () => { op = "delete"; return q; },
        upsert: (row: { k: string; v: { after: string; retry: string[] } }) => { upserts.push(row); meta[row.k] = row.v; return Promise.resolve({ error: null }); },
        maybeSingle: async () => ({ data: k in meta ? { v: meta[k] } : null }),
        then: (ok: (v: unknown) => unknown) => {
          now += 1_000;
          if (table === "job_board_meta" && op === "delete") delete meta[k];
          if (op === "update" && tok) renamed.add(tok);
          return Promise.resolve({ data: op === "select" && tok && !renamed.has(tok) ? [{ company_token: tok }] : [], error: null }).then(ok);
        },
      };
      return q;
    };
    const tokens = Array.from({ length: 30 }, (_, i) => `t${String(i).padStart(2, "0")}`);
    const scope: Record<string, unknown> = {
      client: { from: chain }, Date: FakeDate, NAME_SYNC_VERSION: 4, NAME_SYNC_UNTIL_MS: 90_000, RENAMED_TOKENS: [],
      JOB_SOURCES: tokens.map((t) => ({ source: "workday", token: t, name: t })), SHARED_TOKENS: new Set<string>(),
      overrideTable: () => new Map(tokens.map((t) => [t, `Name of ${t}`])), overrideFor: (t: string) => `Name of ${t}`,
      nameSyncTarget: (s: { token: string }) => `Name of ${s.token}`, nameSyncQueue, console: { log: () => {}, warn: () => {} },
    };
    await compile(fnSource("passEndNames"), "return passEndNames(client, Date.now());")(scope);
    const cursor = upserts.filter((u) => u.k === "name_sync_progress");
    expect(cursor.length, "the cursor is written only when the hop ends").toBeGreaterThan(2);
    // Each retry takes 6 s of the fake clock, so the first write comes after two of the five.
    expect(cursor[0].v).toMatchObject({ after: "t10", retry: ["t03", "t04", "t05"] });
    const afters = cursor.map((c) => c.v.after);
    expect([...afters].sort()).toEqual(afters);
    expect(afters.at(-1)! > "t10").toBe(true);
  });
});
