// @vitest-environment node
/**
 * PERF-06 (board .102): job-board answered its CORS preflight with no
 * Access-Control-Max-Age, so a browser asked again before every board call,
 * and each preflight is a billed invocation. Its answer now lets a browser keep
 * the leave for two hours, the value the cost wave gave every other function.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transformSync } from "esbuild";

const RAW = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");

describe("a browser asks the board for leave once per two hours", () => {
  const cors = /^const corsHeaders = \{[\s\S]*?\n\};/m.exec(RAW)?.[0] ?? "";
  const preflight = /^\s*if \(req\.method === "OPTIONS"\) return new Response\(null, \{ headers: \{ \.\.\.corsHeaders, [^\n]*\n/m.exec(RAW)?.[0] ?? "";

  it("the preflight answer carries Access-Control-Max-Age 7200 beside the build stamp", () => {
    expect(cors, "corsHeaders moved").not.toBe("");
    expect(preflight, "the OPTIONS answer moved").not.toBe("");
    const answer = new Function("req", "BUILD_VERSION", `${transformSync(cors, { loader: "ts" }).code}\n${preflight}\nreturn null;`)({ method: "OPTIONS" }, "2026-09-09.102") as Response;
    expect(answer.headers.get("access-control-max-age")).toBe("7200");
    expect(answer.headers.get("x-fn-build")).toBe("job-board.2026-09-09.102");
    expect(answer.headers.get("access-control-allow-headers")).toContain("x-rb-pass");
  });

  it("every JSON answer carries the same headers, so a cached leave covers the call it precedes", () => {
    expect(RAW).toMatch(/new Response\(JSON\.stringify\(lastPage\(body\)\), \{ status, headers: \{ \.\.\.corsHeaders, "Content-Type": "application\/json" \} \}\)/);
  });
});
