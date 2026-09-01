/**
 * ORACLE ENTERS THE CENSUS; iCIMS DELIBERATELY DOES NOT.
 *
 * These were the two highest-yield vendors we carry — 161 and 130 postings per
 * board against 1.7 for personio and 11.8 for greenhouse — and the only two
 * with no standing census coverage at all. Every Oracle board discovered is
 * worth ~160 postings, so the gap was expensive.
 *
 * Both were investigated the same way and reached opposite answers, which is
 * the point of this file: the difference is measured, not assumed, and the
 * next person tempted by "just add an icims prefix" should find the receipt
 * rather than repeat the experiment.
 *
 *   ORACLE  hosts are {tenant}.fa.{region}.oraclecloud.com and the list
 *           endpoint answers: TotalJobsCount 906 on a live tenant. Viable.
 *
 *   iCIMS   our fetcher reads https://{token}/api/jobs, and that endpoint
 *           exists only on employers' CUSTOM career domains:
 *             careers-pilotcompany.icims.com/api/jobs -> 404
 *             careers-medallia.icims.com/api/jobs     -> 404
 *             careers.84lumber.com/api/jobs           -> 200  (control)
 *             careers.aarp.org/api/jobs               -> 200  (control)
 *           A crawl prefix on icims.com would enumerate thousands of hosts
 *           every probe then fails to read. Not viable HERE — iCIMS discovery
 *           belongs to the Wayback custom-domain channel that produced 105
 *           employers / ~36.7k postings on 2026-07-25.
 *
 * Oracle stays DISCOVERY-ONLY until names are solved: its payload carries no
 * employer name anywhere, and the runtime takes the display name from the
 * catalog entry, so auto-merging would show users "edel" instead of
 * "Fortinet".
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CENSUS = readFileSync(resolve(__dirname, "../../scripts/census-cluster-all.mjs"), "utf8");
const VERIFY = readFileSync(resolve(__dirname, "../../scripts/verify-all.mjs"), "utf8");
const MERGE = readFileSync(resolve(__dirname, "../../scripts/merge-all.mjs"), "utf8");

describe("oracle is discovered and verified", () => {
  it("has a SURT prefix on the oraclecloud namespace", () => {
    expect(CENSUS).toMatch(/vendor: "oracle", kind: "oracle", surt: "com,oraclecloud,"/);
  });

  it("extracts tenant~region~CX_1 — the shape sources.ts stores", () => {
    // A token in any other shape cannot be verified or merged without
    // translation, and translation is where token formats go to rot.
    expect(CENSUS).toMatch(/\^\(\[a-z0-9-\]\+\)\\\.fa\\\.\(\[a-z0-9-\]\+\)\\\.oraclecloud\\\.com\$/);
    expect(CENSUS).toMatch(/add\("oracle", `\$\{m\[1\]\}~\$\{m\[2\]\}~CX_1`\)/);
  });

  it("verify-all can probe it, or discovery is pointless", () => {
    expect(VERIFY).toMatch(/^\s{2}oracle: async \(t\) => \{/m);
    expect(VERIFY).toMatch(/recruitingCEJobRequisitions/);
  });

  it("counts from TotalJobsCount, not the returned page", () => {
    // The endpoint pages at 25; counting the page would report every large
    // employer as a 25-posting board and discard the vendor's whole advantage.
    const probe = VERIFY.slice(VERIFY.indexOf("  oracle: async (t) =>"));
    expect(probe.slice(0, 1200)).toMatch(/Number\(item\?\.TotalJobsCount\)/);
  });

  it("has its own concurrency and spacing — it is heavier than a JSON list", () => {
    // ukg was appended after oracle 2026-09-01 (vendor #19, one shared host per
    // pod, so it takes oracle's politeness). The pin follows the tail rather
    // than pinning oracle as terminal, which it never needed to be.
    expect(VERIFY).toMatch(/oracle: 6, ukg: 6 \}/);
    expect(VERIFY).toMatch(/oracle: 250, ukg: 250 \}/);
  });
});

describe("oracle does NOT auto-merge yet", () => {
  it("merge-all's vendor list still omits it", () => {
    // Its payload carries no employer name (measured: LegalEmployer,
    // BusinessUnit and Organization all null on a live tenant), and the
    // runtime names boards from the catalog entry — so merging would put
    // tenant codes like "edel" in front of users where "Fortinet" belongs.
    const list = /const VENDORS = \[([^\]]+)\]/.exec(MERGE)?.[1] ?? "";
    expect(list, "merge vendor list not found").not.toBe("");
    expect(list).not.toMatch(/"oracle"/);
  });

  it("the census says WHY it is discovery-only, so nobody 'fixes' it blindly", () => {
    expect(CENSUS).toMatch(/DISCOVERY AND VERIFICATION ONLY/);
    expect(CENSUS).toMatch(/no employer name/);
  });
});

describe("icims is excluded on evidence, not oversight", () => {
  it("has no SURT prefix", () => {
    const surtBlock = CENSUS.slice(CENSUS.indexOf("const SURTS = ["), CENSUS.indexOf("async function curlBuf"));
    const active = surtBlock.split("\n").filter((l) => !l.trim().startsWith("//"));
    expect(active.join("\n")).not.toMatch(/vendor: "icims"/);
  });

  it("records the measurement that rules it out, with both controls", () => {
    // Without the controls this reads as "we tried and it didn't work",
    // which is indistinguishable from a broken probe.
    expect(CENSUS).toMatch(/careers-pilotcompany\.icims\.com\/api\/jobs -> 404/);
    expect(CENSUS).toMatch(/careers\.84lumber\.com\/api\/jobs\s+-> 200 \(control/);
  });
});
