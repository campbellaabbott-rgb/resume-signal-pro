// @vitest-environment node
//
// Node, not jsdom: this file builds a throwaway git repository and reads it
// through the ledger's git calls.
/**
 * A COMMENT THAT NAMED THE BUILD HID AN UNBUMPED CHANGE (S14X-137, S11-125).
 *
 * The deploy ledger's MUST BUMP check asks what changed in a function's code
 * since the commit its live stamp proves deployed. It found that commit with
 * `git log -1 -S<build>`: the newest commit that changed how many times the
 * build string appears in index.ts. A history comment naming the build is
 * such a commit, so the anchor moved to it, and every code change made
 * between the real stamp and the comment read as deployed. On main of
 * 2026-11-15 six functions were anchored on a comment (agent-mcp on
 * af016311, though b2ef3f25 wrote its declaration).
 *
 * The anchor is now the commit that last wrote the declaration line (git
 * blame), still moved to a later verified deploy of the same build. Built
 * here in a throwaway repository, so no test reads this repo's history.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

let L: typeof import("../../scripts/deploy-ledger.mjs");

const dirs: string[] = [];
// The pre-push hook runs the suite with GIT_DIR (and friends) set; the ledger's
// git calls inherit this process's environment, so those are set aside here.
const saved: Record<string, string | undefined> = {};
beforeAll(async () => {
  for (const k of Object.keys(process.env).filter((x) => x.startsWith("GIT_"))) { saved[k] = process.env[k]; delete process.env[k]; }
  L = await import("../../scripts/deploy-ledger.mjs");
});
afterAll(() => {
  Object.assign(process.env, saved);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function repo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "stamp anchor ")));
  dirs.push(dir);
  const g = (...a: string[]) => execFileSync("git", a, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const put = (p: string, body: string) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), body); };
  const commit = (msg: string) => { g("add", "-A"); g("-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", msg); return g("rev-parse", "HEAD"); };
  g("init", "-q", "-b", "main");
  return { dir, g, put, commit };
}

const DECL = 'const FN_BUILD = "x.2026-11-01.1";\n';
const index = (body: string, note = "") => `${note}import { gate } from "../_shared/gate.ts";\n${DECL}export const run = () => ${body};\n`;

/** A: the stamp. B: code changes with no bump. C: a comment names the build. */
function history() {
  const r = repo();
  r.put("supabase/functions/_shared/gate.ts", "export const gate = 1;\n");
  r.put("supabase/functions/x/index.ts", index("1"));
  const A = r.commit("stamp x 2026-11-01.1");
  r.put("supabase/functions/x/index.ts", index("2"));
  const B = r.commit("change x without a bump");
  r.put("supabase/functions/x/index.ts", index("2", "// 2026-11-01.1: kept from the stamp of the first of November\n"));
  const C = r.commit("a history note names the build");
  return { ...r, A, B, C };
}

describe("the MUST BUMP anchor is the commit that wrote the build's declaration", () => {
  it("a later comment naming the build does not move the anchor, so the unbumped change is seen", () => {
    const h = history();
    const r = L.changedSinceStamp("x", "x.2026-11-01.1", { verifiedDeploys: [] }, { root: h.dir });
    expect(r.since, `anchored on ${r.since}: A ${h.A.slice(0, 8)}, B ${h.B.slice(0, 8)}, C ${h.C.slice(0, 8)}`).toBe(h.A.slice(0, 8));
    expect(r.changed).toContain("supabase/functions/x/index.ts");
  });

  it("positive control: a verified deploy of the same build at B moves the anchor to B", () => {
    const h = history();
    const r = L.changedSinceStamp("x", "x.2026-11-01.1", { verifiedDeploys: [{ commit: h.B.slice(0, 8), functions: { x: "x.2026-11-01.1" } }] }, { root: h.dir });
    expect(r.since).toBe(h.B.slice(0, 8));
  });

  it("a verified deploy that recorded another build leaves the anchor where blame put it", () => {
    const h = history();
    const other = L.changedSinceStamp("x", "x.2026-11-01.1", { verifiedDeploys: [{ commit: h.C, functions: { x: "x.2026-10-31.4" } }] }, { root: h.dir });
    expect(other.since).toBe(h.A.slice(0, 8));
  });

  it("a bump moves the anchor to the bump, and a _shared import changed after it is listed", () => {
    const h = history();
    h.put("supabase/functions/x/index.ts", index("2").replace("2026-11-01.1", "2026-11-02.1"));
    const D = h.commit("bump x");
    h.put("supabase/functions/_shared/gate.ts", "export const gate = 2;\n");
    h.commit("change the shared gate");
    const r = L.changedSinceStamp("x", "x.2026-11-02.1", { verifiedDeploys: [] }, { root: h.dir });
    expect(r.since).toBe(D.slice(0, 8));
    expect(r.changed).toEqual(["supabase/functions/_shared/gate.ts"]);
  });

  it("reads the template and BUILD_VERSION declarations too", () => {
    const r = repo();
    r.put("supabase/functions/t/index.ts", 'const FN_NAME = "t";\nconst FN_BUILD = `${FN_NAME}.2026-11-03.2`;\nexport {};\n');
    r.put("supabase/functions/v/index.ts", 'const BUILD_VERSION = "2026-11-03.12";\nexport {};\n');
    const A = r.commit("stamps");
    r.put("supabase/functions/t/index.ts", 'const FN_NAME = "t";\nconst FN_BUILD = `${FN_NAME}.2026-11-03.2`;\nexport const y = 1;\n// 2026-11-03.2 noted\n');
    r.put("supabase/functions/v/index.ts", 'const BUILD_VERSION = "2026-11-03.12";\nexport const y = 1;\n// v.2026-11-03.12 noted\n');
    r.commit("code and notes");
    for (const [fn, b] of [["t", "t.2026-11-03.2"], ["v", "v.2026-11-03.12"]]) {
      const x = L.changedSinceStamp(fn, b, { verifiedDeploys: [] }, { root: r.dir });
      expect(x.since, fn).toBe(A.slice(0, 8));
      expect(x.changed, fn).toEqual([`supabase/functions/${fn}/index.ts`]);
    }
  });
});

describe("declarationLine", () => {
  it("is the first line holding the build that is not a comment, and never a longer sequence number", () => {
    const src = ['// x.2026-11-01.1 history', ' * 2026-11-01.1 in a block', 'const OLD = "x.2026-11-01.10";', 'const FN_BUILD = "x.2026-11-01.1";', 'log("x.2026-11-01.1")'].join("\n");
    expect(L.declarationLine("x", "x.2026-11-01.1", src)).toBe(4);
    expect(L.declarationLine("x", "x.2026-11-01.2", src)).toBe(0);
    expect(L.declarationLine("x", "not-a-build", src)).toBe(0);
  });
});
