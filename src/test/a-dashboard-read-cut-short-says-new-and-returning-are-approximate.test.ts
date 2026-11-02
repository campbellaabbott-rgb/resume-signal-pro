// @vitest-environment node
/**
 * A DASHBOARD READ CUT SHORT SAYS NEW AND RETURNING ARE APPROXIMATE (the
 * audit-rest fixer's review of S13-070).
 *
 * WHAT WAS WRONG. get-analytics reads newest first and may stop at its time
 * budget; the dashboard then said only the days before coveredFrom were a
 * floor. But a visitor is "new" on the earliest day seen in the rows READ: a
 * visitor who first came on day 3 and returned on day 20 of a read that
 * stopped at day 10 was counted new on day 20, a day the note presented as
 * complete, and returning visitors were undercounted.
 *
 * WHAT HOLDS NOW: the rollup says so (visitorSplitApproximate) whenever the
 * read stopped early, never otherwise, and the dashboard's note says new and
 * returning are approximate on every day, the read ones too.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRollup } from "../../supabase/functions/get-analytics/rollup";

const ev = (day: string, visitor: string) => ({ test_name: "product_conversion", variant: "a", event_type: "view", created_at: `${day}T12:00:00Z`, visitor_id: visitor });

describe("the rollup", () => {
  it("a read that stopped before a returning visitor's first day counts them new on a read day, and says the split is approximate", () => {
    // Newest first, stopped before 2026-10-03: the day-3 visit is never read.
    const r = createRollup();
    r.add(ev("2026-10-20", "v1"));
    r.add(ev("2026-10-11", "v2"));
    const a = r.audience(true, "2026-10-10T00:00:00Z");
    expect(a.daily.find((d) => d.day === "2026-10-20")!.newVisitors).toBe(1);
    expect(a.returningVisitors).toBe(0);
    expect(a.visitorSplitApproximate).toBe(true);
  });

  it("a whole read is not marked approximate", () => {
    const r = createRollup();
    r.add(ev("2026-10-20", "v1"));
    r.add(ev("2026-10-03", "v1"));
    const a = r.audience(false, null);
    expect(a.returningVisitors).toBe(1);
    expect(a.visitorSplitApproximate).toBe(false);
  });
});

describe("the dashboard's note", () => {
  it("says new and returning are approximate on every day when the read was cut short", () => {
    const page = readFileSync(resolve(__dirname, "../pages/AnalyticsDashboard.tsx"), "utf8");
    const note = page.slice(page.indexOf("{data.audience.truncated && ("), page.indexOf("{data.audience.truncated && (") + 900);
    expect(note).toMatch(/New and returning visitors are approximate on every day, the fully read ones too/);
  });
});
