import { describe, expect, it } from "vitest";
import { agentDb, migration } from "./helpers/agent-db";
import { ownResumePath } from "../../supabase/functions/_shared/resume-path";

/**
 * Sweep S8-080. apply-broker signed whatever path the mandate owner wrote into
 * resume_file_url, with the service role, and agent_mandates' owner policy lets
 * the owner write any text there. '<another-user-uuid>/resume.pdf' went out,
 * signed, with the owner's applications.
 */
const ME = "11111111-1111-4111-8111-111111111111";
const THEM = "22222222-2222-4222-8222-222222222222";
const M = "20261009120000_a_mandate_can_name_only_a_resume_in_its_own_folder.sql";

describe("the broker and the preparer read only the account's own résumé", () => {
  it("a path in another account's folder is not the account's résumé", () => {
    expect(ownResumePath(`${THEM}/resume.pdf`, ME)).toBeNull();
    expect(ownResumePath(`${ME}/../${THEM}/resume.pdf`, ME)).toBeNull();
    expect(ownResumePath("resume.pdf", ME)).toBeNull();
    expect(ownResumePath(`${ME}/resume.pdf`, ME)).toBe(`${ME}/resume.pdf`);
    expect(ownResumePath(`${ME.toUpperCase()}/cv.docx`, ME)).toBe(`${ME.toUpperCase()}/cv.docx`);
  });

});

describe("the table refuses a résumé outside the account's folder", () => {
  it("refuses another account's path, keeps the owner's own, and leaves a legacy row editable", async () => {
    const db = await agentDb();
    await db.exec(`INSERT INTO auth.users (id, email) VALUES ('${ME}', 'me@example.com'), ('${THEM}', 'them@example.com');`);
    // A legacy row written before the trigger existed.
    await db.exec(`INSERT INTO public.agent_mandates (user_id, email, resume_file_url) VALUES ('${ME}', 'me@example.com', '${THEM}/resume.pdf');`);
    await db.exec(migration(M));
    // Re-running is safe.
    await db.exec(migration(M));

    await expect(db.exec(`UPDATE public.agent_mandates SET resume_file_url = '${THEM}/other.pdf' WHERE user_id = '${ME}'`))
      .rejects.toThrow(/own folder/);
    // Editing anything else on the legacy row still works.
    await db.exec(`UPDATE public.agent_mandates SET city = 'Leeds' WHERE user_id = '${ME}'`);
    await db.exec(`UPDATE public.agent_mandates SET resume_file_url = '${ME}/resume.pdf' WHERE user_id = '${ME}'`);
    await expect(db.exec(`INSERT INTO public.agent_mandates (user_id, email, resume_file_url) VALUES ('${THEM}', 'them@example.com', '${ME}/resume.pdf')`))
      .rejects.toThrow(/own folder/);
    const { rows } = await db.query<{ resume_file_url: string; city: string }>(`SELECT resume_file_url, city FROM public.agent_mandates WHERE user_id = '${ME}'`);
    expect(rows[0]).toEqual({ resume_file_url: `${ME}/resume.pdf`, city: "Leeds" });
  }, 60_000);
});
