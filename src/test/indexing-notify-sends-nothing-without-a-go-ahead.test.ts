// @vitest-environment node
//
// Node, not jsdom: the command-line half runs scripts/google-indexing-notify.mjs
// as a child process, and the send half signs with node:crypto.
/**
 * THE GOOGLE INDEXING API NOTIFIER SENDS NOTHING WITHOUT A GO-AHEAD (B08,
 * SEO/GEO audit 2026-11-07, finding SD-06).
 *
 * Posting pages live 30 days at most and most are replaced within two weeks,
 * so Google's Indexing API (built for JobPosting pages) is the way to have a
 * new one crawled and a closed one dropped. Nothing called it. The notifier
 * diffs the live ledger against the previous publish's, lists URL_DELETED
 * (deletions first) and URL_UPDATED for posting pages only, caps the run at
 * the daily quota, and sends only with --send AND INDEXING_SEND=1 AND the
 * service-account key in ~/.config/resumebooster/. Without them it makes no
 * request but the GET of the live ledger, and none at all from local files.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { readFileSync } from "node:fs";
import { pairPaths, previousLedger } from "../../scripts/seo-previous-publish.mjs";
import {
  DAILY_QUOTA, PUBLISH_ENDPOINT, TOKEN_ENDPOINT, indexingDiff, indexingSendAllowed, keyPath, notify, plannedNotices, serviceAccountJwt,
} from "../../scripts/google-indexing-notify.mjs";

vi.setConfig({ testTimeout: 30_000 });

const ROOT = resolve(__dirname, "../..");
const SITE = "https://resumebooster.work";
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });
const tmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d; };

const P = (s: string) => `/jobs/posting/workday/acme~wd1~x/${s}`;
/** The previous publish: four live postings (one without markup), one already gone. */
const PREVIOUS = {
  builtAt: "2026-11-06",
  postings: {
    [P("R1")]: { state: "live" },
    [P("R2")]: { state: "live" },
    [P("R3")]: { state: "live" },
    [P("R4")]: { state: "live", markupWithheld: "name" },
    [P("R5")]: { state: "gone", since: "2026-11-01" },
  },
  companies: { "/jobs/company/acme~wd1~x": { state: "live" } },
};
/** This publish: R1 still live, R2 closed at the employer, R3 retired, R4 no longer named; R6 and R7 new, R8 new but without markup; a stray company path. */
const LIVE = {
  builtAt: "2026-11-08",
  postings: {
    [P("R1")]: { state: "live" },
    [P("R2")]: { state: "gone", basis: "employer", since: "2026-11-08" },
    [P("R3")]: { state: "retired", since: "2026-11-08" },
    [P("R5")]: { state: "tombstone", since: "2026-11-08" },
    [P("R6")]: { state: "live" },
    [P("R7.1")]: { state: "live" },
    [P("R8")]: { state: "live", markupWithheld: "switch" },
    "/jobs/company/acme~wd1~x": { state: "live" },
  },
  companies: { "/jobs/company/newco": { state: "live" } },
};

type Call = { url: string; method: string; body?: string; auth?: string };
function stubNet({ ledger = LIVE, publishStatus = 200 }: { ledger?: unknown; publishStatus?: number } = {}) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(url), method: (init?.method ?? "GET").toUpperCase(), body: typeof init?.body === "string" ? init.body : undefined, auth: headers.authorization });
    if (url === `${SITE}/prerender-ledger.json`) return new Response(JSON.stringify(ledger), { status: 200 });
    if (url === TOKEN_ENDPOINT) return new Response(JSON.stringify({ access_token: "tok-1", expires_in: 3600 }), { status: 200 });
    if (url === PUBLISH_ENDPOINT) return new Response("{}", { status: publishStatus });
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;
  const toGoogle = () => calls.filter((c) => /googleapis\.com/.test(c.url));
  const notGets = () => calls.filter((c) => c.method !== "GET");
  return { calls, fetchImpl, toGoogle, notGets };
}

