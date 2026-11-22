// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * THE INSTALL README CHECK FAILS ON A STOPPED FORM VENDOR OR THE OLD CLAUDE STEP.
 *
 * GEO-2 (SEO audit 2026-11-18b). The install repo's README is what the MCP
 * registry, Glama and coding agents read about the connector. On 2026-11-19
 * it still said apply_myself reads an Ashby application form, which the
 * connector stopped with OD14-ASHBY-1, and told Claude users to keep the
 * authentication settings Claude detected, which /agents replaced with the
 * owner's HO-1 choice. scripts/verify-deploy.d/99zzzzzzz-bugs-connector.sh
 * now compares the README with /agents as crawlers are served it, so this
 * file runs that section, with a fake curl that answers the page and the
 * README, on:
 *   - today's README text (lines 20, 28 and the Claude steps as served from
 *     the install repo's main at bc54f12): both GEO-2 lines FAIL, naming
 *     Ashby and the kept detected settings;
 *   - the corrected text (the install repo's re-sync of 2026-11-19): both
 *     PASS, and the job-id sentence's Ashby posting link, which is true
 *     (agent-mcp's job-link reader takes it), is not read as a form reader;
 *   - a README or a page it cannot read, or the bake this round replaced:
 *     INFO, never a PASS over nothing.
 * The page is built from src/config/mcp-tools.ts, marked up as the prerender
 * marks it up, so the check's expectations follow the copy, not a string
 * typed here.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { MCP_CLAUDE_AUTH_CHOICE, MCP_FORM_VENDORS, MCP_HOSTS, MCP_TOOLS, type McpStep } from "../config/mcp-tools";

// Each run is the whole section in bash (a dozen short node processes): seconds, not milliseconds.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-bugs-connector.sh"), "utf8");
const helper = (name: string) => new RegExp(`^${name}\\(\\) \\{.*\\}$`, "m").exec(SCRIPT)?.[0] ?? "";
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const SITE = "https://resumebooster.work";
const README_URL = "https://raw.githubusercontent.com/campbellaabbott-rgb/resumebooster-mcp/main/README.md";

// Answers GET <url> from a JSON map of exact URLs; every other call is a 404 with no body.
const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let url="",D=null,o=null,w=null;
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];else if(x==="-w")w=a[++i];
  else if(["-X","-H","-d","--data","-A","-m","--max-time"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
const pages=JSON.parse(fs.readFileSync(process.env.VD_PAGES,"utf8"));
const hit=Object.prototype.hasOwnProperty.call(pages,url)?pages[url]:null;
const st=hit?hit.status:404,body=hit?hit.body:"";
const hdr="HTTP/2 "+st+"\\r\\n\\r\\n";
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
if(w)out+=w.replace("%{http_code}",String(st));
process.stdout.write(out);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

/** Runs the whole section against the fake curl and returns its GEO-2 verdict lines. */
function geo2(o: { readme?: string | null; readmeStatus?: number; bake?: string }): string[] {
  const dir = mkdtempSync(join(tmpdir(), "vd99bc-geo2-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  const pages: Record<string, { status: number; body: string }> = { [`${SITE}/agents`]: { status: 200, body: o.bake ?? BAKE } };
  if (o.readme !== null) pages[README_URL] = { status: o.readmeStatus ?? 200, body: o.readme ?? README_CORRECTED };
  writeFileSync(join(dir, "pages.json"), JSON.stringify(pages));
  writeFileSync(join(dir, "ledger.json"), JSON.stringify({ reservations: { "bug-round": { ownerDecided: {} } } }));
  const prelude = `set -u\nK=pk_test_geo2; B=https://p.supabase.co; SITE=${SITE}; UA=Googlebot-test\n${BUILD_GE}\n${helper("J")}\n${helper("R")}\n${helper("MC")}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_PAGES: join(dir, "pages.json"), VDBC_LEDGER: join(dir, "ledger.json"), VERIFY_KEYLESS_CALLS: "0",
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return out.split("\n").filter((l) => /^(PASS|FAIL|INFO)  GEO-2 /.test(l));
}
const verdict = (lines: string[], what: RegExp) => lines.find((l) => what.test(l)) ?? `(no line matching ${what})`;
const READERS = /^.{6}GEO-2 form readers/;
const STEP = /^.{6}GEO-2 Claude step/;

// ── /agents as crawlers are served it, built from the copy module ──────────
const applyMyself = MCP_TOOLS.find((t) => t.name === "apply_myself")!.body;
const claude = MCP_HOSTS.find((h) => h.id === "claude")!;
const ctx = { url: "https://x.supabase.co/functions/v1/agent-mcp", key: "" };
/** A step as the prerender renders it: bold labels as <strong>, the note in its own small paragraph. */
const li = (s: McpStep) => `<li class="text-sm text-muted-foreground">${s.text.replace(/\*\*([^*]+)\*\*/g, '<strong class="text-foreground">$1</strong>')}${s.note ? `<p class="text-xs">${s.note}</p>` : ""}</li>`;
const BAKE = `<!doctype html><html><body><h1>Connect your AI</h1><p><code>apply_myself</code> (read-only) — ${applyMyself}</p><ol>${claude.fallbackSteps!(ctx).map(li).join("")}</ol></body></html>`;
const AUTH_STEP = claude.fallbackSteps!(ctx).find((s) => s.text.startsWith("Under authentication"))!;
// The bake as it stood before round A's frontend publish (every string that round replaced still served).
const OLD_BAKE = `<html><body><p>Full detail for one job id, including the complete description text and when the employer's feed last confirmed it open.</p><p>When the employer uses Greenhouse, Ashby, Recruitee, Breezy or Pinpoint, it returns the employer's real application form</p><p>the U.S. federal job feed, whose terms forbid redistributing it as a data feed</p><h4>With a free key (optional — opens every read tool: key_status, debug_search; 1,000 calls a day)</h4><td>Wait for midnight UTC; the unkeyed tools still answer.</td></body></html>`;

// ── The install README: today's lines, word for word, and the corrected ones ──
const JOB_ID_LINE = "Every tool that takes a job (`get_job`, `get_jobs`, `fetch`, `check_jobs_open` and `apply_myself`) takes its id or the posting's link: a `https://resumebooster.work/jobs?job=<id>` link, a `https://resumebooster.work/jobs/posting/` page, or the employer's own Greenhouse, Lever or Ashby posting link.";
const APPLY_TODAY = "`apply_myself` is how a person applies, free and with no key: when the posting's hiring system is Greenhouse, Ashby, Recruitee, Breezy, Pinpoint, Paylocity, Workable, Teamtailor, Lever or BambooHR, it returns the employer's real application form, every question with its options and who should answer it; otherwise it returns the posting's apply link. Inside ChatGPT it reads the form only for Greenhouse or Recruitee.";
const APPLY_CORRECTED = APPLY_TODAY.replace("Greenhouse, Ashby, Recruitee", "Greenhouse, Recruitee");
const STEP_TODAY = "6. Claude shows the authentication settings it detected. Keep them as they are and click **Continue**. Searching, reading postings and applying yourself need no sign-in, so there is nothing to change. Claude cannot change a connector's authentication after it is added, so when this server's sign-in is switched on, you may need to remove the connector and add it again to use the tools that need your account.";
const STEP_CORRECTED = "6. Under authentication, choose **Sign in when needed** and click **Continue**. Searching, reading postings and applying yourself need no sign-in, so Claude asks for none. Once this server's sign-in is switched on, Claude asks you to sign in the first time you use a tool that needs your account; you do not add the connector again.";
const readme = (apply: string, step: string) => [
  "<!-- GENERATED by scripts/build.mjs from mcp.config.json — edit those, not this file. -->",
  "# Resume Booster Job Board — MCP server",
  "",
  JOB_ID_LINE,
  "",
  "## Applying yourself",
  "",
  apply,
  "",
  "### Claude (claude.ai, Claude Desktop, Claude on your phone)",
  "",
  "5. Click **Continue**.",
  step,
  "7. Click **Add**.",
  "",
].join("\n");
const README_TODAY = readme(APPLY_TODAY, STEP_TODAY);
const README_CORRECTED = readme(APPLY_CORRECTED, STEP_CORRECTED);

describe("the fixtures are what they say", () => {
  it("the page names the readers and the authentication step the copy module names, and no Ashby reader", () => {
    expect(applyMyself).toContain(`When the employer uses ${MCP_FORM_VENDORS.map((v) => v.label).slice(0, -1).join(", ")} or ${MCP_FORM_VENDORS.at(-1)!.label}, it returns the employer's real application form`);
    expect(MCP_FORM_VENDORS.map((v) => v.key)).not.toContain("ashby");
    expect(AUTH_STEP.text).toBe(`Under authentication, choose **${MCP_CLAUDE_AUTH_CHOICE}** and click **Continue**.`);
    // The corrected README step is the page's step (text then note), as the install repo's mirror test holds it.
    expect(STEP_CORRECTED).toBe(`6. ${AUTH_STEP.text} ${AUTH_STEP.note}`);
  });
});

describe("today's install README", () => {
  let lines: string[] = [];
  beforeAll(() => { lines = geo2({ readme: README_TODAY }); });

  it("FAILs the form readers line, naming Ashby as the reader /agents does not name", () => {
    expect(verdict(lines, READERS)).toMatch(/^FAIL  GEO-2 form readers: .*names 10 .*among them Ashby, which \/agents does not name as a reader/);
  });

  it("FAILs the Claude step line, naming the page's step and the kept detected settings", () => {
    expect(verdict(lines, STEP)).toMatch(new RegExp(`^FAIL  GEO-2 Claude step: /agents says "Under authentication, choose ${MCP_CLAUDE_AUTH_CHOICE} and click Continue\\."; the install README does not and still says "Keep them as they are and click Continue\\."`));
  });

  it("prints exactly those two GEO-2 lines", () => {
    expect(lines).toHaveLength(2);
  });
});

describe("the corrected install README", () => {
  let lines: string[] = [];
  beforeAll(() => { lines = geo2({ readme: README_CORRECTED }); });

  it("PASSes both lines, though its job-id sentence still names an Ashby posting link (which the job-link reader takes)", () => {
    expect(README_CORRECTED).toContain("Greenhouse, Lever or Ashby posting link");
    expect(verdict(lines, READERS)).toMatch(/^PASS  GEO-2 form readers: .*names 9 .*none that \/agents does not$/);
    expect(verdict(lines, STEP)).toMatch(/^PASS  GEO-2 Claude step: .*the install README says it too$/);
    expect(lines).toHaveLength(2);
  });
});

describe("each half can FAIL alone", () => {
  it("the corrected step with today's reader list FAILs only the readers line", () => {
    const lines = geo2({ readme: readme(APPLY_TODAY, STEP_CORRECTED) });
    expect(verdict(lines, READERS)).toMatch(/^FAIL/);
    expect(verdict(lines, STEP)).toMatch(/^PASS/);
  });

  it("the corrected readers with today's step FAIL only the step line", () => {
    const lines = geo2({ readme: readme(APPLY_CORRECTED, STEP_TODAY) });
    expect(verdict(lines, READERS)).toMatch(/^PASS/);
    expect(verdict(lines, STEP)).toMatch(/^FAIL/);
  });

  it("the new step with the old one left beside it FAILs the step line", () => {
    const lines = geo2({ readme: readme(APPLY_CORRECTED, `${STEP_CORRECTED}\n${STEP_TODAY}`) });
    expect(verdict(lines, STEP)).toMatch(/^FAIL .*says it too and still says "Keep them as they are and click Continue\."/);
  });

  it("a README whose apply sentence lost its reader list FAILs, never PASSes over nothing", () => {
    const lines = geo2({ readme: readme("`apply_myself` is how a person applies, free and with no key.", STEP_CORRECTED) });
    expect(verdict(lines, READERS)).toMatch(/^FAIL  GEO-2 form readers: the install README's apply_myself sentence names no reader list/);
  });
});

describe("what it cannot compare is INFO", () => {
  it("a README that answers 404, or a page with no reader list or no step", () => {
    expect(geo2({ readme: "Not Found", readmeStatus: 404 })).toEqual([expect.stringMatching(/^INFO  GEO-2 the install README could not be read \(HTTP 404\)/)]);
    expect(geo2({ readme: null })).toEqual([expect.stringMatching(/^INFO  GEO-2 the install README could not be read/)]);
    const bare = geo2({ readme: README_TODAY, bake: "<html><body><h1>Connect your AI</h1></body></html>" });
    expect(verdict(bare, READERS)).toMatch(/^INFO/);
    expect(verdict(bare, STEP)).toMatch(/^INFO/);
  });

  it("the bake round A replaced is not a reference: INFO, even for today's README", () => {
    expect(geo2({ readme: README_TODAY, bake: OLD_BAKE })).toEqual([expect.stringMatching(/^INFO  GEO-2 waits for the frontend publish/)]);
  });
});
