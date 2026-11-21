/**
 * ONE RULE FOR EVERY BOARD NEWLY READ ON ASHBY (job-board .103 onwards; jobs-clear spec-final 3.1 RP and L-M4).
 *
 * Ashby's robots file forbids the application-questions request that job-board and _shared/application-form.ts
 * still make, and every board the catalogue starts reading on Ashby widens it. So a board new to Ashby in a
 * build, whether an add (row A) or a repoint whose new vendor is Ashby, rides only when both hold:
 *
 *  - the owner's OD14(b) yes is recorded: an ownerDecided key in docs/deploy-ledger.json whose name starts
 *    OD14-ASHBY (the bug round's two owner-gated halves use that spelling) or reads OD14(b); and
 *  - the stop is built: no function under supabase/functions requests that path, and FORM_READER_VENDORS
 *    no longer lists the vendor.
 *
 * Both catalogue tests of .103 (row A, and the dead and moved boards) judge through this one module, so the
 * build cannot treat an Ashby add one way and an Ashby repoint another.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { codeOf } from "./strip-comments";

const ROOT = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

/** The robots-disallowed request, as the two readers spell its host and path. */
export const ASHBY_QUESTIONS_PATH = "jobs.ashbyhq.com/api/";

/** Every ownerDecided key the ledger records, in any reservation. */
export function ownerDecidedKeys(ledger: unknown): string[] {
  const keys: string[] = [];
  const walk = (o: unknown) => {
    if (Array.isArray(o)) { for (const v of o) walk(v); return; }
    if (!o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (k === "ownerDecided" && v && typeof v === "object" && !Array.isArray(v)) keys.push(...Object.keys(v as object));
      walk(v);
    }
  };
  walk(ledger);
  return keys;
}

export const od14bAnswered = (ledger: unknown): boolean =>
  ownerDecidedKeys(ledger).some((k) => /^OD14-ASHBY/.test(k) || k === "OD14(b)");

/** Whether the code still makes the Ashby questions request, judged on code with its comments gone. */
export function ashbyQuestionsStillAsked(files: Record<string, string>): string[] {
  const why: string[] = [];
  for (const [path, text] of Object.entries(files)) {
    if (!text.includes(ASHBY_QUESTIONS_PATH) && !/FORM_READER_VENDORS/.test(text)) continue;
    const code = codeOf(text);
    if (code.includes(ASHBY_QUESTIONS_PATH)) why.push(`${path} requests ${ASHBY_QUESTIONS_PATH}`);
    const list = /export const FORM_READER_VENDORS[^=]*=\s*\[([^\]]*)\]/.exec(code)?.[1];
    if (list !== undefined && /["']ashby["']/.test(list)) why.push(`${path}: FORM_READER_VENDORS lists ashby`);
  }
  return why;
}

/** Every .ts file under supabase/functions, keyed by its repository path. */
export function functionSources(): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(resolve(ROOT, dir))) {
      const rel = join(dir, name);
      if (name === "node_modules") continue;
      if (statSync(resolve(ROOT, rel)).isDirectory()) walk(rel);
      else if (name.endsWith(".ts")) out[rel] = read(rel);
    }
  };
  walk("supabase/functions");
  return out;
}

export type AshbyGate = { open: boolean; why: string[] };

/** The gate as this checkout states it, or as the doctored inputs a test hands it. */
export function ashbyGate(o: { ledger?: unknown; files?: Record<string, string> } = {}): AshbyGate {
  const ledger = o.ledger ?? JSON.parse(read("docs/deploy-ledger.json"));
  const why = [...(od14bAnswered(ledger) ? [] : ["no OD14-ASHBY or OD14(b) key in any ownerDecided of docs/deploy-ledger.json"]), ...ashbyQuestionsStillAsked(o.files ?? functionSources())];
  return { open: why.length === 0, why };
}

/**
 * The boards this build starts reading on Ashby that .102 did not: the repoints whose new key is on Ashby and
 * the adds on Ashby, each as its key. `ashbyNow` must equal .102's Ashby count less what left Ashby plus these,
 * which is how a board moved onto Ashby without a fixture entry is caught too.
 */
export function newAshbyBoards(o: {
  ashby102: number;
  ashbyNow: number;
  leftAshby: number;
  repointedTo: string[];
  added: string[];
}): { boards: string[]; unaccounted: number } {
  const boards = [...o.repointedTo, ...o.added].filter((k) => k.startsWith("ashby:"));
  return { boards, unaccounted: o.ashbyNow - (o.ashby102 - o.leftAshby + boards.length) };
}

/** .102's Ashby boards (job-board 2026-09-09.102's JOB_SOURCES, 44,499 boards, read with the runtime's own decoder). */
export const ASHBY_102 = 3_045;

const isAshby = (k: string) => k.startsWith("ashby:");

/** .103's new Ashby boards, from the catalogue lane's fixture and row A's, against the catalogue's keys now. */
export function ashbyNewIn103(keys: readonly string[]): { boards: string[]; unaccounted: number } {
  const dead = JSON.parse(read("src/test/fixtures/board-103-catalogue-2026-11-17.json")) as {
    pruned: Array<[string, string, string]>; retired: string[]; held: Array<{ key: string }>; repointed: Array<{ from: string; to: string }>;
  };
  const rowA = JSON.parse(read("src/test/fixtures/board-103-row-a-2026-11-17.json")) as { added: Array<{ key: string }> };
  const left = [...dead.pruned.map(([k]) => k), ...dead.retired, ...dead.held.map((h) => h.key)];
  return newAshbyBoards({
    ashby102: ASHBY_102,
    ashbyNow: keys.filter(isAshby).length,
    leftAshby: left.filter(isAshby).length + dead.repointed.filter((r) => isAshby(r.from) && !isAshby(r.to)).length,
    repointedTo: dead.repointed.filter((r) => !isAshby(r.from)).map((r) => r.to),
    added: rowA.added.map((a) => a.key),
  });
}
