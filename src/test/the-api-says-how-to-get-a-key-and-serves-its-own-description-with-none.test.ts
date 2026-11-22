// @vitest-environment node
/**
 * WITH NO KEY, /v1/openapi.json ANSWERS THE API'S OWN DESCRIPTION, A PATH THAT
 * DOES NOT EXIST ANSWERS 404, AND THE 401 SAYS IN ONE STEP WHERE A FREE KEY
 * COMES FROM (lane fix/1121-connector-errors, item 7).
 *
 * Before: every path but the root answered 401 missing_key with no key,
 * /v1/openapi.json included; a keyed call to an unknown path was metered and
 * then answered 404; x-api-key, which the connector accepts and its own
 * refusals advise, was missing_key and CORS did not allow it; the 401 had no
 * WWW-Authenticate and said only where to request a key; HEAD was 405; and
 * /v1/companies/ was 404. The shipped handler, its database faked.
 */
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ALLOWED, RecordingDb, loadPublicApi, useDb } from "./helpers/public-api-harness";
import { routeOf } from "../../supabase/functions/public-api/endpoint";
import { OPENAPI_PATH } from "../../supabase/functions/public-api/openapi";
import type { EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const BASE = "https://harness.supabase.co/functions/v1/public-api";
const KEY = "rb_live_harness_key_0123456789";
const PUBLISHABLE = "sb_publishable_abc123";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

let handler: EdgeHandler;
beforeAll(async () => {
  ({ handler } = await loadPublicApi(() => new Response("{}", { status: 500 })));
}, 120_000);

type Answer = { status: number; headers: Headers; text: string; body: Record<string, unknown>; db: RecordingDb };
async function call(path: string, headers: Record<string, string> = {}, method = "GET", decision: Record<string, unknown> = ALLOWED): Promise<Answer> {
  const db = new RecordingDb();
  db.rpcs.api_key_check = () => ({ data: decision, error: null });
  useDb(db);
  const res = await handler(new Request(`${BASE}${path}`, { method, headers }));
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(text) as Record<string, unknown>; } catch { /* no body */ }
  return { status: res.status, headers: res.headers, text, body, db };
}
const keyChecks = (a: Answer) => a.db.rpcCalls.filter((c) => c.name === "api_key_check");
const code = (a: Answer) => (a.body.error as { code?: string } | undefined)?.code;

describe("the document, with no key", () => {
  it("routeOf names the path openapi.ts serves the document at, and no unknown path", () => {
    expect(routeOf(OPENAPI_PATH)).toBe(OPENAPI_PATH);
    expect(routeOf("/openapi.json")).toBe(OPENAPI_PATH);
    expect(routeOf("/v1/nope")).toBeNull();
    expect(routeOf("/v1/jobs/greenhouse:acme:1")).toBe("/v1/jobs/{id}");
  });
  it.each(["/v1/openapi.json", "/openapi.json"])("GET %s answers 200, OpenAPI 3.1.0 with a /v1/jobs path, and checks no key", async (path) => {
    const r = await call(path);
    expect(r.status).toBe(200);
    expect(r.body.openapi).toBe("3.1.0");
    expect(Object.keys(r.body.paths as Record<string, unknown>)).toContain("/v1/jobs");
    expect(keyChecks(r)).toHaveLength(0);
  });
});

describe("a path that does not exist", () => {
  it("answers 404 no_such_endpoint with no key", async () => {
    const r = await call("/v1/nope");
    expect(r.status).toBe(404);
    expect(code(r)).toBe("no_such_endpoint");
  });
  it("answers 404 with a key too, and the key is never checked (nothing is metered)", async () => {
    const r = await call("/v1/nope", { authorization: `Bearer ${KEY}` });
    expect(r.status).toBe(404);
    expect(keyChecks(r)).toHaveLength(0);
  });
});

describe("the 401 says where a free key comes from, in one step", () => {
  it("GET /v1/jobs with no key: 401, WWW-Authenticate Bearer, getAKey and keylessSample", async () => {
    const r = await call("/v1/jobs");
    expect(r.status).toBe(401);
    expect(code(r)).toBe("missing_key");
    expect(r.headers.get("www-authenticate")).toMatch(/^Bearer realm="resumebooster data API"$/);
    const getAKey = r.body.getAKey as { url: string; step: string; free: Record<string, number>; send: string[] };
    expect(getAKey.url).toBe("https://resumebooster.work/data-api");
    expect(getAKey.step).toMatch(/Enter your email on that page and open the link we mail you: it shows the key once\./);
    expect(getAKey.free).toEqual({ perDay: 1000, perMinute: 60 });
    expect(getAKey.send).toEqual(["Authorization: Bearer <key>", "x-api-key: <key>"]);
    expect(r.body.keylessSample).toMatchObject({ offered: false });
    expect(r.body.openapi).toBe("/v1/openapi.json");
    expect((r.body.error as { message: string }).message).toMatch(/x-api-key/);
  });
  it("an unrecognised key's 401 carries the same block and header", async () => {
    const r = await call("/v1/jobs", { authorization: `Bearer ${KEY}` }, "GET", { ...ALLOWED, is_allowed: false, deny_reason: "unknown_key" });
    expect(r.status).toBe(401);
    expect(code(r)).toBe("invalid_key");
    expect(r.headers.get("www-authenticate")).toMatch(/^Bearer /);
    expect((r.body.getAKey as { url: string }).url).toBe("https://resumebooster.work/data-api");
  });
});

