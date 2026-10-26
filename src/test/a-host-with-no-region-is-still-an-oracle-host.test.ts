// @vitest-environment node
/**
 * A HOST WITH NO REGION IS STILL AN ORACLE HOST.
 *
 * The board reads Oracle Recruiting Cloud boards from a catalogue token
 * tenant~region~site and built https://{tenant}.fa.{region}.oraclecloud.com at
 * four places: the list read (fetchOracle), the liveness check (checkLive),
 * the description read (fetchVendorDetail) and the apply links
 * (normalizeOracle). JPMorgan Chase's board lives on a host with no region
 * label, jpmc.fa.oraclecloud.com (7,244 open on 2026-10-25, 3,728 posted in the
 * last 30 days), and every one of the four refused a token with an empty
 * region. The host is a DNS alias of an Oracle pod whose own name fails the
 * certificate check, so no regional token can reach it.
 *
 * The fix is one builder, oracleHost(token) in normalize.ts, that the four
 * places share: an empty region drops the label, anything else is spelled
 * exactly as before. This file runs the REAL four places (lifted out of
 * index.ts and compiled, with only the network stubbed), and proves:
 *   1. a region-less token reaches jpmc.fa.oraclecloud.com at all four;
 *   2. every regional Oracle token in the catalogue produces, at all four, the
 *      byte-identical URL the old template produced (zero diffs);
 *   3. a recorded JPMorgan feed page normalises to apply links on the
 *      region-less host, keyed by requisition for the sub-site dedupe;
 *   4. the catalogue carries JPMorgan once, on one site, under its own name;
 *   5. the census tooling's mirror of the builder agrees with it, and the
 *      census recognises a region-less careers host.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { CATALOG } from "./helpers/catalog";
import * as normalize from "../../supabase/functions/job-board/normalize";
import { pickRoute } from "../../supabase/functions/job-board/search-routing";
import { EMPLOYER_ALIASES } from "../../supabase/functions/job-board/employer-aliases";
import { JOB_SOURCES as LAYOFF_COPY } from "../../supabase/functions/layoff-filings/board-sources";

const ROOT = resolve(__dirname, "../..");
const RAW = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");
const FIXTURE = JSON.parse(readFileSync(resolve(__dirname, "fixtures/oracle-jpmc-cx1001-2026-10-25.json"), "utf8"));

// The builder under test. Read off the module object so this file loads (and
// fails by assertion, not by import) on code that does not export it yet.
const oracleHost = (normalize as unknown as { oracleHost?: (t: string) => string }).oracleHost;
const REGIONLESS = "jpmc~~CX_1001";

/** The template every one of the four places used before (base 27e54375), region always present. */
const OLD = {
  host: (t: string) => { const [tenant, region] = t.split("~"); return `${tenant}.fa.${region}.oraclecloud.com`; },
  ok: (t: string) => { const [tenant, region, site] = t.split("~"); return Boolean(tenant && region && site); },
  list: (t: string, page: number) => {
    const site = t.split("~")[2];
    const finder = `findReqs;siteNumber=${site},limit=${page},offset=0,sortBy=POSTING_DATES_DESC`;
    return `https://${OLD.host(t)}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList&finder=${encodeURIComponent(finder)}`;
  },
  live: (t: string, id: string) => `https://${OLD.host(t)}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?onlyData=true&finder=${encodeURIComponent(`ById;Id=${id},siteNumber=${t.split("~")[2]}`)}`,
  detail: (t: string, id: string) => `https://${OLD.host(t)}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=${encodeURIComponent(`ById;Id=${id},siteNumber=${t.split("~")[2]}`)}`,
  apply: (t: string, id: string) => `https://${OLD.host(t)}/hcmUI/CandidateExperience/en/sites/${t.split("~")[2]}/job/${id}`,
};

