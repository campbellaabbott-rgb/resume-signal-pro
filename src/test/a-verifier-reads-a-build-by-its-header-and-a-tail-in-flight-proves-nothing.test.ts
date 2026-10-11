// @vitest-environment node
/**
 * Two verifier lines that read PASS or INFO where they should not (review of
 * the S11 round).
 *
 *  - Section 71's S11-001 line printed PASS for a pass-end tail that had
 *    started and not finished whenever its start was under 30 minutes old, so
 *    run in that window it passed a tail about to die at 150 s, the very
 *    failure the line exists for. A tail in flight is INFO now.
 *  - Section 79 never read job-board's x-fn-build: it gated FAIL against INFO
 *    on the body's status.version, so a status read that failed or lagged
 *    left every line INFO. It gates on build_ge now, as 73w and 80 do.
 *
 * Both are run here: 71's judging block against a status file, and section
 * 79 whole, with curl answering a preflight and every board call refused.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const blocks = (sh: string) => [...sh.matchAll(/node -e '([^']*)'/g)].map((m) => m[1]);
// Nothing listens here: every board call fails at once, as an unreachable host does.
const DEAD = "http://127.0.0.1:9";

describe("section 71: a pass-end tail in flight proves nothing", () => {
  // The block's own late/info and its S11-001 statement, run against a status
  // object: the rest of the block reads Workday tenants over the network.
  const block = blocks(read("scripts/verify-deploy.d/71-wave3-job-board.sh")).find((b) => b.includes("S11-001 pass-end tail")) ?? "";
  const line = (re: RegExp) => re.exec(block)?.[0] ?? "";
  const lateDef = line(/const late=.*\n/);
  const infoDef = line(/const info=.*\n/);
  const stmt = block.slice(block.indexOf("{const pe=st.passEnd"), block.indexOf("{const fa=st.filterAudit"));
  const run = (passEnd: Record<string, string>) => {
    const code = `const st=JSON.parse(process.env.VD_ST);const v92=true;\n${lateDef}${infoDef}${stmt}`;
    const out = execFileSync(process.execPath, ["-e", code], { encoding: "utf8", env: { ...process.env, VD_ST: JSON.stringify({ version: "2026-09-09.92", passEnd }) } });
    return out.split("\n").filter((l) => l.includes("S11-001 pass-end tail"));
  };
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

  it("finds its judging block", () => {
    expect(lateDef).toContain("const late=");
    expect(infoDef).toContain("const info=");
    expect(stmt).toContain("S11-001 pass-end tail");
  });

  it("a tail started 5 minutes ago with no finish is INFO, never PASS", () => {
    const lines = run({ startedAt: ago(5) });
    expect(lines, lines.join("\n")).toHaveLength(1);
    expect(lines[0]).toMatch(/^INFO /);
  });

  it("a finished tail is PASS, and a start with no finish past 30 minutes is FAIL", () => {
    expect(run({ startedAt: ago(60), doneAt: ago(58) })[0]).toMatch(/^PASS /);
    expect(run({ startedAt: ago(60) })[0]).toMatch(/^FAIL /);
    expect(run({ startedAt: ago(60), doneAt: ago(90) })[0]).toMatch(/^FAIL /);
  });
});

describe("section 79 gates on job-board's x-fn-build", () => {
  const buildGe = /\nbuild_ge\(\) \{[\s\S]*?\n\}\n/.exec(read("scripts/verify-deploy.sh"))?.[0] ?? "";
  const run = (header: string | null) => {
    const curl = `curl() { printf 'HTTP/2 200\\r\\n${header ? `x-fn-build: ${header}\\r\\n` : ""}\\r\\n'; }\n`;
    const script = `${buildGe}${curl}B=${DEAD}\nK=k\n${read("scripts/verify-deploy.d/79-wave3-search.sh")}`;
    return execFileSync("bash", ["-c", script], { encoding: "utf8" }).split("\n").filter((l) => /^(PASS|FAIL|INFO) /.test(l));
  };

  it("reads build_ge from the verifier", () => expect(buildGe).toContain("build_ge()"));

  it("a .92 bundle whose search lines fail prints FAIL, from the header alone", () => {
    const lines = run("job-board.2026-09-09.92");
    expect(lines[0]).toMatch(/^PASS  job-board preflight x-fn-build = job-board\.2026-09-09\.92/);
    expect(lines.filter((l) => l.startsWith("FAIL")).length, lines.join("\n")).toBeGreaterThanOrEqual(8);
  });

  it("an older bundle, or none, is a FAIL build line and every claim INFO", () => {
    for (const h of ["job-board.2026-09-09.91", null]) {
      const lines = run(h);
      expect(lines[0], String(h)).toMatch(/^FAIL  job-board preflight/);
      expect(lines.slice(1).every((l) => l.startsWith("INFO")), lines.join("\n")).toBe(true);
    }
  });
});
