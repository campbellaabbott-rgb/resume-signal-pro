/**
 * WHERE THE INSTALL REPOSITORY'S CHECKOUT IS.
 *
 * The guards that compare this site with resumebooster-mcp looked only beside
 * this checkout. Every agent works in a worktree under .claude/worktrees, so
 * "beside" was .claude/worktrees/resumebooster-mcp and the comparison skipped
 * on every run without a word. The checkout is looked for at the environment
 * variable, beside this checkout, then in ~/Documents/GitHub; the first that
 * holds mcp.config.json wins, and a caller that finds none prints every place
 * it looked.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export interface InstallRepoSearch { dir: string | null; tried: string[] }

export function findInstallRepo(opts: {
  root: string;
  env?: string | undefined;
  home?: string;
  exists?: (path: string) => boolean;
}): InstallRepoSearch {
  const exists = opts.exists ?? existsSync;
  const tried = [
    opts.env,
    resolve(opts.root, "..", "resumebooster-mcp"),
    resolve(opts.home ?? homedir(), "Documents/GitHub/resumebooster-mcp"),
  ].filter((d, i, all): d is string => !!d && all.indexOf(d) === i);
  return { dir: tried.find((d) => exists(resolve(d, "mcp.config.json"))) ?? null, tried };
}

/** The sentence a skipped comparison prints, naming each place it looked. */
export const installRepoSkipReason = (s: InstallRepoSearch, what: string) =>
  `SKIPPED: no resumebooster-mcp checkout with mcp.config.json at ${s.tried.join(", ")} (set RESUMEBOOSTER_MCP_DIR); ${what} was not compared`;
