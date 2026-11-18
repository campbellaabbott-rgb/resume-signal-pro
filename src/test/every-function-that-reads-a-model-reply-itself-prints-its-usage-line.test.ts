// @vitest-environment node
/**
 * EVERY FUNCTION THAT READS A MODEL REPLY ITSELF PRINTS ITS USAGE LINE (cost
 * wave review, 2026-11-15; cost audit 2026-11-08, Do first #11).
 *
 * The usage line ([AI-USAGE], _shared/ai-fallback.ts aiUsageLine) was printed
 * by callAIForUsableReply and by the five functions the lanes touched, but a
 * function that calls callAIWithModelFallback (or the gateway itself) and
 * parses the reply on its own printed nothing: analyze-resume's askPart (the
 * $5 Full Analysis's model spend, which the audit named), parse-resume-
 * structured (whose next model waits on a week of these lines), the generate-*
 * writers and shortlist-evaluate. The ledger recorded the item as done.
 *
 * Read here: every function's own source, comments removed. A reply read is
 * `await <x>.json()` where <x> was bound from callAIWithModelFallback, a local
 * wrapper of it, or a fetch of the gateway; each one must be followed, within
 * a few lines, by logAiUsage( or aiUsageLine(. A probe that reads only the
 * status (health-check, scheduled-health-probe) reads no reply and is not
 * judged.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const FUNCTIONS = resolve(__dirname, "../../supabase/functions");
/** Comments out, line breaks kept, so a line count still means a line. */
const code = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");

const files = readdirSync(FUNCTIONS)
  .filter((d) => d !== "_shared" && statSync(resolve(FUNCTIONS, d)).isDirectory())
  .flatMap((d) => readdirSync(resolve(FUNCTIONS, d)).filter((f) => f.endsWith(".ts")).map((f) => `${d}/${f}`));

/** The names a model call's Response is held in, in one file. */
function replyHolders(src: string): string[] {
  const names = new Set<string>();
  const call = String.raw`await\s+(?:callAIWithModelFallback|callAIWithFallback)\s*\(`;
  for (const m of src.matchAll(new RegExp(String.raw`\{\s*response(?:\s*:\s*(\w+))?[^}]*\}\s*=\s*` + call, "g"))) names.add(m[1] ?? "response");
  for (const m of src.matchAll(new RegExp(String.raw`(?:const|let)\s+(\w+)\s*=\s*` + call, "g"))) names.add(`${m[1]}.response`);
  for (const m of src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*await\s+fetch\(\s*["'`]https:\/\/ai\.gateway\.lovable\.dev/g)) names.add(m[1]);
  return [...names];
}

type Read = { file: string; line: number; text: string; logged: boolean };
function replyReads(file: string): Read[] {
  const src = code(readFileSync(resolve(FUNCTIONS, file), "utf8"));
  const lines = src.split("\n");
  const out: Read[] = [];
  for (const holder of replyHolders(src)) {
    const re = new RegExp(String.raw`await\s+${holder.replace(".", String.raw`\.`)}\.json\(\)`);
    lines.forEach((l, i) => {
      if (!re.test(l)) return;
      const after = lines.slice(i, i + 6).join("\n");
      out.push({ file, line: i + 1, text: l.trim(), logged: /\b(logAiUsage|aiUsageLine)\(/.test(after) });
    });
  }
  return out;
}

const READS = files.flatMap(replyReads);

describe("the usage line beside every reply a function reads itself", () => {
  it("finds the reads the review named, so a pass is not a search that found nothing", () => {
    const where = new Set(READS.map((r) => r.file.split("/")[0]));
    for (const fn of ["analyze-resume", "parse-resume-structured", "generate-ats-defense", "generate-career-path",
      "generate-career-snapshot", "generate-freelance-boost", "generate-graduate-gameplan", "generate-keyword-fix", "shortlist-evaluate",
      "generate-application-answers", "import-freelance-profile"]) {
      expect(where.has(fn), `${fn}: no model reply read found`).toBe(true);
    }
    // The kit and its regeneration are read by callAIForUsableReply, which
    // prints the usage line itself (S14X-266): no read of its own is left.
    expect(READS.filter((r) => r.file.startsWith("generate-apply-package/")), "the package reads no reply itself").toHaveLength(0);
    expect(code(readFileSync(resolve(FUNCTIONS, "generate-apply-package/index.ts"), "utf8"))).toMatch(/\bcallAIForUsableReply\(/);
  });

  it("each read is followed by its [AI-USAGE] line", () => {
    const silent = READS.filter((r) => !r.logged).map((r) => `${r.file}:${r.line} ${r.text}`);
    expect(silent).toEqual([]);
  });

  it("the probes that read only a status are not reply reads", () => {
    expect(READS.some((r) => /^(health-check|scheduled-health-probe)\//.test(r.file))).toBe(false);
  });
});
