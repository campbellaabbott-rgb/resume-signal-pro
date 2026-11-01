// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier's section 7d in bash, with a
// stub for curl, through child_process.
/**
 * 7D JUDGES THE APPROVED PRICING COPY (live verify run 1 after the
 * 2026-10-31 deploy: two FAILs on a true page).
 *
 * 7d's /pricing lines were re-pointed on 2026-10-24 (e6d95d39) to the
 * pricing page of that day, whose description was "One-time tools $2–$59;
 * Pro $45/month.": they wanted "Pro $45/month" in the description and the
 * body, and the description to END with "Pro $45/month.". The switch-over
 * (hp/switch-over, PR #54, merged to main 2026-10-31) is the newer,
 * owner-approved pricing page. Its description, from the English pricing
 * shard (pricingPlans.meta.description), is "Search jobs and scan your résumé
 * free. $5 once for a Full Analysis, or $45 a month for Pro's writing. All
 * sales final.", its body writes "Pro, $45 a month", and section 99 C5
 * requires the description to name both prices. So 7d FAILed the true page:
 * a stale check, not wrong copy.
 *
 * 7d now judges the approved wording: the description is the English shard's
 * own sentence at $5 and $45 (description, or descriptionPro while the Full
 * Analysis is off sale), it prices Pro at $45 a month and names no other
 * price, no pass, no Apply Agent and nothing on 83 C1's retired list; the
 * body (not the title) prices Pro at $45 a month and at nothing else. Each
 * defect the old lines were written to catch still FAILs here: the old
 * description with its retired one-time prices, a wrong Pro price, a pass, the
 * Apply Agent, a description cut short, and a page that no longer sells Pro.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SITE = "https://resumebooster.work";
const MAIN = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
/** 7d, from the /pricing curl to the end of its node block. */
const BLOCK_7D = (/^PR=\$\(curl[\s\S]*?\n'\n(?=\necho "== 7e)/m.exec(MAIN) ?? [""])[0];

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

/** Run a bash fragment whose curl answers from `pages` (keyed by the path the URL ends with). */
function bash(fragment: string, pages: Record<string, string>): string[] {
  const dir = mkdtempSync(join(tmpdir(), "vd-7d-"));
  dirs.push(dir);
  const cases = Object.entries(pages).map(([path, body], i) => {
    writeFileSync(join(dir, `page${i}.html`), body);
    return `    *${JSON.stringify(path)}) cat ${JSON.stringify(join(dir, `page${i}.html`))};;`;
  }).join("\n");
  const prelude = `set -u\nSITE=${SITE}; UA=ua\ncurl() {\n  local u="\${@: -1}"\n  case "$u" in\n${cases}\n    *) : ;;\n  esac\n}\n`;
  writeFileSync(join(dir, "run.sh"), `${prelude}${fragment}\n`);
  const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}` };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return out.split("\n").filter(Boolean);
}
const has = (lines: string[], status: "PASS" | "FAIL" | "INFO", re: RegExp) => lines.some((l) => l.startsWith(`${status}  `) && re.test(l.slice(status.length + 2)));
const show = (lines: string[]) => `\n${lines.join("\n")}`;

// ── the pages ───────────────────────────────────────────────────────────────
const pad = "<p>" + "Search the live board, read each posting in full. ".repeat(60) + "</p>";
const doc = (title: string, head: string, body: string) =>
  `<!doctype html><html><head><title>${title}</title><link rel="canonical" href="${SITE}/pricing" />${head}</head><body>${body}${pad}</body></html>`;
const AGENTS = `<!doctype html><html><head><title>Connect your agent</title><link rel="canonical" href="${SITE}/agents" /></head><body><h1>Connect your agent</h1>${pad}</body></html>`;
const TITLE = "Pricing: free job search, Pro $45 a month | Resume Booster";
/** The live description, read as Googlebot on 2026-10-31 after the deploy. */
const LIVE_DESC = "Search jobs and scan your résumé free. $5 once for a Full Analysis, or $45 a month for Pro's writing. All sales final.";
/** The live body's priced lines, as the bake writes them (scripts/prerender-seo.mjs, the /pricing block). */
const LIVE_BODY = [
  "<h1>Pricing</h1>",
  "<section><h2>Before you buy</h2><ul><li><strong>All sales are final.</strong> No refunds, except where the law requires one.</li>",
  "<li><strong>Pro: US dollars, renews monthly.</strong> Pro is billed in US dollars and renews every month at $45 until you cancel.</li></ul></section>",
  "<section data-plan=\"full-analysis\"><h2>Full Analysis, $5 once</h2><p>Buy the Full Analysis, $5</p></section>",
  "<section data-plan=\"pro\"><h2>Pro, $45 a month</h2><p>The writing tools, for an active search.</p><p>$45 a month, renewing automatically until you cancel.</p><p>Go Pro, $45 a month</p></section>",
  "<section><h2>For builders and companies</h2><p>Builder API (planned), $49 a month</p></section>",
].join("");
const pricing = (desc: string, body = LIVE_BODY, title = TITLE) => doc(title, `<meta name="description" content="${desc}">`, body);
const run = (page: string) => bash(BLOCK_7D, { "/pricing": page, "/agents": AGENTS });

const STATES = /^\/pricing states Pro at \$45 a month in its description and its body/;
const NOT_STATES = /^\/pricing does not state Pro at \$45 a month in both its description and its body/;
const DESC_OK = /^\/pricing description is the approved wording/;

describe("7d's block", () => {
  it("was found, and reads the approved wording from the English pricing shard", () => {
    expect(BLOCK_7D).toMatch(/prerender-retired\.mjs/);
    expect(BLOCK_7D).toMatch(/src\/i18n\/shards\/pricing\/en\.json/);
  });

  it("the live description is the English shard's own sentence at $5 and $45 (so the fixture is today's true page)", () => {
    const meta = JSON.parse(readFileSync(resolve(ROOT, "src/i18n/shards/pricing/en.json"), "utf8")).pricingPlans.meta;
    expect(String(meta.description).replace(/\{\{faPrice\}\}/g, "$5").replace(/\{\{proPrice\}\}/g, "$45")).toBe(LIVE_DESC);
  });
});

describe("today's /pricing PASSes (the two FAILs of run 1 were a stale check)", () => {
  it("the live page PASSes both lines", () => {
    const lines = run(pricing(LIVE_DESC));
    expect(has(lines, "PASS", STATES), show(lines)).toBe(true);
    expect(has(lines, "PASS", DESC_OK), show(lines)).toBe(true);
    expect(lines.filter((l) => l.startsWith("FAIL")), show(lines)).toEqual([]);
  });

  it("an apostrophe written as an entity reads as the same sentence", () => {
    const lines = run(pricing(LIVE_DESC.replace("'", "&#39;")));
    expect(has(lines, "PASS", DESC_OK), show(lines)).toBe(true);
  });

  it("the Pro-only description (the Full Analysis off sale) still sells Pro at $45 and PASSes", () => {
    const lines = run(pricing("Search jobs and scan your résumé free. $45 a month for Pro's writing. All sales final.", LIVE_BODY.replace(/<section data-plan="full-analysis">.*?<\/section>/, "")));
    expect(has(lines, "PASS", STATES), show(lines)).toBe(true);
    expect(has(lines, "PASS", DESC_OK), show(lines)).toBe(true);
  });
});

describe("what the old lines were written to catch still FAILs", () => {
  it("the old description, with the retired one-time tools' prices, FAILs (the old line PASSed it)", () => {
    const lines = run(pricing("One-time tools $2–$59; Pro $45/month."));
    expect(has(lines, "FAIL", /^\/pricing description names a price not on sale \(\$2, \$59\)/), show(lines)).toBe(true);
    expect(has(lines, "PASS", DESC_OK), show(lines)).toBe(false);
  });

  it("a wrong Pro price FAILs both lines", () => {
    const lines = run(pricing(LIVE_DESC.replace("$45", "$49"), LIVE_BODY.replace(/\$45/g, "$49"), TITLE.replace("$45", "$49")));
    expect(has(lines, "FAIL", NOT_STATES), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /^\/pricing description does not price Pro at \$45 a month/), show(lines)).toBe(true);
  });

  it("a description that names a pass FAILs", () => {
    const lines = run(pricing("Search jobs and scan your résumé free. $5 once for a Full Analysis, or $45 a month for Pro's writing, or a pass. All sales final."));
    expect(has(lines, "FAIL", /^\/pricing description names a pass/), show(lines)).toBe(true);
  });

  it("a description that prices the retired pass FAILs on its price", () => {
    const lines = run(pricing("Search jobs and scan your résumé free. $5 once for a Full Analysis, $29 for six hours, or $45 a month for Pro's writing. All sales final."));
    expect(has(lines, "FAIL", /^\/pricing description names a price not on sale \(\$29\)/), show(lines)).toBe(true);
  });

  it("a description that names the Apply Agent FAILs", () => {
    const lines = run(pricing("Search jobs and scan your résumé free. $5 once for a Full Analysis, or $45 a month for Pro's writing and the Apply Agent. All sales final."));
    expect(has(lines, "FAIL", /^\/pricing description names the Apply Agent/), show(lines)).toBe(true);
  });

  it("a description cut short FAILs as not the approved wording", () => {
    const lines = run(pricing("Search jobs and scan your résumé free. $5 once for a Full Analysis, or $45 a month for Pro's"));
    expect(has(lines, "FAIL", /^\/pricing description is not the approved wording/), show(lines)).toBe(true);
    expect(has(lines, "PASS", DESC_OK), show(lines)).toBe(false);
  });

  it("a page that no longer sells Pro (the Full Analysis-only description) FAILs", () => {
    const lines = run(pricing("Search jobs and scan your résumé free. $5 once for a Full Analysis. All sales final.", LIVE_BODY.replace(/<section data-plan="pro">.*?<\/section>/, "").replace(/ Pro is billed[^<]*/, ""), "Pricing: free job search and résumé scans | Resume Booster"));
    expect(has(lines, "FAIL", NOT_STATES), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /^\/pricing description does not price Pro at \$45 a month/), show(lines)).toBe(true);
  });

  it("a body that prices Pro at another figure FAILs, though the description is right", () => {
    const lines = run(pricing(LIVE_DESC, LIVE_BODY.replace("<h2>Pro, $45 a month</h2>", "<h2>Pro, $49 a month</h2>")));
    expect(has(lines, "FAIL", /^\/pricing does not state Pro at \$45 a month in both its description and its body \(.*the body also prices Pro at \$49/), show(lines)).toBe(true);
  });

  it("a body that never prices Pro FAILs: the title is not the body", () => {
    const body = LIVE_BODY.replace(/<section data-plan="pro">.*?<\/section>/, "").replace(/ Pro is billed[^<]*/, "");
    const lines = run(pricing(LIVE_DESC, body));
    expect(has(lines, "FAIL", /^\/pricing does not state Pro at \$45 a month in both its description and its body \(description yes, body no/), show(lines)).toBe(true);
  });

  it("a description that is right in every word but one retired product FAILs on 83 C1's list", () => {
    const lines = run(pricing("Search jobs and scan your résumé free. $5 once for a Full Analysis, or $45 a month for Pro's writing and the Premium Resume Package. All sales final."));
    expect(has(lines, "FAIL", /^\/pricing description sells or names a retired product: the Premium Resume Package/), show(lines)).toBe(true);
    expect(has(lines, "PASS", DESC_OK), show(lines)).toBe(false);
  });
});
