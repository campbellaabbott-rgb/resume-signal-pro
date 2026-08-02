import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const panel = readFileSync(resolve(root, "src/components/account/ApplyProfilePanel.tsx"), "utf8");

describe("the apply profile cannot collapse 'not stated' into 'No'", () => {
  // THE CONTROL DECISION THIS FILE EXISTS TO PROTECT.
  //
  // work_authorized / requires_sponsorship / willing_to_relocate are nullable in
  // the database precisely because "not stated" is not "No". A checkbox has no
  // way to express that — unticked and No look identical — and an unticked box
  // would have the agent tell employers a candidate is not authorised to work
  // when they simply never answered. That is a worse outcome than the packet
  // blocking, and it is irreversible once sent.
  it("renders the three legal questions as three-way controls, not checkboxes", () => {
    expect(panel).toContain("TriToggle");
    for (const q of ["work_authorized", "requires_sponsorship", "willing_to_relocate"]) {
      const idx = panel.indexOf(q);
      expect(idx, `${q} must be wired`).toBeGreaterThan(-1);
      // each must be set through the tri-state control, never a checkbox
      const nearby = panel.slice(Math.max(0, idx - 400), idx + 200);
      expect(nearby, `${q} must not be a checkbox`).not.toMatch(/type="checkbox"[\s\S]{0,200}$/);
    }
  });

  it("offers null as an explicit, selectable option", () => {
    expect(panel).toMatch(/\{ v: null, k: "applyProfile\.unset"/);
    expect(panel).toContain('const opts: Array<{ v: Tri; k: string; d: string }>');
  });

  it("starts every trinary at null, never at false", () => {
    // A default of false is the same lie as an unticked checkbox.
    expect(panel).toMatch(/work_authorized: null/);
    expect(panel).toMatch(/requires_sponsorship: null/);
    expect(panel).toMatch(/willing_to_relocate: null/);
  });

  it("defaults to review mode, never to sending", () => {
    expect(panel).toMatch(/apply_mode: "review"/);
  });

  it("declines demographics by default", () => {
    // Opting in must be an explicit act. The agent never answers these for
    // someone, in either direction.
    expect(panel).toMatch(/share_demographics: false/);
  });

  it("uses radio semantics so the control is reachable without a mouse", () => {
    expect(panel).toContain('role="radiogroup"');
    expect(panel).toContain('aria-checked');
  });
});

describe("the panel tells the user what a blank field costs", () => {
  it("names the missing answers and the consequence, not just a count", () => {
    // Was `applyProfile.missing` — a flat list of four field names with one
    // shared sentence. Replaced 2026-08-02 by the readiness model, which
    // carries the EMPLOYER'S ACTUAL QUESTION per gap. The intent of this test
    // is unchanged and the bar is higher: a consequence per field, not one
    // sentence covering all of them.
    expect(panel).toContain("applyReadiness");
    expect(panel).toContain("g.consequence");
    const en = JSON.parse(readFileSync(resolve(root, "src/i18n/locales/en.json"), "utf8"));
    expect(en.applyProfile.legalIntro).toMatch(/never guesses/i);
    expect(en.applyProfile.modeAutoHint).toMatch(/CAPTCHA/i);
  });

  it("separates what blocks everything from what blocks some", () => {
    // The distinction is the point. Telling someone a missing postcode is as
    // serious as a missing CV makes the panel cry wolf; telling them a missing
    // CV is minor lets them believe applications are going out when none are.
    expect(panel).toContain("blocks-everything");
    expect(panel).toContain("blocks-some");
  });

  it("does not promise more than the agent can honour when nothing is missing", () => {
    // The clear state must not read as "every form will now succeed" — unknown
    // questions still stop the agent, by design.
    const en = JSON.parse(readFileSync(resolve(root, "src/i18n/locales/en.json"), "utf8"));
    expect(en.applyReadiness?.clear ?? "").toMatch(/still stops|rather than guessing/i);
  });

  it("is translated into all nine locales with no key gaps", () => {
    const en = JSON.parse(readFileSync(resolve(root, "src/i18n/locales/en.json"), "utf8"));
    const keys = Object.keys(en.applyProfile);
    expect(keys.length).toBeGreaterThanOrEqual(30);
    for (const loc of ["en-GB", "es", "fr", "de", "pt", "nl", "hi", "tl"]) {
      const j = JSON.parse(readFileSync(resolve(root, `src/i18n/locales/${loc}.json`), "utf8"));
      expect(j.applyProfile, `${loc} missing applyProfile`).toBeTruthy();
      for (const k of keys) {
        expect(j.applyProfile[k], `${loc}.applyProfile.${k}`).toBeTruthy();
      }
    }
  });

  it("translates the trinary labels rather than shipping English into every locale", () => {
    for (const loc of ["es", "fr", "de", "hi"]) {
      const j = JSON.parse(readFileSync(resolve(root, `src/i18n/locales/${loc}.json`), "utf8"));
      expect(j.applyProfile.unset).not.toBe("Not stated");
    }
  });
});

describe("the résumé file — the thing that blocks every application without it", () => {
  const panel = readFileSync(resolve(root, "src/components/account/ApplyProfilePanel.tsx"), "utf8");

  // Find the migration that creates the bucket instead of naming a file.
  //
  // This test previously read 20260730040000 by path, and broke the moment that
  // migration was superseded — reporting a failure about bucket privacy when
  // privacy was entirely intact and only the filename had moved. A guard that
  // fails when the code is REORGANISED rather than when it is WRONG trains you
  // to ignore it, which is worse than not having it.
  //
  // So: assert the property (somewhere in the migration set, the resumes bucket
  // is created private, capped and owner-scoped), not the location.
  const migDir = resolve(root, "supabase/migrations");
  const allMigs = readdirSync(migDir)
    .filter((f) => f.endsWith(".sql")).sort()
    .map((f) => readFileSync(resolve(migDir, f), "utf8"));
  const bucketMigs = allMigs.filter((s) => /INSERT INTO storage\.buckets/.test(s));
  // Later files win, so the last one is the definition actually in force.
  const mig = bucketMigs[bucketMigs.length - 1] ?? "";
  // The policies and the bucket insert do NOT have to live in the same file —
  // the deploy split them across two, which is how the bucket went missing while
  // the policies shipped. So look for each where it actually is.
  const migSet = allMigs.join("\n");
  const agentFn = readFileSync(resolve(root, "supabase/functions/apply-agent/index.ts"), "utf8");

  it("creates the bucket from code, not only from SQL", () => {
    // THE ACTUAL FAILURE THIS SUITE MISSED. Migration 20260730040000 declared
    // the bucket and four policies; the deploy emitted the four policies and
    // dropped the bucket insert. The result was four RLS policies guarding a
    // bucket that did not exist — which looks fully configured and fails every
    // upload at the last step.
    //
    // A SQL-only declaration is therefore not sufficient evidence that the
    // bucket exists. The storage API call is what this project can rely on.
    expect(agentFn).toMatch(/storage\.createBucket\(\s*"resumes"/);
    expect(agentFn, "must not create it public").toMatch(/public:\s*false/);
    expect(agentFn, "the run summary must report bucket state").toMatch(/resumesBucket/);
  });

  it("still declares the bucket in SQL for paths that honour it", () => {
    expect(bucketMigs.length, "no migration declares the resumes bucket").toBeGreaterThanOrEqual(1);
    expect(mig).toMatch(/'resumes'/);
  });

  // The gap this closes: resume_file_url was in the type and in the missing-list,
  // but no control rendered it — so it could never be set, and buildPacket would
  // block on the file question of essentially every posting forever.
  it("renders an upload control, not just a field the user cannot reach", () => {
    expect(panel).toContain('type="file"');
    expect(panel).toContain("applyProfile.chooseResume");
    expect(panel).toMatch(/storage\.from\("resumes"\)\.upload/);
  });

  it("stores a storage PATH keyed by user, never a public URL", () => {
    // The path's first segment is what the storage policy checks ownership on.
    expect(panel).toMatch(/const path = `\$\{userId\}\//);
    expect(panel).toMatch(/set\("resume_file_url", path\)/);
  });

  it("keeps the bucket private", () => {
    // A résumé is a home address, a phone number and an employment history in
    // one file. Public would make every one of them enumerable by URL forever.
    const bucketRow = mig.slice(mig.indexOf("INSERT INTO storage.buckets"), mig.indexOf("ON CONFLICT"));
    expect(bucketRow).toMatch(/\bfalse\b/);
    expect(mig).not.toMatch(/'resumes',\s*'resumes',\s*true/);
  });

  it("scopes every storage policy to the owner's own folder", () => {
    // Searched across the whole migration set, not one file: the policies live
    // in a different migration from the bucket declaration, and pinning this to
    // one file is what made the earlier version of this test misfire.
    const policies = [...new Set(migSet.match(/CREATE POLICY "resumes_[a-z_]+"/g) ?? [])];
    expect(policies.length, "read, write, update, delete").toBeGreaterThanOrEqual(4);
    const owner = migSet.match(/\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/g) ?? [];
    expect(owner.length, "every policy must check ownership").toBeGreaterThanOrEqual(5);
  });

  it("caps the file size and the accepted types", () => {
    expect(mig).toContain("10485760");
    expect(mig).toContain("application/pdf");
    expect(panel).toContain("MAX_BYTES");
  });
});

describe("saving an apply profile survives a migration that has not landed", () => {
  /**
   * The bundle and the migrations do not ship together: Lovable deploys the
   * frontend in seconds and applies migrations only during a session. So there
   * is always a window where this panel knows about a column Postgres does not.
   *
   * Found live, not theoretically. `consent_to_processing` shipped in the
   * bundle before its migration, and the panel's named-column select returned
   * 42703 against the real database — which takes the ENTIRE apply profile
   * down, read and write, with nothing on screen explaining why.
   */
  const undefinedColumn = (col: string) => ({
    code: "42703",
    message: `column agent_mandates.${col} does not exist`,
  });

  it("drops the column Postgres names and saves everything else", async () => {
    const { saveTolerantly } = await import("../components/account/ApplyProfilePanel");
    const seen: Array<Record<string, unknown>> = [];
    const run = async (v: Record<string, unknown>) => {
      seen.push({ ...v });
      return { error: "consent_to_processing" in v ? undefinedColumn("consent_to_processing") : null };
    };
    const { error } = await saveTolerantly(run, {
      full_name: "Alex Fairweather", consent_to_processing: true, apply_mode: "review",
    });
    expect(error).toBeNull();
    expect(seen).toHaveLength(2);
    // The rest of the profile still saved — one pending column must not take
    // the whole form down.
    expect(seen[1]).toEqual({ full_name: "Alex Fairweather", apply_mode: "review" });
  });

  it("surfaces a real failure instead of retrying it away", async () => {
    const { saveTolerantly } = await import("../components/account/ApplyProfilePanel");
    const run = async () => ({ error: { code: "23505", message: "duplicate key" } });
    const { error } = await saveTolerantly(run, { full_name: "x" });
    // Only undefined_column is tolerable. Swallowing anything else would hide
    // genuine save failures behind a silent retry loop.
    expect(error?.code).toBe("23505");
  });

  it("gives up rather than looping when the error names nothing it holds", async () => {
    const { saveTolerantly } = await import("../components/account/ApplyProfilePanel");
    let calls = 0;
    const run = async () => { calls++; return { error: undefinedColumn("some_other_table_column") }; };
    const { error } = await saveTolerantly(run, { full_name: "x" });
    expect(error?.code).toBe("42703");
    expect(calls, "must not retry a column it cannot remove").toBe(1);
  });
});
