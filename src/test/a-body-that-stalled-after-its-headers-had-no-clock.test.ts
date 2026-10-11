// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import ts from "typescript";
import { codeOf } from "./helpers/strip-comments";
import * as requestHeaders from "../../supabase/functions/job-board/request-headers";

/**
 * A BODY THAT STALLED AFTER ITS HEADERS HAD NO CLOCK.
 *
 * Sweep S8-030 (2026-10-08). fetchWithTimeout cleared its abort timer the
 * moment response headers arrived; the body was then read with no limit. A
 * scratch repro (FETCH_TIMEOUT_MS 1,000, a server sending one byte every
 * 500 ms) had headers at 19 ms and the body finished at 8,560 ms, with nothing
 * aborting. In a slice, one such vendor holds a worker, Promise.all never
 * settles, and the isolate is killed before the post-loop writes
 * (refresh_progress, board_failures, the deep cursor and its laps).
 *
 * This runs the SHIPPED fetchWithTimeout and readChunkPage (lifted from
 * index.ts and transpiled; whatever helpers they call today are lifted with
 * them) against a local server, with FETCH_TIMEOUT_MS set to 400 ms.
 */
const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const CODE = codeOf(FN);
const has = (name: string) => new RegExp(`\\n(?:async )?function ${name}\\(`).test(FN);
function lifted(name: string): string {
  const at = FN.search(new RegExp(`\\n(?:async )?function ${name}\\(`));
  expect(at, `${name} not found in job-board/index.ts`).toBeGreaterThan(-1);
  const src = FN.slice(at + 1, FN.indexOf("\n}\n", at) + 2);
  return ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
}
const strConst = (name: string) => new RegExp(`\\nconst ${name} = "([^"]+)";`).exec(FN)?.[1] ?? "";
/** fetchBoard's own reading of a failure message as "timeout". */
const TIMEOUT_RE = (() => {
  const m = /: \/(abort\|timed\? \?out\|deadline)\/i\.test\(raw\)/.exec(CODE);
  expect(m, "fetchBoard's timeout classifier moved; re-point this test").not.toBeNull();
  return new RegExp(m![1], "i");
})();

const T = 400;
let server: Server;
let origin = "";
beforeAll(async () => {
  server = createServer((req, res) => {
    const path = req.url ?? "/";
    res.writeHead(200, { "content-type": "application/json" });
    if (path.startsWith("/stall")) {
      // Headers now, then one byte every 200 ms for ~6 s.
      const body = JSON.stringify({ jobs: [] }) + " ".repeat(20);
      let i = 0;
      const tick = setInterval(() => {
        if (res.destroyed) { clearInterval(tick); return; }
        res.write(body[i++]);
        if (i >= body.length) { clearInterval(tick); res.end(); }
      }, 200);
      req.on("close", () => clearInterval(tick));
      return;
    }
    if (path.startsWith("/slow-headers")) {
      // The body clock starts at the headers: a slow header then a quick body is a normal read.
      return void setTimeout(() => res.end(JSON.stringify({ ok: "slow headers" })), T * 0.6);
    }
    res.end(JSON.stringify({ ok: "quick" }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => { server.closeAllConnections?.(); server.close(() => r()); }));

type Shipped = {
  fetchWithTimeout: (url: string, init?: RequestInit) => Promise<Response>;
  readChunkPage: (res: Response) => Promise<{ body: unknown; over: boolean; late?: Error }>;
};
function shipped(): Shipped {
  const names: Record<string, unknown> = {
    fetch: (url: string, init?: RequestInit) => globalThis.fetch(url.replace(/^https:\/\/[^/]+/, origin), init),
    FETCH_TIMEOUT_MS: T,
    MAX_RESPONSE_BYTES: 4_000_000,
    OVERSIZE_MARKER: strConst("OVERSIZE_MARKER"),
    BODY_LATE_MARKER: strConst("BODY_LATE_MARKER"),
    ...requestHeaders,
  };
  const fns = ["discardBody", "boundBody", "bodyDeadline", "fetchWithTimeout", "readChunkPage"].filter(has);
  const src = fns.map(lifted).join("\n");
  const consts = ["isOversize", "isLate"]
    .map((n) => new RegExp(`\\nconst ${n} = [^\\n]+;`).exec(FN)?.[0] ?? "")
    .map((s) => ts.transpileModule(s, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)
    .join("\n");
  const keys = Object.keys(names);
  return new Function(...keys, `${consts}\n${src}\nreturn { fetchWithTimeout, readChunkPage };`)(...keys.map((k) => names[k]));
}

describe("a vendor body has a clock of its own", () => {
  it("a body that stalls after its headers is cut off near its clock, as a timeout, not read for six seconds", async () => {
    const { fetchWithTimeout } = shipped();
    const t0 = Date.now();
    const res = await fetchWithTimeout("https://slow.vendor.test/stall");
    let err: unknown = null;
    try { await res.text(); } catch (e) { err = e; }
    const ms = Date.now() - t0;
    expect(err, `the stalled body was read to the end after ${ms} ms`).not.toBeNull();
    expect(ms, "the read must end near the body's clock").toBeLessThan(T * 5);
    expect(String((err as Error)?.message ?? err), "fetchBoard must read the failure as a timeout").toMatch(TIMEOUT_RE);
  }, 15_000);

  it("a chunked vendor's first page that stalls is a timeout the walk can throw; a later one ends the walk", async () => {
    const { fetchWithTimeout, readChunkPage } = shipped();
    const page = await readChunkPage(await fetchWithTimeout("https://slow.vendor.test/stall"));
    expect(page.body).toBeUndefined();
    expect(page.over, "a late body is not an oversize deferral").toBe(false);
    expect(page.late, "the caller cannot tell a late body from an unreadable one").toBeInstanceOf(Error);
    expect(String(page.late?.message)).toMatch(TIMEOUT_RE);
  }, 15_000);

  it("a quick body, and a quick body behind slow headers, read normally", async () => {
    const { fetchWithTimeout } = shipped();
    expect(await (await fetchWithTimeout("https://fast.vendor.test/quick")).json()).toEqual({ ok: "quick" });
    expect(await (await fetchWithTimeout("https://fast.vendor.test/slow-headers")).json()).toEqual({ ok: "slow headers" });
  });

  it("every chunked fetcher throws a late first page and keeps the window on a later one", () => {
    const sites = [...CODE.matchAll(/const \{ body, over(, late)? \} = await readChunkPage\(([^)]*)\);\n\s*([^\n]*)/g)];
    expect(sites.length, "the chunked fetchers moved; re-point this test").toBeGreaterThanOrEqual(6);
    for (const s of sites) {
      expect(s[1], `readChunkPage(${s[2]}) drops the late flag`).toBe(", late");
      expect(s[3]).toMatch(/^if \(late && (all\.length === 0|first)\) throw late;$/);
    }
  });
});
