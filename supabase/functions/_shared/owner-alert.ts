/**
 * A CEILING THAT IS REACHED TELLS THE OWNER, ONCE A DAY.
 *
 * The public mail doors (key requests, key mints, pulse and claim sign-ups,
 * report mails) have daily ceilings so the worst case is a number. Past a
 * softer threshold they stop serving networks that already used their share,
 * and at the ceiling they stop for everyone. Either one means real visitors
 * may be turned away, so the owner hears about it: one mail per door per day
 * (mail_door_take keeps the count), to the fixed owner address, with fixed
 * text. Never throws: an alert that fails must not fail the request.
 */
type Rpc = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};
export type OwnerMail = (m: { to: string[]; subject: string; html: string }) => Promise<unknown>;

export async function alertOwnerOnce(admin: Rpc, door: string, what: string, send: OwnerMail): Promise<void> {
  try {
    const { data, error } = await admin.rpc("mail_door_take", {
      p_door: "owner-alert", p_bucket: door.slice(0, 64), p_max: 1, p_window_minutes: 1440,
    });
    if (error || data !== true) return;
    const to = Deno.env.get("OWNER_NOTIFY_EMAIL") ?? "resumeboostersupp@gmail.com";
    await send({
      to: [to],
      subject: `Mail door ${door}: ${what}`,
      html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#111">
        <p>The mail door <b>${door.replace(/[^a-z0-9:._-]/gi, "")}</b> ${what.replace(/[<>&]/g, "")} today.</p>
        <p>Real visitors from busy networks, or everyone at the hard ceiling, are being refused until the day's window ends. If this is a flood, nothing needs doing; if it is real demand, raise the ceiling in migration 20261004100000's functions.</p>
      </div>`,
    });
  } catch (e) {
    console.warn("[OWNER-ALERT] could not alert:", e instanceof Error ? e.message.slice(0, 120) : String(e));
  }
}
