// @vitest-environment node
/**
 * Lovable's agent refused the cost wave's third migration on 2026-11-15 "for
 * a missing sub-hourly cron review marker" and stopped there, so every file
 * after it waited too. Main's cost-wave guard and board .102's guard each pin
 * the marker on a hand list of stamps, and a list only covers the files
 * someone remembered to add: the bug round's 29 files reached review without
 * one.
 *
 * THE LINE LOVABLE'S TOOL READS (2026-11-17). The first marker was written in
 * the agent's own words, upper case, two lines. On 2026-11-17 Lovable's tool
 * refused that file again with the marker in place and named the exact first
 * line it requires: the words lovable-cron-fallback-reviewed, a colon, and a
 * reason on the same line. Main re-headed its sixteen pending files to that
 * form (PR #65) and Lovable applied them. A file that still opens with the old
 * words fails here by name, since this guard passing it is what let the bug
 * round's 37 files reach review in a form the tool refuses.
 *
 * This guard reads the directory instead of a list. Every migration whose
 * stamp sorts at or after the refused file (20261109120000), and that a
 * message can still send, opens with that line:
 *
 *  - a file whose code (comment lines dropped) schedules or keeps a job more
 *    often than hourly gives a reason that names the job, and the lines under
 *    it keep the full review block, as main's 20261109120000 does;
 *  - every other file's reason opens "no cron;" or "no sub-hourly cron;" and
 *    says what the file schedules.
 *
 * WHICH FILES A MESSAGE CAN STILL SEND is the ledger's own reading
 * (scripts/deploy-ledger.mjs migrations()): a file Lovable's runner applied is
 * not read, Lovable will not run it again, and an applied migration is never
 * edited (the 2026-11-10 hotfix's three files went in before the marker was
 * asked for). The ledger knows every stub Lovable writes: one that runs a
 * staged name, one stamped with its file's name, one under its file's title,
 * and one that names no file at all and holds its file's SQL inline (drizzle
 * 0226-0228). This guard read only the first two, so main's 0228, which holds
 * 20261109120000 under a title of Lovable's own, left that applied file
 * pending here and judged it again. Nor is a file the ledger lists under
 * neverApply or appliedOutsideDrizzle read: no message ever sends it.
 *
 * HOW A SCHEDULE IS READ (the closeout review of 2026-11-16). The text reading
 * is main's (a minute field that is not one number, read without its quotes so
 * a doubled quote inside a NOTICE still counts), widened to any hour field, to
 * pg_cron's "N seconds" form, to a dollar-quoted schedule, to runs of spaces
 * between fields and to named months and weekdays (mon-fri). On top of that
 * every cron.schedule, cron.schedule_in_database and cron.alter_job call is
 * read by its arguments:
 *  - a schedule argument that is not one literal (a variable, format(...),
 *    concat(...), a || b) fails, since no reading of the text can judge it,
 *    unless SCHEDULE_FROM_ROWS names that exact argument with its reason;
 *  - a cron.alter_job with no schedule argument KEEPS its job's schedule
 *    (a new command, or active => true), so the guard names the job from the
 *    jobname lookup that fills the id it passes and judges the schedule the
 *    last earlier migration gave that job; a job no earlier file schedules
 *    fails until the call passes schedule => '<literal>' itself.
 *
 * WHAT ELSE LOVABLE'S AGENT REFUSES. A transaction statement in the code
 * (BEGIN; COMMIT ROLLBACK ABORT, START or END TRANSACTION) fails, as does any
 * of the three words the agent refused on 2026-11-06 ("Agent access to secrets
 * is not allowed"), in any case and in comments too. The vault rule also lives
 * in guard (d) of a-dead-chain-is-kicked-on-the-databases-clock-and-reads-no-key,
 * which reads every file after 20261103240000. The transaction rule here reads
 * statements, not words: main's and board .102's hand lists reject the two
 * words even inside a comment or a string, but twelve of the bug round's files
 * carry them in prose or in a self-check's exception name, and Lovable has
 * applied such words before (drizzle 0212 and 0214 raise a self-check named
 * for the word; 20261110140000, applied as 0224, says it in a comment).
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as L from "../../scripts/deploy-ledger.mjs";

const MIG = resolve(__dirname, "../../supabase/migrations");
const DRIZZLE = resolve(__dirname, "../../drizzle/migrations");
const POLICY = JSON.parse(readFileSync(resolve(__dirname, "../../docs/deploy-ledger.json"), "utf8"));
/** The first file Lovable's agent refused for want of the marker. */
const FLOOR = "20261109120000";
/** The first line Lovable's tool requires (it named the form on 2026-11-17): the words, a colon, and a reason on that line. */
const MARKER = /^-- lovable-cron-fallback-reviewed: \S[^\n]*\n/;
/** The marker in the agent's own words, which the tool refused on 2026-11-17 with it in place. */
const REFUSED_MARKER = /^-- SUB-HOURLY CRON REVIEW MARKER\b/;