/** Files on disk for --live and --previous, and a HOME with or without a key. */
function files({ withKey = false }: { withKey?: boolean } = {}) {
  const dir = tmp("indexing-");
  const live = join(dir, "live.json");
  const previous = join(dir, "previous.json");
  writeFileSync(live, JSON.stringify(LIVE));
  writeFileSync(previous, JSON.stringify(PREVIOUS));
  const home = join(dir, "home");
  let publicKey = "";
  if (withKey) {
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    publicKey = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
    mkdirSync(join(home, ".config", "resumebooster"), { recursive: true });
    writeFileSync(join(home, ".config", "resumebooster", "google-indexing-key.json"), JSON.stringify({
      type: "service_account", client_email: "notifier@test-project.iam.gserviceaccount.com", token_uri: TOKEN_ENDPOINT,
      private_key: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    }));
  }
  return { live, previous, home, publicKey, seoDir: join(dir, "seo") };
}

describe("the go-ahead is --send and INDEXING_SEND=1 together, and nothing else", () => {
  it("needs both halves, and only the exact value 1", () => {
    expect(indexingSendAllowed({ argv: ["--send"], env: { INDEXING_SEND: "1" } })).toBe(true);
    expect(indexingSendAllowed({ argv: [], env: { INDEXING_SEND: "1" } })).toBe(false);
    expect(indexingSendAllowed({ argv: ["--send"], env: {} })).toBe(false);
    for (const v of ["", "0", "true", "yes", " 1"]) expect(indexingSendAllowed({ argv: ["--send"], env: { INDEXING_SEND: v } }), v).toBe(false);
  });

  it("reads the key from ~/.config/resumebooster, never from the repo or the scratchpad", () => {
    expect(keyPath({ HOME: "/Users/x" })).toBe("/Users/x/.config/resumebooster/google-indexing-key.json");
  });
});

describe("what a publish lists", () => {
  it("retired pages get URL_DELETED and new job pages URL_UPDATED; posting pages only", () => {
    expect(indexingDiff({ previous: PREVIOUS, live: LIVE })).toEqual({
      // R2 closed at its employer, R3 retired, R4 no longer named (its markup was withheld, but it was a live page).
      deleted: [P("R2"), P("R3"), P("R4")],
      // R8 carries no JobPosting, and a company page is never this API's.
      updated: [P("R6"), P("R7.1")],
    });
  });

  it("deletions go first and the run stops at the cap, the rest left for the next run", () => {
    const { notices, left } = plannedNotices({ deleted: ["/jobs/posting/a/b/1", "/jobs/posting/a/b/2"], updated: ["/jobs/posting/a/b/3", "/jobs/posting/a/b/4", "/jobs/posting/a/b/5"] }, 3);
    expect(notices.map((n) => `${n.type} ${n.path}`)).toEqual(["URL_DELETED /jobs/posting/a/b/1", "URL_DELETED /jobs/posting/a/b/2", "URL_UPDATED /jobs/posting/a/b/3"]);
    expect(left.map((n) => n.path)).toEqual(["/jobs/posting/a/b/4", "/jobs/posting/a/b/5"]);
  });

  it("a cap above the daily quota is the quota", () => {
    const many = Array.from({ length: 250 }, (_, i) => `/jobs/posting/a/b/${i}`);
    expect(plannedNotices({ deleted: many, updated: [] }, 1000).notices).toHaveLength(DAILY_QUOTA);
    expect(DAILY_QUOTA).toBe(200);
  });

  it("a dotted posting address gets the trailing slash its baked page answers at", () => {
    expect(plannedNotices({ deleted: [], updated: [P("R7.1")] }).notices[0].url).toBe(`${SITE}${P("R7.1")}/`);
  });
});

