/**
 * Lovable's agent refused the cost wave's third migration on 2026-11-15 "for
 * a missing sub-hourly cron review marker" and stopped there, so every file
 * after it waited too. Main's cost-wave guard and board .102's guard each pin
 * the marker on a hand list of stamps, and a list only covers the files
 * someone remembered to add: the bug round's 29 files reached review without
 * one.
 *
 * This guard reads the directory instead. Every migration whose stamp sorts
 * at or after the refused file (20261109120000) opens with the marker:
 *
 *  - a file whose code (comment lines dropped) schedules or keeps a job more
 *    often than hourly opens with the full review block, as main's
 *    20261109120000 does;
 *  - every other file opens with the one-line form, "not required.", and a
 *    sentence saying what it schedules.
 *
 * A file Lovable's runner has already applied is not read: its drizzle stub
 * names it, Lovable will not run it again, and main's rule is that an applied
 * migration is never edited (the 2026-11-10 hotfix's three files went in
 * before the marker was asked for).
 *
 * The sub-hourly reading is main's (a minute field that is not one number,
 * read without its quotes so a doubled quote inside a NOTICE still counts),
 * widened to any hour field and to pg_cron's "N seconds" form.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MIG = resolve(__dirname, "../../supabase/migrations");
const DRIZZLE = resolve(__dirname, "../../drizzle/migrations");
/** The first file Lovable's agent refused for want of the marker. */
const FLOOR = "20261109120000";
const MARKER = "-- SUB-HOURLY CRON REVIEW MARKER";

