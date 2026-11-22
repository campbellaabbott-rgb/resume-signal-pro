// @vitest-environment node
/**
 * SECTION 98zzzz CAN FAIL WHAT IT CLAIMS, AND NEVER WRITES (SEO audit
 * 2026-11-18, the bake lane built 2026-11-21).
 *
 * The section is sourced against a stubbed site (every request a GET, or the
 * stub throws): once serving what this lane's bake writes, where every claim
 * PASSes, and once serving each defect the audit found, where every claim
 * FAILs and names it. Its other half, the claims as the live site measures
 * them, runs at the publish (scripts/verify-deploy.sh).
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { GHOST_LLMS_SECTIONS } from "../../scripts/prerender-seo.mjs";

vi.setConfig({ testTimeout: 90_000 });

const ROOT = resolve(__dirname, "../..");
const SITE = "https://site.test";
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

const FETCH_STUB = `const fs=require("fs");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
globalThis.fetch=async(url,init)=>{const u=String(url);
if(init&&init.method&&init.method!=="GET")throw new Error("not a GET: "+init.method+" "+u);
const r=routes[u];
if(r===undefined)return new Response("",{status:404,headers:{"content-type":"text/plain"}});
return new Response(r,{status:200,headers:{"content-type":"text/html"}});};
`;
function runSection(routes: Record<string, string>, stated: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), "vd-98zzzz-"));
  dirs.push(dir);
  writeFileSync(join(dir, "fetch.cjs"), FETCH_STUB);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(Object.fromEntries(Object.entries(routes).map(([k, v]) => [`${SITE}${k}`, v]))));
  writeFileSync(join(dir, "stated.txt"), stated);
  writeFileSync(join(dir, "run.sh"), `set -u\nSITE=${SITE}; UA=ua\n. ${JSON.stringify(resolve(ROOT, "scripts/verify-deploy.d/98zzzz-seo-1121-bake.sh"))}\n`);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"),
    VD98ZZZZ_STATED: join(dir, "stated.txt"),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${join(dir, "fetch.cjs")}`.trim(),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 85_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return out.split("\n").filter(Boolean);
}
const line = (lines: string[], id: string) => lines.find((l) => new RegExp(`^(PASS|FAIL|INFO|WARN)\\s+${id} `).test(l)) ?? `(no ${id} line)\n${lines.join("\n")}`;

// ---- The site, as this lane's bake writes it, with a switch for each defect ----
type Bad = Partial<Record<"B2" | "B4" | "B5" | "B6" | "B7" | "B8" | "B9" | "B10" | "B11" | "B12" | "B13" | "B16" | "B17" | "B18" | "B19", boolean>>;
const page = (bodyHtml: string, o: { desc?: string; robots?: string; ld?: unknown[] } = {}) =>
  `<!doctype html><html><head><meta name="description" content="${o.desc ?? "A page."}" /><meta name="robots" content="${o.robots ?? "index, follow"}" />${(o.ld ?? []).map((b) => `<script type="application/ld+json">${JSON.stringify(b)}</script>`).join("")}</head><body><a href="#main-content" class="sr-only">Skip to main content</a><div id="root"><main id="main-content">${bodyHtml}</main></div></body></html>`;
const crumbs = (p: string) => ({ "@type": "BreadcrumbList", itemListElement: [{ position: 1, item: `${SITE}/` }, { position: 2, item: `${SITE}${p}` }] });
const trail = `<nav class="text-xs text-muted-foreground mb-4"><a href="/">Home</a> / here</nav>`;
const P1 = "/jobs/posting/greenhouse/acme/1", P2 = "/jobs/posting/greenhouse/acme/2";
const INDS = ["agriculture", "beauty", "healthcare", "technology", "zoology"];

function site(bad: Bad = {}): { routes: Record<string, string>; stated: string } {
  const r: Record<string, string> = {};
  const jp = (types: string[], validThrough: string) => ({ "@type": "JobPosting", title: "Nurse", employmentType: types, validThrough: `${validThrough}T23:59:59+00:00` });
  r[P1] = page(`<h1>Nurse</h1><p>${bad.B2 ? "" : "Job type: Full-time, Part-time, as the employer's own posting states it."}</p>${bad.B5 ? "" : `<p><a href="/jobs/field/healthcare">More Healthcare &amp; Clinical jobs</a></p>`}`, { ld: [jp(["FULL_TIME", "PART_TIME"], bad.B4 ? "2026-12-20" : "2026-11-30")] });
  r[P2] = page("<h1>Clerk</h1>");
  // Data pages: field links, trails, cite lines, ranked rows.
  const field = bad.B5 ? "Healthcare &amp; Clinical" : `<a href="/jobs/field/healthcare">Healthcare &amp; Clinical</a>`;
  const cite = (p: string) => `<p><strong>How to cite:</strong> Resume Booster, ${SITE}${p}.${bad.B12 ? "" : ` The figures are published under CC BY 4.0 (<a href="https://creativecommons.org/licenses/by/4.0/">licence</a>).`}</p>`;
  const ranked = `<table><tr><td><a href="/jobs/company/x">${bad.B19 ? "SpaceX_Global" : "SpaceX"}</a></td><td>40%</td></tr></table>`;
  for (const p of ["/hiring-trends", "/pay-transparency", "/entry-level-index", "/ghost-job-index"]) {
    const h2 = p === "/ghost-job-index" && !bad.B13 ? `<h2>${GHOST_LLMS_SECTIONS[0].h2}</h2>` : "";
    r[p] = page(`${bad.B11 ? "" : trail}<h1>${p}</h1>${h2}<table><tr><td>${field}</td><td>12</td></tr></table>${ranked}${cite(p)}`, { ld: bad.B11 ? [] : [crumbs(p)] });
  }
  r["/companies"] = page(`${bad.B11 ? "" : trail}<h1>Companies hiring</h1><p>512 employers have a page.</p>`, { ld: bad.B11 ? [] : [crumbs("/companies")] });
  r["/research/ats-score-benchmarks"] = page(`<h1>Benchmarks</h1>${cite("/research/ats-score-benchmarks")}`, { desc: bad.B13 ? "How resumes score against the scanner, measured." : "Median ATS score 61 (middle half 48-72) over 9,120 scans, measured 2026-11-20." });
  r["/jobs/company/dominos"] = page(`<h1>Domino's jobs</h1>${bad.B5 ? "" : `<p>Every employer's openings in that field: <a href="/jobs/field/customer">Customer jobs</a>.</p>`}`);
  // Industry pages: each links all four siblings (in-degree 4), or all link only the first.
  for (const s of INDS) {
    const sibs = bad.B6 ? [INDS[0] === s ? INDS[1] : INDS[0]] : INDS.filter((x) => x !== s);
    const lander = s === "technology" && !bad.B7 ? `<a href="/jobs/field/engineering">See live technology openings</a>` : "";
    const desc = s === "healthcare" ? (bad.B16 ? "Healthcare resume keywords recruiters look for: patient care, patient, patients, plus titles." : "Healthcare resume keywords recruiters look for: patient care, patient, clinical, plus titles.")
      : s === "beauty" ? (bad.B16 ? "Beauty resume keywords recruiters look for: clients beauty, color services, plus titles." : "Beauty resume keywords recruiters look for: color services, styling, plus titles.") : "Keywords.";
    r[`/industries/${s}`] = page(`<h1>${s}</h1>${lander}<nav class="mt-8 flex flex-wrap gap-2 text-xs">${sibs.map((x) => `<a href="/industries/${x}">${x} keywords</a>`).join("")}<a href="/industries">All industries</a></nav>`, { desc });
  }
  r["/es/industrias/healthcare"] = page(bad.B7 ? "<h1>Salud</h1>" : `<h1>Salud</h1><a href="/jobs/field/healthcare">Ver empleos activos</a>`);
  r["/roles/registered-nurse"] = page(bad.B7 ? "<h1>RN</h1>" : `<h1>RN</h1><a href="/jobs/field/healthcare">Live Healthcare jobs on the board</a>`);
  r["/jobs/field/data_ai"] = page(bad.B7 ? "<h1>Data</h1>" : `<h1>Data</h1><p>Resume keywords for this field: <a href="/industries/machine_learning">Machine learning resume keywords</a>.</p>`);
  r["/jobs/field/healthcare"] = page(bad.B18 ? "<h1>Healthcare jobs</h1>" : `<h1>Healthcare jobs</h1><h2>Roles in this field</h2><p><a href="${P1}">registered nurse</a></p>`);
  r["/fr/normes-cv/france"] = bad.B9
    ? page(`<h1>CV en France</h1><footer><a href="/companies">Companies hiring</a></footer>`)
    : page(`<h1>CV en France</h1><footer><a href="/companies">Entreprises qui recrutent</a></footer>`).replace(`<a href="#main-content" class="sr-only">Skip to main content</a>`, `<a href="#main-content" class="sr-only" lang="fr">Aller au contenu principal</a>`);
  r["/guides/ats"] = page(`<h1>ATS guide</h1><p>8 min read · Updated 2026-11-20</p>`, { ld: [{ "@type": "Article", dateModified: bad.B10 ? "2026-11-21" : "2026-11-20" }] });
  r["/jobs/company/openai"] = page("<h1>OpenAI jobs</h1>", { robots: bad.B17 ? "noindex, follow" : "index, follow" });
  r["/landers.json"] = JSON.stringify(bad.B17 ? { pages: [] } : { pages: ["/jobs/company/openai"] });
  r["/llms.txt"] = [`- Ghost Job Index: ${SITE}/ghost-job-index — the board's live measure: ${GHOST_LLMS_SECTIONS[0].clause}.`, `- Companies hiring: ${SITE}/companies — ${bad.B13 ? "600" : "512"} employers with a page of their own.`].join("\n");
  r["/llms-full.txt"] = bad.B12 ? "Cite us." : "Cite us. The figures are published under CC BY 4.0.";
  const posts = [P1, P2];
  r["/posting-pages.json"] = JSON.stringify({ at: "2026-11-21", live: posts, ...(bad.B8 ? {} : { rows: posts.map((p) => ({ path: p, title: "Nurse", company: "Acme", token: "acme", field: "healthcare" })) }) });
  const sitemapPaths = ["/jobs", ...posts, ...INDS.map((s) => `/industries/${s}`), "/guides/ats", ...(bad.B17 ? [] : ["/jobs/company/openai"])];
  r["/sitemap.xml"] = `<?xml version="1.0"?><urlset>${sitemapPaths.map((p) => `<url><loc>${SITE}${p}</loc></url>`).join("")}</urlset>`;
  const at = new Date(Date.now() - 3_600_000).toISOString().slice(0, 16);
  const stated = `# header\n${P1} ${at}Z open {"employerValidThrough":"2026-12-01"}\n`;
  return { routes: r, stated };
}

const CLAIMS = ["B2", "B4", "B5", "B6", "B7", "B8", "B9", "B10", "B11", "B12", "B13", "B16", "B17", "B18", "B19"] as const;

describe("against the bytes this lane's bake writes", () => {
  const { routes, stated } = site();
  const lines = runSection(routes, stated);
  it("every claim PASSes and none FAILs", () => {
    for (const id of CLAIMS) expect(line(lines, id)).toMatch(/^PASS /);
    expect(lines.filter((l) => l.startsWith("FAIL")), lines.join("\n")).toEqual([]);
  });
});

describe("against each defect the audit found", () => {
  const all = Object.fromEntries(CLAIMS.map((id) => [id, true])) as Bad;
  const { routes, stated } = site(all);
  const lines = runSection(routes, stated);
  it.each(CLAIMS)("%s FAILs", (id) => {
    expect(line(lines, id)).toMatch(/^FAIL /);
  });
  it("names what it found", () => {
    expect(line(lines, "B2")).toContain(`${P1} (FULL_TIME)`);
    expect(line(lines, "B4")).toContain("validThrough 2026-12-20 > stated 2026-12-01");
    expect(line(lines, "B6")).toMatch(/industry pages linked by fewer than 4/);
    expect(line(lines, "B7")).toContain("/industries/technology -> /jobs/field/engineering");
    expect(line(lines, "B9")).toContain('"Companies hiring" PRESENT');
    expect(line(lines, "B13")).toContain(`prints no "${GHOST_LLMS_SECTIONS[0].h2}" heading`);
    expect(line(lines, "B19")).toContain('"SpaceX_Global"');
  });
});

describe("a manifest whose rows name no board token, or another board's (review of 2026-11-21)", () => {
  it("B8 FAILs and counts them", () => {
    const { routes, stated } = site();
    routes["/posting-pages.json"] = JSON.stringify({ at: "2026-11-21", live: [P1, P2], rows: [
      { path: P1, title: "Nurse", company: "Acme", field: "healthcare" },
      { path: P2, title: "Clerk", company: "Acme", token: "pnc~wd5~External", field: null },
    ] });
    const b8 = line(runSection(routes, stated), "B8");
    expect(b8).toMatch(/^FAIL /);
    expect(b8).toContain(`2 without the board token of its own path (e.g. ${P1})`);
  });
});

describe("with nothing stated and no role section", () => {
  it("B4 and B18 say so as INFO, not PASS", () => {
    const { routes } = site();
    routes["/jobs/field/healthcare"] = page(`<h1>Healthcare jobs</h1><h2>Roles in this field</h2><p><a href="${P1}">medical assistant</a></p>`);
    const lines = runSection(routes, "# header only\n");
    expect(line(lines, "B4")).toMatch(/^INFO /);
    expect(line(lines, "B18")).toMatch(/^INFO /);
  });
});

describe("the section", () => {
  it("sends nothing but GETs", () => {
    const src = require("node:fs").readFileSync(resolve(ROOT, "scripts/verify-deploy.d/98zzzz-seo-1121-bake.sh"), "utf8") as string;
    expect(src).not.toMatch(/method:\s*"(POST|PUT|PATCH|DELETE)"/);
    expect(src).not.toMatch(/curl[^\n]*-X\s*(POST|PUT|PATCH|DELETE)/);
  });
});
