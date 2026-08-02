/**
 * The broker seam — the one link in the apply chain that has never run.
 *
 * `worker/src/broker.ts` (Node) and `supabase/functions/apply-broker/index.ts`
 * (Deno) were written from the same specification by two authors and have never
 * exchanged a single packet. They cannot import from each other, so nothing
 * currently connects the shape one SENDS to the shape the other EXPECTS.
 *
 * WHY THIS FAILURE IS WORTH A TEST OF ITS OWN. A field-name disagreement here
 * does not throw. `answers.fullName` arrives as `undefined`, the worker fills a
 * real employer's form with blanks, and refuses the posting citing a missing
 * profile. Every symptom points at the candidate's account; nothing points at
 * the seam. `smoke.ts` checks all of this against the LIVE broker, but it needs
 * APPLY_WORKER_SECRET and has therefore never been run.
 *
 * This is the half that needs no secret: both files are in this repo, so the
 * contract can be compared statically today. It is strictly weaker than the
 * live smoke test — it proves the two agree on NAMES, not that the broker
 * returns sensible VALUES — and it does not replace running smoke.ts once the
 * secret exists.
 *
 * The extractors below assert they found something before comparing. A regex
 * that silently matched nothing on both sides would report perfect agreement
 * between two empty sets, which is the exact shape of every false measurement
 * this codebase has hit.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const WORKER = read("worker/src/broker.ts");
const BROKER = read("supabase/functions/apply-broker/index.ts");

/** Field names declared in a TS type block, e.g. `export type X = { a: string; ... }`. */
function typeFields(src: string, typeName: string): string[] {
  const start = src.indexOf(`export type ${typeName} = {`);
  if (start === -1) throw new Error(`type ${typeName} not found in broker.ts`);
  const open = src.indexOf("{", start);
  let depth = 0, end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = src.slice(open + 1, end);
  // Strip block comments so commented-out names cannot masquerade as fields.
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  return [...new Set([...clean.matchAll(/(?:^|[;{\n])\s*([a-zA-Z_][\w]*)\s*:/g)].map((m) => m[1]))];
}

/** Keys of an object literal the broker returns, e.g. `answers: { a: ..., }`. */
function literalKeys(src: string, key: string): string[] {
  const at = src.indexOf(`${key}: {`);
  if (at === -1) throw new Error(`object literal ${key} not found in apply-broker`);
  const open = src.indexOf("{", at);
  let depth = 0, end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = src.slice(open + 1, end);
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  // Top level only: a nested object's keys are not the broker's own field names.
  const out: string[] = [];
  let d = 0;
  for (const line of clean.split("\n")) {
    const m = d === 0 ? /^\s*([a-zA-Z_][\w]*)\s*:/.exec(line) : null;
    if (m) out.push(m[1]);
    d += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
  }
  return [...new Set(out)];
}

describe("standing answers: what the worker expects vs what the broker sends", () => {
  const expected = typeFields(WORKER, "StandingAnswersWire");
  const sent = literalKeys(BROKER, "answers");

  it("the extractors actually found both sides", () => {
    // Guards the test itself. Two empty sets agree perfectly.
    expect(expected.length).toBeGreaterThan(15);
    expect(sent.length).toBeGreaterThan(15);
    expect(expected).toContain("fullName");
    expect(sent).toContain("fullName");
  });

  it("the broker sends every field the worker reads", () => {
    // A missing one arrives as undefined and becomes a blank on a real form.
    const missing = expected.filter((f) => !sent.includes(f));
    expect(missing, `apply-broker never sends: ${missing.join(", ")}`).toEqual([]);
  });

  it("the worker declares every field the broker sends", () => {
    // The reverse is not harmless either: a field the broker computes and the
    // worker never reads is dead weight that looks like a working feature.
    const unread = sent.filter((f) => !expected.includes(f));
    expect(unread, `apply-broker sends unread fields: ${unread.join(", ")}`).toEqual([]);
  });
});

describe("the packet: same comparison, different object", () => {
  const sent = literalKeys(BROKER, "packet");

  it("carries every field the worker's ClaimedPacket names", () => {
    const block = WORKER.slice(WORKER.indexOf("export type ClaimedPacket"));
    const packetBlock = block.slice(block.indexOf("packet: {"), block.indexOf("answers:"));
    // TOP LEVEL ONLY, scanned character by character.
    //
    // Two extractor bugs got caught here before the contract did, and both were
    // the same mistake in different clothes. A flat regex reported `value` as a
    // missing packet field — it comes from the NESTED
    // `fields: Record<string, { value: string; source: string }>`. A line-based
    // one then found only three fields, because ClaimedPacket declares several
    // per line (`id: number; user_id: string; posting_id: string;`).
    //
    // The `toContain("apply_url")` assertion below is what caught the second.
    // Without it the test would have compared three fields against ten, found
    // no mismatch, and reported the contract as sound.
    const expected: string[] = [];
    let depth = 0;
    for (let i = 0; i < packetBlock.length; i++) {
      const c = packetBlock[i];
      if (c === "{") { depth++; continue; }
      if (c === "}") { depth--; continue; }
      if (depth !== 1) continue;
      const m = /^([a-zA-Z_][\w]*)\s*\??:/.exec(packetBlock.slice(i));
      if (m && !/[\w]/.test(packetBlock[i - 1] ?? "")) {
        expected.push(m[1]);
        i += m[0].length - 1;
      }
    }
    expect(expected).toContain("apply_url");
    expect(sent).toContain("apply_url");
    const missing = expected.filter((f) => !sent.includes(f));
    expect(missing, `packet is missing: ${missing.join(", ")}`).toEqual([]);
  });

  it("includes fields — the reserved cover-note key rides inside it", () => {
    // If `fields` were ever dropped from the packet, tailored cover notes would
    // silently stop arriving and the generic note would go out forever.
    expect(sent).toContain("fields");
  });
});

describe("the trinaries survive as null", () => {
  // The single most damaging value bug available here: coercing null to false
  // tells an employer someone is NOT authorised to work somewhere when they
  // simply never answered.
  const TRINARY = ["workAuthorized", "requiresSponsorship", "willingToRelocate"];

  it.each(TRINARY)("%s goes through trinary(), not a boolean cast", (field) => {
    const line = BROKER.split("\n").find((l) => l.trim().startsWith(`${field}:`));
    expect(line, `${field} not found in the broker's answers`).toBeTruthy();
    expect(line!, `${field} must use trinary()`).toMatch(/trinary\(/);
    // `=== true` or `!!` would collapse "not stated" into "no".
    expect(line!).not.toMatch(/===\s*true|!!/);
  });

  it("the worker declares them as boolean | null", () => {
    for (const f of TRINARY) {
      const line = WORKER.split("\n").find((l) => l.trim().startsWith(`${f}:`));
      expect(line, `${f} missing from StandingAnswersWire`).toBeTruthy();
      expect(line!).toMatch(/boolean\s*\|\s*null/);
    }
  });
});

describe("every action the worker calls, the broker answers", () => {
  const called = [...new Set([...WORKER.matchAll(/action:\s*"([a-z]+)"/g)].map((m) => m[1]))];
  const handled = [...new Set([...BROKER.matchAll(/action === "([a-z]+)"/g)].map((m) => m[1]))];

  it("found both lists", () => {
    expect(called.length).toBeGreaterThan(3);
    expect(handled.length).toBeGreaterThan(3);
  });

  it("the broker handles all of them", () => {
    // An unhandled action does not 404 loudly — it falls through to whatever
    // the broker's default is, and the worker treats the reply as data.
    const unhandled = called.filter((a) => !handled.includes(a));
    expect(unhandled, `worker calls actions the broker ignores: ${unhandled.join(", ")}`).toEqual([]);
  });

  it("keeps uncertain() separate from release()", () => {
    // uncertain carries WHERE submitted_at IS NULL, which refuses to overwrite
    // a CONFIRMED send with "we don't know" — the worst data loss here.
    expect(called).toContain("uncertain");
    expect(handled).toContain("uncertain");
  });
});