describe("without the go-ahead nothing is sent", () => {
  it("from local files the dry run makes no request at all, and lists deletions first", async () => {
    const f = files({ withKey: true });
    const net = stubNet();
    const r = await notify({ argv: ["--live", f.live, "--previous", f.previous], env: { HOME: f.home, INDEXING_SEND: "1" }, fetchImpl: net.fetchImpl });
    expect(net.calls).toEqual([]);
    expect(r.status).toBe("INFO");
    expect(r.sent).toBe(0);
    expect(r.line).toBe("Indexing API dry run: 3 URL_DELETED + 2 URL_UPDATED listed, nothing sent (sending needs --send and INDEXING_SEND=1, the owner's go-ahead, and the service-account key at ~/.config/resumebooster/google-indexing-key.json)");
    const listed = r.report.split("\n").filter((l: string) => /^URL_/.test(l));
    expect(listed).toEqual([
      `URL_DELETED ${SITE}${P("R2")}`, `URL_DELETED ${SITE}${P("R3")}`, `URL_DELETED ${SITE}${P("R4")}`,
      `URL_UPDATED ${SITE}${P("R6")}`, `URL_UPDATED ${SITE}${P("R7.1")}/`,
    ]);
    expect(r.report).toMatch(/^# Google Indexing API DRY RUN/);
  });

  it("against the live site its one request is the GET of the live ledger, with --send alone or INDEXING_SEND alone", async () => {
    for (const [argv, env] of [[[], {}], [["--send"], {}], [[], { INDEXING_SEND: "1" }]] as const) {
      const f = files({ withKey: true });
      const net = stubNet();
      const r = await notify({ argv: [...argv, "--previous", f.previous], env: { ...env, HOME: f.home }, fetchImpl: net.fetchImpl });
      expect(net.calls, JSON.stringify(argv)).toEqual([{ url: `${SITE}/prerender-ledger.json`, method: "GET", body: undefined, auth: undefined }]);
      expect(net.toGoogle()).toEqual([]);
      expect(r.status).toBe("INFO");
    }
  });

  it("with the go-ahead but no key it sends nothing and says where the key belongs", async () => {
    const f = files({ withKey: false });
    const net = stubNet();
    const r = await notify({ argv: ["--send", "--live", f.live, "--previous", f.previous], env: { HOME: f.home, INDEXING_SEND: "1" }, fetchImpl: net.fetchImpl });
    expect(net.calls).toEqual([]);
    expect(r.status).toBe("FAIL");
    expect(r.line).toBe(`Indexing API: no service-account key at ${join(f.home, ".config/resumebooster/google-indexing-key.json")} (client_email and private_key): nothing sent`);
  });

  it("diffs against the newest saved ledger that is not the live one", () => {
    const dir = tmp("indexing-seo-");
    const p = pairPaths(dir);
    writeFileSync(p.ledger, "LAST");
    writeFileSync(p.prevLedger, "PREV");
    writeFileSync(p.log, "x\n");
    expect(previousLedger({ dir, liveLedgerText: "LIVE" })).toMatchObject({ raw: "LAST", from: p.ledger });
    // verify-deploy.sh already saved this publish as last-*: the one before it is prev-*.
    expect(previousLedger({ dir, liveLedgerText: "LAST" })).toMatchObject({ raw: "PREV", from: p.prevLedger });
    rmSync(p.prevLedger);
    expect(previousLedger({ dir, liveLedgerText: "LAST" })).toMatchObject({ raw: "", reason: "own" });
  });

  it("with no previous publish's ledger saved it lists nothing", async () => {
    const f = files({ withKey: true });
    const net = stubNet();
    const r = await notify({ argv: ["--send", "--live", f.live], env: { HOME: f.home, INDEXING_SEND: "1", VD_SEO_DIR: f.seoDir }, fetchImpl: net.fetchImpl });
    expect(net.calls).toEqual([]);
    expect(r).toMatchObject({ status: "INFO", sent: 0, report: "" });
    expect(r.line).toMatch(/^Indexing API: no previous publish's ledger to diff against \(this machine has never saved one/);
  });

  it("the post-publish verifier prints the dry run and can never send: it hands the notifier no --send", () => {
    const smoke = codeOf(readFileSync(resolve(ROOT, "scripts/post-publish-smoke.mjs"), "utf8"));
    expect(smoke).toMatch(/await notify\(\{ argv: \[\], env: process\.env \}\)/);
    expect(smoke).not.toMatch(/--send/);
    expect(smoke).not.toMatch(/indexing\.googleapis/);
  });

  it("the command line with no flags is a dry run that exits 0 and sends nothing", () => {
    const f = files({ withKey: true });
    const log = join(tmp("indexing-cli-"), "calls.log");
    const stub = join(tmp("indexing-stub-"), "fetch.cjs");
    writeFileSync(stub, `const fs=require("fs");globalThis.fetch=async(u,i)=>{fs.appendFileSync(${JSON.stringify(log)},((i&&i.method)||"GET")+" "+u+"\\n");return new Response("",{status:500});};`);
    writeFileSync(log, "");
    const out = execFileSync("node", [resolve(ROOT, "scripts/google-indexing-notify.mjs"), "--live", f.live, "--previous", f.previous], {
      env: { ...process.env, HOME: f.home, INDEXING_SEND: "1", NODE_OPTIONS: `--require ${stub}` }, encoding: "utf8",
    });
    expect(readFileSync(log, "utf8")).toBe("");
    expect(out).toMatch(/^INFO {2}Indexing API dry run: 3 URL_DELETED \+ 2 URL_UPDATED listed, nothing sent/m);
  });
});

describe("with the go-ahead and the key", () => {
  it("signs an RS256 JWT for the indexing scope, then sends each notice, deletions first, inside the cap", async () => {
    const f = files({ withKey: true });
    const net = stubNet();
    const now = new Date("2026-11-08T12:00:00Z");
    const r = await notify({ argv: ["--send", "--cap", "4", "--live", f.live, "--previous", f.previous], env: { HOME: f.home, INDEXING_SEND: "1" }, fetchImpl: net.fetchImpl, now });
    expect(r).toMatchObject({ status: "PASS", sent: 4 });
    expect(r.line).toBe("Indexing API: sent 4 of 4 (3 URL_DELETED + 1 URL_UPDATED); 1 left for the next run");
    const [token, ...publishes] = net.calls;
    expect(token.url).toBe(TOKEN_ENDPOINT);
    expect(token.method).toBe("POST");
    const form = new URLSearchParams(token.body);
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const [h, c, sig] = String(form.get("assertion")).split(".");
    const verify = createVerify("RSA-SHA256");
    verify.update(`${h}.${c}`);
    expect(verify.verify(f.publicKey, Buffer.from(sig.replace(/-/g, "+").replace(/_/g, "/"), "base64"))).toBe(true);
    expect(JSON.parse(Buffer.from(h, "base64").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(Buffer.from(c, "base64").toString())).toEqual({ iss: "notifier@test-project.iam.gserviceaccount.com", scope: "https://www.googleapis.com/auth/indexing", aud: TOKEN_ENDPOINT, iat: 1794139200, exp: 1794142800 });
    expect(publishes.map((p) => [p.url, p.method, p.auth, JSON.parse(String(p.body))])).toEqual([
      [PUBLISH_ENDPOINT, "POST", "Bearer tok-1", { url: `${SITE}${P("R2")}`, type: "URL_DELETED" }],
      [PUBLISH_ENDPOINT, "POST", "Bearer tok-1", { url: `${SITE}${P("R3")}`, type: "URL_DELETED" }],
      [PUBLISH_ENDPOINT, "POST", "Bearer tok-1", { url: `${SITE}${P("R4")}`, type: "URL_DELETED" }],
      [PUBLISH_ENDPOINT, "POST", "Bearer tok-1", { url: `${SITE}${P("R6")}`, type: "URL_UPDATED" }],
    ]);
  });

  it("stops at the first 429, the quota answer, and says how many were not tried", async () => {
    const f = files({ withKey: true });
    const net = stubNet({ publishStatus: 429 });
    const r = await notify({ argv: ["--send", "--live", f.live, "--previous", f.previous], env: { HOME: f.home, INDEXING_SEND: "1" }, fetchImpl: net.fetchImpl });
    expect(net.calls.filter((c) => c.url === PUBLISH_ENDPOINT)).toHaveLength(1);
    expect(r.status).toBe("FAIL");
    expect(r.line).toBe(`Indexing API: sent 0 of 5 (3 URL_DELETED + 2 URL_UPDATED); 1 failed (first: URL_DELETED ${SITE}${P("R2")} -> 429); 4 not tried after the quota ran out`);
  });

  it("the JWT is the service account's own, an hour long", () => {
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwt = serviceAccountJwt({ client_email: "a@b.iam.gserviceaccount.com", private_key: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString() }, new Date(0));
    const claims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64").toString());
    expect(claims).toEqual({ iss: "a@b.iam.gserviceaccount.com", scope: "https://www.googleapis.com/auth/indexing", aud: TOKEN_ENDPOINT, iat: 0, exp: 3600 });
  });
});
