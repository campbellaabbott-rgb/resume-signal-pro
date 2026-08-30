import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE INGEST COULD NOT BE STOPPED.
 *
 * 2026-08-17: the database degraded until `select id limit 1` took 20-30s and
 * action=list timed out. The operator disabled the four pg_cron jobs that start
 * a refresh. SIXTY-SIX MINUTES LATER the ingest was still running — status
 * reported lastSliceAgeMin 0, and the cold cursor had reset from 30000 to 640,
 * meaning a fresh pass had STARTED after the pause.
 *
 * pg_cron only ever starts a chain. chainNextSlice re-invokes the function for
 * the next slice up to CHAIN_CAP hops, and a finished pass wraps the cursor and
 * begins another. Once a chain is moving it sustains itself, so pausing the
 * scheduler quiesces nothing. There was no lever that stopped work in flight.
 *
 * What this file protects is the SHAPE of the lever, because each property was
 * a decision:
 *   - checked at the HOP so an in-flight chain drains rather than being killed
 *     mid-write
 *   - checked at pass ENTRY so cron, a manual refresh, or any other trigger
 *     cannot start a new one
 *   - `force` must NOT override it — force bypasses the slice lock, and an
 *     operator stopping a struggling database means it
 *   - fails OPEN: an unreadable flag must let the ingest CONTINUE, because a
 *     silently-stopped ingest is invisible for hours
 *   - visible on status, or "paused" and "broken" look identical
 */
const FN = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"),
  "utf8",
);

describe("the ingest has an off switch that actually stops it", () => {
  it("stops the chain at the hop boundary, not mid-write", () => {
    const fn = /function chainNextSlice\([\s\S]*?\n}/.exec(FN)?.[0] ?? "";
    expect(fn, "chainNextSlice not found").not.toBe("");
    expect(fn).toMatch(/isIngestPaused/);
    // The successor must be skipped by an early return, before the fetch.
    const guardAt = fn.indexOf("isIngestPaused");
    const fetchAt = fn.indexOf("fetch(url");
    expect(guardAt).toBeGreaterThan(-1);
    expect(fetchAt).toBeGreaterThan(guardAt);
  });

  it("refuses to START a pass while paused, and force does not override", () => {
    const head = FN.slice(FN.indexOf("async function runRefresh("));
    const body = head.slice(0, head.indexOf("refresh_progress"));
    expect(body).toMatch(/isIngestPaused/);
    // The guard must not be gated on !force.
    expect(body).not.toMatch(/if \(!force && await isIngestPaused/);
    expect(body).not.toMatch(/if \(force \|\|/);
  });

  it("FAILS OPEN — but boundedly, retried, and LOUD (sweep-3 hardening)", () => {
    // The property is unchanged: an unreadable flag keeps the ingest running,
    // because a transient meta error silently stopping ingest for hours is the
    // worse failure. What changed: the read is bounded (800ms — a hung read on
    // a distressed database must not hold a hop hostage), retried once, and an
    // un-honoured pause now logs loudly instead of dissolving invisibly.
    const fn = /async function isIngestPaused\([\s\S]*?\n}/.exec(FN)?.[0] ?? "";
    expect(fn, "isIngestPaused not found").not.toBe("");
    expect(fn).toMatch(/setTimeout\(\(\) => res\("timeout"\), 800\)/);
    expect(fn).toMatch(/const second = await readOnce\(\);/);
    expect(fn).toMatch(/ingest_paused UNREADABLE twice/);
    expect(fn, "still fails open at the end — deliberately").toMatch(/return false;\n}$/);
    // Pausing requires a positive, readable true — never a truthy coincidence.
    expect(fn).toMatch(/\.paused === true/);
  });

  it("is visible on status with its age", () => {
    expect(FN).toMatch(/ingestPaused: /);
    expect(FN).toMatch(/ingestPausedAgeMin: ageMin\(/);
    expect(FN).toMatch(/eq\("k", "ingest_paused"\)/);
  });

  it("keeps the status destructuring aligned with its promise array", () => {
    // This array is POSITIONAL. Inserting a promise without inserting a name
    // shifts every slot after it and silently mis-assigns unrelated fields —
    // exactly what happened while adding the pause read.
    //
    // Counted by BALANCED BRACKETS with whole-line comments stripped first. A
    // line-matching regex got this wrong in both directions: the comments in
    // this array are long prose containing commas at depth 0, which split into
    // 48 phantom entries. Counting structure requires parsing structure.
    // Anchored on the destructuring that CONTAINS ingestPaused, not on the
    // first one in the file. The bare pattern matched whichever Promise.all
    // appeared earliest, so an unrelated three-element array added elsewhere in
    // the module silently became the thing under test — a guard pointed at the
    // wrong object reports confidently about code it never read.
    const all = [...FN.matchAll(/const \[([^\]]+)\] = await Promise\.all\(\[/g)];
    const m = all.find((x) => x[1].includes("ingestPaused")) ?? null;
    expect(m, "status Promise.all destructuring not found").not.toBeNull();
    const names = m![1].split(",").map((n) => n.trim()).filter(Boolean);

    let depth = 1;
    let i = FN.indexOf(m![0]) + m![0].length;
    while (depth > 0 && i < FN.length) {
      const ch = FN[i];
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if (ch === ")" || ch === "]" || ch === "}") depth--;
      i++;
    }
    const block = FN.slice(FN.indexOf(m![0]) + m![0].length, i - 1);
    const clean = block
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");

    const entries: string[] = [];
    let d = 0;
    let cur = "";
    for (const ch of clean) {
      if (ch === "(" || ch === "[" || ch === "{") d++;
      else if (ch === ")" || ch === "]" || ch === "}") d--;
      if (ch === "," && d === 0) {
        if (cur.trim()) entries.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    if (cur.trim()) entries.push(cur.trim());

    expect(
      entries.length,
      `${names.length} destructured names but ${entries.length} promises — a ` +
        `positional array where one was added without the other`,
    ).toBe(names.length);

    // And the pause read must sit at the slot its name claims.
    const slot = names.indexOf("ingestPaused");
    expect(slot, "ingestPaused missing from the destructuring").toBeGreaterThan(-1);
    expect(entries[slot]).toMatch(/ingest_paused/);
  });
});