/** Stamps Lovable's staged runner has applied, read from its drizzle stubs. */
const appliedStamps = (): Set<string> => {
  const out = new Set<string>();
  for (const f of readdirSync(DRIZZLE).filter((x) => x.endsWith(".sql"))) {
    const byName = /^\d{4}_(\d{14})_/.exec(f);
    if (byName) out.add(byName[1]);
    const text = readFileSync(resolve(DRIZZLE, f), "utf8");
    for (const m of text.matchAll(/_mig_stage WHERE name = '(\d{14})_/g)) out.add(m[1]);
  }
  return out;
};

/** The file without its comment lines: what the database runs. */
const code = (sql: string): string =>
  sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");

const FIELD = String.raw`[\d*/,-]+`;
/**
 * Every quoted schedule that fires more than once an hour: main's reading
 * (hour field `*`), the same minute rule under any hour field, and the
 * seconds form.
 */
const subHourly = (src: string): string[] => [
  ...[...src.matchAll(/'+([^'\s]+) \* \* \* \*'/g)].map((m) => m[1]),
  ...[...src.matchAll(new RegExp(`'+(${FIELD}) ${FIELD} ${FIELD} ${FIELD} ${FIELD}'`, "g"))].map((m) => m[1]),
]
  .filter((minute) => !/^\d{1,2}$/.test(minute))
  .concat([...src.matchAll(/'+\s*(\d{1,2}\s+seconds?)\s*'/gi)].map((m) => m[1]));

/** A schedule whose minute is computed, so no reading of the text can judge it. */
const computedMinute = (src: string): string[] => [
  ...[...src.matchAll(new RegExp(`\\|\\|\\s*'\\s+${FIELD} ${FIELD} ${FIELD} ${FIELD}'`, "g"))].map((m) => m[0]),
  ...[...src.matchAll(new RegExp(`'%[sIL] ${FIELD} ${FIELD} ${FIELD} ${FIELD}'`, "g"))].map((m) => m[0]),
];

const FULL = [
  /^-- reviewed: \d{4}-\d{2}-\d{2} by the project owner/m,
  /^-- job: \S+/m,
  /^-- schedule: /m,
  /^-- why sub-hourly: /m,
  /^-- load: lower than today/m,
  /^-- new standing sub-hourly jobs: none\.$/m,
];
const NOT_REQUIRED = /^-- SUB-HOURLY CRON REVIEW MARKER: not required\. \S/;

/** The marker block: everything above the first bare "--" line. */
const headOf = (sql: string): string => sql.split("\n--\n")[0];

/** What this guard asks of one file; an empty list is a pass. */
const markerProblems = (sql: string): string[] => {
  const problems: string[] = [];
  if (!sql.startsWith(MARKER)) return ["does not begin with the marker"];
  const head = headOf(sql);
  if (!/reviewed:? \d{4}-\d{2}-\d{2}/.test(head)) problems.push("its marker names no review date");
  const runs = subHourly(code(sql));
  if (runs.length > 0) {
    if (NOT_REQUIRED.test(head)) problems.push(`it schedules ${[...new Set(runs)].join(", ")} but says the review is not required`);
    for (const line of FULL) if (!line.test(head)) problems.push(`its full review lacks ${line}`);
  } else if (!NOT_REQUIRED.test(head)) {
    problems.push("it runs nothing more often than hourly, so its marker is the not-required form with a sentence");
  }
  for (const c of computedMinute(code(sql))) problems.push(`a schedule's minute is computed (${c}); write it literally`);
  return problems;
};

const ALL = readdirSync(MIG).filter((f) => /^\d{14}_.*\.sql$/.test(f)).sort();
const APPLIED = appliedStamps();
const FROM_FLOOR = ALL.filter((f) => f.slice(0, 14) >= FLOOR);
const READ = FROM_FLOOR.filter((f) => !APPLIED.has(f.slice(0, 14)));

describe("every migration from the cost wave on opens with Lovable's sub-hourly cron review marker", () => {
  it("the floor is a real file, and the guard reads every pending file from it on", () => {
    expect(ALL.filter((f) => f.startsWith(`${FLOOR}_`))).toHaveLength(1);
    expect(FROM_FLOOR.length).toBeGreaterThan(0);
    // An applied file is skipped only because a drizzle stub names it.
    for (const f of FROM_FLOOR.filter((x) => !READ.includes(x))) expect(APPLIED.has(f.slice(0, 14)), f).toBe(true);
  });

  for (const f of READ) {
    it(`${f.slice(0, 14)} opens with the marker its schedules call for`, () => {
      expect(markerProblems(readFileSync(resolve(MIG, f), "utf8")), f).toEqual([]);
    });
  }
});

describe("the guard can fail", () => {
  const notRequired = `${MARKER}: not required. This file schedules nothing\n-- (reviewed 2026-11-16 in a test).\n--\nSELECT 1;\n`;
  const full = [
    MARKER,
    "-- reviewed: 2026-11-16 by the project owner, who approves this schedule as written.",
    "-- job: example-job.",
    "-- schedule: none today -> every 15 minutes after this file.",
    "-- why sub-hourly: an example.",
    "-- load: lower than today.",
    "-- new standing sub-hourly jobs: none.",
    "--",
    "SELECT cron.schedule('example-job', '*/15 * * * *', 'SELECT 1');",
    "",
  ].join("\n");

  it("reads sub-hourly schedules in every form a file has used, and leaves hourly and daily ones", () => {
    for (const s of ["'*/30 * * * *'", "'2,17,32,47 * * * *'", "'* * * * *'", "''*/5 * * * *''", "'2-59/5 * * * *'", "'*/10 9 * * *'", "'30 seconds'"]) {
      expect(subHourly(`SELECT cron.schedule('j', ${s}, 'x');`), s).not.toEqual([]);
    }
    for (const s of ["'15 * * * *'", "'41 4 * * *'", "'0 */6 * * *'", "'10 4 * * 0'"]) {
      expect(subHourly(`SELECT cron.schedule('j', ${s}, 'x');`), s).toEqual([]);
    }
  });

  it("passes the two marker forms where they belong", () => {
    expect(markerProblems(notRequired)).toEqual([]);
    expect(markerProblems(full)).toEqual([]);
  });

  it("fails a file without the marker", () => {
    expect(markerProblems("-- A TITLE\nSELECT 1;\n")).toEqual(["does not begin with the marker"]);
  });

  it("fails a sub-hourly file that says the review is not required", () => {
    const sql = notRequired.replace("SELECT 1;", "SELECT cron.schedule('j', '*/5 * * * *', 'SELECT 1');");
    expect(markerProblems(sql).join("; ")).toMatch(/but says the review is not required/);
  });

  it("fails a full review on a file that schedules nothing sub-hourly", () => {
    expect(markerProblems(full.replace("'*/15 * * * *'", "'15 * * * *'")).join("; ")).toMatch(/not-required form/);
  });

  it("does not read a schedule in a comment line", () => {
    expect(markerProblems(notRequired.replace("SELECT 1;", "-- it used to run on '*/5 * * * *'\nSELECT 1;"))).toEqual([]);
  });

  it("fails a schedule whose minute is computed", () => {
    const sql = notRequired.replace("SELECT 1;", "SELECT cron.schedule('j', v_min || ' * * * *', 'SELECT 1');");
    expect(markerProblems(sql).join("; ")).toMatch(/minute is computed/);
  });
});
