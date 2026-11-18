// @vitest-environment node
/**
 * LLMS.TXT NAMES THE FORMS /agents NAMES (SEO audit 2026-11-18, CONTENT-4).
 *
 * public/llms.txt said an AI could read the employer's application form "when
 * the employer uses Greenhouse, Ashby, Recruitee, Breezy or Pinpoint": five of
 * the ten hiring systems whose forms the server reads (MCP_FORM_VENDORS), while
 * /agents named all ten. The bake now restates both form sentences from
 * formVendorPhrase, the one list /agents and the server read, and the
 * committed file says the same, so a bake that misses the pattern cannot
 * ship the old five. The unkeyed allowances print with a thousands
 * separator (10,000 and 20,000, not 10000 and 20000).
 *
 * Judged on the files an offline bake writes.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { formVendorPhrase, MCP_ANON_CAPS, MCP_FORM_VENDORS, MCP_FORM_VENDORS_ON_CHATGPT } from "@/config/mcp-tools";

vi.setConfig({ testTimeout: 120_000 });

const ROOT = resolve(__dirname, "../..");
let OUT = "";
function bake(): string {
  if (OUT) return join(OUT, "dist");
  OUT = mkdtempSync(join(tmpdir(), "llms-forms-"));
  mkdirSync(join(OUT, "dist"), { recursive: true });
  copyFileSync(join(ROOT, "index.html"), join(OUT, "dist", "index.html"));
  execFileSync("node", [join(ROOT, "scripts/prerender-seo.mjs")], {
    cwd: ROOT,
    env: { ...process.env, PRERENDER_OUT: OUT, PRERENDER_OFFLINE: "1", VITE_SUPABASE_URL: "", VITE_SUPABASE_PUBLISHABLE_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
  return join(OUT, "dist");
}
afterAll(() => {
  if (OUT && OUT.startsWith(tmpdir())) rmSync(OUT, { recursive: true, force: true });
});

const FORM_SENTENCE = /When the employer uses ([^.;]*?), your AI can read the employer's published application form/;
const CHATGPT_SENTENCE = /Inside ChatGPT, your AI reads the application form only when the employer uses ([^.;]*?)\./;
/** The names in "A, B, C, or D" / "A, B or C" / "A or B". */
const namesIn = (list: string) => list.split(/,\s*(?:or\s+)?|\s+or\s+/).map((x) => x.trim()).filter(Boolean).sort();
const ALL = MCP_FORM_VENDORS.map((v) => v.label).sort();
const ON_CHATGPT = MCP_FORM_VENDORS.filter((v) => MCP_FORM_VENDORS_ON_CHATGPT.includes(v.key)).map((v) => v.label).sort();

describe("the llms.txt form sentences", () => {
  for (const [name, read] of [
    ["the baked llms.txt", () => readFileSync(join(bake(), "llms.txt"), "utf8")],
    ["the committed public/llms.txt", () => readFileSync(join(ROOT, "public/llms.txt"), "utf8")],
  ] as const) {
    it(`${name} names every hiring system whose form the server reads, in formVendorPhrase's words`, () => {
      const text = read();
      const m = FORM_SENTENCE.exec(text);
      expect(m, `${name} carries the form sentence`).not.toBeNull();
      expect(m![1]).toBe(formVendorPhrase("en"));
      expect(namesIn(m![1])).toEqual(ALL);
      const c = CHATGPT_SENTENCE.exec(text);
      expect(c, `${name} carries the ChatGPT sentence`).not.toBeNull();
      expect(c![1]).toBe(formVendorPhrase("en", MCP_FORM_VENDORS_ON_CHATGPT));
      expect(namesIn(c![1])).toEqual(ON_CHATGPT);
    });
  }

  it("names the same hiring systems as the baked /agents page", () => {
    const dist = bake();
    const agents = readFileSync(join(dist, "agents", "index.html"), "utf8");
    const llms = readFileSync(join(dist, "llms.txt"), "utf8");
    const onAgents = /When the employer uses ([^.;<]*?), it returns the employer's real application form/.exec(agents);
    expect(onAgents, "/agents names its form readers").not.toBeNull();
    expect(namesIn(FORM_SENTENCE.exec(llms)![1])).toEqual(namesIn(onAgents![1]));
  });
});

describe("the unkeyed allowances", () => {
  it("print with a thousands separator in llms-full and on /agents", () => {
    const dist = bake();
    const full = readFileSync(join(dist, "llms-full.txt"), "utf8");
    const agents = readFileSync(join(dist, "agents", "index.html"), "utf8");
    const pool = MCP_ANON_CAPS.hostPoolPerDay.toLocaleString("en-US");
    const all = MCP_ANON_CAPS.globalPerDay.toLocaleString("en-US");
    expect(pool).toBe("10,000");
    expect(full).toContain(`Claude's users share ${pool} a day first — ${all} a day across every unkeyed caller`);
    expect(agents).toContain(`a shared pool of ${pool} first`);
    for (const [name, text] of [["llms-full", full], ["/agents", agents]] as const) {
      expect(text, name).not.toMatch(new RegExp(`\\b(?:${MCP_ANON_CAPS.hostPoolPerDay}|${MCP_ANON_CAPS.globalPerDay}) a day|shared pool of ${MCP_ANON_CAPS.hostPoolPerDay}\\b`));
    }
  });
});
