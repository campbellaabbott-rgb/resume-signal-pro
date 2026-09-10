// Runs 20260909219000 in pglite against a STUB cron catalogue -- a cron.job
// table plus cron.schedule / cron.unschedule with pg_cron's documented
// semantics (schedule by name inserts an active row; unschedule by name deletes
// it and RAISES when the name is absent) -- and proves, for every primary state
// the migration can meet, that it ends with TWO active kicks on offset minutes:
//   * primary active at 9-59/10 (the measured state): backup moves 9-59 -> 4-59;
//   * primary active at 4-59/10 (the folder's state): backup moves to 9-59;
//   * primary INACTIVE (20260817222227 deactivated four jobids by number):
//     the primary is re-created at 9-59/10 with the same body, the backup
//     takes 4-59/10 -- the case the lane's first draft left as ONE kick;
//   * no primary row at all: same as inactive;
//   * a second application is a no-op (idempotent);
//   * the self-check RAISES on a draft that lacks the re-creation branch.
// Usage: node scripts/verify-migration-20260909219000.mjs   (from the repo root)
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const FILE = "supabase/migrations/20260909219000_a_dead_chain_should_not_wait_for_the_minute_it_died_on.sql";
const sql = readFileSync(FILE, "utf8");
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
  if (!ok) failures++;
};

const STUB = `
  CREATE SCHEMA cron;
  CREATE TABLE cron.job (jobid serial PRIMARY KEY, jobname text, schedule text, command text, active boolean NOT NULL DEFAULT true);
  CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE plpgsql AS $f$
  DECLARE id bigint;
  BEGIN
    INSERT INTO cron.job (jobname, schedule, command, active) VALUES (p_name, p_schedule, p_command, true) RETURNING jobid INTO id;
    RETURN id;
  END $f$;
  CREATE FUNCTION cron.unschedule(p_name text) RETURNS boolean LANGUAGE plpgsql AS $f$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = p_name) THEN
      RAISE EXCEPTION 'could not find valid entry for job ''%''', p_name;
    END IF;
    DELETE FROM cron.job WHERE jobname = p_name;
    RETURN true;
  END $f$;
`;
const BODY = `SELECT net.http_post(url := 'x', headers := '{}'::jsonb, body := '{"action":"refresh"}'::jsonb);`;

async function scenario(label, seed) {
  const db = new PGlite();
  await db.exec(STUB);
  await db.exec(seed);
  return { db, label };
}
const rows = async (db) => (await db.query(`SELECT jobname, schedule, active, command FROM cron.job ORDER BY jobname`)).rows;
const active = (rs) => Object.fromEntries(rs.filter((r) => r.active).map((r) => [r.jobname, r.schedule]));
const migBody = (/\$job\$([\s\S]*?)\$job\$/.exec(sql)?.[1] ?? "").replace(/\s+/g, " ").trim();

// 1. measured state: primary active on :x9, backup on :x9 too.
{
  const { db } = await scenario("measured", `
    INSERT INTO cron.job (jobname, schedule, command, active) VALUES ('job-board-refresh', '9-59/10 * * * *', $b$${BODY}$b$, true);
    INSERT INTO cron.job (jobname, schedule, command, active) VALUES ('job-board-refresh-backup', '9-59/10 * * * *', $b$${BODY}$b$, true);
  `);
  await db.exec(sql);
  const a = active(await rows(db));
  check("primary on :x9 -> backup moved to 4-59/10, primary untouched", a["job-board-refresh"] === "9-59/10 * * * *" && a["job-board-refresh-backup"] === "4-59/10 * * * *", JSON.stringify(a));
  const before = JSON.stringify(await rows(db));
  await db.exec(sql);
  check("second application is a no-op", JSON.stringify(await rows(db)) === before);
}

