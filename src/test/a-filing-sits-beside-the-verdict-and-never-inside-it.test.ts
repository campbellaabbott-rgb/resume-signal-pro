/**
 * A FILING SITS BESIDE THE VERDICT AND NEVER INSIDE IT.
 *
 * The owner's thesis -- "if there are listings and the company conducted a
 * layoff, that gives users credence to the quality of the job post" -- is
 * carried to the reader by putting BOTH facts on the card, dated and sourced,
 * side by side. It is NOT carried by folding the filing into the verdict:
 * a takedown at a layoff employer is at least as likely a cancelled
 * requisition as a fill, and Cambium's 53.6 % cut sits in the same 8-K as a
 * subsidiary insolvency. So (SPEC sections 9.5, 9.6, 9.8, 11):
 *
 *   1. VERDICT UNTOUCHED. The bodies of activelyHiringVerdict,
 *      hiringRecordVerdict and growthVerdict contain no "layoff"; the OR that
 *      combines the two halves has exactly ONE site; the verdict type has
 *      exactly three members -- no fourth state.
 *   2. SURFACE ISOLATION. The per-posting surface (Jobs.tsx and its filing
 *      line) never calls the aggregate reader get_layoff_partition; the
 *      Ghost Index section never calls the per-posting reader
 *      get_employer_layoff_filings; the components never import a verdict.
 *   3. THE PRERENDER RENDERS NO FILING. scripts/prerender-seo.mjs regenerates
 *      ~500 company pages only on a build (the PwC overstatement sat in
 *      Google's index between deploys); a filing there would be a dated fact
 *      served weeks stale. It calls neither reader and names no layoff key.
 *   4. THE POLLER NEVER TOUCHES THE RATE BUDGET. No file under
 *      supabase/functions/layoff-filings names check_rate_limit,
 *      check_global_rate_limit or rate_limits -- board browsing has already
 *      killed upload and checkout once through that table.
 *   5. THE ORDER ON THE CARD. The filing chip renders AFTER the Actively-
 *      hiring slot in the meta row; the lander's "Also on record" list
 *      renders inside the Hiring Health card after the growth lines.
 *
 * Every assertion about what code DOES runs on comment-stripped source; the
 * teeth block proves each check fires on a doctored copy.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const has = (p: string) => existsSync(resolve(ROOT, p));
/** Block comments blanked (keeping newlines), then whole-line and trailing `//` comments; a `//` inside a string survives only when the line does not start with it. */
const stripTs = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/^\s*\/\/[^\n]*/gm, "").replace(/([;{}(),]\s*)\/\/[^\n]*/g, "$1");

const JOBS = "src/pages/Jobs.tsx";
const GHOST = "src/pages/GhostJobIndex.tsx";
const LINE = "src/components/jobs/LayoffFilingLine.tsx";
const SECTION = "src/components/ghost/LayoffPartitionSection.tsx";
const PRERENDER = "scripts/prerender-seo.mjs";
const POLLER_DIR = "supabase/functions/layoff-filings";

/** The text of `export function <name>(` up to its closing brace at column 0. */
export function fnBody(code: string, name: string): string {
  const start = code.search(new RegExp(`export function ${name}\\s*\\(`));
  if (start < 0) return "";
  const end = code.indexOf("\n}\n", start);
  return end < 0 ? "" : code.slice(start, end + 3);
}

/** What Jobs.tsx gets wrong, as named findings, so the same routine runs on a doctored copy. */
export function verdictFindings(code: string): string[] {
  const f: string[] = [];
  for (const name of ["activelyHiringVerdict", "hiringRecordVerdict", "growthVerdict"]) {
    const body = fnBody(code, name);
    if (!body) { f.push(`${name}: not found`); continue; }
    if (/layoff/i.test(body)) f.push(`${name}: reads a filing`);
  }
  const orSites = code.match(/closes === "closes" \|\| growth === "grew"/g) ?? [];
  if (orSites.length !== 1) f.push(`combination OR sites: ${orSites.length}`);
  const typeLine = code.match(/export type ActivelyHiringVerdict = ([^;]+);/);
  if (!typeLine) f.push("ActivelyHiringVerdict: type not found");
  else {
    const members = [...typeLine[1].matchAll(/"(\w+)"/g)].map((m) => m[1]).sort();
    if (members.join() !== ["negative", "positive", "unknown"].join()) f.push(`ActivelyHiringVerdict members: ${members.join("|")}`);
  }
  const sig = code.match(/export function activelyHiringVerdict\(([^)]*)\)/);
  if (sig && sig[1].split(",").length !== 2) f.push(`activelyHiringVerdict arity: ${sig[1].split(",").length}`);
  return f;
}

