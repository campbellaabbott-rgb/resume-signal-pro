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

/**
 * The sweep with its prose removed, for the guards that must assert about CODE.
 *
 * A guard whose literal appears in a nearby COMMENT passes (or, negated,
 * fails) on the explanation rather than on the behaviour. That has shipped
 * here four times, and the argv guard below is exactly the shape that invites
 * it: the fix's own comment quotes the broken expression on purpose.
 */
const sweepCode = sweep
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((l) => !/^\s*(\/\/|\*)/.test(l))
  .join("\n");

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

/**
 * THE CADENCE ITSELF, WHICH IS THE THING THAT WAS BROKEN.
 *
 * apply_tenant_walls held exactly one sweep (2026-08-07) despite a weekly
 * schedule, and the reason was three characters of argument parsing. The
 * workflow renders `npx tsx src/botwall-sweep.ts "${{ github.event.inputs.vendors }}"`,
 * and on a `schedule` event github.event.inputs is null — so argv[2] is the
 * empty STRING. `""?.split(",").filter(Boolean)` is `[]`, and `?? DEFAULT`
 * never fires for an empty array, so every cron run swept zero vendors and
 * exited green. It is invisible locally, because nobody runs the script
 * without arguments.
 */
describe("an empty argument means 'not supplied', not 'nothing'", () => {
  it("never guards an argv list with ?? alone", () => {
    // The literal that caused it. `??` is nullish-only; "" is not nullish.
    //
    // Asserted against CODE ONLY. main()'s comment quotes the broken
    // expression verbatim so the next reader knows what went wrong, and a
    // guard that reads the whole file would fail on the explanation of the bug
    // it is guarding — this repo has shipped that inversion four times.
    expect(sweepCode).not.toMatch(/process\.argv\[\d\]\?\.split\([^)]*\)[^;]*\?\?/);
    // ...and the comment really does still carry the explanation.
    expect(sweep).toMatch(/optional chaining only guards nullish/);
  });

  it("falls back on LENGTH", () => {
    expect(sweep).toMatch(/const vendors = asked\.length \? asked : DEFAULT_VENDORS/);
  });

  it("the workflow really does pass an empty string on a schedule", () => {
    // If this ever stops being true the guard above is still correct, but the
    // reason recorded next to it would be wrong.
    expect(wf).toMatch(/schedule:/);
    expect(wf).toMatch(/botwall-sweep\.ts "\$\{\{ github\.event\.inputs\.vendors \}\}"/);
  });

  it("resolves to the full closed set for every shape of empty input", () => {
    // The parse, verbatim from main().
    const resolve_ = (argv2: string | undefined) => {
      const asked = (argv2 ?? "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
      return asked.length ? asked : ["DEFAULTS"];
    };
    expect(resolve_("")).toEqual(["DEFAULTS"]);
    expect(resolve_(undefined)).toEqual(["DEFAULTS"]);
    expect(resolve_(" , ")).toEqual(["DEFAULTS"]);
    expect(resolve_(" Workable , ashby ")).toEqual(["workable", "ashby"]);
  });
});

describe("the sweep says who it is", () => {
  it("stamps itself as maintenance on every board call", () => {
    // job_board_search_events.caller DEFAULTS to 'web'. An unstamped self-call
    // is not stored as unknown — it is stored as candidate demand, which is
    // worse than the column not existing, and the day cannot be re-attributed.
    expect(sweep).toMatch(/const SWEEP_CALLER = "maintenance"/);
    expect(sweep).toMatch(/"x-rsp-caller": SWEEP_CALLER/);
    expect(sweep).toMatch(/"x-rb-caller": SWEEP_CALLER/);
    expect(sweep).toMatch(/action: "list", \.\.\.body, caller: SWEEP_CALLER/);
  });

  it("has no unstamped list caller", () => {
    // One helper posts `action: "list"`; if a second appears it must carry the
    // stamp too, so assert there is still exactly one.
    expect(sweep.match(/action: "list"/g)?.length).toBe(1);
  });
});

describe("the rolling walk covers the universe instead of a prefix of it", () => {
  it("does not truncate the discovered list before the cursor sees it", () => {
    // A deterministic sort plus a fixed prefix means the employers past the
    // cut are discovered every week and probed never.
    expect(sweep).not.toMatch(/universe\.slice\(0, TARGET_EMPLOYERS\)/);
  });

  it("steps by a fixed amount, not by this week's discovery yield", () => {
    expect(sweep).toMatch(/const start = \(weekIndex\(\) \* PER_RUN\) % universe\.length/);
    expect(sweep).not.toMatch(/weekIndex\(\) % slices/);
  });

  it("wraps rather than running off the end into an empty run", () => {
    const walk = (week: number, len: number) => {
      const start = (week * 240) % len;
      const take = Math.min(240, len);
      return Array.from({ length: take }, (_, i) => (start + i) % len);
    };
    // Nine consecutive weeks cover a 2,000-employer universe exactly once.
    const seen = new Set<number>();
    for (let w = 0; w < 9; w++) for (const i of walk(w, 2000)) seen.add(i);
    expect(seen.size).toBe(2000);
    // And no week is ever empty, whatever the yield.
    for (const len of [1500, 1900, 2000, 240, 37]) {
      for (let w = 0; w < 12; w++) expect(walk(w, len).length).toBeGreaterThan(0);
    }
  });

  it("the deadline costs every vendor, not the last two on the list", () => {
    // bamboohr and rippling are last in DEFAULT_VENDORS and are the file's own
    // "biggest blank on the map". Vendor-sequential probing sacrificed exactly
    // them every time a run went long.
    expect(sweep).toMatch(/PROBE ORDER IS ROUND-ROBIN ACROSS VENDORS/);
    expect(sweep).not.toMatch(/for \(const vendor of vendors\) \{\n    const tenants = todays\.filter/);
  });
});

describe("a vendor-level all-clear needs a denominator", () => {
  it("will not call a vendor open off a one-page sample", () => {
    // vendorVerdict says `clean` for 0/1, and a rolling window really can hand
    // a vendor a single tenant. 30/30 walled on 2026-08-07 must not be
    // overturned by one apply page that happened to load.
    expect(isOpportunity(vendorVerdict([t("A", [])]).verdict)).toBe(true); // the raw verdict still says so
    expect(sweep).toMatch(/const MIN_REACHED = \d+/);
    expect(sweep).toMatch(/opportunities = findings\.filter\(\(\[, v\]\) => v\.reached >= MIN_REACHED\)/);
  });

  it("reports the small samples rather than hiding them", () => {
    expect(sweep).toMatch(/n too small to judge/);
  });

  it("does not report 'still walled' when it simply could not tell", () => {
    expect(sweep).toMatch(/nothing conclusive, which is not the same as still walled/);
  });
});
