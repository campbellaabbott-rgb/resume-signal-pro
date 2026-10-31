// @vitest-environment node
/**
 * THE MERGE PUBLISHES THE FRONTEND, AND THE MESSAGE SAYS SO (the final recheck
 * of land/all, 2026-10-31).
 *
 * The recheck read production: the live index.html carried code that reached
 * main after the last driven Lovable session, and the live /changelog quoted an
 * entry merged hours after it, while every function still answered its old
 * build. Lovable publishes the frontend from main by itself; only a driven
 * session deploys functions and migrations. The generated message assumed the
 * frontend went out last, as its own step. What it now says, proved on the
 * pure message builder with the real policy:
 *   - a draft tells the owner to merge only when the message can go to Lovable
 *     at once, and a deploy message tells Lovable the pages may already be
 *     serving in front of the old functions, so it works straight through;
 *   - one line says what to do when a migration fails: stop and send the
 *     error, never edit, rename or re-stage the file (Lovable edits failing
 *     migrations and stages them under other names, and the ledger's title
 *     matching would count such a copy as applied);
 *   - the held 20261011103000 is held for this whole session, even once the
 *     builds it waits for serve, and released by a later message after verify
 *     sections 82 and 86 pass (it starts an irreversible 30-day prune); its
 *     `until` names the build that will serve (.96), never ".93 serving";
 *   - a slice-gated file written for .95 names the build this deploy carries
 *     (.96) in the OPTIONS clause, and both say when to stop retrying;
 *   - a constant dated at the deploy (the Privacy page's last update and the
 *     day the connector log changes) is checked against the day the message is
 *     made, while the change it dates is not live: a deploy message refuses
 *     another day, and a draft says to set it on the merge day.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as L from "../../scripts/deploy-ledger.mjs";

const ROOT = resolve(__dirname, "../..");
const policy = JSON.parse(readFileSync(resolve(ROOT, "docs/deploy-ledger.json"), "utf8"));
const repoBuild = (fn: string) => L.buildOf(fn, readFileSync(resolve(ROOT, "supabase/functions", fn, "index.ts"), "utf8"));
const LIVE: Record<string, string> = {
  "job-board": "job-board.2026-09-09.92",
  "agent-mcp": "agent-mcp.2026-10-09.71",
  "process-email-queue": "process-email-queue.2026-10-14.1",
};
const rows = (live: Record<string, string | null>) => Object.keys(LIVE).map((fn) => {
  const want = repoBuild(fn);
  const have = live[fn] ?? null;
  return { fn, want, have, state: L.rowState(want, have) };
});
const HELD = ["20261011103000_a_chat_users_searches_are_kept_a_month_not_half_a_year.sql"];
const SCOPE = ["20261025110000_the_reyes_boards_keep_only_their_own_brand.sql", "20261026110000_six_icims_boards_keep_only_their_own_brand_or_hirer.sql"];
const PRE = ["20261025100000_a_board_named_by_its_logo_or_a_site_label_takes_the_name_its_employer_uses.sql"];

describe("the message says the merge publishes the frontend, and what to do when a migration fails", () => {
  const phases = L.migrationPhases([...PRE, ...SCOPE], policy, rows(LIVE));
  const holds = L.holdStates(HELD, policy, rows(LIVE)).holds;

  it("a deploy message keeps its first line and then tells Lovable to work straight through", () => {
    const msg: string[] = L.lovableMessage({ head: "abc12345", phases, hold: HELD, holds, toDeploy: [] });
    expect(msg[0]).toMatch(/^Pull GitHub main at commit \*\*abc12345\*\*/);
    const text = msg.join("\n");
    expect(text).toMatch(/Merging into main publishes the frontend by itself, so this commit's pages may already be serving in front of the old edge functions: work the steps below straight through, without a pause\./);
    expect(text).toMatch(/If a migration fails, stop and send its error \(only a file whose own note below says to wait and apply it again may be retried, unedited\): never edit, rename or re-stage a migration file\./);
  });

  it("a draft tells the owner to merge only when the message can go to Lovable at once", () => {
    const msg: string[] = L.lovableMessage({ head: "abc12345", draftOf: "land/all", phases, hold: HELD, holds, toDeploy: [] });
    expect(msg[0]).toMatch(/^DRAFT from land\/all at abc12345: NOT a deploy message\./);
    expect(msg[0]).toMatch(/Merge into main only when this message can go to Lovable at once: the merge publishes the frontend by itself, in front of the functions that serve until step \d+ is done\./);
  });

  it("the frontend step says the merge has usually published it, on its own line", () => {
    const msg: string[] = L.lovableMessage({ head: "abc12345", phases, toDeploy: [] });
    const line = msg.find((l) => /^\d+\. Publish the frontend\./.test(l)) ?? "";
    expect(line).toMatch(/^\d+\. Publish the frontend\. The merge into main has usually published it already: publish again only if the site does not serve this commit\.$/);
  });
});