// 2. folder state: primary active on :x4, backup on :x9 (already offset).
{
  const { db } = await scenario("folder", `
    INSERT INTO cron.job (jobname, schedule, command, active) VALUES ('job-board-refresh', '4-59/10 * * * *', $b$${BODY}$b$, true);
    INSERT INTO cron.job (jobname, schedule, command, active) VALUES ('job-board-refresh-backup', '9-59/10 * * * *', $b$${BODY}$b$, true);
  `);
  const before = JSON.stringify(await rows(db));
  await db.exec(sql);
  check("primary on :x4, backup on :x9 -> nothing changes", JSON.stringify(await rows(db)) === before, JSON.stringify(active(await rows(db))));
}

// 3. THE FINDING: the primary row exists but is INACTIVE (deactivated by jobid).
{
  const { db } = await scenario("inactive primary", `
    INSERT INTO cron.job (jobname, schedule, command, active) VALUES ('job-board-refresh', '4-59/10 * * * *', $b$${BODY}$b$, false);
    INSERT INTO cron.job (jobname, schedule, command, active) VALUES ('job-board-refresh-backup', '9-59/10 * * * *', $b$${BODY}$b$, true);
  `);
  await db.exec(sql);
  const rs = await rows(db);
  const a = active(rs);
  check("inactive primary -> re-created ACTIVE at 9-59/10, backup at 4-59/10: two offset kicks", a["job-board-refresh"] === "9-59/10 * * * *" && a["job-board-refresh-backup"] === "4-59/10 * * * *" && rs.length === 2, JSON.stringify(rs.map((r) => [r.jobname, r.schedule, r.active])));
  const cmd = rs.find((r) => r.jobname === "job-board-refresh").command.replace(/\s+/g, " ").trim();
  check("the re-created primary carries the migration's own $job$ body (20260715015753's, byte-identical)", cmd === migBody && migBody.includes('"action":"refresh"'));
  const before = JSON.stringify(rs);
  await db.exec(sql);
  check("second application is a no-op", JSON.stringify(await rows(db)) === before);
}

// 4. no primary row at all, backup on :x9.
{
  const { db } = await scenario("no primary", `
    INSERT INTO cron.job (jobname, schedule, command, active) VALUES ('job-board-refresh-backup', '9-59/10 * * * *', $b$${BODY}$b$, true);
  `);
  await db.exec(sql);
  const a = active(await rows(db));
  check("no primary row -> created at 9-59/10, backup at 4-59/10", a["job-board-refresh"] === "9-59/10 * * * *" && a["job-board-refresh-backup"] === "4-59/10 * * * *", JSON.stringify(a));
}

// 5. no backup row either (a replay on a fresh database): both are created.
{
  const { db } = await scenario("empty catalogue", ``);
  await db.exec(sql);
  const a = active(await rows(db));
  check("empty catalogue -> both kicks created, offset", a["job-board-refresh"] === "9-59/10 * * * *" && a["job-board-refresh-backup"] === "4-59/10 * * * *", JSON.stringify(a));
}

// 6. TEETH: the lane's first draft -- the re-creation branch removed -- moves a
//    lone backup and must now be REFUSED by the self-check.
{
  const draft = sql.replace(/IF primary_sched IS NULL THEN[\s\S]*?RAISE WARNING[^\n]*\n\s*END IF;/, "");
  check("draft fixture differs from the shipped text", draft !== sql && draft.length < sql.length);
  const { db } = await scenario("draft", `
    INSERT INTO cron.job (jobname, schedule, command, active) VALUES ('job-board-refresh', '4-59/10 * * * *', $b$${BODY}$b$, false);
    INSERT INTO cron.job (jobname, schedule, command, active) VALUES ('job-board-refresh-backup', '9-59/10 * * * *', $b$${BODY}$b$, true);
  `);
  let err = null;
  try { await db.exec(draft); } catch (e) { err = String(e.message ?? e); }
  check("DRAFT with an inactive primary is refused by the self-check (one kick is not the five-minute bound)", err !== null && /not active after the move/.test(err), err ?? "no error");
}

// 7. no cron namespace: NOTICE and nothing else.
{
  const db = new PGlite();
  let err = null;
  try { await db.exec(sql); } catch (e) { err = String(e.message ?? e); }
  check("without pg_cron the migration returns with a NOTICE", err === null, err ?? "");
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
