// @vitest-environment node
/**
 * EVERY WAVE-4 BUILD IS ASKED FOR BY ITS OWN SECTION.
 *
 * The wave-3 review found 35 re-stamped functions that no verifier section
 * asked for, so a stale bundle would only have shown in section 49's ledger
 * comparison and never failed a group's own claims
 * (every-wave-three-build-is-asked-for-by-its-own-section). Wave 4 stamps
 * fourteen functions; the integration alone added five (public-api,
 * api-key-request's ask, create-product-checkout, and the two generators that
 * import the widened classifier), and three of those had no section at first.
 *
 * The property: every function built on 2026-10-11 (wave 4's day) or on
 * job-board's reserved 2026-09-09.93 is asked for by at least one of the
 * wave-4 sections (82-86, 93, and the second round's 92-w4b-*) through build_ge, at that date with a floor at
 * or below the build the repository carries (build_ge accepts a later one, so
 * a floor can lag a later fix-round stamp without going stale). A later wave
 * is free of this test.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildOf } from "../../scripts/deploy-ledger.mjs";

const ROOT = resolve(__dirname, "../..");
const FN_DIR = join(ROOT, "supabase/functions");
const SEC_DIR = join(ROOT, "scripts/verify-deploy.d");
const WAVE4 = (fn: string, b: { date: string; n: number }) => b.date === "2026-10-11" || (fn === "job-board" && b.date === "2026-09-09" && b.n === 93);

type Build = { date: string; n: number };
const parse = (b: string | null): Build | null => {
  const m = b ? /\.(20\d\d-\d\d-\d\d)\.(\d+)$/.exec(b) : null;
  return m ? { date: m[1], n: Number(m[2]) } : null;
};

/** Every (function, floor) a section asks build_ge for: literal names, "fn|day|n" pairs, and a loop over names with one floor. */
function asksOf(src: string): Array<[string, Build]> {
  const out: Array<[string, Build]> = [];
  for (const m of src.matchAll(/"([a-z][a-z0-9-]+)\|(20\d\d-\d\d-\d\d)\|(\d+)"/g)) out.push([m[1], { date: m[2], n: Number(m[3]) }]);
  for (const m of src.matchAll(/build_ge "?([a-z][a-z0-9-]+)"? "\$[A-Za-z0-9_]+" "?(20\d\d-\d\d-\d\d)"? "?(\d+)"?/g)) out.push([m[1], { date: m[2], n: Number(m[3]) }]);
  for (const m of src.matchAll(/for ([A-Z0-9_]+) in ([a-z0-9 -]+); do[\s\S]{0,600}?build_ge "\$\1" "\$[A-Za-z0-9_]+" "(20\d\d-\d\d-\d\d)" "(\d+)"/g)) {
    for (const fn of m[2].trim().split(/\s+/)) out.push([fn, { date: m[3], n: Number(m[4]) }]);
  }
  return out;
}

describe("the wave-4 sections ask for every wave-4 build", () => {
  const sections = readdirSync(SEC_DIR).filter((f) => /^(8[2-6]|93|92-w4b)-/.test(f) && f.endsWith(".sh"));
  const asked = new Map<string, Build[]>();
  for (const f of sections) for (const [fn, b] of asksOf(readFileSync(join(SEC_DIR, f), "utf8"))) asked.set(fn, [...(asked.get(fn) ?? []), b]);

  it("reads the sections, the retire loop included", () => {
    expect(sections).toEqual(expect.arrayContaining(["82-wave4-keyless-surface.sh", "84-wave4-apply-myself.sh", "85-wave4-allowance.sh", "86-wave4-job-board.sh", "93-wave4-retire.sh"]));
    expect(asked.get("apply-broker")?.some((b) => b.date === "2026-10-11" && b.n === 13), "the retire section's loop").toBe(true);
    expect(asked.get("job-board")?.some((b) => b.date === "2026-09-09" && b.n === 93)).toBe(true);
  });

  it("every function the repository stamps for wave 4 is asked for at that date, at or below its build", () => {
    const unasked: string[] = [];
    let wave4 = 0;
    for (const fn of readdirSync(FN_DIR)) {
      const idx = join(FN_DIR, fn, "index.ts");
      if (fn === "_shared" || !existsSync(idx)) continue;
      const head = parse(buildOf(fn, readFileSync(idx, "utf8")));
      if (!head || !WAVE4(fn, head)) continue;
      wave4++;
      const asks = asked.get(fn) ?? [];
      if (!asks.some((a) => a.date === head.date && a.n <= head.n)) {
        unasked.push(`${fn} carries ${head.date}.${head.n}; the wave-4 sections ask for ${asks.map((a) => `${a.date}.${a.n}`).join(", ") || "nothing"}`);
      }
    }
    expect(wave4, "no wave-4 build was found: the date filter is wrong").toBeGreaterThanOrEqual(10);
    expect(unasked, unasked.join("\n")).toEqual([]);
  });

  it("teeth: a function no section asks for is reported", () => {
    const one = asksOf('for VD_FN in alpha beta; do\n  H=$(x)\n  if build_ge "$VD_FN" "$H" "2026-10-11" "3"; then :; fi\ndone');
    expect(one).toEqual([["alpha", { date: "2026-10-11", n: 3 }], ["beta", { date: "2026-10-11", n: 3 }]]);
    expect(asksOf('build_ge agent-mcp "$H" "2026-10-11" "2"')).toEqual([["agent-mcp", { date: "2026-10-11", n: 2 }]]);
    expect(asksOf("echo nothing")).toEqual([]);
  });
});