describe("the verdict is untouched", () => {
  const code = stripTs(read(JOBS));

  it("the three verdict functions read no filing, the OR has one site, the type has three members, the combiner takes two halves", () => {
    expect(verdictFindings(code)).toEqual([]);
  });

  it("the filing reaches the card through its own hook and component, not through the verdict's inputs", () => {
    // The hook lives in the filing line's module; Jobs.tsx consumes rows and
    // hands them to the chip and the line by token. hiringRecordOf/growthOf
    // are never fed a filing.
    expect(code).toMatch(/useEmployerLayoffFilings\(/);
    expect(code).not.toMatch(/hiringRecordOf\([^)]*layoff/i);
    expect(code).not.toMatch(/growthOf\([^)]*layoff/i);
    expect(code).not.toMatch(/activelyHiringVerdict\([^)]*layoff/i);
  });
});

describe("surface isolation", () => {
  it("Jobs.tsx and the filing line never call the aggregate reader", () => {
    expect(stripTs(read(JOBS))).not.toMatch(/get_layoff_partition/);
    expect(has(LINE), `${LINE} missing`).toBe(true);
    expect(stripTs(read(LINE))).not.toMatch(/get_layoff_partition/);
    expect(stripTs(read(LINE))).toMatch(/get_employer_layoff_filings/);
  });

  it("GhostJobIndex.tsx and the partition section never call the per-posting reader", () => {
    expect(stripTs(read(GHOST))).not.toMatch(/get_employer_layoff_filings/);
    expect(has(SECTION), `${SECTION} missing`).toBe(true);
    const sec = stripTs(read(SECTION));
    expect(sec).not.toMatch(/get_employer_layoff_filings/);
    expect(sec).toMatch(/get_layoff_partition/);
  });

  it("neither component imports a verdict or a slot, and the section divides no arm by the other", () => {
    for (const p of [LINE, SECTION]) {
      const code = stripTs(read(p));
      expect(code, `${p} imports a verdict`).not.toMatch(/\b(activelyHiringVerdict|hiringRecordVerdict|growthVerdict|hiringRecordSlot|admittedBy)\b/);
    }
    const sec = stripTs(read(SECTION));
    // No quotient of the two arms, however the rows are named.
    expect(sec).not.toMatch(/filed[\w.]*\s*\/\s*[\w.]*control/i);
    expect(sec).not.toMatch(/control[\w.]*\s*\/\s*[\w.]*filed/i);
    expect(sec).not.toMatch(/×/);
    // The unavailable state is rendered with its reason, never an early null.
    expect(sec).toMatch(/layoffUnavailable/);
  });

  it("the prerendered company block renders no filing and calls neither reader", () => {
    const pre = stripTs(read(PRERENDER));
    expect(pre).not.toMatch(/get_employer_layoff_filings|get_layoff_partition/);
    expect(pre).not.toMatch(/layoff/i);
    expect(pre).not.toMatch(/hhAlsoOnRecord/);
  });
});

describe("the card order and the lander li", () => {
  const code = stripTs(read(JOBS));

  it("the filing chip renders after the Actively-hiring slot in the same meta row", () => {
    const chip = code.indexOf("<LayoffFilingChip ");
    expect(chip, "the card chip is not rendered").toBeGreaterThan(0);
    // The hiring slot's last branch (the unread-growth badge) precedes it inside the same region.
    const hiringSlot = code.lastIndexOf('"jobsPage.growthUnreadBadge"', chip);
    expect(hiringSlot, "the Actively-hiring slot was not found before the chip").toBeGreaterThan(0);
    expect(chip - hiringSlot).toBeLessThan(2500);
    // And it is a single render site.
    expect(code.match(/<LayoffFilingChip /g)?.length).toBe(1);
  });

  it("the lander's 'Also on record' list sits inside the Hiring Health card after the growth lines, and only there", () => {
    const li = code.indexOf("<LayoffFilingsOnRecord ");
    expect(li, "the lander list is not rendered").toBeGreaterThan(0);
    expect(code.match(/<LayoffFilingsOnRecord /g)?.length).toBe(1);
    const growth = code.lastIndexOf('"jobsPage.hhGrowth', li);
    expect(growth, "the growth line was not found before the list").toBeGreaterThan(0);
    expect(li - growth).toBeLessThan(4000);
    // The detail-panel line is its own site, after the closure-record line.
    const line = code.indexOf("<LayoffFilingLine ");
    expect(line).toBeGreaterThan(0);
    expect(code.match(/<LayoffFilingLine /g)?.length).toBe(1);
  });
});

describe("the poller never touches the rate budget", () => {
  (has(POLLER_DIR) ? it : it.skip)(`no file under ${POLLER_DIR} names the limiter`, () => {
    const files = readdirSync(resolve(ROOT, POLLER_DIR), { recursive: true }) as string[];
    // The poller's own tests assert the same absence by name; they are not the
    // poller. They are named *_test.ts (Deno's suffix vitest does not sweep).
    const ts = files.filter((f) => f.endsWith(".ts") && !/(?:\.|_)test\.ts$/.test(f));
    expect(ts.length).toBeGreaterThan(0);
    for (const f of ts) {
      const code = stripTs(read(`${POLLER_DIR}/${f}`));
      expect(code, `${f} touches the rate budget`).not.toMatch(/check_rate_limit|check_global_rate_limit|rate_limits/);
    }
  });
});

describe("the checks have teeth", () => {
  const code = stripTs(read(JOBS));

  it("fires when a verdict reads a filing, when a second OR site appears, when a fourth state is added", () => {
    const folded = code.replace(
      'if (closes === "closes" || growth === "grew") return "positive";',
      'if (closes === "closes" || growth === "grew" || layoff) return "positive";',
    );
    expect(folded).not.toBe(code);
    expect(verdictFindings(folded)).toEqual(["activelyHiringVerdict: reads a filing"]);
    const twoSites = code + '\nconst again = (closes: string, growth: string) => closes === "closes" || growth === "grew";\n';
    expect(verdictFindings(twoSites)).toEqual(["combination OR sites: 2"]);
    const fourth = code.replace('export type ActivelyHiringVerdict = "positive" | "negative" | "unknown";', 'export type ActivelyHiringVerdict = "positive" | "negative" | "unknown" | "layoff";');
    expect(fourth).not.toBe(code);
    expect(verdictFindings(fourth)).toEqual(["ActivelyHiringVerdict members: layoff|negative|positive|unknown"]);
    const third = code.replace("export function activelyHiringVerdict(closes: HiringRecordVerdict, growth: GrowthVerdict)", "export function activelyHiringVerdict(closes: HiringRecordVerdict, growth: GrowthVerdict, filing: unknown)");
    expect(third).not.toBe(code);
    expect(verdictFindings(third)).toEqual(["activelyHiringVerdict arity: 3"]);
  });

  it("a filing read that only appears in a COMMENT does not fire, and one in code does", () => {
    const raw = read(JOBS);
    const commented = raw.replace("export function growthVerdict(", "// layoff: a filing is read here\nexport function growthVerdict(");
    expect(verdictFindings(stripTs(commented))).toEqual([]);
    const inCode = raw.replace('  if (!g) return "unknown";\n  if (g.verdict === "grew"', '  if (!g) return "unknown";\n  const layoffSeen = false;\n  if (g.verdict === "grew"');
    expect(inCode).not.toBe(raw);
    expect(verdictFindings(stripTs(inCode))).toEqual(["growthVerdict: reads a filing"]);
  });
});
