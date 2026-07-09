// Installs the repo's git hooks (scripts/hooks/*) into .git/hooks.
//
// Bulletproof by design: ANY failure just warns and exits 0, so it can never
// break `npm install` / `npm ci` — including in Lovable's build, where .git may
// be absent (tarball) or laid out differently. Wired as the package.json
// `prepare` script so the hook auto-installs on every install and can't rot.
import { copyFileSync, chmodSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

try {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const dotGit = join(root, ".git");
  // Only proceed for a normal git checkout with a hooks dir. `.git` as a file
  // (worktree/submodule) or missing entirely → skip silently.
  if (!existsSync(dotGit) || !statSync(dotGit).isDirectory()) process.exit(0);
  const hooksDir = join(dotGit, "hooks");
  if (!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true });

  const srcDir = join(root, "scripts", "hooks");
  for (const name of readdirSync(srcDir)) {
    const dest = join(hooksDir, name);
    copyFileSync(join(srcDir, name), dest);
    chmodSync(dest, 0o755);
    console.log(`[install-hooks] installed ${name}`);
  }
} catch (e) {
  console.warn("[install-hooks] skipped:", e?.message || e);
}
process.exit(0);