describe("the held prune waits for another message, not for builds this one deploys", () => {
  it("held now: not in this session, even once the builds it waits for serve, and released after sections 82 and 86", () => {
    const holds = L.holdStates(HELD, policy, rows(LIVE)).holds;
    const msg = L.lovableMessage({ head: "abc12345", phases: L.migrationPhases([], policy, rows(LIVE)), hold: HELD, holds, toDeploy: [] }).join("\n");
    expect(msg).toMatch(/Do NOT apply in this session, even once the builds it waits for serve: 20261011103000_a_chat_users_searches_are_kept_a_month_not_half_a_year\.sql \(waits for job-board\.2026-09-09\.93 or later, live job-board\.2026-09-09\.92; agent-mcp\.2026-10-11\.3 or later, live agent-mcp\.2026-10-09\.71; a later message releases it once verify sections 82 and 86 pass/);
    expect(msg).not.toMatch(/Do NOT apply yet/);
  });

  it("a plain hold list is held for the session too", () => {
    const msg = L.lovableMessage({ head: "abc12345", phases: L.migrationPhases([], {}, []), hold: ["20261009100300_held.sql"] }).join("\n");
    expect(msg).toMatch(/Do NOT apply in this session: 20261009100300_held\.sql \(a later message releases it\)\./);
  });

  it("the policy's until names sections 82 and 86 and the build that will serve, never .93 serving", () => {
    const h = policy.holdUntilVerified.find((x: { stamp: string }) => x.stamp === "20261011103000");
    expect(h.until).toMatch(/^verify sections 82 and 86 pass/);
    expect(h.until).toMatch(/job-board 2026-09-09\.93 or later \(this deploy's \.96\)/);
    expect(h.until).toMatch(/agent-mcp 2026-10-11\.3 or later \(this deploy's \.38\)/);
    expect(h.until).not.toMatch(/\.93 serving/);
  });
});

describe("a slice note names the build this deploy carries, and when to stop", () => {
  const phases = L.migrationPhases(SCOPE, policy, rows(LIVE));
  const note = (s: string) => phases.afterFunctions.find((p: { file: string }) => p.file.startsWith(s))?.note ?? "";

  it("written for .95, deployed as .96: the OPTIONS clause names .96, and .95 or later stays the rule", () => {
    expect(note("20261025110000")).toBe(L.sliceNote("2026-09-09.95", "2026-09-09.96"));
    expect(note("20261025110000")).toContain("sliceStats.build reads 2026-09-09.95 or later (this deploy's 2026-09-09.96 qualifies)");
    expect(note("20261025110000")).toContain("minutes after an OPTIONS request already answers 2026-09-09.96");
    expect(note("20261025110000")).not.toContain("answers 2026-09-09.95");
  });

  it("written for .96, deployed as .96: no qualifier", () => {
    expect(note("20261026110000")).toBe(L.sliceNote("2026-09-09.96", "2026-09-09.96"));
    expect(note("20261026110000")).not.toContain("qualifies");
  });

  it("both say when to stop retrying", () => {
    for (const s of ["20261025110000", "20261026110000"]) {
      expect(note(s)).toMatch(/if it still refuses an hour after job-board first answers 2026-09-09\.96 to an OPTIONS request, stop and send the error$/);
    }
  });
});

describe("a constant dated at the deploy is checked against the day the message is made", () => {
  const files: Record<string, string> = {
    "src/config/a.ts": 'export const A_DAY = "2026-10-31";\n',
    "src/config/b.ts": 'export const B_DAY: string = "2026-10-29";\n',
  };
  const read = (f: string) => files[f] ?? null;
  const pol = (entries: unknown[]) => ({ datedAtDeploy: entries });
  const A = { file: "src/config/a.ts", constant: "A_DAY", whenDeploying: "fn:job-board@2026-09-09.93", why: "the page names the day" };
  const B = { file: "src/config/b.ts", constant: "B_DAY", whenDeploying: "fn:job-board@2026-09-09.93" };

  it("while the change is not live, a value that is not today is a refusal; today is fine", () => {
    const later = L.datedAtDeploy(pol([A, B]), rows(LIVE), read, "2026-11-02");
    expect(later.errors).toEqual([]);
    expect(later.checks.map((c: { constant: string; due: boolean; ok: boolean }) => [c.constant, c.due, c.ok])).toEqual([["A_DAY", true, false], ["B_DAY", true, false]]);
    expect(L.datedRefusals(later).join("\n")).toMatch(/src\/config\/a\.ts A_DAY reads 2026-10-31, not today \(2026-11-02, UTC\), and job-board is older than job-board\.2026-09-09\.93: set it to 2026-11-02/);
    const today = L.datedAtDeploy(pol([A]), rows(LIVE), read, "2026-10-31");
    expect(today.checks[0]).toMatchObject({ due: true, ok: true, value: "2026-10-31" });
    expect(L.datedRefusals(today)).toEqual([]);
  });

  it("once the function answers the build, the date is history and is not checked", () => {
    const live = L.datedAtDeploy(pol([A]), rows({ ...LIVE, "job-board": repoBuild("job-board") }), read, "2026-12-25");
    expect(live.checks[0]).toMatchObject({ due: false, ok: true });
    expect(L.datedRefusals(live)).toEqual([]);
  });

  it("an entry the ledger cannot read is an error, never a pass", () => {
    const bad = L.datedAtDeploy(pol([
      { ...A, constant: "NO_SUCH" },
      { ...A, file: "src/config/missing.ts" },
      { ...A, whenDeploying: "job-board .93" },
      { ...A, whenDeploying: "fn:no-such@2026-10-11.1" },
    ]), rows(LIVE), read, "2026-10-31");
    const e = bad.errors.join("\n");
    expect(e).toMatch(/src\/config\/a\.ts has no NO_SUCH = "YYYY-MM-DD"/);
    expect(e).toMatch(/src\/config\/missing\.ts cannot be read/);
    expect(e).toMatch(/whenDeploying "job-board \.93" is not "fn:<name>@<YYYY-MM-DD\.N>"/);
    expect(e).toMatch(/main has no function no-such/);
    expect(L.datedRefusals(bad).length).toBe(4);
  });

  it("a draft names each due constant and the day to set it to", () => {
    const due = L.datedAtDeploy(pol([A]), rows(LIVE), read, "2026-10-31");
    const msg: string[] = L.lovableMessage({ head: "abc12345", draftOf: "land/all", phases: L.migrationPhases([], {}, []), toDeploy: [], dated: due.checks });
    expect(msg.join("\n")).toMatch(/On the merge day, before merging, set src\/config\/a\.ts A_DAY \(it reads 2026-10-31\) to that day \(UTC\): the deploy message refuses another day while job-board is older than job-board\.2026-09-09\.93 \(the page names the day\)\./);
  });

  it("the real policy dates the Privacy page and the connector log by job-board .93, and both read the same day", () => {
    const real = L.datedAtDeploy(policy, rows(LIVE), (f: string) => { try { return readFileSync(resolve(ROOT, f), "utf8"); } catch { return null; } }, "2026-10-31");
    expect(real.errors).toEqual([]);
    expect(real.checks.map((c: { file: string; constant: string }) => `${c.file}#${c.constant}`).sort()).toEqual([
      "src/config/mcp-privacy.ts#CONNECTOR_SEARCH_LOG_CHANGED",
      "src/config/seller.ts#PRIVACY_LAST_UPDATED",
    ]);
    expect(new Set(real.checks.map((c: { value: string }) => c.value)).size).toBe(1);
  });
});