// ─────────────────────────────────────────────────────────────────────────────
// The shipped functions, lifted out of index.ts and compiled.
// ─────────────────────────────────────────────────────────────────────────────
const constDecl = (name: string): string => {
  const m = RAW.match(new RegExp(`^const ${name}\\b[^;\\n]*;`, "m"));
  if (!m) throw new Error(`const ${name} not found at the top level of index.ts`);
  return m[0];
};
const fnDecl = (head: string): string => {
  const i = RAW.indexOf(`\n${head}`);
  if (i < 0) throw new Error(`${head} not found at the top level of index.ts`);
  return RAW.slice(i + 1, RAW.indexOf("\n}\n", i) + 2);
};
/**
 * Build one top-level function with `deps` in scope. An identifier this
 * harness did not stub reports itself by name instead of failing as a bare
 * ReferenceError, so a new helper reached inside a lifted function says what
 * to stub.
 */
function lift<F>(head: string, consts: string[], deps: Record<string, unknown>): F {
  const name = /function\s+(\w+)/.exec(head)![1];
  const js = transformSync([...consts.map(constDecl), fnDecl(head)].join("\n"), { loader: "ts" }).code;
  const env = new Proxy(deps, {
    has: () => true,
    get: (t, k) => {
      if (typeof k === "symbol") return undefined;
      if (k in t) return t[k as string];
      if (k in globalThis) return (globalThis as Record<string, unknown>)[k as string];
      throw new Error(`${name} reached an unstubbed dependency: ${String(k)}`);
    },
  });
  // eslint-disable-next-line no-new-func
  return new Function("__env", `with (__env) { ${js}\n return ${name}; }`)(env) as F;
}

const asked: string[] = [];
let answer: unknown = { items: [{}] };
const fakeFetch = async (u: string) => {
  asked.push(u);
  return { status: 200, ok: true, json: async () => answer };
};
const STOP = new Error("stop: the first page's URL is all this harness reads");
type Src = { name: string; source: string; token: string; pages?: number };
const src = (token: string): Src => ({ name: "Employer", source: "oracle", token, pages: 1 });

const fetchOracle = lift<(s: Src, startOffset?: number) => Promise<unknown>>("async function fetchOracle(", ["ORACLE_PAGE_SIZE", "ORACLE_PAGE_CAP"], {
  oracleHost,
  fetchWithTimeout: async (u: string) => { asked.push(u); throw STOP; },
  chunkPageRefusal: (e: unknown) => { throw e; },
});
const checkLive = lift<(s: Src, id: string, applyUrl?: string | null) => Promise<boolean | null>>("async function checkLive(", [], {
  oracleHost,
  fetchWithTimeout: fakeFetch,
});
const fetchVendorDetail = lift<(s: Src, id: string, externalId: string, applyUrl?: string | null) => Promise<{ text: string | null }>>("async function fetchVendorDetail(", ["DESC_CAP"], {
  oracleHost,
  fetchWithTimeout: fakeFetch,
  htmlToText: (h: string) => String(h).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
});
const PAGE = Number(/=\s*(\d+)/.exec(constDecl("ORACLE_PAGE_SIZE"))![1]);

/** The URL each of the four places builds for a token, or the error it raised before asking anything. */
async function urlsFor(token: string, id = "210587260"): Promise<{ list: string | Error; live: string | null; detail: string | null; apply: string | null }> {
  asked.length = 0;
  let list: string | Error;
  try {
    await fetchOracle(src(token), 0);
    list = new Error("fetchOracle returned without asking the network");
  } catch (e) {
    list = e === STOP ? asked[0] : (e as Error);
  }
  asked.length = 0;
  answer = { items: [{ Id: id }] };
  await checkLive(src(token), id, null);
  const live = asked[0] ?? null;
  asked.length = 0;
  answer = { items: [{ ExternalDescriptionStr: "<p>Builds things.</p>" }] };
  await fetchVendorDetail(src(token), `oracle:${token}:${id}`, id, null);
  const detail = asked[0] ?? null;
  const jobs = normalize.normalizeOracle([{ Id: id, Title: "Engineer", PostedDate: "2026-10-24", PrimaryLocation: "New York, NY, United States" }] as never, "Employer", token);
  return { list, live, detail, apply: jobs[0]?.applyUrl ?? null };
}