/**
 * The files from the floor on that a message can still send Lovable: the
 * ledger's pending and held files, read against every kind of stub Lovable
 * writes (scripts/deploy-ledger.mjs migrations()). `dirs` points it at a
 * fixture.
 */
const sendable = (dirs?: { migrations: string; drizzle: string }): string[] => {
  const m = L.migrations(POLICY, dirs);
  return [...m.pending, ...m.hold].filter((f: string) => f.slice(0, 14) >= FLOOR).sort();
};

/** The file without its comment lines: what the database runs. */
const code = (sql: string): string =>
  sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");

/** A minute, hour or day-of-month field. */
const FIELD = String.raw`[\d*/,-]+`;
/** A month or weekday field, which may be named (jan, mon-fri). */
const NAMED = String.raw`[\dA-Za-z*/,-]+`;
/** A format() placeholder standing where a field should be. */
const PLACE = String.raw`%[sIL]`;
/** A string opens with one or more quotes (a doubled one inside a string) or a dollar tag... */
const OPEN = String.raw`(?:'+|\$\w*\$)`;
/** ...and closes with a quote or a dollar tag. */
const CLOSE = String.raw`(?:'|\$\w*\$)`;
const S = String.raw`\s+`;

/** A literal schedule's verdict: true when it fires more than once an hour, null when it is not a schedule at all. */
const firesSubHourly = (schedule: string): boolean | null => {
  const t = schedule.trim().replace(/\s+/g, " ");
  if (/^\d{1,2} seconds?$/i.test(t)) return true;
  const f = t.split(" ");
  if (f.length !== 5 || !f.slice(0, 3).every((x) => new RegExp(`^${FIELD}$`).test(x)) || !f.slice(3).every((x) => new RegExp(`^${NAMED}$`).test(x))) return null;
  return !/^\d{1,2}$/.test(f[0]);
};

/**
 * Every quoted schedule in the text that fires more than once an hour: main's
 * reading (hour field `*`), the same minute rule under any hour field, and the
 * seconds form (an interval literal is not a schedule).
 */
const subHourly = (src: string): string[] => [
  ...[...src.matchAll(new RegExp(`${OPEN}\\s*([^'\\s$]+)${S}\\*${S}\\*${S}\\*${S}\\*\\s*${CLOSE}`, "g"))].map((m) => m[1]),
  ...[...src.matchAll(new RegExp(`${OPEN}\\s*(${FIELD})${S}${FIELD}${S}${FIELD}${S}${NAMED}${S}${NAMED}\\s*${CLOSE}`, "g"))].map((m) => m[1]),
]
  .filter((minute) => !/^\d{1,2}$/.test(minute))
  .concat([...src.matchAll(new RegExp(`(?<!interval\\s*)${OPEN}\\s*(\\d{1,2}\\s+seconds?)\\s*${CLOSE}(?!\\s*::\\s*interval)`, "gi"))].map((m) => m[1]));

/**
 * A schedule whose minute is computed, so no reading of the text can judge
 * it: a literal whose minute is a format() placeholder, and a literal tail of
 * three or four fields that a minute is joined onto (v || ' * * * *',
 * concat(v, ' 4 * * *')).
 */
const computedMinute = (src: string): string[] => [
  ...[...src.matchAll(new RegExp(`${OPEN}\\s*${PLACE}(?:${S}(?:${FIELD}|${PLACE})){2}(?:${S}(?:${NAMED}|${PLACE})){2}\\s*${CLOSE}`, "g"))].map((m) => m[0]),
  ...[...src.matchAll(new RegExp(`${OPEN}${S}(?:(?:${FIELD}|${PLACE})${S}){1,2}${NAMED}${S}${NAMED}\\s*${CLOSE}`, "g"))].map((m) => m[0])
    .filter((m) => m.includes("*")),
];