describe("the key, from either slot", () => {
  it("a key in x-api-key alone is checked like one in Authorization", async () => {
    const viaBearer = await call("/v1/stats", { authorization: `Bearer ${KEY}` });
    const viaHeader = await call("/v1/stats", { "x-api-key": KEY });
    expect(keyChecks(viaHeader)).toHaveLength(1);
    expect(keyChecks(viaHeader)[0].args.p_key_hash).toBe(sha(KEY));
    expect(keyChecks(viaHeader)[0].args).toEqual(keyChecks(viaBearer)[0].args);
    expect(viaHeader.status).toBe(viaBearer.status);
  });
  it("Authorization: Bearer <publishable key> beside x-api-key: rb_live_... is checked as the rb_live_ key", async () => {
    const r = await call("/v1/stats", { authorization: `Bearer ${PUBLISHABLE}`, "x-api-key": KEY });
    expect(keyChecks(r)[0].args.p_key_hash).toBe(sha(KEY));
  });
  it("a publishable key alone is still checked as sent (and so is invalid_key)", async () => {
    const r = await call("/v1/stats", { authorization: `Bearer ${PUBLISHABLE}` }, "GET", { ...ALLOWED, is_allowed: false, deny_reason: "unknown_key" });
    expect(keyChecks(r)[0].args.p_key_hash).toBe(sha(PUBLISHABLE));
    expect(code(r)).toBe("invalid_key");
  });
  it("a revoked key in x-api-key answers 403 key_revoked", async () => {
    const r = await call("/v1/stats", { "x-api-key": KEY }, "GET", { ...ALLOWED, is_allowed: false, deny_reason: "revoked" });
    expect(r.status).toBe(403);
    expect(code(r)).toBe("key_revoked");
  });
  it("the preflight allows x-api-key, and a browser can read WWW-Authenticate", async () => {
    const r = await call("/v1/jobs", { "access-control-request-headers": "x-api-key" }, "OPTIONS");
    expect(r.headers.get("access-control-allow-headers")).toMatch(/(^|, )x-api-key(,|$)/);
    expect(r.headers.get("access-control-expose-headers")).toMatch(/WWW-Authenticate/);
  });
});

describe("the root, HEAD and a trailing slash", () => {
  it("the root has getAKey, openapi and keylessSample, and names the document in its own field", async () => {
    const r = await call("/v1");
    expect(r.status).toBe(200);
    expect((r.body.getAKey as { url: string }).url).toBe("https://resumebooster.work/data-api");
    expect(r.body.openapi).toBe("/v1/openapi.json");
    // Not in endpoints: that list is held route by route to the site's pages,
    // which name the document only once the docs lane writes them.
    expect(r.body.endpoints).not.toContain("/v1/openapi.json");
    expect(r.body.auth).toMatch(/x-api-key/);
    expect((r.body.keylessSample as { offered: boolean }).offered).toBe(false);
  });
  it("the root's keylessSample.offered is what a keyless /v1/jobs does", async () => {
    const root = await call("/v1");
    const keyless = await call("/v1/jobs");
    expect((root.body.keylessSample as { offered: boolean }).offered).toBe(keyless.status === 200);
  });
  it("HEAD /v1 answers 200 with no body and the GET's headers", async () => {
    const get = await call("/v1");
    const head = await call("/v1", {}, "HEAD");
    expect(head.status).toBe(200);
    expect(head.text).toBe("");
    expect(head.headers.get("content-type")).toBe(get.headers.get("content-type"));
  });
  it("HEAD on a keyed route is metered like the GET", async () => {
    const head = await call("/v1/stats", { authorization: `Bearer ${KEY}` }, "HEAD");
    expect(keyChecks(head)).toHaveLength(1);
    expect(head.text).toBe("");
  });
  it.each(["/v1/companies/", "/v1/stats/", "/v1/changes/", "/v1/usage/"])("%s routes as the path without its slash", async (path) => {
    const r = await call(path, { authorization: `Bearer ${KEY}` });
    expect(r.status).not.toBe(404);
    expect(keyChecks(r)[0].args.p_endpoint).toBe(path.slice(0, -1));
  });
});
