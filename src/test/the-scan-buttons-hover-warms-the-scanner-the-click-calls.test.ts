// @vitest-environment jsdom
/**
 * THE SCAN BUTTON'S HOVER WARMS THE SCANNER THE CLICK CALLS (cost audit
 * 2026-11-08, Do first #13).
 *
 * The hover (ResumeUploader's onMouseEnter / onFocus) asked warm-up to warm
 * free-keyword-scan-stream, the fork the page asks only after
 * free-keyword-scan has failed, so the warm isolate was never the one the
 * click reached. And the hook never recorded that it had warmed anything (its
 * guard reads a résumé hash only the switched-off background scan writes), so
 * every hover after the last one finished posted again.
 *
 * Run, not read: the shipped hook with fetch faked and the clock pinned.
 *   - the hover posts one warm-up naming free-keyword-scan;
 *   - warm-up warms that name alone today (it is in its list; a name outside
 *     the list makes warm-up warm every function it knows);
 *   - more hovers inside two minutes post nothing, and the validation the
 *     hover exists for still runs each time;
 *   - after two minutes the next hover warms again.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-streaming-scan", () => ({ clearAllClientScanCaches: () => {} }));

import { SCAN_WARM_TTL_MS, useScanPrefetch } from "@/hooks/use-scan-prefetch";

const RESUME = [
  "Jane Doe | jane.doe@example.com | (555) 010-0199",
  "EXPERIENCE",
  "Senior Financial Analyst, Acme Corp, Jan 2020 - Present",
  "- Cut vendor spend by $250,000 annually by renegotiating contracts",
  "EDUCATION",
  "BSc Economics, State University, 2015",
  "SKILLS",
  "Excel, SQL, Tableau, financial modeling, budgeting",
].join("\n");

let posts: Array<{ url: string; body: Record<string, unknown> }>;

beforeEach(() => {
  posts = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    posts.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response(JSON.stringify({ success: true, mode: "targeted" }), { status: 200 });
  }));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-09T10:00:00Z") });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function hover(result: { current: ReturnType<typeof useScanPrefetch> }) {
  await act(async () => { await result.current.prefetch(); });
}

describe("the scan button's hover", () => {
  it("posts one warm-up, and it names free-keyword-scan, the function the click calls first", async () => {
    const { result } = renderHook(() => useScanPrefetch({ resumeText: RESUME }));
    await hover(result);
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toMatch(/\/functions\/v1\/warm-up$/);
    expect(posts[0].body).toEqual({ target: "free-keyword-scan" });
    expect(result.current.isWarmedUp).toBe(true);
  });

  it("names a function warm-up warms alone, so the hover never sets off a warm-up of every function", async () => {
    const { result } = renderHook(() => useScanPrefetch({ resumeText: RESUME }));
    await hover(result);
    const src = readFileSync(resolve(process.cwd(), "supabase/functions/warm-up/index.ts"), "utf8");
    const list = src.match(/const FUNCTIONS_TO_WARM = \[([\s\S]*?)\];/);
    expect(list, "warm-up's list moved").not.toBeNull();
    const names = [...list![1].matchAll(/^\s*'([a-z0-9-]+)',/gm)].map((m) => m[1]);
    expect(names.length, "warm-up's list read empty").toBeGreaterThan(5);
    expect(names).toContain(posts[0].body.target);
  });

  it("posts nothing more for two minutes, while every hover still validates the résumé", async () => {
    const validated: unknown[] = [];
    const { result } = renderHook(() => useScanPrefetch({ resumeText: RESUME, onValidationComplete: (v) => validated.push(v) }));
    await hover(result);
    vi.setSystemTime(Date.now() + 30_000);
    await hover(result);
    vi.setSystemTime(Date.now() + SCAN_WARM_TTL_MS - 31_000);
    await hover(result);
    expect(posts, "a hover inside the two minutes posted another warm-up").toHaveLength(1);
    expect(validated).toHaveLength(3);
    expect(result.current.validationResult).not.toBeNull();
  });

  it("warms again once two minutes have passed", async () => {
    const { result } = renderHook(() => useScanPrefetch({ resumeText: RESUME }));
    await hover(result);
    vi.setSystemTime(Date.now() + SCAN_WARM_TTL_MS);
    await hover(result);
    expect(posts).toHaveLength(2);
    expect(posts.every((p) => p.body.target === "free-keyword-scan")).toBe(true);
  });

  it("a failed warm-up costs the hover nothing: it still validates and says it is done", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const { result } = renderHook(() => useScanPrefetch({ resumeText: RESUME }));
    await hover(result);
    expect(result.current.isWarmedUp).toBe(true);
    expect(result.current.isWarming).toBe(false);
    expect(result.current.validationResult).not.toBeNull();
  });
});