const ORACLE_TOKENS = [...new Set(CATALOG.filter((e) => e.source === "oracle").map((e) => e.token))];
const REGIONAL = ORACLE_TOKENS.filter((t) => t.split("~")[1] !== "");

// ─────────────────────────────────────────────────────────────────────────────
describe("the one host builder", () => {
  it("spells a regional host exactly as before and drops the label when the region is empty", () => {
    expect(typeof oracleHost, "normalize.ts exports no oracleHost").toBe("function");
    expect(oracleHost!("ebxr~us2~CX_1")).toBe("ebxr.fa.us2.oraclecloud.com");
    expect(oracleHost!("fa-espx-saasfaprod1~ocs~CX_1006")).toBe("fa-espx-saasfaprod1.fa.ocs.oraclecloud.com");
    expect(oracleHost!(REGIONLESS)).toBe("jpmc.fa.oraclecloud.com");
  });

  it("refuses every shape the old guard refused apart from the empty region", () => {
    for (const bad of ["", "jpmc", "jpmc~", "jpmc~~", "jpmc~us2", "jpmc~us2~", "~us2~CX_1", "~~CX_1"]) {
      expect(oracleHost!(bad), JSON.stringify(bad)).toBe("");
    }
  });

  it("agrees with the old template on every regional Oracle token in the catalogue (zero diffs)", () => {
    expect(REGIONAL.length, "the catalogue reader found too few Oracle tokens for this to mean anything").toBeGreaterThan(1000);
    const diffs = REGIONAL.filter((t) => OLD.ok(t) !== Boolean(oracleHost!(t)) || (OLD.ok(t) && oracleHost!(t) !== OLD.host(t)));
    expect(diffs.slice(0, 10), `${diffs.length} of ${REGIONAL.length} regional tokens build a different host`).toEqual([]);
  });
});

describe("the four places that build an Oracle URL, executed", () => {
  it("reach jpmc.fa.oraclecloud.com for the region-less token, at all four", async () => {
    const u = await urlsFor(REGIONLESS);
    expect(u.list instanceof Error ? u.list.message : u.list, "fetchOracle").toBe(
      `https://jpmc.fa.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList&finder=${encodeURIComponent(`findReqs;siteNumber=CX_1001,limit=${PAGE},offset=0,sortBy=POSTING_DATES_DESC`)}`,
    );
    expect(u.live, "checkLive").toBe(`https://jpmc.fa.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?onlyData=true&finder=${encodeURIComponent("ById;Id=210587260,siteNumber=CX_1001")}`);
    expect(u.detail, "fetchVendorDetail").toBe(`https://jpmc.fa.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=${encodeURIComponent("ById;Id=210587260,siteNumber=CX_1001")}`);
    expect(u.apply, "normalizeOracle").toBe("https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210587260");
  });

  it("answer the liveness question on the region-less host: open when the detail lists it, gone when it does not", async () => {
    answer = { items: [{ Id: "210587260" }] };
    expect(await checkLive(src(REGIONLESS), "210587260", null)).toBe(true);
    answer = { items: [] };
    expect(await checkLive(src(REGIONLESS), "999999999", null)).toBe(false);
  });

  it("read the description on the region-less host", async () => {
    answer = { items: [{ ExternalDescriptionStr: "<p>Builds things.</p>" }] };
    const d = await fetchVendorDetail(src(REGIONLESS), `oracle:${REGIONLESS}:210587260`, "210587260", null);
    expect(d.text).toBe("Builds things.");
  });

  it("build, at all four, the byte-identical URL the old template built for every regional catalogue token", async () => {
    const diffs: string[] = [];
    for (const t of REGIONAL) {
      const u = await urlsFor(t, "4242");
      if (u.list !== OLD.list(t, PAGE)) diffs.push(`fetchOracle ${t}: ${u.list}`);
      if (u.live !== OLD.live(t, "4242")) diffs.push(`checkLive ${t}: ${u.live}`);
      if (u.detail !== OLD.detail(t, "4242")) diffs.push(`fetchVendorDetail ${t}: ${u.detail}`);
      if (u.apply !== OLD.apply(t, "4242")) diffs.push(`normalizeOracle ${t}: ${u.apply}`);
    }
    expect(diffs.slice(0, 8), `${diffs.length} diffs over ${REGIONAL.length} tokens x 4 places`).toEqual([]);
  });

  it("still refuse a token that is not tenant~region~site, before asking anything", async () => {
    for (const bad of ["jpmc~us2", "jpmc~~", "~~CX_1001"]) {
      const u = await urlsFor(bad);
      expect(u.list instanceof Error && u.list.message, `fetchOracle ${bad}`).toBe("bad oracle token");
      expect(u.live, `checkLive ${bad}`).toBeNull();
      expect(u.detail, `fetchVendorDetail ${bad}`).toBeNull();
      expect(u.apply, `normalizeOracle ${bad}`).toBeNull();
    }
  });
});

