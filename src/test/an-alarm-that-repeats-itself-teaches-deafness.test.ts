/**
 * 48 IDENTICAL EMAILS A DAY IS NOT AN ALERT, IT IS A MUTE BUTTON.
 *
 * scan-heartbeat runs on a 10-minute cron and emailed on every non-healthy
 * run, gated only by a 2/hour rate cap. A PERSISTENT degraded state — a slow
 * census digestion, a week of a miscalibrated SLA — therefore meant two
 * identical emails an hour, forever. The user said it plainly: "I'm
 * constantly getting these alerts." An inbox trained that way stops reading,
 * and the one email that matters drowns in copies of itself.
 *
 * The gate is the FAILING SET now, not the clock: a durable fingerprint
 * (status + sorted failing check names) in job_board_meta. Email when it
 * CHANGES — a new check fails, the status escalates, part of it recovers —
 * remind at most once a day while it persists, send ONE recovery note when it
 * clears, and keep the rate cap only as a backstop for a flapping check.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const HB = readFileSync(
  resolve(__dirname, "../../supabase/functions/scan-heartbeat/index.ts"), "utf8");
const CODE = HB.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

describe("the heartbeat alerts on change, not on schedule", () => {
  it("fingerprints the failing set durably", () => {
    expect(CODE).toMatch(/const fingerprint = `\$\{status\}\|\$\{failedChecks\.map\(\(c\) => c\.name\)\.sort\(\)\.join\(","\)\}`/);
    expect(CODE, "the fingerprint must survive isolates — module state does not")
      .toMatch(/eq\('k', 'heartbeat_alert_state'\)/);
  });

  it("a flapping check emails once per day, and a shrink never emails", () => {
    // Measured on the user's own inbox: verification_ceiling flapped in and
    // out of the failing set as rotation caught up, and fingerprint EQUALITY
    // emailed every flip — including the shrink, an email whose only news was
    // "less is wrong than before". News is now per-CHECK with a 24h clock;
    // getting better is only ever announced by the whole-board recovery note.
    expect(CODE).toMatch(/const REMIND_MS = 24 \* 60 \* 60_000/);
    expect(CODE, "per-check alert clock is gone").toMatch(/const newsChecks = failedChecks\.filter/);
    expect(CODE, "escalation to down must always send")
      .toMatch(/status === 'down' && !String\(prev\.fingerprint \?\? ''\)\.startsWith\('down'\)/);
    expect(CODE, "the daily reminder must survive").toMatch(/remindDue/);
    expect(CODE, "a silent run must still keep the state row current — the recovery note depends on it")
      .toMatch(/lastSentAt: shouldSend \? new Date\(\)\.toISOString\(\) : \(prev\.lastSentAt/);
  });

  it("one incident is one email per four hours", () => {
    // Three emails in one morning for one underlying story (facets stalls,
    // then the deploy check trips on the same load) — measured on the user's
    // inbox. Degraded emails share a cooldown; DOWN-escalation and the
    // recovery note bypass it, because a worsening or healed board is always
    // worth one email.
    expect(CODE).toMatch(/DEGRADED_COOLDOWN_MS = 4 \* 60 \* 60_000/);
    expect(CODE).toMatch(/status !== 'down' && Number\.isFinite\(lastSent\) && now - lastSent < DEGRADED_COOLDOWN_MS/);
    expect(CODE, "escalation must bypass the cooldown").toMatch(/\|\| escalated \|\| remindDue/);
  });

  it("a news slot is spent only by an actual email", () => {
    // Initializing first-seen names on silent runs consumed their slot with
    // no email sent — a check first failing inside a cooldown would then stay
    // unannounced for a full day.
    expect(CODE).toMatch(/if \(shouldSend\) nextAlerted\[c\.name\] = new Date\(\)\.toISOString\(\);/);
    expect(CODE).toMatch(/else if \(alerted\[c\.name\]\) nextAlerted\[c\.name\] = alerted\[c\.name\];/);
  });

  it("keeps the rate cap as a flap backstop, after the fingerprint gate", () => {
    const fp = CODE.indexOf("heartbeat_alert_state");
    const cap = CODE.indexOf("'alert:heartbeat'");
    expect(fp, "the fingerprint gate is gone").toBeGreaterThan(-1);
    expect(cap, "the 2/hour backstop is gone — a flapping check emails every flip").toBeGreaterThan(-1);
    expect(fp).toBeLessThan(cap);
  });

  it("a dedupe failure falls through to sending — never swallows a real alert", () => {
    // Both durable gates sit in try/catch with empty catches that continue to
    // the send; assert the catches exist rather than trusting memory.
    const block = CODE.slice(CODE.indexOf("const fingerprint ="), CODE.indexOf("const statusEmoji"));
    expect((block.match(/catch \(_e\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("sends one recovery note when a previously-alerted state clears", () => {
    expect(CODE).toMatch(/sendRecoveryIfAlerted/);
    expect(CODE, "recovery must not fire when nothing was alerted")
      .toMatch(/if \(!prev\.fingerprint \|\| prev\.fingerprint\.startsWith\('healthy'\)\) return/);
    expect(CODE, "recovery must clear the state or it emails every healthy run")
      .toMatch(/fingerprint: 'healthy'/);
    expect(CODE).toMatch(/Heartbeat recovered/);
  });

  it("the subject names the failing set, so one incident is one thread", () => {
    expect(CODE).toMatch(/failedChecks\.map\(\(c\) => c\.name\.replace\(\/\^job_board_\/, ""\)\)\.sort\(\)/);
  });
});
