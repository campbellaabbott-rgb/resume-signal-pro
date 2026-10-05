/**
 * A RULE WRITTEN IN PROSE BESIDE AN OPEN SET IS NOT A RULE.
 *
 * Two defects, one shape: a constraint that was stated correctly in one place
 * and never held anywhere else.
 *
 * (B) LIGHT_CAPABLE_VENDORS exists because light mode is only safe where the
 *     descriptions can come back. greenhouse light boards are refilled by
 *     backfill-desc's per-JOB endpoint; workable has no such filler, so a
 *     workable board in light mode fetches details=false, inserts description
 *     NULL on every new row forever, and nothing can put the text back. The set
 *     was consulted at ONE call site — the byte-budget bound — while the two
 *     content-volume enrolments in the ingest loop wrote DYNAMIC_LIGHT and its
 *     persisted meta row by hand, with no vendor test. 2,925 workable boards
 *     could enrol themselves into the mode the comment forbade, and the
 *     enrolment persisted, so it survived the isolate that chose it.
 *
 *     So this guard does not pin the fixed call site. It states the property
 *     for the CLASS: the set itself refuses a non-light-capable token, and the
 *     refusal is executed here, not merely read.
 *
 * (C) The maintenance ladder counted description-nulls over a vendor-agnostic
 *     light list and kicked backfill-desc, which fills greenhouse light boards
 *     only. Nulls on a non-greenhouse light token were counted by the trigger
 *     and unreachable by the filler, so the count could never fall, the trigger
 *     was permanently true, and its `return` stood in front of desc-sweep — the
 *     only lane that fills workday, oracle, smartrecruiters, bamboohr, breezy,
 *     rippling, adp, ukg and jazzhr. Workday description coverage went 98% ->
 *     90%. Two predicates that must agree, written twice, drifted.
 *
 *     So this guard does not pin either spelling. It states that there is only
 *     ONE predicate, that both the trigger and the filler read it, and that the
 *     rung falls through instead of gating the lane behind it.
 *
 * Verified to have teeth: reverted to `const DYNAMIC_LIGHT = new Set<string>()`
 * the class test fails at the declaration and the executed gate admits the
 * workable token; restoring the ladder's own `JOB_SOURCES.filter(isLight)` and
 * its `return` fails the shared-predicate and fall-through tests.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const INDEX = resolve(__dirname, "../../supabase/functions/job-board/index.ts");
const RAW = readFileSync(INDEX, "utf8");

/**
 * Comments first — every assertion below is about code, and a rule that quotes
 * the broken form in a comment must not fail itself (nor pass on one). Block
 * comments and JSDoc go wholesale; line comments go only where `//` is not
 * preceded by `:`, `'`, `"`, a backtick or a backslash, so `https://` inside a
 * string literal survives intact.
 */
const stripComments = (ts: string) =>
  ts.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:'"`\\])\/\/[^\n]*/gm, "$1");

const CODE = stripComments(RAW);

/** The balanced `{...}` block that opens after `marker`. */
function blockAfter(src: string, marker: string): string {
  const i = src.indexOf(marker);
  expect(i, `expected to find ${marker} in job-board/index.ts`).toBeGreaterThan(-1);
  const open = src.indexOf("{", i);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(open, j + 1);
  }
  throw new Error(`unbalanced block after ${marker}`);
}

const countOf = (needle: string) => CODE.split(needle).length - 1;

/** Every index at which `needle` appears. */
function positionsOf(needle: string): number[] {
  const out: number[] = [];
  for (let i = CODE.indexOf(needle); i !== -1; i = CODE.indexOf(needle, i + 1)) out.push(i);
  return out;
}

/** [start, end) of the balanced block belonging to a named declaration. */
function spanOf(marker: string): [number, number] {
  const i = CODE.indexOf(marker);
  expect(i, `expected to find ${marker} in job-board/index.ts`).toBeGreaterThan(-1);
  const body = blockAfter(CODE, marker);
  const open = CODE.indexOf("{", i);
  return [open, open + body.length];
}

const DECL = /const DYNAMIC_LIGHT\s*:\s*Set<string>\s*=\s*new\s+([A-Za-z_$][\w$]*)\s*\(\s*\)/;

