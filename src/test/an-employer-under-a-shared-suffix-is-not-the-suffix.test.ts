// @vitest-environment node
/**
 * AN EMPLOYER UNDER A SHARED SUFFIX IS NOT THE SUFFIX (S13-071).
 *
 * WHAT WAS WRONG. company-claim verifies a claim on its own when the work
 * email's registrable domain equals the registrable domain of a host the board
 * links to for the company. The registrable domain was read with a short list
 * of second-level labels (co, com, org, gov...), so an employer under any
 * shared suffix the list did not name collapsed to that suffix:
 * careers.acme.me.uk read as "me.uk", and so did hr@anyone.me.uk, which then
 * proved Acme. The same for id.au, waw.pl, k12.ca.us, firm.in, uk.com and
 * every other suffix the Public Suffix List holds and the short list did not.
 *
 * WHAT HOLDS NOW: the registrable domain comes from the full Public Suffix
 * List (its ICANN and private sections, wildcards and exceptions), and the
 * old rule's answer is kept wherever it held more labels, so no host is read
 * as more shared than before. A host that is itself a public suffix has no
 * registrable domain, and a vendor's tenant host proves nothing whether or not
 * the vendor's domain is a public suffix.
 *
 * THE CORPUS (domain-proof-hosts-2026-11-03.json): 728 real hosts the board
 * links to or names, each with its registrable domain under the full list as
 * tldts 7.4.4 reads it. Measured at the time of writing, main's rule and this
 * one both agree with the list on all 728; the test holds the branch to never
 * worse than main on any one of them, case by case, and to keeping every
 * employer-owned host's domain.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { buildIsAtLeast } from "./helpers/fn-build";
import {
  VENDOR_DOMAINS, domainProven, employerDomains, publicSuffixLabels, registrableDomain, vendorHost,
} from "../../supabase/functions/company-claim/domain-proof";

type Case = { host: string; from: string; listed: string };
const CORPUS: Case[] = JSON.parse(readFileSync(resolve(__dirname, "fixtures/domain-proof-hosts-2026-11-03.json"), "utf8")).cases;

/** main's rule, frozen as it stood on 2026-11-02, so the comparison runs without git. */
const MAIN_SECOND_LEVEL = new Set(["co", "com", "org", "net", "ac", "gov", "edu", "ltd", "plc", "ne", "or", "gob", "nic", "mil", "sch", "gv", "go", "nhs"]);
function mainRegistrable(host: string): string {
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  if (!/^[a-z0-9.-]+$/.test(h) || !h.includes(".")) return "";
  const labels = h.split(".").filter(Boolean);
  if (labels.length < 2 || labels.some((l) => l.length > 63)) return "";
  const n = labels.length;
  const take = n >= 3 && labels[n - 1].length === 2 && MAIN_SECOND_LEVEL.has(labels[n - 2]) ? 3 : 2;
  return labels.slice(-take).join(".");
}
const mainEmployer = (host: string) => { const d = mainRegistrable(host); return d && !VENDOR_DOMAINS.has(d) ? d : ""; };
const branchEmployer = (host: string) => [...employerDomains([`https://${host}/jobs/1`])][0] ?? "";

describe("S13-071: a shared suffix is never an employer's domain", () => {
  const SHARED: Array<[string, string, string]> = [
    // [an employer's careers host, its registrable domain, a stranger's mailbox under the same suffix]
    ["careers.acme.me.uk", "acme.me.uk", "hr@evil.me.uk"],
    ["jobs.smithandco.id.au", "smithandco.id.au", "hr@other.id.au"],
    ["praca.firma.waw.pl", "firma.waw.pl", "kadry@inna.waw.pl"],
    ["hr.lincoln.k12.ca.us", "lincoln.k12.ca.us", "hr@riverside.k12.ca.us"],
    ["careers.patel.firm.in", "patel.firm.in", "hr@shah.firm.in"],
    ["jobs.acme.uk.com", "acme.uk.com", "hr@evil.uk.com"],
  ];

  it("reads each host to its own registrable domain, where main read the suffix", () => {
    for (const [host, want] of SHARED) {
      expect(registrableDomain(host), host).toBe(want);
      expect(mainRegistrable(host), `${host}: main already read it right, so this case proves nothing`).not.toBe(want);
    }
  });

  it("a stranger's mailbox under the same suffix proves nothing, and the employer's own still does", () => {
    for (const [host, want, stranger] of SHARED) {
      const domains = employerDomains([`https://${host}/jobs/7`]);
      expect([...domains]).toEqual([want]);
      expect(domainProven(stranger, domains), `${stranger} proved ${host}`).toBe(false);
      expect(domainProven(`talent@${want}`, domains)).toBe(true);
      expect(domainProven(`talent@mail.${want}`, domains)).toBe(true);
    }
  });

  it("a host that is itself a public suffix has no registrable domain and proves nothing", () => {
    for (const host of ["me.uk", "k12.ca.us", "uk.com", "co.uk", "github.io"]) expect(registrableDomain(host), host).toBe("");
    expect(employerDomains(["https://me.uk/jobs"]).size).toBe(0);
    expect(domainProven("x@me.uk", new Set(["me.uk"]))).toBe(false);
  });

  it("the list's own algorithm: an exception wins, a wildcard covers one label, an unlisted TLD is one label", () => {
    expect(publicSuffixLabels(["www", "ck"])).toBe(1);
    expect(registrableDomain("www.ck")).toBe("www.ck");
    expect(registrableDomain("shop.ck")).toBe("");
    expect(registrableDomain("acme.shop.ck")).toBe("acme.shop.ck");
    expect(registrableDomain("careers.acme.notarealtld")).toBe("acme.notarealtld");
    expect(registrableDomain("careers.savills.co.uk")).toBe("savills.co.uk");
    expect(registrableDomain("not a host")).toBe("");
  });

  it("a vendor's tenant host proves nothing, even where the vendor's domain is itself a public suffix", () => {
    for (const host of ["acme.notion.site", "acme.github.io", "td.wd3.myworkdayjobs.com", "job-boards.greenhouse.io"]) {
      expect(vendorHost(host), host).toBe(true);
      expect(employerDomains([`https://${host}/x`]).size, host).toBe(0);
    }
    expect(vendorHost("careers.savills.co.uk")).toBe(false);
  });
});

