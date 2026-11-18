// SECTION 87 READS THE ENGLISH STRINGS THE BUILD SHIPS.
//
// 87d judges the company page's title form in the English locale chunks the
// entry names. It read only the first 12 en-* names and only chunks written
// as `jobsPage:`; round A (deployed 2026-11-18) added twelve English shards,
// which pushed the whole en-GB chunk to the twentieth name, and en.json has
// shipped one namespace at a time (rb-en_ns_<namespace> chunks, JSON text)
// since 2026-10-18. The live verify printed "title form missing" for a title
// production serves. These cases hold the reader to what the build names,
// read from the section's code with its comment lines removed.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const CODE = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/87-profiles-design-pass-b.sh"), "utf8")
  .split("\n").filter((l) => !/^\s*(\/\/|#)/.test(l)).join("\n");

const line = CODE.split("\n").find((l) => /const enNames = /.test(l)) ?? "";
/** The regexes enNames is built from, as RegExp objects. */
const readers = [...line.matchAll(/matchAll\(\/(.+?)\/g\)/g)].map((m) => new RegExp(m[1], "g"));
const names = (entry: string) => [...new Set(readers.flatMap((re) => [...entry.matchAll(re)].map((m) => m[1])))];
const cap = Number(/\.slice\(0, (\d+)\)/.exec(line)?.[1] ?? 0);
const familyLine = CODE.split("\n").find((l) => /localeNames\.push\(d\)/.test(l)) ?? "";
const family = new RegExp(/\.test\(js\)/.test(familyLine) ? (/if \(\/(.+?)\/\.test\(js\)\)/.exec(familyLine)?.[1] ?? "$^") : "$^");

describe("section 87's English chunk reader", () => {
  it("names both the lazy en-* / en-GB-* chunks and the rb-en_ns_ namespace chunks the entry lists", () => {
    const entry = `const a=()=>import("./en-GB-nkcH_Dl3.js"),b=()=>import("./en-Dh53gBkX.js");const p=["assets/rb-en_ns_jobsPage-DWAwkbrx.js"];`;
    expect(names(entry).sort()).toEqual(["en-Dh53gBkX.js", "en-GB-nkcH_Dl3.js", "rb-en_ns_jobsPage-DWAwkbrx.js"]);
  });

  it("never names the whole-English fallback chunk", () => {
    expect(names(`const p=["assets/rb-en_all-ALL00001.js"];import("./rb-en_all-ALL00001.js");`)).toEqual([]);
  });

  it("reads far more names than the 22 en-* chunks the entry named on 2026-11-18", () => {
    expect(cap).toBeGreaterThanOrEqual(40);
  });

  it("takes a namespace chunk written as JSON text and a module written as an object literal", () => {
    expect(family.test(`JSON.parse('{"jobsPage":{"companySeoTitle":"x"}}')`)).toBe(true);
    expect(family.test(`const e={jobsPage:{companySeoTitle:"x"}}`)).toBe(true);
    expect(family.test(`const e={changelogEntries:{}}`)).toBe(false);
  });
});
