// @vitest-environment node
/**
 * TWO PARALLEL BRANCHES MAY SHARE A FILE ONLY WHEN ONE OWNS IT
 * (docs/DEPLOY-LEDGER.md §6, 2026-10-11).
 *
 * The post-wave-3 tooling branch and profiles/integration both edited
 * docs/deploy-ledger.json and the prerender bake, and nothing said so until a
 * merge would have. `node scripts/deploy-ledger.mjs --overlap <ref> ...` diffs
 * each ref from its merge-base with main, lists every file and every function
 * two refs change, and exits 4 when one has no owner in `sharedFiles` (or an
 * owner no reservation names).
 *
 * The rule is run pure on fixtures, then end to end: the real script, copied
 * into a throwaway git repository with a main and three branches.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
let L: typeof import("../../scripts/deploy-ledger.mjs");
const load = async () => {
  if (!L) {
    vi.stubGlobal("fetch", async () => { throw new Error("the ledger reached the network on import"); });
    L = await import("../../scripts/deploy-ledger.mjs");
    vi.unstubAllGlobals();
  }
  return L;
};

const POLICY = {
  reservations: { wave3: {}, "company-profiles": {}, wave4: {} },
  sharedFiles: {
    "docs/deploy-ledger.json": "wave3",
    "scripts/prerender-seo.mjs": "company-profiles",
    "supabase/functions/agent-mcp/": "wave4",
    "fn:public-api": "wave4",
    "docs/typo.md": "wave-three",
  },
};

describe("the rule, on fixtures", () => {
  it("an owner is found by exact path, by folder key and by fn:<name>; the longest key wins", async () => {
    const { sharedOwner } = await load();
    expect(sharedOwner(POLICY.sharedFiles, "docs/deploy-ledger.json")).toBe("wave3");
    expect(sharedOwner(POLICY.sharedFiles, "supabase/functions/agent-mcp/tools.ts")).toBe("wave4");
    expect(sharedOwner(POLICY.sharedFiles, "fn:public-api")).toBe("wave4");
    expect(sharedOwner(POLICY.sharedFiles, "docs/deploy-ledger.json.bak")).toBeNull();
    expect(sharedOwner({ "a/": "x", "a/b/": "y" }, "a/b/c.ts")).toBe("y");
    expect(sharedOwner(undefined, "a")).toBeNull();
  });

  it("lists only what two or more refs change, declared or not, and counts the undeclared", async () => {
    const { overlapReport } = await load();
    const r = overlapReport([
      { ref: "post-wave3/tooling", files: ["docs/deploy-ledger.json", "scripts/prerender-seo.mjs", "docs/wave3/README.md", "docs/typo.md"], functions: [] },
      { ref: "origin/profiles/integration", files: ["docs/deploy-ledger.json", "scripts/prerender-seo.mjs", "scripts/prerender-pages.mjs", "docs/typo.md"], functions: ["employer-profiles", "agent-mcp"] },
      { ref: "wave4/integration", files: ["scripts/prerender-pages.mjs"], functions: ["agent-mcp", "public-api", "job-board"] },
    ], POLICY);
    expect(r.files.map((f) => [f.path, f.refs.length, f.owner, f.declared])).toEqual([
      ["docs/deploy-ledger.json", 2, "wave3", true],
      ["docs/typo.md", 2, "wave-three", false], // an owner no reservation names is not a decision
      ["scripts/prerender-pages.mjs", 2, null, false],
      ["scripts/prerender-seo.mjs", 2, "company-profiles", true],
    ]);
    expect(r.functions.map((f) => [f.fn, f.refs, f.declared])).toEqual([
      ["agent-mcp", ["origin/profiles/integration", "wave4/integration"], true],
    ]);
    expect(r.undeclared).toBe(2);
  });

  it("one ref, or refs with disjoint files, overlap nowhere", async () => {
    const { overlapReport } = await load();
    expect(overlapReport([{ ref: "a", files: ["x", "y"], functions: ["f"] }], POLICY).undeclared).toBe(0);
    const r = overlapReport([{ ref: "a", files: ["x"], functions: ["f"] }, { ref: "b", files: ["y"], functions: ["g"] }], POLICY);
    expect([r.files, r.functions, r.undeclared]).toEqual([[], [], 0]);
  });
});

// ── end to end: the real script in a throwaway repository ────────────────────
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

// The pre-push hook runs this suite with GIT_DIR (and friends) pointing at the
// checkout being pushed; inherited, they send every git call below there.
const CLEAN_ENV: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));

function repo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "overlap repo ")));
  dirs.push(dir);
  const g = (...a: string[]) => execFileSync("git", a, { cwd: dir, env: CLEAN_ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const put = (path: string, body: string) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), body); };
  const commit = (msg: string) => { g("add", "-A"); g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", msg); };
  g("init", "-q", "-b", "main");
  mkdirSync(join(dir, "scripts"));
  copyFileSync(resolve(ROOT, "scripts/deploy-ledger.mjs"), join(dir, "scripts/deploy-ledger.mjs"));
  put("package.json", JSON.stringify({ type: "module" }));
  put("docs/deploy-ledger.json", JSON.stringify({ reservations: { wave3: {}, "company-profiles": {} }, sharedFiles: {} }));
  put("docs/notes.md", "notes\n");
  put("supabase/functions/_shared/gate.ts", "export const gate = 1;\n");
  put("supabase/functions/employer-profiles/index.ts", 'import { gate } from "../_shared/gate.ts";\n');
  put("supabase/functions/job-board/index.ts", "export {};\n");
  commit("main");
  // profiles: the notes, and the shared gate (which reaches employer-profiles)
  g("checkout", "-q", "-b", "profiles/integration");
  put("docs/notes.md", "notes\nprofiles\n");
  put("supabase/functions/_shared/gate.ts", "export const gate = 2;\n");
  commit("profiles");
  // tooling: the notes and employer-profiles' own folder
  g("checkout", "-q", "main");
  g("checkout", "-q", "-b", "post-wave3/tooling");
  put("docs/notes.md", "tooling\nnotes\n");
  put("supabase/functions/employer-profiles/extra.ts", "export {};\n");
  commit("tooling");
  // main moves on after both forked: job-board changes there, and in a third branch forked later
  g("checkout", "-q", "main");
  put("supabase/functions/job-board/index.ts", "export const v = 92;\n");
  commit("main moves");
  g("checkout", "-q", "-b", "late/branch");
  put("docs/other.md", "x\n");
  commit("late");
  g("checkout", "-q", "main");
  const run = (...refs: string[]) => {
    try {
      return { code: 0, out: execFileSync(process.execPath, [join(dir, "scripts/deploy-ledger.mjs"), "--overlap", ...refs, "--main", "main"], { cwd: dir, env: CLEAN_ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
    } catch (e) {
      const x = e as { status?: number; stdout?: string; stderr?: string };
      return { code: x.status ?? 1, out: `${x.stdout ?? ""}${x.stderr ?? ""}` };
    }
  };
  return { dir, put, commit, g, run };
}

describe("--overlap, run on a repository with a main and three branches", () => {
  it("exits 4 naming the shared file and the shared function, each ref judged from its own merge-base", () => {
    const { run } = repo();
    const { code, out } = run("profiles/integration", "post-wave3/tooling", "late/branch");
    expect(code, out).toBe(4);
    expect(out).toMatch(/UNDECLARED docs\/notes\.md\s+no owner in sharedFiles; changed by profiles\/integration, post-wave3\/tooling/);
    // employer-profiles: reached through the _shared gate on one side, its own folder on the other
    expect(out).toMatch(/UNDECLARED employer-profiles\s+no owner in sharedFiles; changed by profiles\/integration, post-wave3\/tooling/);
    // main's own later change to job-board is nobody's: late/branch forked after it and does not carry it as its own
    expect(out).not.toMatch(/job-board/);
    expect(out).toMatch(/late\/branch: 1 files, 0 functions/);
    expect(out).toMatch(/2 undeclared overlap\(s\)/);
  });

  it("exits 0 once sharedFiles gives both a reservation-named owner, and 4 again for an owner nobody reserved", () => {
    const { run, put, commit } = repo();
    put("docs/deploy-ledger.json", JSON.stringify({ reservations: { wave3: {}, "company-profiles": {} }, sharedFiles: { "docs/notes.md": "wave3", "fn:employer-profiles": "company-profiles" } }));
    commit("declare");
    const ok = run("profiles/integration", "post-wave3/tooling");
    expect(ok.code, ok.out).toBe(0);
    expect(ok.out).toMatch(/DECLARED\s+docs\/notes\.md\s+owned by wave3/);
    expect(ok.out).toMatch(/DECLARED\s+employer-profiles\s+owned by company-profiles/);
    expect(ok.out).toMatch(/No undeclared overlap\./);
    put("docs/deploy-ledger.json", JSON.stringify({ reservations: { wave3: {} }, sharedFiles: { "docs/notes.md": "wave3", "fn:employer-profiles": "company-profiles" } }));
    commit("drop the reservation");
    const bad = run("profiles/integration", "post-wave3/tooling");
    expect(bad.code, bad.out).toBe(4);
    expect(bad.out).toMatch(/sharedFiles names "company-profiles", which no reservation is/);
  });

  it("an unknown ref is an error, never an empty pass, and no ref at all is refused", () => {
    const { run } = repo();
    const unknown = run("no-such-branch", "post-wave3/tooling");
    expect(unknown.code).not.toBe(0);
    expect(unknown.code).not.toBe(4);
    const none = run();
    expect(none.code).toBe(1);
    expect(none.out).toMatch(/--overlap needs at least one git ref/);
  });
});

describe("the real policy declares every overlap it knows of with a reservation-named owner", () => {
  it("each sharedFiles owner is a reservations key", async () => {
    const { readFileSync } = await import("node:fs");
    const policy = JSON.parse(readFileSync(resolve(ROOT, "docs/deploy-ledger.json"), "utf8"));
    const owners = Object.entries(policy.sharedFiles ?? {}).filter(([k]) => !k.startsWith("_"));
    expect(owners.length).toBeGreaterThan(0);
    for (const [path, owner] of owners) expect(Object.keys(policy.reservations), `${path} is owned by "${owner}"`).toContain(owner);
  });
});