type Arg = { name: string | null; text: string };
type CronCall = { fn: "schedule" | "schedule_in_database" | "alter_job"; at: number; args: Arg[] };

/** The arguments of the call whose "(" ends just before `from`, split at its own commas; null when it never closes. */
const argsFrom = (src: string, from: number): Arg[] | null => {
  const parts: string[] = [];
  let depth = 0, start = from, i = from;
  while (i < src.length) {
    const c = src[i];
    if (c === "'") {
      i++;
      while (i < src.length && !(src[i] === "'" && src[i + 1] !== "'")) i += src[i] === "'" ? 2 : 1;
      i++;
      continue;
    }
    const tag = c === "$" ? /^\$\w*\$/.exec(src.slice(i))?.[0] : undefined;
    if (tag) {
      const end = src.indexOf(tag, i + tag.length);
      if (end < 0) return null;
      i = end + tag.length;
      continue;
    }
    if (c === "-" && src[i + 1] === "-") { const nl = src.indexOf("\n", i); i = nl < 0 ? src.length : nl; continue; }
    if (c === "/" && src[i + 1] === "*") { const end = src.indexOf("*/", i + 2); if (end < 0) return null; i = end + 2; continue; }
    if (c === "(" || c === "[") depth++;
    else if ((c === ")" || c === "]") && depth > 0) depth--;
    else if (c === ")") { parts.push(src.slice(start, i)); break; }
    else if (c === "," && depth === 0) { parts.push(src.slice(start, i)); start = i + 1; }
    i++;
  }
  if (i >= src.length) return null;
  return parts.map((p) => p.trim()).filter((p) => p !== "").map((p) => {
    const named = /^(\w+)\s*(?:=>|:=)\s*([\s\S]*)$/.exec(p);
    return named ? { name: named[1].toLowerCase(), text: named[2].trim() } : { name: null, text: p };
  });
};

/** Every pg_cron call that sets or keeps a schedule, with its arguments. */
const cronCalls = (src: string): CronCall[] => {
  const out: CronCall[] = [];
  for (const m of src.matchAll(/\bcron\.(schedule_in_database|schedule|alter_job)\s*\(/gi)) {
    const args = argsFrom(src, (m.index ?? 0) + m[0].length);
    if (args) out.push({ fn: m[1].toLowerCase() as CronCall["fn"], at: m.index ?? 0, args });
  }
  return out;
};

const positional = (c: CronCall): string[] => c.args.filter((a) => a.name === null).map((a) => a.text);
/** The call's schedule argument as written; undefined when it passes none (an alter_job that keeps it). */
const scheduleArg = (c: CronCall): string | undefined => {
  const named = c.args.find((a) => a.name === "schedule")?.text;
  if (named !== undefined) return /^NULL$/i.test(named) ? undefined : named;
  const pos = positional(c);
  if (c.fn === "schedule") return pos.length >= 3 ? pos[1] : pos[0];
  const second = pos[1];
  return second === undefined || /^NULL$/i.test(second) ? undefined : second;
};
/** The text of a literal argument, or null when the argument is anything else. */
const literal = (arg: string): string | null =>
  /^'+([^']*)'+$/.exec(arg)?.[1] ?? /^\$(\w*)\$([\s\S]*)\$\1\$$/.exec(arg)?.[2] ?? null;

/** The job an alter_job changes: named in its first argument, or by the jobname lookup that fills the id it passes. */
const jobOf = (src: string, c: CronCall): string | null => {
  const first = c.args.find((a) => a.name === "job_id")?.text ?? positional(c)[0] ?? "";
  const inline = /\bjobname\s*=\s*'+([^']+)'/.exec(first);
  if (inline) return inline[1];
  const v = /^\w+$/.exec(first)?.[0];
  if (!v) return null;
  const before = src.slice(0, c.at);
  let name: string | null = null;
  for (const m of before.matchAll(/\bINTO\s+([\w\s,.]+?)\s+FROM\s+cron\.job\b[^;]*?\bjobname\s*=\s*'+([^']+)'/gi)) {
    if (m[1].split(",").map((x) => x.trim()).includes(v)) name = m[2];
  }
  for (const m of before.matchAll(new RegExp(`\\b${v}\\s*:=\\s*\\(\\s*SELECT\\b[^;]*?\\bFROM\\s+cron\\.job\\b[^;]*?\\bjobname\\s*=\\s*'+([^']+)'`, "gi"))) name = m[1];
  return name;
};

