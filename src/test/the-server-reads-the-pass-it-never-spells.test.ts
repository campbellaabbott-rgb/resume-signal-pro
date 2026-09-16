/**
 * THE SERVER READS THE PASS IT NEVER SPELLS.
 *
 * agent-mcp tells an agent what a pass is (key_status, initialize
 * instructions, the refusal copy) and decides which funding source a request
 * draws on. Every one of those sentences must be built from the pass row it
 * reads or from the constants in supabase/functions/_shared/pass.ts — never
 * from a number typed into the server. SPEC section 6 guard 3.
 *
 * Two properties, over the comment-stripped code (the BOARD = RAW.replace
 * idiom, so prose can never stand in for the check):
 *   1. agent-mcp imports at least one PASS_ name from ../_shared/pass.ts.
 *   2. no line of code that names the pass carries a standalone integer equal
 *      to one of the six pass numbers (read from pass.ts, never typed here).
 * The whole file is not scanned for the bare numbers because the server
 * legitimately spells other tens and thirties (a shortlist cap, a serving
 * window); the property is that the PASS's lines hold none of them.
 *
 * TEETH: a mutated copy with a pass number on a pass line is reported; a
 * copy without the import fails the import check.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const PASS_TS = readFileSync(resolve(ROOT, "supabase/functions/_shared/pass.ts"), "utf8");
const RAW = readFileSync(resolve(ROOT, "supabase/functions/agent-mcp/index.ts"), "utf8");
const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:\w])\/\/[^\n]*/g, "$1 ");

const NUMBER_NAMES = ["PASS_PRICE_CENTS", "PASS_SESSION_HOURS", "PASS_APPLICATIONS", "PASS_QUOTA_PER_DAY", "PASS_RATE_PER_MIN", "PASS_SHELF_LIFE_DAYS"];
const numberOf = (name: string): number => {
  const m = new RegExp(`export const ${name}\\s*=\\s*(\\d+)\\s*;`).exec(PASS_TS);
  if (!m) throw new Error(`${name} not found in pass.ts`);
  return Number(m[1]);
};
const PASS_NUMBERS = new Map(NUMBER_NAMES.map((n) => [numberOf(n), n]));

/** A line that names the pass: the word, a camel/Pascal fragment, or a PASS_ constant. */
const PASS_LINE = /\bpass\b|[a-z]Pass\b|\bPass[A-Z]|PASS_|\bpass[A-Z]/;
const importsPass = (code: string) => /import\s*\{[^}]*\bPASS_\w+[^}]*\}\s*from\s*["']\.\.\/_shared\/pass\.ts["']/.test(code);
function spelledOnPassLines(code: string): string[] {
  const hits: string[] = [];
  for (const line of code.split("\n")) {
    if (!PASS_LINE.test(line)) continue;
    for (const m of line.matchAll(/(?<![\w.$])(\d+)(?![\w.])/g)) {
      const name = PASS_NUMBERS.get(Number(m[1]));
      if (name) hits.push(`${name} on: ${line.trim().slice(0, 100)}`);
    }
  }
  return hits;
}

describe("agent-mcp reads the pass constants and spells none of them", () => {
  it("the parser read six distinct positive numbers from pass.ts", () => {
    expect(PASS_NUMBERS.size).toBe(NUMBER_NAMES.length);
    expect([...PASS_NUMBERS.keys()].every((v) => v > 0)).toBe(true);
  });
  it("imports at least one PASS_ constant from ../_shared/pass.ts", () => {
    expect(importsPass(CODE), "agent-mcp must import its pass vocabulary from _shared/pass.ts").toBe(true);
  });
  it("no line that names the pass carries a pass number", () => {
    expect(spelledOnPassLines(CODE)).toEqual([]);
  });
});

describe("teeth", () => {
  it("a pass line carrying a pass number is reported by name", () => {
    const n = numberOf("PASS_APPLICATIONS");
    const mutated = `${CODE}\nconst passApplications = ${n};\n`;
    const hits = spelledOnPassLines(mutated);
    expect(hits.length).toBe(1);
    expect(hits[0]).toMatch(/^PASS_APPLICATIONS on: /);
  });
  it("the same number on a line that does not name the pass is not the pass's business", () => {
    const n = numberOf("PASS_APPLICATIONS");
    expect(spelledOnPassLines(`const shortlistCap = ${n};\n`)).toEqual([]);
  });
  it("a number inside an identifier or a decimal is not a standalone literal", () => {
    const n = numberOf("PASS_SESSION_HOURS");
    expect(spelledOnPassLines(`const passWindow = x${n}y + 0.${n} + ${n}.5;\n`)).toEqual([]);
  });
  it("the import detector recognises the required shape and nothing looser", () => {
    expect(importsPass(`import { PASS_TIER, PASS_APPLICATIONS } from "../_shared/pass.ts";`)).toBe(true);
    expect(importsPass(`import { hasFitAccess } from "../_shared/key-tier.ts";`)).toBe(false);
    expect(importsPass(`import { something } from "../_shared/pass.ts";`)).toBe(false);
  });
  it("a comment naming the constant is stripped before the import check", () => {
    const prose = `// import { PASS_TIER } from "../_shared/pass.ts"\n`;
    const stripped = prose.replace(/(^|[^:\w])\/\/[^\n]*/g, "$1 ");
    expect(importsPass(stripped)).toBe(false);
  });
});
