/**
 * THE TRACKER SAID "GENUINELY FILLS ROLES" FROM A COUNT OF CLOSURE EVENTS.
 *
 * The account page's application tracker printed "this company genuinely
 * fills roles (2499)" for Johnson & Johnson from get_company_fill_curve's
 * fills_90d, which counts closure EVENTS: one role that closed twice is two,
 * one serving again today is one. At most 1,799 roles stayed down and 403 came
 * back (register L11-02). The chip now reads the role counts 20261008110000
 * adds, through trackedEmployerChip, and says what the board says.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { trackedEmployerChip } from "@/lib/tracked-employer-chip";

describe("the tracker's employer chip reads roles, not closure events", () => {
  it("quotes the roles that stayed down, never the event count", () => {
    const jnj = { fills_90d: 2499, relists_90d: 5, filled_roles_90d: 1799, relisted_roles_90d: 403 };
    expect(trackedEmployerChip(jnj)).toEqual({ kind: "stayed-down", n: 1799 });
  });

  it("an employer whose fill events are all roles that came back gets the caution, not praise", () => {
    expect(trackedEmployerChip({ filled_roles_90d: 2, relisted_roles_90d: 40 })).toEqual({ kind: "churn", n: 40 });
  });

  it("more roles back than down, under the caution's floor, says nothing", () => {
    expect(trackedEmployerChip({ filled_roles_90d: 3, relisted_roles_90d: 4 })).toBeNull();
  });

  it("a row from a deploy without the role columns says nothing rather than zero", () => {
    expect(trackedEmployerChip({})).toBeNull();
    expect(trackedEmployerChip({ filled_roles_90d: null, relisted_roles_90d: null })).toBeNull();
    expect(trackedEmployerChip(undefined)).toBeNull();
  });

  it("the account page renders through it, with the board's sentence and not the 'genuinely fills' claim", () => {
    const src = readFileSync(resolve(__dirname, "../pages/Account.tsx"), "utf8");
    expect(src).toMatch(/const chip = trackedEmployerChip\(hh\);/);
    expect(src).not.toMatch(/t\("jobsPage\.verdictFills"/);
    expect(src).not.toMatch(/hh\.fills_90d/);
  });
});
