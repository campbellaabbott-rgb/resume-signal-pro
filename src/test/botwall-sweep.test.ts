/**
 * THE SWEEP THAT KEEPS "CLOSED" HONEST.
 *
 * The agent reaches 5.4% of the board and every route past it is shut by a
 * vendor's choice. Choices change; RECON records Workable as "a two-hour
 * adapter if Turnstile ever comes off" and nothing was watching. This tests the
 * verdict logic, because the verdict is what decides whether a human is told.
 *
 * THE DIRECTION THAT MATTERS. Reporting a walled vendor as clean is the
 * expensive error — it gets an adapter built against a wall. Reporting a clean
 * vendor as walled only costs a missed opportunity. So `unknown` must never
 * collapse into `clean`, and a sweep that reached nobody must say so.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { signsInUrl, vendorVerdict, isOpportunity, SIGNS } from "../../worker/src/botwall-detect";

const sweep = readFileSync(resolve(__dirname, "../../worker/src/botwall-sweep.ts"), "utf8");
const probe = readFileSync(resolve(__dirname, "../../worker/src/probe-botwall.ts"), "utf8");
const wf = readFileSync(resolve(__dirname, "../../.github/workflows/botwall-sweep.yml"), "utf8");

const t = (company: string, walls: string[], reached = true) => ({ company, walls, reached });

describe("the signature table catches a self-hosted wall", () => {
  it("matches on path, not host — the Recruitee lesson", () => {
    // captcha-base.recruiteecdn.com defeated a host allow-list silently, and
    // reported 10/10 clean on a vendor that walls every tenant.
    expect(signsInUrl("https://captcha-base.recruiteecdn.com/1/secure-api.js?render=explicit")).toContain("captcha");
  });

  it("catches the walls measured live 2026-08-07", () => {
    expect(signsInUrl("https://apply.workable.com/cdn-cgi/challenge-platform/scripts/jsd/main.js")).toContain("cf-challenge");
    expect(signsInUrl("https://www.recaptcha.net/recaptcha/enterprise.js?render=abc")).toContain("captcha");
  });

  it("says nothing about an ordinary asset", () => {
    expect(signsInUrl("https://cdn.example.com/app.bundle.js")).toEqual([]);
  });

  it("lives in exactly one place", () => {
    // A second copy is how a stale table reports a walled vendor clean.
    expect(SIGNS.length).toBeGreaterThanOrEqual(9);
    expect(probe).toMatch(/import \{ SIGNS \} from "\.\/botwall-detect\.js"/);
    expect(probe).not.toMatch(/\["turnstile", \/turnstile\/i\]/);
  });
});

describe("the verdict", () => {
  it("is walled when every reached tenant is walled", () => {
    const v = vendorVerdict([t("A", ["cf-challenge"]), t("B", ["cf-challenge"])]);
    expect(v.verdict).toBe("walled");
    expect(v.walled).toBe(2);
  });

  it("is clean only when reached tenants show nothing", () => {
    expect(vendorVerdict([t("A", []), t("B", [])]).verdict).toBe("clean");
  });

  it("is mixed when some are walled — still an opportunity worth reading", () => {
    // Greenhouse measured 5/6 on 2026-08-07: one tenant clean. Mixed is a real
    // state and flattening it either way loses the finding.
    expect(vendorVerdict([t("A", ["captcha"]), t("B", [])]).verdict).toBe("mixed");
  });

  it("is UNKNOWN when nothing was reached, never clean", () => {
    // The expensive error. A network failure that reads as `clean` is a green
    // light to build an adapter against a wall.
    expect(vendorVerdict([t("A", [], false), t("B", [], false)]).verdict).toBe("unknown");
    expect(vendorVerdict([]).verdict).toBe("unknown");
  });

  it("excludes unreachable tenants from the denominator", () => {
    const v = vendorVerdict([t("A", ["captcha"]), t("B", [], false)]);
    expect(v.reached).toBe(1);
    expect(v.verdict).toBe("walled");
  });

  it("reports which walls were seen, deduped", () => {
    const v = vendorVerdict([t("A", ["captcha", "cf-challenge"]), t("B", ["captcha"])]);
    expect(v.walls).toEqual(["captcha", "cf-challenge"]);
  });
});

describe("what wakes a human", () => {
  it("only a vendor that opened", () => {
    expect(isOpportunity("clean")).toBe(true);
    expect(isOpportunity("mixed")).toBe(true);
  });

  it("never the expected state", () => {
    // A weekly alert for "still walled" is the muted alert this project has a
    // rule against — it would be ignored within a month, including the week it
    // finally said something else.
    expect(isOpportunity("walled")).toBe(false);
    expect(isOpportunity("unknown")).toBe(false);
  });
});

describe("the sweep refuses to report a measurement it did not take", () => {
  it("exits non-zero without credentials", () => {
    expect(sweep).toMatch(/refusing to report a sweep that measured nothing/);
    expect(sweep).toMatch(/process\.exit\(2\)/);
  });

  it("skips the vendors that are already drivable", () => {
    // A wall on a SENDABLE vendor is the sender's failure path, not a reach
    // question, and probing them weekly would spend the budget on the answer
    // we already have.
    const list = sweep.slice(sweep.indexOf("DEFAULT_VENDORS"), sweep.indexOf("const PER_VENDOR"));
    for (const v of ["breezy", "personio", "pinpoint", "teamtailor"]) {
      expect(list, `${v} is already drivable and should not be swept`).not.toContain(v);
    }
  });

  it("submits nothing — it reads a page and watches requests", () => {
    expect(sweep).not.toMatch(/\.fill\(|\.setInputFiles\(|type=["']submit["']/);
  });
});

describe("the schedule", () => {
  it("runs weekly, not daily", () => {
    expect(wf).toMatch(/cron: "12 6 \* \* 1"/);
  });

  it("avoids the round-hour slots everything else uses", () => {
    const cron = /cron: "(\d+) (\d+)/.exec(wf);
    expect(cron).toBeTruthy();
    expect(Number(cron![1])).not.toBe(0);
  });

  it("can be run by hand when a vendor is rumoured to have opened", () => {
    expect(wf).toMatch(/workflow_dispatch:/);
  });

  it("stays green while everything is still walled", () => {
    // The run's colour must mean "did the sweep work", not "is a vendor open".
    expect(sweep).toMatch(/Exit 0 regardless/);
    expect(sweep).toMatch(/::warning title=Bot wall lifted::/);
  });
});
