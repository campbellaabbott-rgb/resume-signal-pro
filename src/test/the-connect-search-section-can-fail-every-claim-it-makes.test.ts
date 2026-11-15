// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * THE CONNECT SEARCH SECTION CAN FAIL EVERY CLAIM IT MAKES
 * (scripts/verify-deploy.d/99zzzz-ca3-search.sh, connect W1 recheck,
 * 2026-11-08).
 *
 * The deploy note claimed W1 and W3 verified while no section read them: the
 * plan named this section and it was not built. It now reads each claim from
 * the live answer, and this file proves each line can fail:
 *   - the answers a good deploy gives are the SHIPPED agent-mcp handler's own
 *     (booted here over a fake board), so the section judges the real shapes,
 *     and a good deploy prints no FAIL;
 *   - each claim fails alone when its answer is the one before the fix
 *     (main's reading, or the recheck's broken one: "Customer Service TX" as a
 *     town called Service, "visa sponsorship" as the whole board, an EU link
 *     read as a US id);
 *   - the build before this round prints only INFO and asks agent-mcp nothing;
 *   - a keyless refusal for the minute is INFO, never a verdict;
 *   - every POST is job-board with the probe header or an agent-mcp read, and
 *     the publishable key is never printed.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { bootKeylessMcp } from "./helpers/keyless-mcp";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzz-ca3-search.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const J_FN = /^J\(\) \{.*\}$/m.exec(SCRIPT)?.[0] ?? "";
