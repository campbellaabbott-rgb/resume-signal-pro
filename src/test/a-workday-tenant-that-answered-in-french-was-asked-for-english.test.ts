// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import ts from "typescript";
import * as requestHeaders from "../../supabase/functions/job-board/request-headers";

/**
 * A WORKDAY TENANT THAT ANSWERED IN FRENCH WAS ASKED FOR ENGLISH.
 *
 * Review of S8-003 (2026-10-10). The first fix sent `Accept-Language: en-US`
 * to every *.myworkdayjobs.com tenant, not only to the ones that refuse the
 * runtime's `*` with HTTP 500. Read from their public CXS lists that day,
 * first 20 postings, `*` against en-US: desjardins~wd10~desjardins changed
 * 20/20 titles ('Conseiller ou conseillère, Gouvernance de l'IA' -> 'Senior
 * Advisor, Data governance'), cbcrc~wd3~CBC_Radio-Canada_Jobs 10/20,
 * cdpq~wd10~CDPQ every externalPath (apply_url is built from it). What the
 * board stores was read under `*`, so the first visit would have rewritten
 * those rows and logged each rewrite as an employer edit.
 *
 * This runs the SHIPPED fetchWithTimeout (lifted from index.ts, with whatever
 * request-headers.ts exports) against stand-in tenants. Only the network
 * address is redirected; the host the language is decided from is the
 * tenant's own.
 */
const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");

function lifted(name: string): string {
  const at = FN.search(new RegExp(`\\n(?:async )?function ${name}\\(`));
  expect(at, `${name} not found in job-board/index.ts`).toBeGreaterThan(-1);
  const src = FN.slice(at + 1, FN.indexOf("\n}\n", at) + 2);
  return ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
}
const constOf = (name: string): number => Number(new RegExp(`\\nconst ${name} = ([0-9_]+);`).exec(FN)![1].replace(/_/g, ""));

type Tenant = (lang: string, nth: number) => { status: number; title?: string };
const FRENCH = "Conseiller ou conseillère, Gouvernance de l’IA";
const ENGLISH = "Senior Advisor, Data governance";
const bilingual: Tenant = (lang) => ({ status: 200, title: lang.startsWith("en") ? ENGLISH : FRENCH });
const englishOnly: Tenant = (lang) => (lang.startsWith("en") ? { status: 200, title: "Teller" } : { status: 500 });
// Answers its default, then one passing 500, then its default again.
const flaky: Tenant = (lang, nth) => (nth === 2 ? { status: 500 } : bilingual(lang, nth));
const TENANTS: Record<string, Tenant> = {
  "desjardins.wd10.myworkdayjobs.com": bilingual,
  "cbcrc.wd3.myworkdayjobs.com": bilingual,
  "truist.wd1.myworkdayjobs.com": englishOnly,
  "geico.wd1.myworkdayjobs.com": englishOnly,
  "cdpq.wd10.myworkdayjobs.com": flaky,
};

