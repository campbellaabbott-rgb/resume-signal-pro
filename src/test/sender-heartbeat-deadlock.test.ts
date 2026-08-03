/**
 * THE DEADLOCK THAT WOULD HAVE MADE THE ARMED AGENT DO NOTHING, FOREVER.
 *
 * Found 2026-08-03, minutes after the first worker was ever armed and running.
 * Two components, each correct in isolation, that between them could not start:
 *
 *   apply-agent  releases nothing unless `agent_sender_online(900)` is true.
 *                That RPC is fed ONLY by the worker's heartbeat.
 *   worker       claimed first, and on an empty queue took a fast path —
 *                "nothing to do — exiting without starting a browser" — that
 *                RETURNED BEFORE the loop containing the heartbeat.
 *
 * So the worker only checked in once it already had work, and it could only be
 * given work after checking in. A fresh install would log "nothing to do" every
 * five minutes forever while apply-agent logged "sender OFFLINE — preparing
 * packets but releasing none". No error, no alert, both components behaving
 * exactly as written, and zero applications ever sent.
 *
 * WHAT MAKES THIS WORTH A TEST RATHER THAN A COMMENT. The loop's heartbeat
 * ALREADY carried a comment explaining this precise failure — "if the heartbeat
 * only landed on successful claims then a healthy-but-idle sender would look
 * dead and apply-agent would stop releasing to it — the system would talk
 * itself into an outage." It was right, and it did not help, because the
 * fast-exit was added later and returns above it. A comment cannot see code
 * written after it; this can.
 *
 * The invariant: on EVERY run, including one that finds an empty queue, the
 * worker checks in before it can exit.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(
  resolve(__dirname, "../../worker/src/index.ts"), "utf8");

/** Comments describe intent; only code decides. Strip them before asserting. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("an idle worker still checks in", () => {
  it("pings before the first claim, not only inside the loop", () => {
    const firstPing = code.indexOf("broker.ping(");
    const firstClaim = code.indexOf("broker.claim(");
    expect(firstPing, "no broker.ping call at all").toBeGreaterThan(-1);
    expect(firstClaim, "no broker.claim call at all").toBeGreaterThan(-1);
    expect(
      firstPing,
      "the first claim now happens BEFORE any heartbeat — an idle run will exit " +
      "without checking in, and apply-agent will refuse to release to it",
    ).toBeLessThan(firstClaim);
  });

  it("the early exit cannot be reached before a heartbeat", () => {
    const exit = code.indexOf("nothing to do");
    expect(exit, "the fast-exit path is gone or reworded").toBeGreaterThan(-1);
    const pingBeforeExit = code.lastIndexOf("broker.ping(", exit);
    expect(
      pingBeforeExit,
      "the 'nothing to do' return is reachable with no preceding broker.ping — " +
      "this is the deadlock returning",
    ).toBeGreaterThan(-1);
  });

  it("still pings inside the loop too, for long-running sessions", () => {
    // The pre-claim ping covers the idle run; the loop covers a worker that
    // stays up for hours. Losing either one reintroduces a stale heartbeat.
    expect((code.match(/broker\.ping\(/g) ?? []).length,
      "expected a heartbeat both before the first claim and inside the loop")
      .toBeGreaterThanOrEqual(2);
  });
});

/**
 * The other half of the pair. If apply-agent ever stops gating on the sender,
 * these assertions should fail LOUDLY rather than the gate quietly disappearing
 * — an ungated release would send applications with nothing alive to send them.
 */
describe("apply-agent still gates releases on a live sender", () => {
  const agent = readFileSync(
    resolve(__dirname, "../../supabase/functions/apply-agent/index.ts"), "utf8");

  it("asks agent_sender_online with a 900s window", () => {
    expect(agent).toMatch(/agent_sender_online/);
    expect(agent).toMatch(/p_max_age_seconds:\s*900/);
  });

  it("fails closed when the check itself errors", () => {
    // A query that did not answer must not read as "sender is up".
    expect(agent).toMatch(/const senderOnline = !onlineErr && onlineRow === true/);
  });

  it("releases nothing while the sender is offline", () => {
    expect(agent).toMatch(/if \(!senderOnline\)/);
  });
});

/**
 * launchd does not read your shell profile. Same session, same install: the
 * job ran, reached `npm run --silent dev`, and died with exit 127 "npm: command
 * not found" every five minutes — while `./mac/applyd once` in a terminal
 * worked perfectly, because that inherits your PATH. The two disagreed, and the
 * failing one was the scheduled one.
 */
describe("the LaunchAgent gets a PATH that can find node", () => {
  const applyd = readFileSync(
    resolve(__dirname, "../../worker/mac/applyd"), "utf8");

  it("sets EnvironmentVariables/PATH in the generated plist", () => {
    expect(applyd, "no PATH in the plist — a scheduled run cannot find npm")
      .toMatch(/<key>EnvironmentVariables<\/key>/);
    expect(applyd).toMatch(/<key>PATH<\/key>/);
  });

  it("covers both Homebrew prefixes and the system default", () => {
    // Apple silicon and Intel put Homebrew in different places, and the Node
    // .pkg installer uses /usr/local/bin on both.
    expect(applyd).toMatch(/\/opt\/homebrew\/bin/);
    expect(applyd).toMatch(/\/usr\/local\/bin/);
  });
});