describe("B — the dynamic light set can only ever hold a light-capable vendor's token", () => {
  it("is a gated class, not a bare Set that anything may write to", () => {
    expect(
      DECL.test(CODE),
      "DYNAMIC_LIGHT must be constructed from a class that refuses non-light-capable " +
        "tokens. A bare `new Set<string>()` puts the vendor test back at the call sites, " +
        "which is exactly the shape that let 2,925 workable boards enrol themselves into " +
        "a mode with no filler behind it.",
    ).toBe(true);
    expect(
      /const DYNAMIC_LIGHT\s*=\s*new Set/.test(CODE),
      "DYNAMIC_LIGHT is back to a plain Set — the gate has been removed",
    ).toBe(false);
  });

  it("refuses before it admits: the class asks the catalog ahead of super.add", () => {
    const cls = DECL.exec(CODE)![1];
    const body = blockAfter(CODE, `class ${cls} extends Set<string>`);
    expect(body).toContain("lightBoardRefusal(");
    expect(body).toContain("super.add(");
    expect(
      body.indexOf("lightBoardRefusal(") < body.indexOf("super.add("),
      `${cls}.add admits the board before it asks whether the board is safe`,
    ).toBe(true);
    // The predicate itself must consult the vendor set.
    const pred = blockAfter(CODE, "const lightBoardRefusal = (key: string)");
    expect(pred).toContain("LIGHT_CAPABLE_VENDORS.has(");
  });

  /**
   * Lift the gate (lightKey, lightBoardRefusal, the class) and isLight out of
   * the file, strip their type annotations, and execute them against a stub
   * catalog. A guard that only pins spellings goes green over dead code.
   */
  function liftGate(catalog: Array<{ token: string; source: string }>, staticLight: string[] = []) {
    const cls = DECL.exec(CODE)![1];
    const keyFn = /const lightKey = \(s: \{ source: string; token: string \}\) => [^\n]+;/.exec(CODE)?.[0] ?? "";
    expect(keyFn, "lightKey not found: the light set must be keyed by board").not.toBe("");
    const isLightFn = /const isLight = \(s: \{ source: string; token: string \}\) => [^\n]+;/.exec(CODE)?.[0] ?? "";
    expect(isLightFn, "isLight not found in its per-board form").not.toBe("");
    const vendorFn = `const lightBoardRefusal = (key) => ${blockAfter(CODE, "const lightBoardRefusal = (key: string)")};`;
    const classSrc = `class ${cls} extends Set<string> ${blockAfter(CODE, `class ${cls} extends Set<string>`)}`;
    const js = `${keyFn}\n${vendorFn}\n${classSrc}\nconst DYNAMIC_LIGHT = new ${cls}();\n${isLightFn}\nreturn { gate: DYNAMIC_LIGHT, isLight, lightKey };`
      .replace(/\boverride\s+/g, "")
      .replace(/extends Set<string>/g, "extends Set")
      .replace(/\(s: \{ source: string; token: string \}\)/g, "(s)")
      .replace(/\(([A-Za-z_$][\w$]*)\s*:\s*[^)]+\)/g, "($1)")
      .replace(/\)\s*:\s*[A-Za-z_$][\w$<>|\s.]*?(=>|\{)/g, ") $1");
    try {
      return new Function("JOB_SOURCES", "LIGHT_CAPABLE_VENDORS", "LIGHT_DESC_TOKENS", "console", js)(
        catalog, new Set(["greenhouse"]), new Set(staticLight), { warn: () => {} },
      ) as { gate: Set<string>; isLight: (s: { source: string; token: string }) => boolean; lightKey: (s: { source: string; token: string }) => string };
    } catch (e) {
      throw new Error(
        `the light-mode gate could not be executed (${e instanceof Error ? e.message : String(e)}).\n` +
          `If you reshaped it, update this harness — but KEEP THE PROPERTY: a board whose ` +
          `vendor is not in LIGHT_CAPABLE_VENDORS must never read as light.\n--- lifted source ---\n${js}`,
      );
    }
  }

  it("REFUSES A WORKABLE BOARD WHEN RUN, not merely when read", () => {
    const { gate } = liftGate([
      { token: "acme", source: "greenhouse" },
      { token: "bigwork", source: "workable" },
      { token: "lev", source: "lever" },
      { token: "antenna", source: "greenhouse" },
      { token: "antenna", source: "workable" },
    ]);

    gate.add("greenhouse:acme");
    expect(gate.has("greenhouse:acme"), "a greenhouse board has a filler and must still be admitted").toBe(true);

    gate.add("workable:bigwork");
    expect(
      gate.has("workable:bigwork"),
      "a WORKABLE board entered light mode. Its light list form drops details=true, so every " +
        "new posting stores description NULL and no filler can put it back — the enrolment " +
        "deletes descriptions rather than deferring them.",
    ).toBe(false);

    gate.add("lever:lev");
    expect(gate.has("lever:lev"), "lever has no light list form at all").toBe(false);

    gate.add("greenhouse:not-in-the-catalog");
    expect(
      gate.has("greenhouse:not-in-the-catalog"),
      "an unresolvable board was admitted. Unknown must be REFUSED, not assumed: light mode " +
        "is a promise that some filler will put the text back, and we cannot promise that for " +
        "a board whose vendor we can no longer name.",
    ).toBe(false);

    gate.add("greenhouse:bigwork");
    expect(gate.has("greenhouse:bigwork"), "a key naming a vendor the token is not carried by is not a board").toBe(false);

    gate.add("acme");
    expect(gate.has("acme"), "a bare token is not a board key and must not enter the set").toBe(false);
  });

  it("a shared token: the greenhouse board goes light ALONE, its workable twin never does", () => {
    // `antenna`, `mcs`, `lockwood` (workable), `lush` (personio), `samsara`
    // (pinpoint), `pulse` (ashby): 52 greenhouse tokens carry a second vendor.
    // Keyed by token, admitting the greenhouse board flipped the twin to its
    // light form too and deleted its descriptions forever, so every shared
    // token was refused and an oversize greenhouse board on one stayed dark.
    // Keyed by board, the greenhouse enrolment is admitted and the twin's
    // isLight stays false.
    const { gate, isLight } = liftGate([
      { token: "antenna", source: "greenhouse" },
      { token: "antenna", source: "workable" },
    ]);
    gate.add("greenhouse:antenna");
    expect(gate.has("greenhouse:antenna"), "the greenhouse board of a shared token was refused light mode").toBe(true);
    expect(isLight({ source: "greenhouse", token: "antenna" })).toBe(true);
    expect(
      isLight({ source: "workable", token: "antenna" }),
      "the WORKABLE twin reads as light: its list form would drop details=true and no filler can put the text back",
    ).toBe(false);
    gate.add("workable:antenna");
    expect(gate.has("workable:antenna")).toBe(false);
  });

  it("has exactly one door: nothing outside the two admission functions writes the set or its meta row", () => {
    const [loadFrom, loadTo] = spanOf("async function loadDynamicLight(");
    const [enrolFrom, enrolTo] = spanOf("async function enrolDynamicLight(");
    const inside = (p: number) => (p >= loadFrom && p < loadTo) || (p >= enrolFrom && p < enrolTo);

    const adds = positionsOf("DYNAMIC_LIGHT.add(");
    expect(adds.length, "nothing admits to DYNAMIC_LIGHT any more — the set is unreachable").toBeGreaterThan(0);
    expect(
      adds.filter((p) => !inside(p)).length,
      "DYNAMIC_LIGHT is written outside loadDynamicLight/enrolDynamicLight. Every enrolment " +
        "must go through the one door so the vendor test and the persistence stay together — " +
        "the ingest loop's hand-written copies are how the guard was bypassed.",
    ).toBe(0);

    const writes = positionsOf(`k: "light_desc_dynamic"`);
    expect(
      writes.filter((p) => !inside(p)).length,
      "the persisted light-mode row is written outside loadDynamicLight/enrolDynamicLight. A " +
        "second writer can persist an enrolment the set refused, which outlives the isolate.",
    ).toBe(0);
  });

  it("sweeps the persisted row, so a stranded board is not merely refused forever", () => {
    const body = blockAfter(CODE, "async function loadDynamicLight(");
    expect(
      /k: "light_desc_dynamic"/.test(body),
      "loadDynamicLight refuses stranded tokens but never rewrites the row, so every isolate " +
        "re-reads and re-refuses them and nobody can see which boards were stranded",
    ).toBe(true);
    expect(body).toContain("strandedRemoved");
  });

  it("a vendor may go light only where a filler exists", () => {
    const set = /const LIGHT_CAPABLE_VENDORS\s*=\s*new Set\(\[([^\]]*)\]\)/.exec(CODE);
    expect(set, "LIGHT_CAPABLE_VENDORS is gone").not.toBeNull();
    const vendors = [...set![1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
    expect(vendors.length).toBeGreaterThan(0);
    expect(vendors, "workable has no per-posting filler and must never be light-capable").not.toContain("workable");

    const filler = /const DESC_BACKFILL_VENDOR\s*=\s*["']([^"']+)["']/.exec(CODE);
    expect(filler, "DESC_BACKFILL_VENDOR is gone — the filler's vendor must be nameable").not.toBeNull();
    expect(
      vendors,
      `a vendor is in LIGHT_CAPABLE_VENDORS that backfill-desc cannot fill. backfill-desc hits ` +
        `the ${filler![1]} per-JOB endpoint and only that; any other vendor here goes light and ` +
        `never gets its descriptions back.`,
    ).toEqual([filler![1]]);
  });
});

