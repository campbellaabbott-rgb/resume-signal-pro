// @vitest-environment node
/**
 * A FIX-PLAN MAIL QUEUED BEFORE THE PAUSE IS ARCHIVED, NOT SENT (migration
 * 20261011172000; S12-010, plan CP-016, CP-038).
 *
 * Marketing mail waits for a seller with a legal name and a postal address,
 * and confirm-drip queues nothing while it waits. A sequence confirmed before
 * this round had already queued its four mails, up to fourteen days ahead, on
 * transactional_emails as 'transactional' with no text part, and R1's drain
 * sends that queue every ten seconds. Run, not read, in pglite with a stand-in
 * for pgmq's queue tables and pgmq.archive:
 *   - every queued 'fix-plan-drip' message moves to the archive table, and no
 *     other message (a receipt, a legal notice) is touched;
 *   - a second run archives nothing and still passes;
 *   - a database with no queue at all passes, twice;
 *   - the self-check fails when a fix-plan message is still queued (an
 *     archive that does nothing), so it can fail.
 */
import { describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const DIR = resolve(__dirname, "../../supabase/migrations");
const MIGRATION = readFileSync(resolve(DIR, readdirSync(DIR).find((n) => n.startsWith("20261011172000_"))!), "utf8");

/** pgmq's queue and archive tables for one queue, and its archive(), as the extension defines them. */
const PGMQ = (archiveWorks: boolean) => `
  CREATE SCHEMA pgmq;
  CREATE TABLE pgmq.q_transactional_emails (msg_id bigserial PRIMARY KEY, read_ct int NOT NULL DEFAULT 0,
    enqueued_at timestamptz NOT NULL DEFAULT now(), vt timestamptz NOT NULL DEFAULT now(), message jsonb);
  CREATE TABLE pgmq.a_transactional_emails (msg_id bigint PRIMARY KEY, read_ct int NOT NULL DEFAULT 0,
    enqueued_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz NOT NULL DEFAULT now(), vt timestamptz NOT NULL, message jsonb);
  CREATE FUNCTION pgmq.archive(queue_name text, msg_id bigint) RETURNS boolean LANGUAGE plpgsql AS $$
  DECLARE moved boolean;
  BEGIN
    IF NOT ${archiveWorks ? "true" : "false"} THEN RETURN false; END IF;
    EXECUTE format('WITH a AS (DELETE FROM pgmq.%I WHERE msg_id = $1 RETURNING msg_id, read_ct, enqueued_at, vt, message)
                    INSERT INTO pgmq.%I (msg_id, read_ct, enqueued_at, vt, message) SELECT * FROM a RETURNING true',
                   'q_' || queue_name, 'a_' || queue_name) USING msg_id INTO moved;
    RETURN coalesce(moved, false);
  END $$;
  INSERT INTO pgmq.q_transactional_emails (message, vt) VALUES
    ('{"label":"fix-plan-drip","purpose":"transactional","to":"a@example.com","subject":"Day 2"}', now() + interval '2 days'),
    ('{"label":"fix-plan-drip","purpose":"transactional","to":"a@example.com","subject":"Day 4"}', now() + interval '4 days'),
    ('{"label":"product-delivery","purpose":"transactional","to":"b@example.com","subject":"Your analysis"}', now()),
    ('{"label":"subscription-confirmation","legal_notice":true,"to":"c@example.com","subject":"Your plan"}', now()),
    ('{"label":"fix-plan-drip","purpose":"transactional","to":"d@example.com","subject":"Day 14"}', now() + interval '14 days');
`;

const labels = async (db: PGlite, table: string) =>
  (await db.query<{ label: string }>(`SELECT message->>'label' AS label FROM pgmq.${table} ORDER BY msg_id`)).rows.map((r) => r.label);

describe("20261011172000: a fix-plan mail queued before the pause is archived", () => {
  it("archives every queued fix-plan message and touches nothing else, twice", async () => {
    const db = new PGlite();
    await db.exec(PGMQ(true));
    await db.exec(MIGRATION);
    expect(await labels(db, "q_transactional_emails")).toEqual(["product-delivery", "subscription-confirmation"]);
    expect(await labels(db, "a_transactional_emails")).toEqual(["fix-plan-drip", "fix-plan-drip", "fix-plan-drip"]);
    await db.exec(MIGRATION);
    expect(await labels(db, "q_transactional_emails")).toEqual(["product-delivery", "subscription-confirmation"]);
    expect((await labels(db, "a_transactional_emails")).length).toBe(3);
    await db.close();
  });

  it("a database with no queue passes, twice", async () => {
    const db = new PGlite();
    await db.exec(MIGRATION);
    await db.exec(MIGRATION);
    await db.close();
  });

  it("the self-check fails while a fix-plan message is still queued", async () => {
    const db = new PGlite();
    await db.exec(PGMQ(false));
    await expect(db.exec(MIGRATION)).rejects.toThrow(/self-check: 3 fix-plan message\(s\) are still queued/);
    await db.close();
  });
});
