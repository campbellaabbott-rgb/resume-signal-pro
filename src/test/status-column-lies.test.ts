/**
 * `agent_submissions.status` IS NOT SAFE TO READ DIRECTLY, AND I LEARNED THAT
 * THREE TIMES BEFORE WRITING THIS.
 *
 * agent_mark_uncertain parks a packet at status='blocked'. So "blocked" in that
 * column means EITHER "something needs you" OR "we pressed submit and could not
 * read the confirmation page". Those are opposite instructions to a candidate:
 * one says act, the other says do not act, because acting means applying twice
 * under their own name.
 *
 * Three separate surfaces read the raw column and told people the wrong one:
 *
 *   ApplyQueuePanel row label     "Needs you"
 *   ApplyQueuePanel summary count filed under "need you"
 *   AgentNightSummary             "skipped"
 *
 * Each was fixed individually. That is three patches for one design fault, and
 * the fourth surface would have shipped the same bug — so this stops being a
 * patch and becomes a rule.
 *
 * TWO RULES, because there are two ways to get it wrong and the second is the
 * one that looks correct:
 *
 *   1. Comparing status to "blocked" without asking packetState.
 *   2. Asking packetState WITHOUT selecting the columns it reads — PostgREST
 *      returns only named columns, so packetState would be blind to `blockers`
 *      and quietly classify every uncertain packet as ordinary. Nothing errors.
 *      This is the same shape that made apply-broker's `active` check do nothing
 *      for months, and it has now bitten this codebase four times.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const SRC = resolve(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "test" || name === "node_modules") continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Every non-test source file that queries the packet table. */
const readers = walk(SRC)
  .map((path) => ({ path, code: strip(readFileSync(path, "utf8")) }))
  .filter((f) => /from\(["']agent_submissions["']\)/.test(f.code));

const rel = (p: string) => p.slice(SRC.length + 1);

describe("the guard is actually looking at something", () => {
  it("finds the files that read agent_submissions", () => {
    // Without this, a refactor that renamed the table or changed the query
    // helper would empty the list and every rule below would pass vacuously —
    // the failure mode I hit twice today writing break-tests.
    expect(readers.length, "no agent_submissions readers found — this guard has stopped guarding")
      .toBeGreaterThan(0);
  });
});

describe("nothing decides what to tell a candidate from the raw status", () => {
  for (const f of readers) {
    it(`${rel(f.path)} does not read "blocked" without packetState`, () => {
      if (!/status\s*===\s*["']blocked["']/.test(f.code)) return;   // does not use it at all
      expect(
        f.code.includes("packetState"),
        `${rel(f.path)} compares status to "blocked" but never asks packetState. ` +
        `That column reads "blocked" for BOTH "needs you" and "we could not confirm ` +
        `the send" — and telling somebody the second is the first makes them apply twice.`,
      ).toBe(true);
    });
  }
});

describe("anything asking packetState selects what packetState reads", () => {
  for (const f of readers) {
    it(`${rel(f.path)} selects blockers and attempts if it derives state`, () => {
      if (!/packetState\s*\(/.test(f.code)) return;
      const sel = f.code.match(/\.select\(\s*["'`]([\s\S]*?)["'`]\s*[,)]/);
      // Some readers compose their select from a shared constant; only enforce
      // where the column list is literal enough to check honestly.
      if (!sel) return;
      const cols = sel[1].replace(/\s+/g, "");
      for (const needed of ["blockers", "attempts"]) {
        expect(
          cols.includes(needed),
          `${rel(f.path)} calls packetState but does not select "${needed}". ` +
          `PostgREST returns only the columns named, so packetState would read ` +
          `undefined and classify every uncertain packet as ordinary — silently, forever.`,
        ).toBe(true);
      }
    });
  }
});
