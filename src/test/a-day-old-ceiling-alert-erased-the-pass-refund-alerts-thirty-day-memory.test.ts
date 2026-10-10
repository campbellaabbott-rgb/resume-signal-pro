// @vitest-environment node
/**
 * A DAY-OLD CEILING ALERT ERASED THE PASS REFUND ALERT'S THIRTY-DAY MEMORY
 * (S8-101).
 *
 * WHAT WAS WRONG. agent-pass-status mails the owner "refund it" once per
 * session, remembered for 30 days on the mail door "owner-alert".
 * alertOwnerOnce used the same door with a one-day window, and
 * mail_door_take's sweep deletes a door's rows older than the CALLER's
 * window. A day after the pass alert, any ceiling alert could delete its row,
 * and the buyer's next status poll mailed the owner again.
 *
 * WHAT HOLDS NOW, against the real mail_door_take in pglite: after the pass
 * alert is two days old and ceiling alerts have swept their door hundreds of
 * times, the same pass session is still remembered.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { bootMailDoorDb, rows } from "./helpers/mail-door-db";
import { alertOwnerOnce, firstPassAlert } from "../../supabase/functions/_shared/owner-alert";

let pg: PGlite;
const admin = {
  rpc: async (fn: string, a: Record<string, unknown>) => {
    if (fn !== "mail_door_take") throw new Error(fn);
    const r = await rows<{ ok: boolean }>(pg, "SELECT public.mail_door_take($1, $2, $3, $4) AS ok", [a.p_door, a.p_bucket, a.p_max, a.p_window_minutes]);
    return { data: r[0].ok, error: null };
  },
};

beforeAll(async () => {
  pg = await bootMailDoorDb();
  (globalThis as Record<string, unknown>).Deno = { env: { get: () => undefined } };
}, 120_000);

describe("the pass refund alert keeps its thirty days", () => {
  it("is sent once, and two days and many ceiling alerts later the same session is still remembered", async () => {
    const bucket = "pass:pass_already_open:cs_live_secondpass0001";
    expect(await firstPassAlert(admin, bucket)).toBe(true);
    expect(await firstPassAlert(admin, bucket)).toBe(false);
    // Two days pass.
    await pg.query("UPDATE public.mail_door_counts SET window_start = now() - interval '2 days'");
    // Ceiling alerts on their one-day door: enough knocks that the 2% sweep has surely run.
    const send = async () => undefined;
    for (let i = 0; i < 400; i++) await alertOwnerOnce(admin, `door-${i}`, "reached its ceiling", send);
    expect(await firstPassAlert(admin, bucket), "a ceiling alert's sweep erased the pass alert: the owner is mailed again").toBe(false);
  });
});
