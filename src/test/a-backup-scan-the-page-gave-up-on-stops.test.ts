// @vitest-environment node
/**
 * A BACKUP SCAN THE PAGE GAVE UP ON STOPS (bug round S14X-144, M-S14-119;
 * with S14X-118, M-S14-091: the backup scan hears what the reader confirmed).
 *
 * The page falls back to free-keyword-scan-stream when the primary fails, on
 * a clock of its own. The fork scanned on regardless of the page: past the
 * page's deadline, or after the visitor left, it still called the model,
 * mailed the owner, counted the scan, logged it completed and cached it,
 * and the day's scan it had counted stayed spent.
 *
 * Now the page's deadline (body.deadlineAt) is read first: too close, and the
 * fork refuses before anything is counted. The request's abort and the
 * stream's cancel stop the model calls, a gone run has no completion side
 * effects, and the day goes back. The fork also takes the reader's confirmed
 * industry as the primary does, and says it wrote no posting comparison.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EdgeHandler } from "./helpers/edge-harness";
import { gatewayHanging, loadScanners, metricStatuses, modelCalls, resetWorld, RESUME, rpcNames, scanStream, world } from "./helpers/free-scan-world";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 240_000 });

let stream: EdgeHandler;
const spies: Array<ReturnType<typeof vi.spyOn>> = [];
beforeAll(async () => { ({ stream } = await loadScanners(["stream"])); }, 240_000);
beforeEach(() => {
  resetWorld();
  for (const m of ["log", "warn", "error", "info"] as const) spies.push(vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => { while (spies.length) spies.pop()!.mockRestore(); });

const ownerNotes = () => world.fetched.filter((f) => f.url.includes("/functions/v1/notify-owner")).length;

describe("S14X-144: the page's deadline and its leaving stop the backup scan", () => {
  it("control: a scan the page waits for completes, is counted, and keeps its day", async () => {
    const r = await scanStream(stream, { resumeText: RESUME, deadlineAt: Date.now() + 60_000 });
    expect(r.complete?.success).toBe(true);
    expect(rpcNames(world.streamDb)).toContain("increment_free_scan_count");
    expect(metricStatuses(world.streamDb)).toContain("completed");
    expect(world.streamDb.rpcArgs("give_back_scan_day")).toEqual([]);
  });

  it("a deadline already past is refused before the day or the hour is counted, and no model is called", async () => {
    const r = await scanStream(stream, { resumeText: RESUME, deadlineAt: Date.now() - 1_000 });
    expect(r.error?.code).toBe("deadline_passed");
    expect(rpcNames(world.streamDb)).not.toContain("check_rate_limit");
    expect(modelCalls()).toBe(0);
  });

  it("a page that leaves mid-scan gets no owner note, no count, no completed row, and its day back", async () => {
    const page = new AbortController();
    world.gateway = gatewayHanging(() => setTimeout(() => page.abort(), 5));
    await scanStream(stream, { resumeText: RESUME, deadlineAt: Date.now() + 60_000 }, { signal: page.signal });
    expect(ownerNotes()).toBe(0);
    expect(rpcNames(world.streamDb)).not.toContain("increment_free_scan_count");
    expect(rpcNames(world.streamDb)).not.toContain("store_cached_response");
    expect(metricStatuses(world.streamDb)).not.toContain("completed");
    expect(world.streamDb.rpcArgs("give_back_scan_day")).toEqual([{ p_ip: "198.51.100.77", p_function: "free-keyword-scan" }]);
  });
});

describe("S14X-118: the backup scan hears what the reader confirmed", () => {
  const POSTING = [
    "Clinical Nurse Manager, Riverside Health. We are hiring a nurse manager to lead a 30-bed medical-surgical unit.",
    "Requirements: active RN licence, five years of acute care, two years of charge or supervisory experience,",
    "staffing and scheduling, quality improvement, patient safety programs, budget ownership, Epic EHR.",
  ].join(" ");

  it("a confirmed industry is the industry the report is written for", async () => {
    const r = await scanStream(stream, { resumeText: RESUME, userContext: { confirmedIndustry: "healthcare" } });
    expect(r.complete?.industry).toBe("healthcare");
  });

  it("an industry the scanner does not know is ignored", async () => {
    const r = await scanStream(stream, { resumeText: RESUME, userContext: { confirmedIndustry: "zz-not-an-industry" } });
    expect(r.complete?.industry).not.toBe("zz-not-an-industry");
  });

  it("with a posting sent, it says it wrote no posting comparison; without one, it says nothing", async () => {
    const withPosting = await scanStream(stream, { resumeText: RESUME, jobDescriptionText: POSTING });
    expect(withPosting.complete?.postingComparison).toBe("not_available");
    resetWorld();
    const without = await scanStream(stream, { resumeText: RESUME });
    expect(without.complete?.postingComparison).toBeUndefined();
  });
});