const MC_FN = /^MC\(\) \{.*\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_search";

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string };

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,w=null,data=null;const hs=[];
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];else if(x==="-w")w=a[++i];
  else if(x==="-d"||x==="--data"||x==="--data-binary")data=a[++i];else if(x==="-H")hs.push(a[++i]);else if(["-m","-A","--max-time"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
fs.appendFileSync(process.env.VD_CALLS,"curl\\t"+method+" "+url+(data!==null?"\\t"+data:"")+"\\t"+(hs.some((h)=>/^x-rb-budget: probe$/i.test(h))?"probe":"noprobe")+"\\t"+(hs.find((h)=>/^user-agent:/i.test(h))||"")+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const key=method+" "+url+(data!==null?" "+data:"");
const r=routes.find((x)=>new RegExp(x.match).test(key))||{status:404,body:""};
const st=r.status??200;
const hdr="HTTP/2 "+st+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
const body=r.body??"";if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
if(w)out+=w.split("\\\\n").join("\\n").replace("%{http_code}",String(st));
process.stdout.write(out);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(routes: Route[]): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vdsearch-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "bin", "sleep"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(dir, "bin", "sleep"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n${J_FN}\n${MC_FN}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 85_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  const calls = readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean);
  return { lines: out.split("\n").filter((l) => /^(PASS|FAIL|INFO)/.test(l)), calls, out };
}

const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MCP = "https://p\\.supabase\\.co/functions/v1/agent-mcp";
const BOARD = "https://p\\.supabase\\.co/functions/v1/job-board";
const preflight = (build: string | null): Route => ({ match: `^OPTIONS ${MCP}$`, headers: build ? { "x-fn-build": build } : {} });

/** The section's own calls, in its words: what each tool is sent. */
const GH_IDS = Array.from({ length: 6 }, (_, i) => `greenhouse:acme:${5_000_000 + i}`);
const EU_ID = "greenhouse:eu~imc:4960533101";
const EU_LINK = "https://job-boards.eu.greenhouse.io/imc/jobs/4960533101";
const LINK1 = `https://resumebooster.work/jobs?job=${encodeURIComponent(GH_IDS[0])}`;
const CALLS: Record<string, { tool: string; args: Record<string, unknown>; ua?: string }> = {
  S1: { tool: "search_jobs", args: { query: "registered nurse jobs Austin TX" } },
  S2: { tool: "search_jobs", args: { query: "Customer Service TX" } },
  S3: { tool: "search_jobs", args: { query: "software engineer", location: "London, UK" } },
  S4: { tool: "search_jobs", args: { query: "part-time jobs near Manchester UK" } },
  S5: { tool: "search_jobs", args: { query: "marketing jobs posted this week" } },
  S6: { tool: "search_jobs", args: { query: "jobs at Humana" } },
  S7: { tool: "search_jobs", args: { query: "visa sponsorship software engineer" } },
  S8: { tool: "search_jobs", args: { query: "visa sponsorship" } },
  L: { tool: "check_jobs_open", args: { ids: [LINK1, "not-an-id", EU_LINK] } },
  G1: { tool: "get_jobs", args: { ids: GH_IDS, includeDescription: true } },
  G2: { tool: "get_jobs", args: { ids: GH_IDS.slice(0, 4) } },
  C1: { tool: "search", args: { query: "software engineer" }, ua: "openai-mcp/1.0 (ChatGPT)" },
  Z1: { tool: "search_jobs", args: { query: "registered nurse", location: "78701" } },
};
/** The exact body the section sends for a call, as a route matcher. */
const callMatch = (c: { tool: string; args: Record<string, unknown> }) => `^POST ${MCP} ${esc(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"${c.tool}","arguments":${JSON.stringify(c.args)}}}`)}$`;
const rpcBody = (sc: Record<string, unknown>) => JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify(sc) }], structuredContent: sc } });

/** The shipped handler's own answers to the section's calls, over a board that answers like the live one. */
const GOOD: Record<string, Record<string, unknown>> = {};
const LONG = `About the team.\n${"We build things together. ".repeat(40)}\nRequirements:\n${"Five years of building things. ".repeat(300)}`;
beforeAll(async () => {
  const mcp = await bootKeylessMcp();
  const ok = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
  const row = (i: number) => ({ id: `greenhouse:acme:${7_000 + i}`, source: "greenhouse", title: `Software Engineer ${i}`, company: "Acme", location: "Austin, TX", postedAt: "2026-11-04T00:00:00Z" });
  mcp.board = (body) => {
    if (body.action === "list") {
      if (body.location === "78701") return ok({ jobs: [], total: 0, hasMore: false });
      if (Array.isArray(body.companies) && body.companies.includes("Humana")) {
        return ok({ jobs: [{ ...row(1), id: "workday:humana~wd5~x:R-1", source: "workday", company: "Humana" }], total: 1172, hasMore: true, nextOffset: 10, companiesResolved: [{ asked: "Humana", name: "Humana", tokens: ["humana~wd5~x"] }] });
      }
      return ok({ jobs: Array.from({ length: 10 }, (_, i) => row(i)), total: 120, hasMore: true, nextOffset: 10 });
    }
    if (body.action === "exists") return ok({ open: Object.fromEntries((body.ids as string[]).map((id) => [id, true])), rowTest: "served" });
    if (body.action === "detail") return ok({ job: { id: body.id, source: "greenhouse", title: "Software Engineer", company: "Acme" }, description: LONG });
    return ok({});
  };
  for (const [tag, c] of Object.entries(CALLS)) {
    const r = await mcp.rpc("tools/call", { name: c.tool, arguments: c.args }, c.ua ? { "user-agent": c.ua } : {}) as { result?: { structuredContent?: Record<string, unknown>; content?: Array<{ text: string }>; isError?: boolean } };
    if (!r.result || r.result.isError) throw new Error(`${tag}: the handler refused ${JSON.stringify(r).slice(0, 300)}`);
    GOOD[tag] = r.result.structuredContent ?? JSON.parse(r.result.content![0].text);
  }
}, 120_000);

const answer = (tag: string, sc: Record<string, unknown>): Route => ({ match: callMatch(CALLS[tag]), body: rpcBody(sc) });
const boardRoutes = (): Route[] => [
  { match: `^POST ${BOARD} .*"vendor":"greenhouse"`, body: JSON.stringify({ jobs: GH_IDS.map((id) => ({ id, source: "greenhouse" })) }) },
  { match: `^POST ${BOARD} .*"companies":\\["eu~imc","eu~lookers"\\]`, body: JSON.stringify({ jobs: [{ id: EU_ID, source: "greenhouse" }] }) },
];
const good = (build = "agent-mcp.2026-11-08.1"): Route[] => [preflight(build), ...boardRoutes(), ...Object.keys(CALLS).map((t) => answer(t, GOOD[t]))];
/** One call's answer replaced: the rest of a good deploy stays. */
const goodWith = (tag: string, sc: Record<string, unknown>): Route[] => [answer(tag, sc), ...good()];
const without = (o: Record<string, unknown>, ...keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

describe("the connect search section", () => {
  it("the shipped handler's answers are the ones the claims are about", () => {
    expect(GOOD.S1.locationInterpreted).toMatchObject({ query: "registered nurse", location: "Austin, TX" });
    expect(GOOD.S2.locationInterpreted).toBeUndefined();
    expect(GOOD.S8).toMatchObject({ notSearched: true, jobs: [] });
    expect(GOOD.L.readAs).toMatchObject({ [EU_LINK]: EU_ID, [LINK1]: GH_IDS[0] });
    expect(GOOD.G1.truncatedForSize).toBe(true);
  });

  it("a good deploy passes every claim and fails none", () => {
    const { lines, out } = run(good());
    expect(fails(lines), out).toEqual([]);
    const passed = lines.filter((l) => l.startsWith("PASS")).map((l) => l.slice(6).split(" ")[0]);
    expect(passed, out).toEqual(["agent-mcp", "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "L1", "L2", "G1", "G2", "C1", "Z1"]);
  });

  it("a later build passes", () => {
    const { lines, out } = run(good("agent-mcp.2026-11-20.2"));
    expect(fails(lines), out).toEqual([]);
  });

  it("the build before this round asks agent-mcp nothing and only waits", () => {
    const { lines, calls, out } = run(good("agent-mcp.2026-11-03.1"));
    expect(fails(lines), out).toEqual([]);
    expect(lines.every((l) => l.startsWith("INFO")), out).toBe(true);
    expect(calls.filter((c) => c.startsWith("curl\tPOST"))).toEqual([]);
  });

  it("an agent-mcp with no x-fn-build fails", () => {
    const { lines, out } = run(good().map((r) => (r.match.startsWith("^OPTIONS") ? preflight(null) : r)));
    expect(fails(lines), out).toEqual([expect.stringMatching(/^FAIL {2}agent-mcp preflight carries no x-fn-build/)]);
  });

  const bad: Array<[string, () => Record<string, unknown>]> = [
    ["S1", () => without(GOOD.S1, "locationInterpreted")],
    ["S2", () => ({ ...GOOD.S2, locationInterpreted: { query: "Customer", location: "Service, TX", from: "Service TX", note: '"Service, TX" was kept as written: a city name can span states.' } })],
    ["S3", () => without(GOOD.S3, "locationInterpreted")],
    ["S4", () => ({ ...GOOD.S4, locationInterpreted: { query: "part-time", country: "GB", from: "near Manchester UK" } })],
    ["S5", () => without(GOOD.S5, "locationInterpreted")],
    ["S6", () => without(GOOD.S6, "locationInterpreted", "companiesResolved")],
    ["S7", () => without(GOOD.S7, "locationInterpreted", "sponsorshipNote")],
    ["S8", () => ({ jobs: GOOD.S1.jobs, total: 880_000, hasMore: true, sponsorshipNote: GOOD.S7.sponsorshipNote, locationInterpreted: { query: "", sponsorship: "visa sponsorship", from: "visa sponsorship" } })],
    // main read the whole link as an id, and a non-id as closed.
    ["L1", () => ({ ...without(GOOD.L, "unknown", "unknownNote"), open: { [LINK1]: false, "not-an-id": false, [EU_LINK]: true }, closed: [LINK1, "not-an-id"], readAs: { [EU_LINK]: EU_ID } })],
    // The recheck's EU defect: the link read as a US id the board does not hold.
    ["L2", () => ({ ...GOOD.L, open: { ...(GOOD.L.open as object), [EU_LINK]: false }, readAs: { [LINK1]: GH_IDS[0], [EU_LINK]: "greenhouse:imc:4960533101" } })],
    ["G1", () => ({ ...without(GOOD.G1, "truncatedForSize"), jobs: (GOOD.G1.jobs as Array<Record<string, unknown>>).map((j) => ({ ...j, description: LONG.slice(0, 8_000) })) })],
    ["G2", () => ({ ...without(GOOD.G2, "descriptionsOmitted"), jobs: (GOOD.G2.jobs as Array<Record<string, unknown>>).map((j) => ({ ...j, description: "Build things." })) })],
    ["C1", () => ({ ...GOOD.C1, results: (GOOD.C1.results as Array<Record<string, unknown>>).map((r) => ({ ...r, title: `Software Engineer ${"x".repeat(150)}` })) })],
    ["Z1", () => without(GOOD.Z1, "locationUnrecognised", "locationHint", "locationDidYouMean")],
  ];
  it.each(bad)("%s fails alone when its answer is the one before the fix", (tag, sc) => {
    const call = tag === "L1" || tag === "L2" ? "L" : tag;
    const { lines, out } = run(goodWith(call, sc()));
    expect(fails(lines), out).toEqual([expect.stringMatching(new RegExp(`^FAIL {2}${tag} `))]);
  });

  it("a keyless refusal for the minute is INFO, never a verdict on the build", () => {
    const refused = { jsonrpc: "2.0", id: 1, result: { isError: true, content: [{ type: "text", text: JSON.stringify({ error: "Too many keyless calls this minute from this connection (15 of 15). Nothing was counted for this call." }) }] } };
    const { lines, out } = run([{ match: callMatch(CALLS.S2), body: JSON.stringify(refused) }, ...good()]);
    expect(fails(lines), out).toEqual([]);
    expect(lines.some((l) => /^INFO {2}S2 refused by the keyless allowance, not judged/.test(l)), out).toBe(true);
  });

  it("a posting read right that closed between the list and the check is INFO, not a FAIL", () => {
    const closed = { ...GOOD.L, open: { [LINK1]: false, [EU_LINK]: false }, closed: [LINK1, EU_LINK] };
    const { lines, out } = run(goodWith("L", closed));
    expect(fails(lines), out).toEqual([]);
    expect(lines.filter((l) => /^INFO {2}L[12] the .*closed between the list and the check/.test(l)), out).toHaveLength(2);
  });

  it("only reads: job-board with the probe header, thirteen agent-mcp calls of read tools, and the key never printed", () => {
    const { calls, out } = run(good());
    const posts = calls.filter((c) => c.startsWith("curl\tPOST"));
    const mcp = posts.filter((c) => c.includes("/functions/v1/agent-mcp\t"));
    expect(mcp).toHaveLength(13);
    for (const c of posts) {
      const url = c.split("\t")[1].replace("POST ", "");
      if (url.endsWith("/functions/v1/job-board")) expect(c, c).toMatch(/\tprobe\t/);
      else expect(url).toMatch(/\/functions\/v1\/agent-mcp$/);
    }
    for (const c of mcp) expect(c, c).toMatch(/"name":"(search_jobs|search|check_jobs_open|get_jobs)"/);
    expect(posts.some((c) => /"action":"(refresh|click|report|verify)"/.test(c))).toBe(false);
    expect(out).not.toContain(KEY);
  });

  it("every line it prints starts PASS, FAIL or INFO, after its header", () => {
    const { out } = run(good());
    for (const l of out.split("\n").filter(Boolean)) expect(l, l).toMatch(/^(PASS|FAIL|INFO|== )/);
  });
});
