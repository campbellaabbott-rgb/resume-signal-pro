// @vitest-environment node
/**
 * EVERY PGLITE HARNESS THAT CREATES THE CLIENT ROLES STARTS FROM SUPABASE'S
 * DEFAULT GRANTS, OR IS NAMED (S14X-140).
 *
 * A refusal asserted on roles created holding nothing holds whatever the
 * migration under test does; thirty-one such harnesses now start from
 * helpers/supabase-defaults.ts. This guard reads every file under src/test
 * (helpers/bare-role-harnesses.ts, which the bug round's verify section reads
 * too) and refuses:
 *   - a file that creates the roles holding nothing and asserts a refusal;
 *   - a new file that creates them holding nothing at all (the list of such
 *     files that assert no refusal only shrinks);
 *   - a new file that asserts a refusal over a helper that creates them
 *     holding nothing (the four such helpers are another workstream's);
 *   - an entry on either list that no longer needs to be there.
 * It is shown catching a fixture of each kind, so it is not passing on an
 * empty scan.
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
  BARE_WITHOUT_A_REFUSAL,
  CONVERTED_BY_ANOTHER_LANE,
  REFUSES_OVER_A_BARE_HELPER,
  classify,
  scan,
  violations,
} from "./helpers/bare-role-harnesses";

const ROOT = resolve(__dirname, "../..");
const T = (name: string) => resolve(ROOT, "src/test", name);
const harnesses = scan(ROOT);

describe("the scan finds the harnesses it judges", () => {
  it("reads every file that creates the client roles, converted or not", () => {
    expect(harnesses.length).toBeGreaterThan(100);
    const webhook = harnesses.find((h) => h.file === "src/test/the-webhook-log-drops-resume-text-and-every-copy-has-a-clock.test.ts");
    expect(webhook, "the webhook-log harness is not in the scan").toBeTruthy();
    expect(webhook!.refuses).toBe(true);
    expect(webhook!.bare, "the webhook-log harness still creates its roles holding nothing").toBe(false);
    const helper = harnesses.find((h) => h.file === "src/test/helpers/mail-door-db.ts");
    expect(helper?.bare, "a helper that makes bare roles reads as bare").toBe(true);
  });

  it("catches a bare harness that asserts a refusal, and one that refuses over a bare helper", () => {
    const fixtures = new Map([
      [T("fixture-bare-refusal.test.ts"), 'await db.exec("CREATE ROLE anon; CREATE ROLE authenticated;");\nawait expect(q).rejects.toThrow(/permission denied/);'],
      [T("fixture-converted.test.ts"), 'import { SUPABASE_DEFAULTS } from "./helpers/supabase-defaults";\nawait db.exec(`${SUPABASE_DEFAULTS} CREATE ROLE anon;`);\nexpect(has_table_privilege).toBe(false);'],
      [T("fixture-inline.test.ts"), 'await db.exec("CREATE ROLE anon; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;");\nexpect(e.code).toBe("42501");'],
      [T("helpers/fixture-bare-helper.ts"), 'export const ROLES = "CREATE ROLE anon;";'],
      [T("fixture-over-helper.test.ts"), 'import { ROLES } from "./helpers/fixture-bare-helper";\nawait expect(q).rejects.toThrow(/permission denied/);'],
      [T("fixture-comment-only.test.ts"), '// CREATE ROLE anon; and permission denied, in a comment only\nexport {};'],
    ]);
    const found = classify(fixtures, ROOT);
    const by = (n: string) => found.find((h) => h.file.endsWith(n));
    expect(by("fixture-bare-refusal.test.ts")).toMatchObject({ bare: true, refuses: true });
    expect(by("fixture-converted.test.ts")).toMatchObject({ bare: false, refuses: true });
    expect(by("fixture-inline.test.ts")).toMatchObject({ bare: false, refuses: true });
    expect(by("fixture-over-helper.test.ts")).toMatchObject({ bare: false, refuses: true, bareVia: ["src/test/helpers/fixture-bare-helper.ts"] });
    expect(by("fixture-comment-only.test.ts"), "a comment is not a harness").toBeUndefined();
    const v = violations(found);
    expect(v.some((l) => l.startsWith("src/test/fixture-bare-refusal.test.ts creates the client roles holding nothing and asserts a refusal"))).toBe(true);
    expect(v.some((l) => l.startsWith("src/test/fixture-over-helper.test.ts asserts a refusal over src/test/helpers/fixture-bare-helper.ts"))).toBe(true);
    expect(v.some((l) => l.startsWith("src/test/helpers/fixture-bare-helper.ts creates the client roles holding nothing: start it"))).toBe(true);
    expect(v.some((l) => /fixture-(converted|inline)/.test(l)), v.join("\n")).toBe(false);
  });
});

describe("the checkout", () => {
  it("has no harness that creates the client roles holding nothing and asserts a refusal, and no new bare harness", () => {
    expect(violations(harnesses)).toEqual([]);
  });

  it("the lists only shrink: thirty bare files that assert no refusal, fifteen that refuse over a bare helper, none converted elsewhere", () => {
    expect(BARE_WITHOUT_A_REFUSAL.length).toBeLessThanOrEqual(30);
    expect(REFUSES_OVER_A_BARE_HELPER.length).toBeLessThanOrEqual(15);
    expect(Object.keys(CONVERTED_BY_ANOTHER_LANE)).toEqual([]);
    for (const list of [BARE_WITHOUT_A_REFUSAL, REFUSES_OVER_A_BARE_HELPER]) expect(new Set(list).size).toBe(list.length);
  });
});
