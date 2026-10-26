// @vitest-environment node
/**
 * SECTION 83 C7 JUDGES THE STRINGS REACT RENDERS, NOT THE CHANGELOG THAT
 * QUOTES THEM (the recheck of the merge of main 899be058, 2026-10-25).
 *
 * C7 fetches the served entry and every chunk named en-*, en-GB-* or Index-*
 * and fails on any retired home, FAQ or trust sentence it finds. The
 * changelog's lazy bundle (src/i18n/changelog/en.json) is built as en-*.js
 * too, and main's 18 October entry quotes the old hero sentence to say it was
 * removed. So C7 failed a correct deploy: on main's bake, on the merged bake
 * and on production (en-CQ9twWBz.js and en-GB-DyuRHzvu.js each carry the
 * quote once, inside changelogEntries.theHomePageStoppedSayingAnAgentApplies).
 *
 * This runs section 83 in bash against a local site: the changelog chunk alone
 * quoting a retired sentence PASSes C7, a locale chunk whose hero still says
 * it FAILs, and a chunk that carries the hero and the changelog together is
 * judged on its hero.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { withoutChangelogEntries } from "../../scripts/prerender-retired.mjs";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SECTION = resolve(ROOT, "scripts/verify-deploy.d/83-profiles-design-bake.sh");

/** Built the way vite writes the changelog chunk: the entries object, then the namespace that names it. */
const CHANGELOG_CHUNK = `const e={aPassAndAHandOff:{title:"A pass",description:"x"},theHomePageStoppedSayingAnAgentApplies:{title:"The top of our home page stopped saying an agent applies for you",description:"Until 18 October the top of our home page said “The agent applies for you” and counted “verified openings”."}},t={changelogEntries:e};export{e as changelogEntries,t as default};`;
const HERO_OK = `const o={homeHero:{title:"Live jobs, straight from employers",sub2:"We never submit anything for you."}};export{o as default};`;
const HERO_RETIRED = `const o={homeHero:{title:"Live jobs, straight from employers",sub2:"The agent applies for you."}};export{o as default};`;

type Site = Record<string, string>;
let server: Server;
let base = "";
let site: Site = {};
beforeAll(async () => {
  server = createServer((req, res) => {
    const body = site[(req.url ?? "/").split("?")[0]];
    if (body === undefined) { res.writeHead(404, { "content-type": "text/plain" }); res.end("not found"); return; }
    res.writeHead(200, { "content-type": req.url?.endsWith(".js") ? "text/javascript" : "text/html; charset=utf-8" });
    res.end(body);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const run = (s: Site) => new Promise<string[]>((done, fail) => {
  site = s;
  execFile("bash", ["-c", `. ${JSON.stringify(SECTION)}`], { env: { ...process.env, SITE: base, UA: "vitest" }, encoding: "utf8", timeout: 50_000 }, (err, stdout) => (err ? fail(err) : done(stdout.split("\n").filter((l) => /^(?:PASS|FAIL|INFO)\s+C7\b/.test(l)))));
});
const home = `<html><head><title>Resume Booster</title><script type="module" src="/assets/index-main.js"></script></head><body><h1>Live jobs</h1></body></html>`;
const entry = (chunks: string[]) => `const m={};${chunks.map((c) => `import("./${c}")`).join(";")};`;

describe("C7 reads the strings React renders and leaves the changelog's quotes out", () => {
  it("the changelog chunk alone quoting a retired sentence: PASS", async () => {
    const lines = await run({ "/": home, "/assets/index-main.js": entry(["en-chg.js", "Index-hero.js"]), "/assets/en-chg.js": CHANGELOG_CHUNK, "/assets/Index-hero.js": HERO_OK });
    expect(lines.length, lines.join("\n")).toBe(1);
    expect(lines[0]).toMatch(/^PASS\s+C7 /);
  });
  it("a hero value that still says it: FAIL", async () => {
    const lines = await run({ "/": home, "/assets/index-main.js": entry(["en-chg.js", "en-GB-hero.js"]), "/assets/en-chg.js": CHANGELOG_CHUNK, "/assets/en-GB-hero.js": HERO_RETIRED });
    expect(lines[0]).toMatch(/^FAIL\s+C7 the React bundle still renders 1 retired sentence\(s\): "The agent applies for you"/);
  });
  it("one chunk carrying the hero and the changelog is judged on its hero", async () => {
    const both = (hero: string) => `${hero.replace(/export\{[^}]*\};$/, "")}${CHANGELOG_CHUNK}`;
    expect((await run({ "/": home, "/assets/index-main.js": entry(["en-both.js"]), "/assets/en-both.js": both(HERO_OK) }))[0]).toMatch(/^PASS\s+C7 /);
    expect((await run({ "/": home, "/assets/index-main.js": entry(["en-both.js"]), "/assets/en-both.js": both(HERO_RETIRED) }))[0]).toMatch(/^FAIL\s+C7 the React bundle still renders/);
  });
});

describe("withoutChangelogEntries cuts the entries object and nothing else", () => {
  it("the entries go, the namespace's other keys and the hero stay", () => {
    const cut = withoutChangelogEntries(`${HERO_OK.replace(/export\{[^}]*\};$/, "")}${CHANGELOG_CHUNK}`);
    expect(cut).not.toContain("The agent applies for you");
    expect(cut).toContain("Live jobs, straight from employers");
    expect(cut).toContain("changelogEntries");
  });
  it("an inline namespace (changelogEntries:{...}) and a JSON.parse string are cut too", () => {
    expect(withoutChangelogEntries(`var x={changelogEntries:{a:{d:"“The agent applies for you” {x}"}},other:"keep"};`)).toBe(`var x={changelogEntries:{},other:"keep"};`);
    expect(withoutChangelogEntries(`var x=JSON.parse('{"changelogEntries":{"a":{"d":"The agent applies for you"}},"o":1}');`)).not.toContain("applies for you");
  });
  it("a chunk with no changelog is returned unchanged", () => {
    expect(withoutChangelogEntries(HERO_RETIRED)).toBe(HERO_RETIRED);
  });
});