describe("a recorded JPMorgan Chase feed page (CX_1001, 2026-10-25)", () => {
  const reqs = FIXTURE.items[0].requisitionList as Array<{ Id: string; Title: string }>;
  const jobs = normalize.normalizeOracle(reqs as never, "JPMorgan Chase", REGIONLESS);

  it("normalises every requisition to an apply link on the region-less host", () => {
    expect(reqs.length).toBeGreaterThanOrEqual(5);
    expect(jobs.map((j) => j.applyUrl)).toEqual(reqs.map((r) => `https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/${r.Id}`));
    expect(jobs.map((j) => j.id)).toEqual(reqs.map((r) => `oracle:${REGIONLESS}:${r.Id}`));
    expect(new Set(jobs.map((j) => j.company))).toEqual(new Set(["JPMorgan Chase"]));
  });

  it("keys each row by requisition, so the sub-site dedupe and its repair sweep can see it", () => {
    expect(jobs.map((j) => normalize.oracleReqKeyOfId(j.id))).toEqual(reqs.map((r) => `oracle:jpmc:${r.Id}`));
    expect(normalize.oracleTenantOf(REGIONLESS)).toBe("jpmc");
  });

  it("the page states the tenant's own totals the board will be judged against", () => {
    const it0 = FIXTURE.items[0];
    expect(it0.TotalJobsCount).toBeGreaterThan(5000);
    const inWindow = it0.postingDatesFacet.find((f: { Id: number }) => f.Id === 30)?.TotalCount;
    expect(inWindow).toBeGreaterThan(1000);
  });
});

describe("the catalogue", () => {
  const jpmc = CATALOG.filter((e) => e.token.split("~")[0] === "jpmc" && e.source === "oracle");

  it("carries JPMorgan Chase once, on its one site, under the employer's own name", () => {
    expect(jpmc.map((e) => [e.name, e.source, e.token])).toEqual([["JPMorgan Chase", "oracle", REGIONLESS]]);
  });

  it("moved no carried board's catalogue index: every board before it holds wave 4's place, bar four repointed on purpose", () => {
    // Every position before JPMorgan holds the board (vendor and token) wave 4's catalogue holds
    // there. Until trust round 3 this pinned build-version-guard's whole fingerprint over those
    // boards (000aab18fae6dd65, wave 4's catalogHash at f4ccfeae, names and agency flags
    // included). Round 3 renames boards and moves agency flags in place, which build-version-guard
    // pins, and gives four duplicate iCIMS hosts' places to four Exelon brand boards, so this pins
    // the places alone: (index, vendor, token), with the four repointed places read as the hosts
    // they held. The cold cursor walks a vendor-interleaved list, not this order, so appending
    // still moves about half of that list by one place (n1384); what this pins is that no board
    // was displaced in the catalogue. A census merge that removes or reorders a board before
    // JPMorgan on purpose re-pins build-version-guard too; delete this test then.
    const REPOINTED: Record<number, [string, string]> = {
      38669: ["careers.goldennugget.com", "careers.bge.com"],
      38698: ["careers.keysight.com", "careers.peco.com"],
      38760: ["careers.bpas.com", "careers.pepco.com"],
      41040: ["talent.lla.com", "careers.atlanticcityelectric.com"],
    };
    const before = CATALOG.slice(0, jpmc[0]?.index ?? 0);
    const h = createHash("sha256");
    for (const e of before) {
      h.update(JSON.stringify([e.index, e.source, REPOINTED[e.index]?.[0] ?? e.token]));
      h.update("\n");
    }
    expect(before.length).toBe(44_519);
    expect(h.digest("hex").slice(0, 16)).toBe("8f388176f2692e17");
    for (const [at, [, now]] of Object.entries(REPOINTED)) expect([CATALOG[Number(at)].source, CATALOG[Number(at)].token], at).toEqual(["icims", now]);
  });

  it("holds no other region-less token: every other tenant found on such a host was a sandbox or unreachable", () => {
    expect(ORACLE_TOKENS.filter((t) => t.split("~")[1] === "")).toEqual([REGIONLESS]);
  });

  it("the layoff-filings copy carries the same entry", () => {
    expect(LAYOFF_COPY.filter((e) => e.token === REGIONLESS).map((e) => [e.name, e.source])).toEqual([["JPMorgan Chase", "oracle"]]);
  });

  it("routes the spellings people type to the employer, and leaves 'Chase' a search", () => {
    for (const q of ["JPMorgan", "J.P. Morgan", "JP Morgan", "jpmorgan"]) {
      const r = pickRoute(q, EMPLOYER_ALIASES);
      expect([r.route, r.route === "EMPLOYER" ? r.tokens : null], q).toEqual(["EMPLOYER", [REGIONLESS]]);
    }
    expect(pickRoute("Chase", EMPLOYER_ALIASES).route).not.toBe("EMPLOYER");
  });
});

