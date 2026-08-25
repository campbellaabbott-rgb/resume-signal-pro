/**
 * The `host` override: a board served from the employer's own domain.
 *
 * This is the seam that closes the 364 custom-domain Teamtailor boards whose
 * tenant token no reverse lookup can recover. It is one `??` in one expression,
 * which is exactly why it needs a test — a change that small is the kind that
 * gets "simplified" away by someone who cannot see what depends on it.
 *
 * The failure it prevents is silent. If `host` stopped being honoured, the
 * ingester would fetch `{token}.teamtailor.com` for a board whose token is a
 * domain-derived placeholder, get a 404, and record the board as dead. Nothing
 * would error; the board would just stop existing.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const INDEX = read("supabase/functions/job-board/index.ts");
const SOURCES = read("supabase/functions/job-board/sources.ts");

describe("JobSource carries an optional host", () => {
  it("declares host as optional so every existing entry stays valid", () => {
    // 28,318 entries have no host. Making it required would break all of them.
    expect(SOURCES).toMatch(/host\?\s*:\s*string/);
  });
});

describe("the teamtailor feed URL honours it", () => {
  it("prefers host over the token-built vendor hostname", () => {
    expect(INDEX).toMatch(/https:\/\/\$\{s\.host \?\? `\$\{s\.token\}\.teamtailor\.com`\}\/jobs\.rss/);
  });

  it("still falls back to the vendor hostname when host is absent", () => {
    // The fallback is what keeps the other ~1,500 teamtailor boards working.
    const line = INDEX.split("\n").find((l) => l.includes("teamtailor.com`}/jobs.rss"));
    expect(line).toBeTruthy();
    expect(line!).toContain("s.token");
  });

  it("does not use host for vendors that have not been verified to serve it", () => {
    // Breezy/Recruitee/BambooHR custom-domain behaviour is UNMEASURED. Applying
    // the override there would be a guess wearing the same syntax as a fact.
    for (const vendor of ["recruitee.com/api/offers", "breezy.hr/json", "bamboohr.com/careers/list"]) {
      const line = INDEX.split("\n").find((l) => l.includes(vendor));
      expect(line, `no line building a ${vendor} url`).toBeTruthy();
      expect(line!, `${vendor} must not read s.host yet`).not.toContain("s.host");
    }
  });
});

describe("the board's identity is unchanged by where it is fetched", () => {
  // Both assertions below used to read `fn.slice(0, 900)` — an arbitrary
  // character window, not the function. When normalizeTeamtailor grew (it
  // started parsing tt:city/tt:country/tt:department, which it had been
  // discarding for every one of 10,858 rows), `applyUrl` fell off the end of
  // the window and the positive assertion failed for a reason that had nothing
  // to do with apply urls.
  //
  // The negative assertion had the worse version of the same bug: a window too
  // small to reach new code cannot see a `host` added below it, so it would
  // have kept passing while the thing it forbids crept in. Bounded to the real
  // function body instead — it ends where the next top-level export begins.
  const teamtailorFn = (norm: string) => {
    const start = norm.indexOf("export function normalizeTeamtailor");
    expect(start, "normalizeTeamtailor not found").toBeGreaterThan(-1);
    const next = norm.indexOf("\nexport ", start + 10);
    const body = norm.slice(start, next > start ? next : undefined);
    expect(body.length, "function body looks truncated").toBeGreaterThan(900);
    return body;
  };

  it("posting ids are still keyed on token, not host", () => {
    // `teamtailor:${token}:${externalId}` — if this ever became host-keyed, a
    // company moving to or from a custom domain would orphan every saved job,
    // tracker row and application that referenced its postings.
    const norm = read("supabase/functions/job-board/normalize.ts");
    expect(norm).toMatch(/teamtailor:\$\{token\}:/);
    expect(teamtailorFn(norm)).not.toContain("host");
  });

  it("apply urls come from the feed's own link", () => {
    // Which is why a custom-domain board's apply urls land on the custom
    // domain automatically, and why the worker's adapter needs no change.
    const norm = read("supabase/functions/job-board/normalize.ts");
    expect(teamtailorFn(norm)).toMatch(/applyUrl:\s*safeUrl\(link\)/);
  });
});
