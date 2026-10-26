/**
 * Writes src/lib/board-collisions.ts from the catalogue: every board token
 * that two (or more) hiring systems carry, with each system's board name.
 *
 *   npx tsx scripts/board-collisions.ts          rewrite the module
 *   npx tsx scripts/board-collisions.ts --check  exit 1 when it is stale
 *
 * The guard src/test/a-board-name-two-employers-share-shows-no-employer-facts.test.tsx
 * recomputes the same rows through the test catalogue reader and fails when
 * the module has drifted, so a census merge that adds a colliding board is
 * told to run this.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JOB_SOURCES } from "../supabase/functions/job-board/sources.ts";

const OUT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../src/lib/board-collisions.ts");

export type CollisionRow = [token: string, boards: Array<[source: string, name: string]>];

/** Tokens carried by more than one hiring system, sorted by token; boards sorted by source. */
export function collisionRows(entries: ReadonlyArray<{ source: string; token: string; name: string }>): CollisionRow[] {
  const by = new Map<string, Map<string, string>>();
  for (const e of entries) {
    const m = by.get(e.token) ?? new Map<string, string>();
    if (!m.has(e.source)) m.set(e.source, e.name);
    by.set(e.token, m);
  }
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [...by]
    .filter(([, m]) => m.size > 1)
    .sort(([a], [b]) => cmp(a, b))
    .map(([token, m]) => [token, [...m].sort(([a], [b]) => cmp(a, b))]);
}

export function renderModule(rows: CollisionRow[]): string {
  const body = rows.map(([token, boards]) =>
    `  [${JSON.stringify(token)}, [${boards.map(([s, n]) => `[${JSON.stringify(s)}, ${JSON.stringify(n)}]`).join(", ")}]],`).join("\n");
  return `/**
 * BOARD TOKENS TWO HIRING SYSTEMS CARRY -- GENERATED, do not edit by hand.
 *
 *   npx tsx scripts/board-collisions.ts
 *
 * A company page lives at /jobs/company/<token>, and the token is the board's
 * name on its hiring system. ${rows.length} tokens are carried by two systems at once,
 * and nothing we hold says whether the two boards are one employer. Often they
 * are not: /jobs/company/clear lists Clear (BambooHR) beside CLEAR - Corporate
 * (Greenhouse), and /jobs/company/ans lists ANS beside the Agence du Numérique
 * en Santé. Every per-employer reader keys on the token, so on these pages
 * intel, pay, headcount, SEC figures, filings, wage filings, the hiring record
 * and similar employers could describe two companies as one. A missed merge
 * shows a name twice; a wrong one prints one company's record as another's.
 * So the page reads this list (the catalogue, not which boards happen to have
 * live postings) and shows only the per-vendor split and its open-role counts
 * (company profiles plan 2026-10-11, section 2).
 *
 * The guard a-board-name-two-employers-share-shows-no-employer-facts.test.tsx
 * recomputes this list from supabase/functions/job-board/sources.ts.
 */

export interface CollidedBoard {
  /** job_board_postings.source */
  source: string;
  /** The board's name in the catalogue. */
  name: string;
}

const ROWS: ReadonlyArray<readonly [token: string, boards: ReadonlyArray<readonly [source: string, name: string]>]> = [
${body}
];

const BY_TOKEN: ReadonlyMap<string, CollidedBoard[]> = new Map(
  ROWS.map(([token, boards]) => [token, boards.map(([source, name]) => ({ source, name }))]),
);

/** The rows as generated, for the guard. */
export const BOARD_COLLISION_ROWS = ROWS;

/** The boards behind a token two hiring systems carry, or null for every other token. */
export function collidedBoards(token: string | null | undefined): CollidedBoard[] | null {
  return typeof token === "string" ? BY_TOKEN.get(token) ?? null : null;
}

/** True when two hiring systems carry this token, so no employer-level fact may be shown for it. */
export function isCollidedToken(token: string | null | undefined): boolean {
  return typeof token === "string" && BY_TOKEN.has(token);
}
`;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const next = renderModule(collisionRows(JOB_SOURCES));
  if (process.argv.includes("--check")) {
    let cur = "";
    try { cur = readFileSync(OUT, "utf8"); } catch { /* missing reads as stale */ }
    if (cur !== next) { console.error("src/lib/board-collisions.ts is stale: run npx tsx scripts/board-collisions.ts"); process.exit(1); }
    console.log("src/lib/board-collisions.ts matches the catalogue");
  } else {
    writeFileSync(OUT, next);
    console.log(`wrote ${OUT}`);
  }
}