let server: Server;
let origin = "";
const seen = new Map<string, string[]>();
const asked = (host: string) => seen.get(host) ?? [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const [, host] = /^\/([^/]+)/.exec(req.url ?? "/") ?? [];
    const lang = String(req.headers["accept-language"] ?? "*");
    const log = seen.get(host) ?? [];
    log.push(lang);
    seen.set(host, log);
    const answer = (TENANTS[host] ?? bilingual)(lang, log.length);
    res.writeHead(answer.status, { "content-type": "application/json" });
    res.end(JSON.stringify(answer.status === 200 ? { total: 1, jobPostings: [{ title: answer.title, externalPath: "/job/x_R1" }] } : { errorCode: "HTTP_500" }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

/** The shipped fetchWithTimeout, sending every request to the stand-in with the tenant's host in the path. */
function shippedFetch(): (url: string, init?: RequestInit) => Promise<Response> {
  const names: Record<string, unknown> = {
    ...requestHeaders,
    fetch: (url: string, init?: RequestInit) => globalThis.fetch(url.replace(/^https:\/\/([^/]+)/, `${origin}/$1`), init),
    FETCH_TIMEOUT_MS: constOf("FETCH_TIMEOUT_MS"),
    MAX_RESPONSE_BYTES: constOf("MAX_RESPONSE_BYTES"),
    OVERSIZE_MARKER: "OVERSIZE_BODY",
    BODY_LATE_MARKER: /\nconst BODY_LATE_MARKER = "([^"]+)";/.exec(FN)?.[1] ?? "",
  };
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
const list = (tenant: string, site: string) => `https://${tenant}/wday/cxs/${tenant.split(".")[0]}/${site}/jobs`;
const title = async (res: Response) => ((await res.json()) as { jobPostings: Array<{ title: string }> }).jobPostings[0].title;

describe("a Workday tenant is read in the language it answers by default", () => {
  it("Desjardins' list comes back in the French the board stored, asked once, never in English", async () => {
    const res = await shippedFetch()(list("desjardins.wd10.myworkdayjobs.com", "desjardins"), LIST_INIT);
    expect(res.status).toBe(200);
    expect(await title(res), `the tenant was asked ${JSON.stringify(asked("desjardins.wd10.myworkdayjobs.com"))}`).toBe(FRENCH);
    expect(asked("desjardins.wd10.myworkdayjobs.com")).toEqual(["*"]);
  });

  it("a bilingual tenant's posting detail is not switched to English either", async () => {
    const res = await shippedFetch()("https://cbcrc.wd3.myworkdayjobs.com/wday/cxs/cbcrc/CBC_Radio-Canada_Jobs/job/Montreal/Mediathecaire_R1");
    expect(await title(res)).toBe(FRENCH);
    expect(asked("cbcrc.wd3.myworkdayjobs.com")).toEqual(["*"]);
  });

  it("an English-only tenant that refuses the default is asked in English, and the rest of its site goes straight there", async () => {
    const fetch = shippedFetch();
    const first = await fetch(list("truist.wd1.myworkdayjobs.com", "careers"), LIST_INIT);
    expect(first.status, "the 500 the runtime's '*' drew was not retried").toBe(200);
    expect(await title(first)).toBe("Teller");
    expect(asked("truist.wd1.myworkdayjobs.com")).toEqual(["*", requestHeaders.WORKDAY_ACCEPT_LANGUAGE]);
    const detail = await fetch("https://truist.wd1.myworkdayjobs.com/wday/cxs/truist/careers/job/Charlotte/Teller_R1");
    expect(detail.status).toBe(200);
    await detail.body?.cancel();
    expect(asked("truist.wd1.myworkdayjobs.com").slice(2), "the site's refusal was paid again").toEqual([requestHeaders.WORKDAY_ACCEPT_LANGUAGE]);
  });

  it("a tenant seen answering the default is not re-read in English after one passing 500", async () => {
    const fetch = shippedFetch();
    const ok = await fetch(list("cdpq.wd10.myworkdayjobs.com", "CDPQ"), LIST_INIT);
    expect(await title(ok)).toBe(FRENCH);
    const blip = await fetch(list("cdpq.wd10.myworkdayjobs.com", "CDPQ"), LIST_INIT);
    expect(blip.status).toBe(500);
    await blip.body?.cancel();
    expect(asked("cdpq.wd10.myworkdayjobs.com")).toEqual(["*", "*"]);
  });

  it("a caller that names its own language keeps it, and another vendor is left to the runtime", async () => {
    const fetch = shippedFetch();
    const own = await fetch(list("geico.wd1.myworkdayjobs.com", "External"), {
      ...LIST_INIT, headers: { ...LIST_INIT.headers, "Accept-Language": "fr-FR" },
    });
    await own.body?.cancel();
    expect(asked("geico.wd1.myworkdayjobs.com")).toEqual(["fr-FR"]);
    const other = await fetch("https://boards-api.greenhouse.io/v1/boards/acme/jobs");
    await other.body?.cancel();
    expect(asked("boards-api.greenhouse.io")).toEqual(["*"]);
  });
});
