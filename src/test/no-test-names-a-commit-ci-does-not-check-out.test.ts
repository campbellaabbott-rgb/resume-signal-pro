// @vitest-environment node
/**
 * NO TEST NAMES A COMMIT CI DOES NOT CHECK OUT (fix/post-deploy, 2026-11-01).
 *
 * CI's checkout is one commit deep (actions/checkout's default fetch-depth of
 * 1; .github/workflows/ci.yml says so at the checkout), so a test that asks
 * git for a file as it stood at an older commit throws "invalid object name"
 * there, while it passes on every laptop and in the pre-push hook, which run
 * on a full clone. main went red that way on every run from 6b3e6d43 to
 * f8d72a9b (an en.json read out of e75945fe; fix/pd-ci vendored it), and the
 * same shape came back in the same merge: the two STALE BEFORE cases of
 * sections 88 and 99zzz read those sections out of f8d72a9b. Reproduced in a
 * one-commit clone of fix/post-deploy at 989e4534: 2 failed, 25 passed.
 *
 * So this walks every file vitest runs (its default include, under the
 * config's excludes) and fails on a git call that names a commit by its id or
 * a remote branch: an argv element "<sha>", "<sha>:<path>", "<sha>~1" or
 * "origin/<branch>", or a command string "git <sub> ... <sha>". A file from an
 * older commit goes in src/test/fixtures/, as those three did. git run in a
 * throwaway repository it builds (two-parallel-branches) names no such
 * commit and passes. The shapes below are built from pieces at run time, so
 * this file scans clean too.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { gitBlobId, vendoredAt } from "./helpers/vendored-at-commit";

const ROOT = resolve(__dirname, "../..");
/** vitest.config.ts's excludes (node_modules, dist, .claude, the nested worktree folder), plus .git. */
const SKIP = new Set(["node_modules", "dist", ".claude", "New Folder With Items", ".git"]);
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

function testFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) testFiles(p, out);
    else if (e.isFile() && TEST_FILE.test(e.name)) out.push(p);
  }
  return out;
}

const Q = "[\"'`]";
/** A git argv in code: "git", [ ...elements ]. */
const ARGV = new RegExp(`${Q}git${Q}\\s*,\\s*\\[([^\\]]*)\\]`, "g");
/** A git command written as one string: "git show ...", `git log ...`. */
const SHELL = new RegExp(`${Q}git\\s+[a-z-]+\\b[^"'\`\\n]*`, "g");
/**
 * A commit only a full clone has: an id of 7 to 40 hex digits (with :path, ~n
 * or ^ after it), a remote branch, or an id held in a constant and written as
 * "${X}:path" (a bare "${dir}" is a path, and passes).
 */
const COMMIT_ELEMENT = /^(?:[0-9a-f]{7,40}(?:[:~^].*)?|(?:origin|upstream)\/[\w./-]+(?::.*)?|\$\{[^}]+\}[:~^].*)$/;
const COMMIT_IN_COMMAND = /(?:^|\s)(?:[0-9a-f]{7,40}(?=[\s:~^.]|$)|(?:origin|upstream)\/[\w./-]+|\$\{[^}]+\}[:~^])/;