describe("the census tooling", () => {
  it("builds the same host as the board from every catalogue token, and reads a region-less careers host back to a token", async () => {
    const tooling = await import("../../scripts/oracle-host.mjs").catch(() => null) as null | {
      oracleHost: (t: string) => string;
      oracleTokenOfHost: (h: string, site?: string) => string | null;
    };
    expect(tooling, "scripts/oracle-host.mjs is missing").not.toBeNull();
    const all = [...ORACLE_TOKENS, REGIONLESS, "jpmc~us2", "jpmc~~", "~~CX_1", ""];
    expect(all.filter((t) => tooling!.oracleHost(t) !== oracleHost!(t))).toEqual([]);
    expect(tooling!.oracleTokenOfHost("jpmc.fa.oraclecloud.com")).toBe("jpmc~~CX_1");
    expect(tooling!.oracleTokenOfHost("JPMC.fa.oraclecloud.com", "CX_1001")).toBe(REGIONLESS);
    expect(tooling!.oracleTokenOfHost("ebxr.fa.us2.oraclecloud.com")).toBe("ebxr~us2~CX_1");
    expect(tooling!.oracleTokenOfHost("fa-espx-saasfaprod1.fa.ocs.oraclecloud.com")).toBe("fa-espx-saasfaprod1~ocs~CX_1");
    for (const no of ["fa.oraclecloud.com", "jpmc.oraclecloud.com", "jpmc.fa.oraclecloud.com.evil.example", "a.b.c.fa.oraclecloud.com", "jpmc.fa.us2.oraclecloud.eu"]) {
      expect(tooling!.oracleTokenOfHost(no), no).toBeNull();
    }
  });

  it("the census reads the region-less domain and the yield check reads a region-less posting link", async () => {
    const census = readFileSync(resolve(ROOT, "scripts/census-oracle.mjs"), "utf8");
    expect(census).toMatch(/OC_REGIONS \|\| "[a-z0-9,]*,none"/);
    expect(census).toMatch(/region === "none" \? "fa\.oraclecloud\.com"/);
    const { parseAtsRef } = await import("../../scripts/sweden-jobtech-yield.mjs");
    expect(parseAtsRef("https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210587260")).toMatchObject({ vendor: "oracle", token: REGIONLESS });
    expect(parseAtsRef("https://ebxr.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/1")).toMatchObject({ vendor: "oracle", token: "ebxr~us2~CX_1" });
  });
});
