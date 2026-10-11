// @vitest-environment node
/**
 * EVERY WAVE-3 BUILD IS ASKED FOR BY ITS OWN SECTION (review of the S11 round).
 *
 * 35 functions the round re-stamped had no verifier section asking for the
 * round's build: scan-heartbeat was asked for .2 while the merge carried .7,
 * shortlist-evaluate for 2026-10-10.3 while the 112000 hold said "section 72
 * PASSes" at .62, nl-search, public-api, the parsers and a dozen generators
 * for older builds or none. Only section 49's ledger comparison would have
 * caught a stale bundle, so a group's claims never failed on its own section.
 *
 * The property: every build dated 2026-10-09 or 2026-10-10 (wave 3's days)
 * is asked for exactly, by at least one of sections 71-80. A later build
 * (a later wave) is free of this test.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildOf } from "../../scripts/deploy-ledger.mjs";

const ROOT = resolve(__dirname, "../..");
const FN_DIR = join(ROOT, "supabase/functions");
const SEC_DIR = join(ROOT, "scripts/verify-deploy.d");
const WAVE3_DAYS = new Set(["2026-10-09", "2026-10-10"]);

type Build = { date: string; n: number };
const parse = (b: string | null): Build | null => {
  const m = b ? /\.(20\d\d-\d\d-\d\d)\.(\d+)$/.exec(b) : null;
  return m ? { date: m[1], n: Number(m[2]) } : null;
};

function pinsOf(src: string): Array<[string, Build]> {
  const out: Array<[string, Build]> = [];
  for (const m of src.matchAll(/"([a-z][a-z0-9-]+)\|(20\d\d-\d\d-\d\d)\|(\d+)"/g)) out.push([m[1], { date: m[2], n: Number(m[3]) }]);
  for (const m of src.matchAll(/build_ge "?([a-z][a-z0-9-]+)"? "\$[A-Za-z0-9_]+" "?(20\d\d-\d\d-\d\d)"? "?(\d+)"?/g)) out.push([m[1], { date: m[2], n: Number(m[3]) }]);
  // for X in a:N b:N ...; do ... build_ge "$FN" "$H" "<day>" "$N"   (a fixed day, a number per entry)
  // for X in a:GET b:OPTIONS ...; do ... build_ge "$FN" "$H" "<day>" "<n>"   (a fixed day and number)
  for (const m of src.matchAll(/for [A-Z0-9_]+ in ((?:[^;]|\n)+?); do((?:.|\n){0,900}?)build_ge "\$[A-Z0-9_]+" "\$[A-Z0-9_]+" "?(20\d\d-\d\d-\d\d)"? "?(\$[A-Z0-9_]+|\d+)"?/g)) {
    const [, list, , day, nArg] = m;
    for (const e of list.matchAll(/([a-z][a-z0-9-]+):([A-Za-z0-9]+)/g)) {
      const n = /^\d+$/.test(nArg) ? Number(nArg) : /^\d+$/.test(e[2]) ? Number(e[2]) : NaN;
      if (Number.isFinite(n)) out.push([e[1], { date: day, n }]);
    }
  }
  // Section 71's loop: a case per name, the default for the rest.
  const loop = /for VD71_FN in ([a-z -]+); do/.exec(src);
  if (loop) {
    const named = new Map<string, Build>();
    let dflt: Build | null = null;
    for (const c of src.matchAll(/([a-z*][a-z0-9-]*)\) VD71_D=(20\d\d-\d\d-\d\d); VD71_N=(\d+);;/g)) {
      const b = { date: c[2], n: Number(c[3]) };
      if (c[1] === "*") dflt = b; else named.set(c[1], b);
    }
    for (const fn of loop[1].trim().split(/\s+/)) {
      const b = named.get(fn) ?? dflt;
      if (b) out.push([fn, b]);
    }
  }
  return out;
}

describe("sections 71-80 ask for every wave-3 build", () => {
  const sections = readdirSync(SEC_DIR).filter((f) => /^(7\d|80)/.test(f) && f.endsWith(".sh"));
  const asked = new Map<string, Build[]>();
  for (const f of sections) for (const [fn, b] of pinsOf(readFileSync(join(SEC_DIR, f), "utf8"))) asked.set(fn, [...(asked.get(fn) ?? []), b]);

  it("reads the sections", () => {
    expect(sections.length).toBeGreaterThanOrEqual(10);
    expect(asked.get("job-board")?.some((b) => b.date === "2026-09-09" && b.n === 92)).toBe(true);
  });

  it("every function built on 2026-10-09 or 2026-10-10 is asked for that exact build", () => {
    const stale: string[] = [];
    for (const fn of readdirSync(FN_DIR)) {
      const idx = join(FN_DIR, fn, "index.ts");
      if (fn === "_shared" || !existsSync(idx)) continue;
      const head = parse(buildOf(fn, readFileSync(idx, "utf8")));
      if (!head || !WAVE3_DAYS.has(head.date)) continue;
      const pins = asked.get(fn) ?? [];
      if (!pins.some((p) => p.date === head.date && p.n === head.n)) {
        stale.push(`${fn} carries ${head.date}.${head.n}; sections ask for ${pins.map((p) => `${p.date}.${p.n}`).join(", ") || "nothing"}`);
      }
    }
    expect(stale, stale.join("\n")).toEqual([]);
  });
});