describe("the corpus: never worse than main, case by case", () => {
  it("holds at least 300 real hosts, each with the list's answer", () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(300);
    expect(new Set(CORPUS.map((c) => c.host)).size).toBe(CORPUS.length);
  });

  it("every host main read as the list does is still read as the list does", () => {
    let main = 0, branch = 0;
    const worse: string[] = [];
    for (const c of CORPUS) {
      const m = mainRegistrable(c.host) === c.listed, b = registrableDomain(c.host) === c.listed;
      if (m) main++;
      if (b) branch++;
      if (m && !b) worse.push(`${c.host}: ${registrableDomain(c.host)} (list ${c.listed})`);
    }
    expect(worse).toEqual([]);
    expect(branch).toBeGreaterThanOrEqual(main);
  });

  it("no host is read as more shared than main read it", () => {
    const shorter = CORPUS.filter((c) => {
      const m = mainRegistrable(c.host), b = registrableDomain(c.host);
      return m && b && b.split(".").length < m.split(".").length;
    }).map((c) => c.host);
    expect(shorter).toEqual([]);
  });

  it("every employer-owned host keeps its domain, and no vendor host becomes an employer's", () => {
    const lost: string[] = [], gained: string[] = [];
    for (const c of CORPUS) {
      const m = mainEmployer(c.host), b = branchEmployer(c.host);
      if (m && b !== m) lost.push(`${c.host}: main ${m}, now ${b || "nothing"}`);
      if (!m && b) gained.push(`${c.host}: now ${b}`);
    }
    expect(lost).toEqual([]);
    expect(gained).toEqual([]);
  });
});

describe("the handler, end to end", () => {
  const db = new FakeDb();
  let handler: EdgeHandler;
  const sent: Array<{ to: string[] }> = [];

  beforeAll(async () => {
    const g = globalThis as Record<string, unknown>;
    const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_harness_0123456789abcdef", RESEND_API_KEY: "re_harness" };
    g.__ssfSent = sent;
    g.__ssfDb = db;
    g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
    handler = await loadEdgeHandler("company-claim", {
      "https://esm.sh/@supabase/supabase-js@2.39.3": "export const createClient = () => globalThis.__ssfDb;",
      "https://esm.sh/resend@2.0.0":
        "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__ssfSent.push(m); return { data: { id: 'em' }, error: null }; } }; } }",
    });
  }, 60_000);

  afterEach(() => { sent.length = 0; db.tables = {}; db.writes = []; db.rpcs = {}; db.faults = []; });

  const post = (body: unknown) => handler(new Request("https://harness.supabase.co/functions/v1/company-claim", {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.21" }, body: JSON.stringify(body),
  }));

  it("a stranger's me.uk mailbox waits for the owner; the employer's own verifies on its click", async () => {
    db.rpcs.mail_door_take = () => ({ data: true, error: null });
    db.rows("job_board_postings").push({ id: "p-acme", company_token: "acmeuk", company: "Acme", apply_url: "https://careers.acme.me.uk/jobs/1" });

    const res = await post({ action: "request", companyToken: "acmeuk", workEmail: "hr@evil.me.uk" });
    expect(res.status).toBe(200);
    expect(buildIsAtLeast(res.headers.get("x-fn-build"), "company-claim", "2026-11-03"), String(res.headers.get("x-fn-build"))).toBe(true);
    const stranger = db.rows("company_claims").find((r) => r.work_email === "hr@evil.me.uk")!;
    expect(stranger.domain_match, "hr@evil.me.uk proved Acme at careers.acme.me.uk").toBe(false);
    expect(await (await post({ action: "verify", token: stranger.verify_token })).json()).toEqual({ status: "email_confirmed" });

    await post({ action: "request", companyToken: "acmeuk", workEmail: "talent@acme.me.uk" });
    const own = db.rows("company_claims").find((r) => r.work_email === "talent@acme.me.uk")!;
    expect(own.domain_match).toBe(true);
    expect(await (await post({ action: "verify", token: own.verify_token })).json()).toEqual({ status: "verified" });
  });
});
