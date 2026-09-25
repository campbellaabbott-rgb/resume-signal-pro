// @vitest-environment node
/**
 * A BUNDLE OVER THE CLIFF SERVES THE PREVIOUS DEPLOY.
 *
 * WHAT THIS GUARDS. A function bundle over about 4.5 MB does not fail to
 * deploy here -- it deploys, reports success, and keeps serving the PREVIOUS
 * version. That is the worst failure shape available: every check downstream
 * passes against code that is not the code in the tree, and the way it is
 * found is by noticing that a change had no effect. lca-payload.ts's own
 * header cites this cliff as the reason its rows are gzipped, and nothing
 * measured it: verify-deploy.sh sizes only the job-board bundle, and no test
 * in src/test/ looked at layoff-filings at all.
 *
 * BOTH THINGS EATING THE MARGIN GROW. board-sources.ts is a byte copy of the
 * job-board catalogue (guarded for drift by
 * a-copy-of-the-catalogue-drifts-the-day-the-catalogue-moves) and grows with
 * every census merge; each new quarterly payload is another ~200 KB of base64.
 * Neither growth is visible in a diff that says "regenerated".
 *
 * WHAT IT MEASURES, AND WHAT IT CANNOT. The LOCAL module graph reachable from
 * the entry point: every relative import, transitively, summed as bytes on
 * disk. It does not measure the eszip the platform builds, and it does not
 * measure the remote modules -- deno info put those at about 1.49 MB for this
 * function on 2026-09-25. So the ceiling below is set where the local half can
 * sit with the remote half and the platform's own overhead still under the
 * cliff, and it is a LOWER bound on what ships: if this fails, the deploy is
 * already over.
 *
 * TEETH. The walker is shown finding a file that is imported and not finding
 * one that is not, and the ceiling is shown refusing a graph one byte over it.
 * A size gate that cannot fail is a number in a comment.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const ENTRY = resolve(ROOT, "supabase/functions/layoff-filings/index.ts");

/**
 * THE CEILING, AND WHY IT IS THIS NUMBER. The cliff is ~4.5 MB for the whole
 * bundle. The remote modules this function pulls measured 1.49 MB on
 * 2026-09-25, leaving ~3.0 MB for the local graph before the platform's own
 * overhead is counted. Measured that day: 2,647,865 bytes over 32 modules --
 * 352 KB of headroom, or roughly one more quarterly payload plus a year of
 * catalogue growth. Raising this number is a decision about what gets served,
 * not a formality: the next quarter's payload REPLACES this one, so a load
 * that grows the graph is a catalogue that grew.
 */
const LOCAL_GRAPH_CEILING_BYTES = 3_000_000;

/** Every local module reachable from an entry point, and its size on disk. */
function localGraph(entry: string): Map<string, number> {
  const seen = new Map<string, number>();
  const walk = (file: string) => {
    if (seen.has(file)) return;
    const src = readFileSync(file, "utf8");
    seen.set(file, Buffer.byteLength(src, "utf8"));
    for (const m of src.matchAll(/(?:from|import)\s+"([^"]+)"/g)) {
      const spec = m[1];
      if (!spec.startsWith(".")) continue;
      walk(resolve(dirname(file), spec));
    }
  };
  walk(entry);
  return seen;
}

describe("the layoff-filings bundle stays under the cliff", () => {
  const graph = localGraph(ENTRY);
  const total = [...graph.values()].reduce((n, b) => n + b, 0);

  it(`is at most ${LOCAL_GRAPH_CEILING_BYTES.toLocaleString("en-US")} bytes of local modules`, () => {
    const biggest = [...graph.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([f, n]) => `${relative(ROOT, f)} ${n.toLocaleString("en-US")}`).join(", ");
    expect(
      total,
      `the local module graph is ${total.toLocaleString("en-US")} bytes over ${graph.size} modules (${biggest}). ` +
      "Over the ceiling the deploy reports success and serves the PREVIOUS version.",
    ).toBeLessThanOrEqual(LOCAL_GRAPH_CEILING_BYTES);
  });

  it("walks the real graph: the payload and the catalogue copy are in it, an unimported file is not", () => {
    const names = [...graph.keys()].map((f) => relative(ROOT, f));
    for (const f of [
      "supabase/functions/layoff-filings/index.ts",
      "supabase/functions/layoff-filings/lca-payload.ts",
      "supabase/functions/layoff-filings/lca-cells.ts",
      "supabase/functions/layoff-filings/board-sources.ts",
    ]) expect(names, `${f} is not in the measured graph`).toContain(f);
    // The tests beside the function are not part of what ships, and counting
    // them would hide real growth behind a number that is already too big.
    expect(names.some((n) => n.endsWith("_test.ts"))).toBe(false);
  });

  it("TEETH: the ceiling refuses a graph over it, and it binds the growth that is actually coming", () => {
    // The gate itself, shown failing: a number in a comment is not a gate.
    expect(() => expect(LOCAL_GRAPH_CEILING_BYTES + 1).toBeLessThanOrEqual(LOCAL_GRAPH_CEILING_BYTES)).toThrow();
    // And it binds something real. The payload is replaced each quarter rather
    // than added to, so the growth this has to catch is the catalogue copy and
    // a payload that grew: two more of today's payload does not fit, which is
    // the margin this ceiling is claiming to hold.
    const payload = [...graph.entries()].find(([f]) => f.endsWith("lca-payload.ts"))![1];
    expect(payload).toBeGreaterThan(100_000);
    expect(
      total + payload * 2,
      "two more payloads fit under the ceiling -- it is not holding anything",
    ).toBeGreaterThan(LOCAL_GRAPH_CEILING_BYTES);
  });
});
