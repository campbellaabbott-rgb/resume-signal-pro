/**
 * THE ROUTE SAYS WHAT A PERSON MEETS (connect W4, APPLY-1107-05).
 *
 * apply_myself's route came from the vendor table that also drives the
 * retired sendable list, and it was wrong for a person in three ways,
 * measured with plain GETs on 2026-11-07:
 *   - iCIMS (?mode=apply) lands on a candidate login before the form on 4 of
 *     4 tenants; the route said no account;
 *   - UKG redirects to a sign-in before the form; it was unmeasured (null);
 *   - Paylocity's Apply page loads with no login and no CAPTCHA script on 6
 *     of 6 postings; it was unmeasured (null);
 * and Greenhouse's CAPTCHA is invisible scoring, so "Expect a CAPTCHA, which
 * you solve" told the person to expect a puzzle they never see.
 *
 * selfApplyRoute (_shared/self-apply.ts) carries those measurements and
 * reads the table for the rest; the connector and /v1 both answer from it.
 * The vendor table itself is unchanged: job-board and the website read it.
 */
import { describe, expect, it } from "vitest";
import { selfApplyRoute } from "../../supabase/functions/_shared/self-apply";
import { automationFor } from "../../supabase/functions/_shared/apply-automation";
import { applyMyselfAnswer, applyMyselfMarkdown, routeFor, routeSentence } from "../../supabase/functions/agent-mcp/apply-myself";
import { routeFor as v1RouteFor } from "../../supabase/functions/public-api/application";

const posting = (id: string) => ({ id, title: "Analyst", company: "Acme", location: null, pay: null, postedAt: null, applyUrl: "https://example.test/apply", siteUrl: `https://resumebooster.work/jobs?job=${id}` });

describe("the measured systems", () => {
  it("iCIMS asks for an employer account before the form, and shows a CAPTCHA", () => {
    expect(selfApplyRoute("icims")).toEqual({ submitter: "you", needsEmployerAccount: true, captchaLikely: true, captcha: "visible", attachFilesYourself: true });
  });

  it("UKG asks for an account before the form; whether a CAPTCHA follows is not claimed", () => {
    expect(selfApplyRoute("ukg")).toEqual({ submitter: "you", needsEmployerAccount: true, captchaLikely: null, captcha: null, attachFilesYourself: true });
  });

  it("Paylocity asks for neither", () => {
    expect(selfApplyRoute("paylocity")).toEqual({ submitter: "you", needsEmployerAccount: false, captchaLikely: false, captcha: "none", attachFilesYourself: true });
  });

  it("Greenhouse's check is invisible: likely, but no puzzle", () => {
    expect(selfApplyRoute("greenhouse")).toMatchObject({ needsEmployerAccount: false, captchaLikely: true, captcha: "invisible" });
  });

  it("the rest read the table: a click tier is a visible CAPTCHA, an account note is an account, an unmeasured system is null", () => {
    expect(selfApplyRoute("lever")).toMatchObject({ needsEmployerAccount: false, captcha: "visible", captchaLikely: true });
    expect(selfApplyRoute("bamboohr")).toMatchObject({ captcha: "visible" });
    expect(selfApplyRoute("workable")).toMatchObject({ captcha: "visible" });
    expect(selfApplyRoute("workday")).toMatchObject({ needsEmployerAccount: true, captcha: "none", captchaLikely: false });
    expect(selfApplyRoute("teamtailor")).toMatchObject({ needsEmployerAccount: false, captcha: "none" });
    expect(selfApplyRoute("taleo")).toMatchObject({ needsEmployerAccount: null, captcha: null, captchaLikely: null });
    expect(selfApplyRoute("constructor")).toMatchObject({ needsEmployerAccount: null, captcha: null });
  });

  it("the vendor table the board and the website read is not what changed", () => {
    expect(automationFor("icims").note).not.toMatch(/account/i);
    expect(automationFor("ukg").tier).toBe("unknown");
    expect(automationFor("paylocity").tier).toBe("unknown");
  });

  it("the connector and /v1 answer the same route for every system", () => {
    for (const v of ["greenhouse", "ashby", "lever", "workday", "bamboohr", "recruitee", "breezy", "pinpoint", "icims", "ukg", "paylocity", "workable", "teamtailor", "taleo"]) {
      expect(routeFor(v), v).toEqual(selfApplyRoute(v));
      expect(v1RouteFor(v), v).toEqual(selfApplyRoute(v));
    }
  });
});

describe("the packet says it in words", () => {
  it("Greenhouse: an invisible check, never a puzzle to solve", () => {
    const s = routeSentence(selfApplyRoute("greenhouse"));
    expect(s).toMatch(/invisible check; you won't see a puzzle/);
    expect(s).not.toMatch(/which you solve/);
  });

  it("iCIMS: an account first, then a CAPTCHA", () => {
    const md = applyMyselfMarkdown(applyMyselfAnswer(posting("icims:acme:1"), { kind: "no-reader", vendor: "icims" }, []));
    expect(md).toMatch(/sign in or make an account with the employer before the form/);
    expect(md).toMatch(/Expect a CAPTCHA, which you solve\./);
  });

  it("UKG: an account first, and the CAPTCHA said to be unmeasured", () => {
    const s = routeSentence(selfApplyRoute("ukg"));
    expect(s).toMatch(/sign in or make an account/);
    expect(s).toMatch(/We have not measured whether it shows a CAPTCHA\./);
  });

  it("Paylocity: neither", () => {
    const s = routeSentence(selfApplyRoute("paylocity"));
    expect(s).not.toMatch(/account|CAPTCHA|check/);
  });
});