describe("C — the trigger and the filler read the same predicate, and the rung falls through", () => {
  it("there is one predicate, defined once", () => {
    expect(countOf("const descBackfillBoards"), "descBackfillBoards must have exactly one definition").toBe(1);
  });

  it("both the maintenance trigger and the backfill filler call it", () => {
    expect(
      countOf("descBackfillBoards()"),
      "descBackfillBoards() must be called exactly twice — once by the trigger that COUNTS the " +
        "missing descriptions and once by the filler that WRITES them. Any other count means a " +
        "reader has grown its own list again.",
    ).toBe(2);

    const trigger = /const lightTokens\s*=\s*([^\n;]+)/.exec(CODE);
    expect(trigger, "the maintenance ladder no longer builds lightTokens").not.toBeNull();
    expect(
      trigger![1],
      "lightTokens is built from something other than descBackfillBoards(). A vendor-agnostic " +
        "list counts description-nulls on boards backfill-desc cannot touch: the count never " +
        "falls, so the trigger is permanently true.",
    ).toContain("descBackfillBoards()");

    const filler = /const BOARDS\s*=\s*descBackfillBoards\(\)/.test(CODE);
    expect(filler, "backfill-desc no longer selects its boards through descBackfillBoards()").toBe(true);
  });

  it("no second, drifting light-board list survives anywhere in the file", () => {
    const defLine = "JOB_SOURCES.filter((s) => s.source === DESC_BACKFILL_VENDOR && isLight(s))";
    const strays = positionsOf("JOB_SOURCES.filter(").filter((p) => {
      const stmt = CODE.slice(p, CODE.indexOf("\n", p) + 1);
      return stmt.includes("isLight(") && !stmt.includes(defLine);
    });
    expect(
      strays.length,
      "a second JOB_SOURCES list filtered by isLight exists. Two predicates that must agree, " +
        "written twice, is the drift that starved the description lane for weeks.",
    ).toBe(0);
  });

  it("the backfill-desc rung kicks and FALLS THROUGH to desc-sweep", () => {
    const kick = CODE.indexOf(`kick("backfill-desc"`);
    const sweep = CODE.indexOf(`kick("desc-sweep"`);
    expect(kick, "the backfill-desc kick is gone").toBeGreaterThan(-1);
    expect(sweep, "the desc-sweep kick is gone").toBeGreaterThan(-1);
    expect(
      sweep > kick,
      "desc-sweep no longer sits after the backfill-desc rung — this test is pointed at the wrong region",
    ).toBe(true);

    const between = CODE.slice(kick, sweep);
    expect(
      /\breturn\s*;/.test(between),
      "a `return` stands between the backfill-desc kick and the desc-sweep kick. That makes the " +
        "rung EXCLUSIVE: on every cycle the trigger fires, desc-sweep — the only lane that fills " +
        "workday, oracle, smartrecruiters, bamboohr, breezy, rippling, adp, ukg and jazzhr — " +
        "never runs. The country and embed tracks kick and fall through for exactly this reason " +
        "(the 2026-07-25 starvation); this rung must too.",
    ).toBe(false);
  });
});
