// @vitest-environment node
/**
 * THE AUDIT-REST DEPLOY NOTES STATE WHAT THE BRANCH DOES.
 *
 * The owner pastes from these two files, and the landing review found four
 * sentences in them the code did not bear out: a margin against "caps" the code
 * does not have, a trigger the migration no longer holds, a date the constant no
 * longer reads, and a decision on upkeep's meter nobody had written down. Each
 * sentence here is read against the code or the file it describes.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";

const ROOT = resolve(__dirname, "../..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");
const NOTES = read("docs/job-board-deploy-notes.md");
const SECTION = NOTES.slice(NOTES.indexOf("## 2026-09-09.101"), NOTES.indexOf("\n## ", NOTES.indexOf("## 2026-09-09.101") + 10));
const LEDGER = JSON.parse(read("docs/deploy-ledger.json"));
const STATUS: string = LEDGER.reservations["audit-rest"].status;

describe("the .101 notes and the ledger's audit-rest entry", () => {
  it("state the per-address cap anon-budget.ts has, not a margin in the millions", () => {
    const cap = Number(/ADDRESS_DAILY_CAP = ([\d_]+)/.exec(read("supabase/functions/job-board/anon-budget.ts"))?.[1].replace(/_/g, ""));
    expect(cap).toBeGreaterThan(144);
    const said = cap.toLocaleString("en-US");
    for (const text of [SECTION, STATUS]) {
      expect(text).toContain(`144 a day against the ${said}-a-day per-address cap`);
      expect(text).not.toMatch(/millions/);
    }
  });

  it("record that upkeep is not metered as a decision, with its cost", () => {
    expect(SECTION).toMatch(/Upkeep itself is not metered, and that is decided/);
    expect(SECTION).toMatch(/32 to 256 characters costs one email_cron_key_matches vault lookup/);
    expect(STATUS).toMatch(/ACCEPTED: job-board's upkeep action is not metered/);
    const shared = read("supabase/functions/_shared/email-cron.ts");
    expect(shared).toMatch(/email_cron_key_matches/);
  });

  it("say the saved search's language comes from the page, as 20261103240000 now has it", () => {
    const file = readdirSync(resolve(ROOT, "supabase/migrations")).find((f) => f.startsWith("20261103240000_")) as string;
    expect(codeOf(read(`supabase/migrations/${file}`))).not.toMatch(/CREATE (OR REPLACE )?TRIGGER/i);
    expect(SECTION).not.toMatch(/filled by a trigger/);
    expect(SECTION).not.toMatch(/optional Jobs\.tsx locale write was not made/);
    expect(STATUS).not.toMatch(/the trigger reads/);
    expect(SECTION).toMatch(/The pages write it, on every write to the row/);
  });

  it("name the same day the dated constant reads", () => {
    const day = /PRIVACY_LAST_UPDATED = "(\d{4}-\d{2}-\d{2})"/.exec(read("src/config/seller.ts"))?.[1];
    expect(day).toBeTruthy();
    expect(SECTION).toContain(`it reads ${day} now`);
  });

  it("keep the first-match rule the digest has, and drop the sentence it replaced", () => {
    expect(SECTION).toMatch(/an earlier empty run \(digest_last_sent_at set\), and a created_at on or after 2026-10-12/);
    expect(SECTION).not.toMatch(/mailed only before 2026-10-08 gets it once/);
    expect(read("supabase/functions/send-search-digest/index.ts")).toMatch(/SENT_RECORD_BEGAN_MS = Date\.UTC\(2026, 9, 12\)/);
  });

  it("list each gap the merge opens that the landing review found", () => {
    for (const gap of [/Old-mail buyers/, /"The link cannot delete it" \(success\.actions\.shareHint\) is false until 20261103130000/, /The claim and key pages send `language`/, /Every saved-search write sends locale/, /Terms are written after the mailbox guard has settled/, /analytics warning reads either build/, /fonts probably lose gstatic's year-long cache/]) {
      expect(SECTION, String(gap)).toMatch(gap);
    }
  });

  it("list the review section, which exists, and the scan total's reason for needing no re-bake", () => {
    const section = "99zzzz-audit-rest-review.sh";
    expect(LEDGER.reservations["audit-rest"].verifySections).toContain(section);
    expect(readdirSync(resolve(ROOT, "scripts/verify-deploy.d"))).toContain(section);
    expect(LEDGER.migrationOrder["20261103190000"].why).toMatch(/writes it nowhere/);
    expect(SECTION).toMatch(/writes it nowhere/);
  });
});

describe("the claim the no-re-bake reason stands on", () => {
  it("the bake reads the scan total and never reads it back", () => {
    const code = codeOf(read("scripts/prerender-seo.mjs"));
    const uses = code.split("\n").filter((l) => /\bscanTotals\b/.test(l));
    expect(uses).toHaveLength(3);
    expect(uses[0]).toMatch(/let scanTotals = null/);
    expect(uses[1]).toMatch(/scanTotals = await rpc\("get_scan_totals"\)/);
    expect(uses[2]).toMatch(/if \(!scanTotals\?\.total_scans\) scanTotals = null/);
  });
});
