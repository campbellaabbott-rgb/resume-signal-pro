// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import ts from "typescript";
import { vendorDefaultHeaders, WORKDAY_ACCEPT_LANGUAGE } from "../../supabase/functions/job-board/request-headers";

/**
 * SOME WORKDAY TENANTS ANSWERED HTTP 500 TO THE LANGUAGE THE RUNTIME SENT.
 *
 * Sweep S8-003 (2026-10-08). Deno's fetch, like Node's, adds
 * `Accept-Language: *` to a request that names no language, and job-board
 * named none. Truist, Geico, 7-Eleven and WVU Medicine answer that with
 * {"errorCode":"HTTP_500"} and answer the same request under en-US with their
 * list (measured from Node on 2026-10-08: truist~wd1~careers 500 -> 200 with
 * total 1,497; geico 321; 7eleven 72; wvumedicine 742; nvidia 200 either way).
 * Page 0 threw, the failure streak grew, and the dormancy prune classed the
 * boards dead and deleted what they held.
 *
 * This runs the SHIPPED fetchWithTimeout (lifted from index.ts and
 * transpiled) against a local stand-in with Truist's behaviour: 500 unless a
 * real language is named. Only the network address is redirected; the URL the
 * function decides headers from is the tenant's own.
 */
const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");

function lifted(name: string): string {
  const at = FN.search(new RegExp(`\\n(?:async )?function ${name}\\(`));
  expect(at, `${name} not found in job-board/index.ts`).toBeGreaterThan(-1);
  const src = FN.slice(at + 1, FN.indexOf("\n}\n", at) + 2);
  return ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
}
const constOf = (name: string): number => Number(new RegExp(`\\nconst ${name} = ([0-9_]+);`).exec(FN)![1].replace(/_/g, ""));

let server: Server;
let origin = "";
const seen: Array<string | undefined> = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const lang = req.headers["accept-language"];
    seen.push(lang);
    const refused = lang === undefined || lang.trim() === "*";
    res.writeHead(refused ? 500 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify(refused ? { errorCode: "HTTP_500" } : { total: 1497, jobPostings: [{ title: "Teller", externalPath: "/job/x_R1" }] }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

/** The shipped fetchWithTimeout, sending every request to the stand-in. */
function shippedFetch(): (url: string, init?: RequestInit) => Promise<Response> {
  const names: Record<string, unknown> = {
    fetch: (url: string, init?: RequestInit) => globalThis.fetch(url.replace(/^https:\/\/[^/]+/, origin), init),
    FETCH_TIMEOUT_MS: constOf("FETCH_TIMEOUT_MS"),
    MAX_RESPONSE_BYTES: constOf("MAX_RESPONSE_BYTES"),
    OVERSIZE_MARKER: "OVERSIZE_BODY",
    BODY_LATE_MARKER: /\nconst BODY_LATE_MARKER = "([^"]+)";/.exec(FN)?.[1] ?? "",
    vendorDefaultHeaders,
  };
  // Whatever helpers fetchWithTimeout calls today are lifted with it.
  const src = ["discardBody", "boundBody", "bodyDeadline", "fetchWithTimeout"]
    .filter((n) => new RegExp(`\\n(?:async )?function ${n}\\(`).test(FN))
    .map(lifted)
    .join("\n");
  const keys = Object.keys(names);
  return new Function(...keys, `${src}\nreturn fetchWithTimeout;`)(...keys.map((k) => names[k]));
}

const LIST_INIT = {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify({ limit: 20, offset: 0, searchText: "", appliedFacets: {} }),
};

describe("a Workday list request names a language", () => {
  it("Truist's list answers 200 with its postings, not the 500 the runtime's '*' drew", async () => {
    const res = await shippedFetch()("https://truist.wd1.myworkdayjobs.com/wday/cxs/truist/careers/jobs", LIST_INIT);
    expect(res.status, `the tenant saw Accept-Language ${JSON.stringify(seen.at(-1))}`).toBe(200);
    expect(((await res.json()) as { total: number }).total).toBe(1497);
    expect(seen.at(-1)).toBe(WORKDAY_ACCEPT_LANGUAGE);
  });

  it("the posting-detail GET on the same host names it too", async () => {
    const res = await shippedFetch()("https://truist.wd1.myworkdayjobs.com/wday/cxs/truist/careers/job/Charlotte/Teller_R1");
    expect(res.status).toBe(200);
    await res.body?.cancel();
  });

  it("a caller that names its own language keeps it", async () => {
    const res = await shippedFetch()("https://truist.wd1.myworkdayjobs.com/wday/cxs/truist/careers/jobs", {
      ...LIST_INIT,
      headers: { ...LIST_INIT.headers, "Accept-Language": "fr-FR" },
    });
    await res.body?.cancel();
    expect(seen.at(-1)).toBe("fr-FR");
  });

  it("other vendors are left to the runtime default, which may change a feed's language", async () => {
    // The stand-in refuses the default, which is the point: only Workday's host is given a language.
    const res = await shippedFetch()("https://api.greenhouse.io/v1/boards/acme/jobs");
    await res.body?.cancel();
    expect(seen.at(-1) ?? "*").toBe("*");
    expect(vendorDefaultHeaders("https://acme.teamtailor.com/jobs.rss")).toEqual({});
    expect(vendorDefaultHeaders("https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/Ext/jobs")).toEqual({ "Accept-Language": WORKDAY_ACCEPT_LANGUAGE });
    expect(vendorDefaultHeaders("not a url")).toEqual({});
  });
});