/** Every git call in `src` that names a commit a one-commit checkout does not have. Pure. */
function commitsNamed(src: string): string[] {
  const hits: string[] = [];
  for (const m of src.matchAll(ARGV)) {
    const elements = [...m[1].matchAll(/(["'`])((?:(?!\1)[^\\]|\\.)*)\1/g)].map((x) => x[2]);
    if (elements.some((el) => COMMIT_ELEMENT.test(el))) hits.push(m[0]);
  }
  for (const m of src.matchAll(SHELL)) {
    if (COMMIT_IN_COMMAND.test(m[0].slice(1).replace(/^git\s+[a-z-]+/, ""))) hits.push(m[0]);
  }
  return hits;
}

// Built from pieces, so this file's own text names no commit.
const G = ["gi", "t"].join("");
const SHA_88 = ["f8d7", "2a9b"].join("");
const SHA_W3 = ["e759", "45fe"].join("");
const call = (argv: string[]) => `execFileSync("${G}", [${argv.map((a) => JSON.stringify(a)).join(", ")}], { cwd: ROOT, encoding: "utf8" })`;

describe("no test vitest runs asks git for a commit CI's one-commit checkout does not have", () => {
  const files = testFiles(ROOT);

  it("walks every test file vitest runs, in src/test and beside the code", () => {
    const rel = files.map((f) => relative(ROOT, f));
    expect(rel.length, "a walk that found nothing passes nothing").toBeGreaterThan(1000);
    expect(rel).toContain("src/test/trust-round3-verify-section-99zzz.test.ts");
    expect(rel).toContain("src/test/a-quoted-company-token-is-refused-or-resolved-by-name-verify-88.test.ts");
    expect(rel).toContain("supabase/functions/parse-pdf/pdfjs-contract.test.ts");
    expect(rel).toContain("tests/guards/a-dead-chain-should-not-wait-for-the-minute-it-died-on.test.ts");
    expect(rel.some((f) => f.startsWith(".claude/") || f.includes("/node_modules/"))).toBe(false);
  });

  it("no test file names one (an older file goes in src/test/fixtures/)", () => {
    const named = files.flatMap((f) => commitsNamed(readFileSync(f, "utf8")).map((hit) => `${relative(ROOT, f)}: ${hit}`));
    expect(named).toEqual([]);
  });
});

describe("the detector: the shapes that broke CI, and git that never leaves a throwaway repository", () => {
  it("catches the three reads that went red on CI, a command string and a remote branch", () => {
    expect(commitsNamed(`const EN_W3 = ${call(["show", `${SHA_W3}:src/i18n/locales/en.json`])};`)).toHaveLength(1);
    expect(commitsNamed(`const old = ${call(["show", `${SHA_88}:scripts/verify-deploy.d/88-job-board-abuse.sh`])};`)).toHaveLength(1);
    expect(commitsNamed(`const old = ${call(["show", `${SHA_88}:scripts/verify-deploy.d/99zzz-trust-round-3.sh`])};`)).toHaveLength(1);
    expect(commitsNamed(`execSync("${G} show ${SHA_88}:scripts/x.sh")`)).toHaveLength(1);
    expect(commitsNamed(`execSync(\`${G} log --oneline ${SHA_88}..HEAD\`)`)).toHaveLength(1);
    expect(commitsNamed(call(["diff", "origin/main", "--", "src"]))).toHaveLength(1);
    expect(commitsNamed(call(["cat-file", "-p", `${SHA_88}~1:package.json`]))).toHaveLength(1);
    // An id kept in a constant and interpolated as "\${X}:path".
    expect(commitsNamed(`execFileSync("${G}", ["show", \`\${OLD}:scripts/x.sh\`])`)).toHaveLength(1);
  });

  it("passes git run in a throwaway repository, a fake git, and prose or a pattern that mentions a commit", () => {
    expect(commitsNamed(`const g = (...a: string[]) => execFileSync("${G}", a, { cwd: dir, env: CLEAN_ENV, encoding: "utf8" });`)).toEqual([]);
    expect(commitsNamed(call(["init", "-q", "-b", "main"]))).toEqual([]);
    expect(commitsNamed(call(["commit", "-qm", "base"]))).toEqual([]);
    expect(commitsNamed(call(["show", "HEAD:docs/x.json"]))).toEqual([]);
    expect(commitsNamed(`execFileSync("${G}", ["-C", \`\${dir}\`, "status"])`)).toEqual([]);
    expect(commitsNamed(`expect(src).toMatch(/execFileSync\\("${G}", \\["fetch", "--quiet", "origin", "main"\\]/);`)).toEqual([]);
    expect(commitsNamed(`writeFileSync(join(dir, "bin", "${G}"), "#!/bin/sh\\nexit 0\\n");`)).toEqual([]);
    expect(commitsNamed(`// this line read en.json out of ${SHA_W3}; the fixture is that commit's values`)).toEqual([]);
    expect(commitsNamed(`const sha = "${SHA_88}"; // a hash in a test is not a git call`)).toEqual([]);
  });
});

describe("the vendored copies the STALE BEFORE cases run instead", () => {
  it("are the blobs they name at f8d72a9b, and an edited copy throws", () => {
    for (const f of ["verify-88-job-board-abuse-f8d72a9b.json", "verify-99zzz-trust-round-3-f8d72a9b.json"]) {
      const text = vendoredAt(f);
      expect(text.startsWith("#!/") || text.startsWith("#"), f).toBe(true);
      expect(gitBlobId(`${text} `), `${f}: one byte more is another blob`).not.toBe(gitBlobId(text));
    }
    // git's own id for a known blob: printf 'hello\n' | git hash-object --stdin
    expect(gitBlobId("hello\n")).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
  });
});