/** Each job's literal schedules in one file, in order: its cron calls, and ('job', 'schedule') rows a loop schedules from. */
const schedulesIn = (src: string): [string, string][] => {
  const out: [string, string][] = [];
  for (const c of cronCalls(src)) {
    const s = scheduleArg(c);
    const sched = s === undefined ? null : literal(s);
    if (sched === null || firesSubHourly(sched) === null) continue;
    const pos = positional(c);
    const job = c.fn === "alter_job" ? jobOf(src, c)
      : literal(c.args.find((a) => a.name === "job_name")?.text ?? (c.fn === "schedule" && pos.length < 3 ? "" : pos[0] ?? "")) ?? null;
    if (job) out.push([job, sched]);
  }
  for (const m of src.matchAll(/(?<!')'([a-z0-9][\w-]*)'\s*,\s*'([^']+)'(?!')/gi)) {
    if (firesSubHourly(m[2]) !== null) out.push([m[1], m[2]]);
  }
  return out;
};

/**
 * A schedule argument this guard accepts though it is not one literal, with
 * the reason its values are literals the text reading judges. Each entry is
 * checked to still name a real call.
 */
const SCHEDULE_FROM_ROWS: { stamp: string; arg: string; why: string }[] = [
  {
    stamp: "20261109190000",
    arg: "r.at_minute",
    why: "the loop's four VALUES rows give at_minute as literals ('26 * * * *', '28 * * * *', '58 * * * *', '29 * * * *'), each read by the text reading, none more than hourly",
  },
];

const ALL = readdirSync(MIG).filter((f) => /^\d{14}_.*\.sql$/.test(f)).sort();
const CODE = new Map<string, string>();
const codeOf = (f: string): string => {
  if (!CODE.has(f)) CODE.set(f, code(readFileSync(resolve(MIG, f), "utf8")));
  return CODE.get(f) as string;
};
/** The schedule the last migration stamped before `stamp` gave `job`, or null when none did. */
const scheduleBefore = (job: string, stamp: string): string | null => {
  let last: string | null = null;
  for (const f of ALL) {
    if (f.slice(0, 14) >= stamp) break;
    if (!codeOf(f).includes(job)) continue;
    for (const [j, s] of schedulesIn(codeOf(f))) if (j === job) last = s;
  }
  return last;
};

/** Each schedule a file's calls set or keep, judged; and what the calls leave unreadable. */
const callReading = (src: string, stamp: string): { runs: string[]; problems: string[] } => {
  const runs: string[] = [], problems: string[] = [];
  for (const c of cronCalls(src)) {
    const arg = scheduleArg(c);
    if (arg === undefined) {
      if (c.fn !== "alter_job") { problems.push(`a cron.${c.fn} call passes no schedule this guard can find`); continue; }
      const job = jobOf(src, c);
      if (!job) { problems.push("a cron.alter_job with no schedule keeps a job this guard cannot name; fill its id from a jobname = '<name>' lookup, or pass schedule => '<literal>'"); continue; }
      const kept = scheduleBefore(job, stamp);
      if (kept === null) { problems.push(`a cron.alter_job keeps ${job} on a schedule no earlier migration gives it; pass schedule => '<literal>'`); continue; }
      if (firesSubHourly(kept)) runs.push(`${job} kept at '${kept}'`);
      continue;
    }
    const sched = literal(arg);
    if (sched === null) {
      if (!SCHEDULE_FROM_ROWS.some((e) => e.stamp === stamp && e.arg === arg)) problems.push(`a cron.${c.fn} schedule is not one literal (${arg.replace(/\s+/g, " ").slice(0, 60)}); write it literally`);
      continue;
    }
    const verdict = firesSubHourly(sched);
    if (verdict === null) problems.push(`a cron.${c.fn} schedule '${sched}' is neither five cron fields nor 'N seconds'`);
    else if (verdict) runs.push(sched.trim().split(/\s+/)[0]);
  }
  return { runs, problems };
};

const FULL = [
  /^-- reviewed: \d{4}-\d{2}-\d{2} by the project owner/m,
  /^-- job: \S+/m,
  /^-- schedule: /m,
  /^-- why sub-hourly: /m,
  /^-- load: lower than today/m,
  /^-- new standing sub-hourly jobs: none\.$/m,
];
/** The reason a file that runs nothing more often than hourly gives. */
const NOT_REQUIRED = /^-- lovable-cron-fallback-reviewed: no (?:sub-hourly )?cron; \S/;
/** A transaction statement in the code: Lovable's agent runs each file in its own transaction and refuses one that ends or opens another. */
const TRANSACTION = /\bBEGIN\s*(?:TRANSACTION|WORK)?\s*;|\b(?:COMMIT|ROLLBACK|ABORT)(?:\s+(?:WORK|TRANSACTION|AND\s+(?:NO\s+)?CHAIN|PREPARED\s+'[^']*'|TO\s+(?:SAVEPOINT\s+)?\w+))?\s*;|\b(?:START|END)\s+TRANSACTION\b|^\s*END\s+WORK\s*;/im;
/**
 * The code with each single-quoted string emptied and every comment dropped,
 * so a word inside a NOTICE or an exception name is not read as a statement.
 * Dollar-quoted bodies stay: a DO block or a job's command is code.
 */
const withoutStrings = (src: string): string => {
  let out = "", i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "'") {
      i++;
      while (i < src.length && !(src[i] === "'" && src[i + 1] !== "'")) i += src[i] === "'" ? 2 : 1;
      i++;
      out += "''";
    } else if (c === "-" && src[i + 1] === "-") {
      const nl = src.indexOf("\n", i);
      i = nl < 0 ? src.length : nl;
    } else if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 2;
      out += " ";
    } else {
      out += c;
      i++;
    }
  }
  return out;
};
/** The words the agent refused on 2026-11-06, anywhere in the file. */
const REFUSED_WORDS = /vault|secret|decrypt/i;

/** The marker block: everything above the first bare "--" line. */
const headOf = (sql: string): string => sql.split("\n--\n")[0];

/** What this guard asks of one file; an empty list is a pass. `stamp` places the file among the others. */
const markerProblems = (sql: string, stamp = "99999999999999"): string[] => {
  const problems: string[] = [];
  if (REFUSED_MARKER.test(sql)) return ["opens with the marker Lovable's tool refused on 2026-11-17; its first line must be -- lovable-cron-fallback-reviewed: <reason>"];
  if (!MARKER.test(sql)) return ["does not begin with the line Lovable's tool requires (-- lovable-cron-fallback-reviewed: <reason>)"];
  const head = headOf(sql);
  const run = code(sql);
  if (!/reviewed:? \d{4}-\d{2}-\d{2}/.test(head)) problems.push("its marker names no review date");
  const calls = callReading(run, stamp);
  const runs = [...subHourly(run), ...calls.runs];
  if (runs.length > 0) {
    if (NOT_REQUIRED.test(head)) problems.push(`it schedules or keeps ${[...new Set(runs)].join(", ")} but says the review is not required`);
    for (const line of FULL) if (!line.test(head)) problems.push(`its full review lacks ${line}`);
    const job = /^-- job: ([\w-]+)/m.exec(head)?.[1];
    if (job && !sql.split("\n")[0].includes(job)) problems.push(`its first line's reason does not name ${job}, the job it keeps sub-hourly`);
  } else if (!NOT_REQUIRED.test(head)) {
    problems.push("it runs nothing more often than hourly, so its first line's reason opens \"no cron;\" or \"no sub-hourly cron;\" and says what it schedules");
  }
  for (const c of computedMinute(run)) problems.push(`a schedule's minute is computed (${c}); write it literally`);
  problems.push(...calls.problems);
  const tx = TRANSACTION.exec(withoutStrings(run));
  if (tx) problems.push(`it carries a transaction statement (${tx[0].trim()}), which Lovable's agent refuses`);
  const word = REFUSED_WORDS.exec(sql);
  if (word) problems.push(`it says "${word[0]}", a word Lovable's agent refuses in any case, comments included`);
  return problems;
};

const FROM_FLOOR = ALL.filter((f) => f.slice(0, 14) >= FLOOR);
const READ = sendable();

describe("every migration from the cost wave on that a message can send opens with the line Lovable's cron review tool reads", () => {
  it("the floor is a real file, and the guard reads every file from it on that the ledger can still send", () => {
    expect(ALL.filter((f) => f.startsWith(`${FLOOR}_`))).toHaveLength(1);
    expect(FROM_FLOOR.length).toBeGreaterThan(0);
    // A file is skipped only because the ledger reads it applied or never sends it.
    const m = L.migrations(POLICY);
    const skipped = new Set([...m.applied, ...m.neverApplyPresent]);
    for (const f of FROM_FLOOR.filter((x) => !READ.includes(x))) expect(skipped.has(f), f).toBe(true);
    for (const f of READ) expect(FROM_FLOOR, f).toContain(f);
  });

  it("every schedule accepted from rows still names a call in its file", () => {
    for (const e of SCHEDULE_FROM_ROWS) {
      const f = ALL.find((x) => x.startsWith(`${e.stamp}_`));
      expect(f, e.stamp).toBeDefined();
      expect(cronCalls(codeOf(f as string)).some((c) => scheduleArg(c) === e.arg), `${e.stamp} ${e.arg}`).toBe(true);
    }
  });

  for (const f of READ) {
    it(`${f.slice(0, 14)} opens with the marker its schedules call for, and carries nothing Lovable refuses`, () => {
      expect(markerProblems(readFileSync(resolve(MIG, f), "utf8"), f.slice(0, 14)), f).toEqual([]);
    });
  }
});

describe("the guard can fail", () => {
  const notRequired = "-- lovable-cron-fallback-reviewed: no cron; this file schedules nothing (reviewed 2026-11-16 in a test).\n--\nSELECT 1;\n";
  const full = [
    "-- lovable-cron-fallback-reviewed: example-job runs every 15 minutes, as before; reviewed 2026-11-16 by the project owner.",
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
  const withCode = (sql: string) => notRequired.replace("SELECT 1;", sql);

  it("reads sub-hourly schedules in every form a file has used, and leaves hourly and daily ones", () => {
    for (const s of ["'*/30 * * * *'", "'2,17,32,47 * * * *'", "'* * * * *'", "''*/5 * * * *''", "'2-59/5 * * * *'", "'*/10 9 * * *'", "'30 seconds'"]) {
      expect(subHourly(`SELECT cron.schedule('j', ${s}, 'x');`), s).not.toEqual([]);
    }
    for (const s of ["'15 * * * *'", "'41 4 * * *'", "'0 */6 * * *'", "'10 4 * * 0'"]) {
      expect(subHourly(`SELECT cron.schedule('j', ${s}, 'x');`), s).toEqual([]);
    }
  });

  it("reads a dollar-quoted schedule, runs of spaces and named weekdays, and no interval", () => {
    for (const s of ["$s$*/5 * * * *$s$", "'*/5  * * * *'", "'*/5\t*  *  * *'", "'*/5 * * * mon-fri'", "'*/5 * * * MON'", "'0,30 9-17 * jan-jun 1-5'"]) {
      expect(subHourly(`SELECT cron.schedule('j', ${s}, 'x');`), s).not.toEqual([]);
      expect(markerProblems(withCode(`SELECT cron.schedule('j', ${s}, 'x');`)).join("; "), s).toMatch(/but says the review is not required/);
    }
    for (const s of ["$s$15 * * * *$s$", "'41  4 * * mon'"]) {
      expect(markerProblems(withCode(`SELECT cron.schedule('j', ${s}, 'x');`)), s).toEqual([]);
    }
    expect(subHourly("SELECT now() - interval '30 seconds', '30 seconds'::interval;")).toEqual([]);
  });

  it("passes the two marker forms where they belong", () => {
    expect(markerProblems(notRequired)).toEqual([]);
    expect(markerProblems(full)).toEqual([]);
    // A file that schedules only hourly or daily jobs says so.
    const daily = "-- lovable-cron-fallback-reviewed: no sub-hourly cron; every job this file schedules runs once a day (reviewed 2026-11-16 in a test).\n--\nSELECT cron.schedule('j', '41 4 * * *', 'SELECT 1');\n";
    expect(markerProblems(daily)).toEqual([]);
  });

  it("fails a file without the line Lovable's tool reads", () => {
    expect(markerProblems("-- A TITLE\nSELECT 1;\n")).toEqual(["does not begin with the line Lovable's tool requires (-- lovable-cron-fallback-reviewed: <reason>)"]);
    // The words with no reason, or the reason on the next line, are not the line.
    expect(markerProblems("-- lovable-cron-fallback-reviewed:\n-- no cron (reviewed 2026-11-16).\n--\nSELECT 1;\n")).toHaveLength(1);
    expect(markerProblems(" -- lovable-cron-fallback-reviewed: no cron; nothing (reviewed 2026-11-16).\n--\nSELECT 1;\n")).toHaveLength(1);
  });

  it("fails a file that opens with the marker Lovable's tool refused on 2026-11-17, in either of its forms", () => {
    const refused = "-- SUB-HOURLY CRON REVIEW MARKER";
    for (const sql of [
      `${refused}: not required. This file schedules nothing\n-- (reviewed 2026-11-16 in a test).\n--\nSELECT 1;\n`,
      full.replace(/^[^\n]*/, refused),
    ]) {
      expect(markerProblems(sql).join("; "), sql).toMatch(/opens with the marker Lovable's tool refused on 2026-11-17/);
    }
  });

  it("fails a sub-hourly file whose first line does not name the job it keeps sub-hourly", () => {
    const unnamed = full.replace(/^[^\n]*/, "-- lovable-cron-fallback-reviewed: a job keeps its schedule; reviewed 2026-11-16 by the project owner.");
    expect(markerProblems(unnamed).join("; ")).toMatch(/first line's reason does not name example-job/);
  });

  it("reads a file Lovable applied through a stub that names no file as applied, and every other file from the floor as one a message can send", () => {
    const dir = mkdtempSync(join(tmpdir(), "marker-guard-"));
    try {
      const migrations = join(dir, "migrations"), drizzle = join(dir, "drizzle");
      mkdirSync(migrations);
      mkdirSync(drizzle);
      const appliedSql = "-- lovable-cron-fallback-reviewed: no cron; this file schedules nothing (reviewed 2026-11-16 in a test).\n--\nSELECT 'the applied file';\n";
      writeFileSync(join(migrations, "20261201000000_the_applied_file.sql"), appliedSql);
      writeFileSync(join(migrations, "20261201000001_the_pending_file.sql"), "SELECT 'the pending file';\n");
      writeFileSync(join(migrations, "20261109000000_below_the_floor.sql"), "SELECT 'below the floor';\n");
      // Lovable's stub: a title of its own, no stamp, no staged name, the file's SQL inline (as drizzle 0226-0228).
      writeFileSync(join(drizzle, "0300_a_title_of_lovables_own.sql"), appliedSql);
      expect(sendable({ migrations, drizzle })).toEqual(["20261201000001_the_pending_file.sql"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails a sub-hourly file that says the review is not required", () => {
    expect(markerProblems(withCode("SELECT cron.schedule('j', '*/5 * * * *', 'SELECT 1');")).join("; ")).toMatch(/but says the review is not required/);
  });

  it("fails a full review on a file that schedules nothing sub-hourly", () => {
    expect(markerProblems(full.replace("'*/15 * * * *'", "'15 * * * *'")).join("; ")).toMatch(/so its first line's reason opens "no cron;" or "no sub-hourly cron;"/);
  });

  it("does not read a schedule in a comment line", () => {
    expect(markerProblems(withCode("-- it used to run on '*/5 * * * *'\nSELECT 1;"))).toEqual([]);
  });

  it("fails a schedule whose minute is computed, joined, formatted or held in a variable", () => {
    for (const sql of [
      "SELECT cron.schedule('j', v_min || ' * * * *', 'SELECT 1');",
      "SELECT cron.schedule('j', concat(v, ' * * * *'), 'SELECT 1');",
      "SELECT cron.schedule('j', format('%s %s * * *', m, h), 'SELECT 1');",
      "SELECT cron.schedule('j', format('%s * * * *', m), 'SELECT 1');",
      "SELECT cron.schedule('j', v_schedule, 'SELECT 1');",
      "PERFORM cron.alter_job(v_id, schedule => v_schedule);",
    ]) {
      expect(markerProblems(withCode(sql)).join("; "), sql).toMatch(/minute is computed|is not one literal/);
    }
    // A NOTICE that formats a name into prose is no schedule.
    for (const sql of ["DO $$ BEGIN RAISE NOTICE '%s is not SECURITY DEFINER', f; END $$;", "DO $$ BEGIN RAISE NOTICE '%s is executable by anon', f; END $$;"]) {
      expect(markerProblems(withCode(sql)), sql).toEqual([]);
    }
    // A loop's schedule is accepted only for the file and argument SCHEDULE_FROM_ROWS names.
    expect(markerProblems(withCode("PERFORM cron.schedule(r.job, r.at_minute, 'x');"), "20261109190000")).toEqual([]);
    expect(markerProblems(withCode("PERFORM cron.schedule(r.job, r.at_minute, 'x');"), "20261201000000").join("; ")).toMatch(/is not one literal \(r\.at_minute\)/);
  });

  it("judges an alter_job's literal schedule, positional or named", () => {
    expect(markerProblems(withCode("PERFORM cron.alter_job(v_id, '*/5 * * * *');")).join("; ")).toMatch(/but says the review is not required/);
    expect(markerProblems(withCode("PERFORM cron.alter_job(job_id := v_id, schedule := $q$*/5 * * * *$q$);")).join("; ")).toMatch(/but says the review is not required/);
    expect(markerProblems(withCode("PERFORM cron.alter_job(v_id, schedule => '41 4 * * *', command => 'x');"))).toEqual([]);
  });

  it("an alter_job that keeps its schedule is judged by the schedule the last earlier file gave the job", () => {
    // employer-perks-sweep runs every minute (20261012111000); a new command keeps that.
    const perks = "DO $$ DECLARE v_id bigint; BEGIN\n  SELECT j.jobid INTO v_id FROM cron.job j WHERE j.jobname = 'employer-perks-sweep';\n  PERFORM cron.alter_job(v_id, command => 'SELECT 2');\nEND $$;";
    expect(markerProblems(withCode(perks), "20261201000000").join("; ")).toMatch(/keeps employer-perks-sweep kept at '\* \* \* \* \*' but says the review is not required/);
    // Re-activating it keeps the same schedule.
    const reactivate = perks.replace("command => 'SELECT 2'", "active => true");
    expect(markerProblems(withCode(reactivate), "20261201000000").join("; ")).toMatch(/but says the review is not required/);
    // The nightly purge (10 4 * * *) keeps a daily schedule: the one-line marker is right.
    const nightly = perks.replace("employer-perks-sweep", "scan-cache-and-telemetry-purge");
    expect(markerProblems(withCode(nightly), "20261201000000")).toEqual([]);
    // An id from an inline lookup names its job the same way.
    expect(markerProblems(withCode("PERFORM cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'employer-perks-sweep'), command => 'x');"), "20261201000000").join("; "))
      .toMatch(/but says the review is not required/);
  });

  it("fails an alter_job that keeps a schedule no earlier file states, or a job it cannot name", () => {
    const unknown = "DO $$ BEGIN\n  SELECT j.jobid INTO v_id FROM cron.job j WHERE j.jobname = 'a-job-no-file-schedules';\n  PERFORM cron.alter_job(v_id, command => 'x', active => true);\nEND $$;";
    expect(markerProblems(withCode(unknown), "20261201000000").join("; ")).toMatch(/keeps a-job-no-file-schedules on a schedule no earlier migration gives it/);
    expect(markerProblems(withCode("FOR r IN SELECT jobid FROM cron.job LOOP PERFORM cron.alter_job(r.jobid, active => false); END LOOP;"), "20261201000000").join("; "))
      .toMatch(/keeps a job this guard cannot name/);
  });

  it("fails a transaction statement in the code, and leaves the words in prose, a string or a block's own BEGIN and END", () => {
    for (const sql of ["BEGIN;\nSELECT 1;", "SELECT 1;\nCOMMIT;", "ROLLBACK;", "  commit work;", "START TRANSACTION;", "END TRANSACTION;", "EXCEPTION WHEN others THEN ROLLBACK;"]) {
      expect(markerProblems(withCode(sql)).join("; "), sql).toMatch(/carries a transaction statement/);
    }
    for (const sql of [
      "DO $$\nBEGIN\n  RAISE EXCEPTION 'privacy-retention-selfcheck-rollback';\nEND;\n$$;",
      "-- changed in the same commit\nSELECT 1;",
      "SELECT 'one commit; two';",
      "DO $$ BEGIN NULL; END $$;",
    ]) {
      expect(markerProblems(withCode(sql)), sql).toEqual([]);
    }
  });

  it("fails each word Lovable's agent refused, in code or in a comment", () => {
    for (const sql of ["SELECT decrypted_secret FROM vault.decrypted_secrets;", "-- reads the Vault\nSELECT 1;", "SELECT 'a webhook secret';", "-- decrypt it later\nSELECT 1;"]) {
      expect(markerProblems(withCode(sql)).join("; "), sql).toMatch(/a word Lovable's agent refuses/);
    }
  });
});
