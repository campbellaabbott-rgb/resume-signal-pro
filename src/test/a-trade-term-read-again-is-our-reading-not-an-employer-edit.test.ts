// @vitest-environment node
/**
 * A TRADE TERM READ AGAIN IS OUR READING, NOT AN EMPLOYER EDIT (board .102
 * review; BR-08 and S14X-216).
 *
 * BR-08 stopped reading a trade term ("Remote Sensing", "Remote Pilot",
 * "Hybrid Cloud") as a work mode. On the first .102 read of every board that
 * stored such a row as remote or hybrid, the row is patched to remote false
 * and no mode, and the diff loop's pair block note()d both changes into
 * job_board_field_changes, the irreversible log of what employers edit,
 * though the employer edited nothing. Now a remote or work_mode change on a
 * row whose title and place are unchanged and name a trade term is patched
 * unlogged. An employer who moves the posting (its place or title changes) is
 * still logged.
 *
 * S14X-216's department decode reached only new rows: a stored 'R&amp;D'
 * department kept its entity until the posting closed. A stored department
 * that differs from the new reading only by its entities now heals, unlogged.
 *
 * Runs the shipped note(), put(), work-mode pair and department lines, lifted
 * from index.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { detectWorkMode, listMayRewriteMode, namesATrade, unescapeEntities } from "../../supabase/functions/job-board/normalize";
import { sameButApostrophes } from "../../supabase/functions/job-board/typed-text";

const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const cut = (from: string, to: string) => {
  const a = FN.indexOf(from);
  const b = a < 0 ? -1 : FN.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error(`${from.trim().slice(0, 40)} moved in index.ts: re-point this test`);
  return FN.slice(a, b + to.length);
};
const NOTE = cut("          const note = (field: string, oldV: unknown, newV: unknown) => {", "\n          };\n");
const PUT = cut("          const put = (k: string, next: unknown, cur: unknown, allowNull: boolean) => {", "\n          };\n");
const WLINE = cut('          if (!keepStoredMode) put("work_mode", row.work_mode, prev.work_mode, false);', "\n");
const PAIR = cut('          if (typeof row.remote === "boolean" && !keepStoredMode) {', "\n          }\n");
const DEPT = cut("          if (typeof prev.department === \"string\" && row.department !== prev.department", "\n");
const OUR = new Set([.../const OUR_READING_CHANGED = new Set\(\[([\s\S]*?)\]\);/.exec(FN)![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
const JS = ts.transpileModule(`${NOTE}\n${PUT}\n${WLINE}\n${PAIR}\n${DEPT}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

type Row = { title: string; location: string; work_mode?: string | null; remote?: boolean; department?: string | null };
/** One stored row read again: the patch the diff loop queues and the field changes it logs. */
function reread(source: string, prev: Row, next: { title: string; location: string; department?: string | null }) {
  const mode = detectWorkMode(next.location, next.title);
  const row = { ...next, work_mode: mode, remote: mode === "remote" };
  const changeLog: Array<{ field: string }> = [];
  const patch: Record<string, unknown> = {};
  const keepStoredMode = !listMayRewriteMode(source, prev, row);
  new Function("s", "id", "row", "prev", "patch", "keepStoredMode", "changeLog", "corrections", "logMark", "capped", "changeAt",
    "DERIVED_NOT_EMPLOYER_EDITS", "OUR_READING_CHANGED", "FIELD_CHANGES_PER_VISIT", "sameButApostrophes", "unescapeEntities", "namesATrade", "changeCapAt", "changesDropped", JS)(
    { source, token: "t" }, `${source}:t:1`, row, prev, patch, keepStoredMode, changeLog, [], 0, (v: unknown) => v, "2026-11-16T00:00:00Z",
    new Set(["region_code", "country"]), OUR, 500, sameButApostrophes, unescapeEntities, namesATrade, -1, 0);
  return { patch, logged: changeLog.map((c) => c.field) };
}

describe("a trade term read again", () => {
  it("an icims 'Remote Sensing Project Manager' stored remote is patched to no mode, and nothing is logged", () => {
    const x = reread("icims", { title: "Remote Sensing Project Manager", location: "Austin, Texas", work_mode: "remote", remote: true }, { title: "Remote Sensing Project Manager", location: "Austin, Texas" });
    expect(x.patch).toEqual({ remote: false, work_mode: null });
    expect(x.logged).toEqual([]);
  });

  it("so are 'Remote Pilot' and 'Hybrid Cloud' on other vendors", () => {
    const pilot = reread("paylocity", { title: "Remote Pilot Operator", location: "BOS Logan International Airport", work_mode: "remote", remote: true }, { title: "Remote Pilot Operator", location: "BOS Logan International Airport" });
    expect(pilot).toEqual({ patch: { remote: false, work_mode: null }, logged: [] });
    const cloud = reread("bamboohr", { title: "Senior Hybrid Cloud Architect", location: "Moncton, New Brunswick", work_mode: "hybrid", remote: false }, { title: "Senior Hybrid Cloud Architect", location: "Moncton, New Brunswick" });
    expect(cloud).toEqual({ patch: { work_mode: null }, logged: [] });
  });

  it("an employer who moved the posting is still logged: a changed place, or a title with no trade term", () => {
    const moved = reread("icims", { title: "Remote Sensing Project Manager", location: "Remote", work_mode: "remote", remote: true }, { title: "Remote Sensing Project Manager", location: "Austin, Texas" });
    expect(moved.logged, "the place moved, so the mode change is the employer's").toEqual(["remote", "work_mode"]);
    const plain = reread("icims", { title: "Project Manager", location: "Austin, Texas", work_mode: "remote", remote: true }, { title: "Project Manager", location: "Austin, Texas" });
    expect(plain.patch).toEqual({ remote: false, work_mode: null });
    expect(plain.logged, "no trade term: the mode change is logged as before").toEqual(["remote", "work_mode"]);
  });
});

describe("a stored department with its entities still encoded", () => {
  it("heals to the decoded reading, unlogged", () => {
    const x = reread("teamtailor", { title: "Hands-on Marketing Project Manager", location: "Amsterdam", work_mode: null, remote: false, department: "Sales, Marketing &amp; Communication" }, { title: "Hands-on Marketing Project Manager", location: "Amsterdam", department: "Sales, Marketing & Communication" });
    expect(x.patch).toEqual({ department: "Sales, Marketing & Communication" });
    expect(x.logged).toEqual([]);
  });

  it("a department that differs in more than its entities, or none stored, is left as it was", () => {
    expect(reread("personio", { title: "A", location: "Berlin", work_mode: null, remote: false, department: "R&amp;D" }, { title: "A", location: "Berlin", department: "Research" }).patch).toEqual({});
    expect(reread("personio", { title: "A", location: "Berlin", work_mode: null, remote: false, department: null }, { title: "A", location: "Berlin", department: "R&D" }).patch).toEqual({});
    expect(reread("personio", { title: "A", location: "Berlin", work_mode: null, remote: false, department: "R&D" }, { title: "A", location: "Berlin", department: "R&D" }).patch).toEqual({});
  });

  it("the existing-row read carries the department, so the line has a stored value to compare", () => {
    expect(FN).toMatch(/\.select\(`id,lap_epoch,missing_since,title,location,country,region_code,apply_url,work_mode,employment_type,remote,salary,agency,first_seen,posted_at,department\$\{closesCol\}`\)/);
  });
});
