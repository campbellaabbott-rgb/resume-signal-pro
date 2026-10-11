// @vitest-environment node
//
// Node, not jsdom: the handlers are bundled with esbuild (helpers/edge-harness.ts).
/**
 * A LINK IS NOT A JOB DESCRIPTION (sweep S11-032, owner decision 2026-10-11:
 * "the server ignores a URL-only JD"), the server half.
 *
 * WHAT WAS WRONG. The scanner's "Job URL" tab sent "[Job URL: <link>]" as the
 * job description. free-keyword-scan reads anything over 50 characters as a
 * posting, so it asked the model for a Job Match Score against a link and
 * labelled the report's keywords as coming from the job description; the
 * streaming fallback did the same; and the $5 analysis (analyze-resume, which
 * accepts any non-empty description) framed a paid report around the link.
 *
 * WHAT HOLDS NOW, on the three shipped handlers with only the network faked:
 * the old wrapper, a bare link, and a link with a few words beside it reach
 * no prompt and are no posting; a real description (with or without its
 * source link) still reaches the model. The browser's mirror agrees with the
 * server's rule on every input here.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { analyzeResumeHarness, fullAnalysisSession, type Harness } from "./helpers/analyze-resume-harness";
import { scannableJobDescription } from "../../supabase/functions/_shared/job-description-input";
import { scannableJobDescription as browserScannable } from "@/lib/job-description-input";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 240_000 });

const LINK = "https://www.linkedin.com/jobs/view/3912345678";
const WRAPPED = `[Job URL: ${LINK}]\n\n`;
const POSTING = "Senior Financial Analyst. We need FP&A, variance analysis, forecasting and SQL for our corporate finance team in Austin.";
const RESUME = [
  "Jane Doe | jane.doe@example.com", "SUMMARY", "Senior financial analyst with nine years in FP&A and vendor management.",
  "EXPERIENCE", "Senior Financial Analyst, Acme Corp, Jan 2020 - Present", "- Cut vendor spend by $250,000 annually by renegotiating contracts",
  "- Built the quarterly forecasting model used by the CFO", "Financial Analyst, Beta Inc, Mar 2016 - Dec 2019", "- Led month-end close for three business units",
  "EDUCATION", "BSc Economics, State University", "SKILLS", "Excel, SQL, Tableau, financial modeling, budgeting",
].join("\n");

const URL_ONLY = [WRAPPED, LINK, `  ${LINK}  `, `Apply here: ${LINK}`, `[Job URL: ${LINK}]\n\nGreat role!`, "www.indeed.com/viewjob?jk=abc123"];
const REAL = [POSTING, `Job Title: Analyst\nSource: ${LINK}\n\n${POSTING}`, `[Job URL: ${LINK}]\n\n${POSTING}`];

describe("the rule, in both runtimes", () => {
  it("a link with almost nothing beside it is no posting; a description keeps its text", () => {
    for (const s of URL_ONLY) expect(scannableJobDescription(s), JSON.stringify(s)).toBe("");
    expect(scannableJobDescription(POSTING)).toBe(POSTING);
    expect(scannableJobDescription(`[Job URL: ${LINK}]\n\n${POSTING}`)).toBe(POSTING);
    expect(scannableJobDescription("Short note, no link")).toBe("Short note, no link");
    expect(scannableJobDescription(undefined)).toBe("");
    expect(scannableJobDescription(42)).toBe("");
  });
  it("the browser's mirror answers the same on every input", () => {
    for (const s of [...URL_ONLY, ...REAL, "", "Short note, no link", "https://x.y", "Visit www.acme.com for perks. ".repeat(4)]) {
      expect(browserScannable(s), JSON.stringify(s)).toBe(scannableJobDescription(s));
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
const env: Record<string, string> = {
  SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-harness-key-0123456789abcdef",
  SUPABASE_ANON_KEY: "anon_harness",
  LOVABLE_API_KEY: "lovable_harness",
  NOTIFY_SCANS: "false",
};
let prompts: string[] = [];
const spies: Array<ReturnType<typeof vi.spyOn>> = [];
function quiet() {
  for (const m of ["log", "warn", "error", "info"] as const) spies.push(vi.spyOn(console, m).mockImplementation(() => {}));
}
afterEach(() => { while (spies.length) spies.pop()!.mockRestore(); });

function installGateway() {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.EdgeRuntime = { waitUntil: () => undefined };
  g.fetch = async (url: string, init?: RequestInit) => {
    if (String(url).includes("ai.gateway.lovable.dev")) {
      prompts.push(String(init?.body ?? ""));
      return new Response(JSON.stringify({ error: "harness stops at the model" }), { status: 400 });
    }
    return new Response("{}", { status: 200 });
  };
}
function scanDb(): FakeDb {
  const db = new FakeDb();
  db.rpcs.check_global_rate_limit = () => ({ data: true, error: null });
  db.rpcs.check_rate_limit = () => ({ data: true, error: null });
  db.rpcs.get_cached_response = () => ({ data: null, error: null });
  db.rpcs.acquire_scan_slot = () => ({ data: "slot-1", error: null });
  db.rpcs.release_scan_slot = () => ({ data: null, error: null });
  db.rpcs.log_scan_metric = () => ({ data: null, error: null });
  return db;
}

describe("free-keyword-scan (the primary)", () => {
  let handler: EdgeHandler;
  beforeAll(async () => {
    installGateway();
    handler = await loadEdgeHandler("free-keyword-scan", { "_shared/supabase-client.ts": "export const getServiceClient = () => globalThis.__scanDb;" });
  }, 240_000);
  beforeEach(() => {
    prompts = [];
    const db = scanDb();
    // Every query answers empty, whatever chain it is built with.
    const from = () => {
      const builder: Record<string, unknown> = new Proxy({}, {
        get(_t, prop: string) {
          if (prop === "then") return (ok: (r: unknown) => unknown, no?: (e: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok, no);
          if (prop === "maybeSingle" || prop === "single") return () => Promise.resolve({ data: null, error: null });
          return () => builder;
        },
      });
      return builder;
    };
    (globalThis as Record<string, unknown>).__scanDb = {
      rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a), from,
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    };
    quiet();
  });
  const scan = async (jobDescriptionText: string) => {
    installGateway();
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/free-keyword-scan", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer anon_harness", "cf-connecting-ip": "198.51.100.41", "cf-ipcountry": "US" },
      body: JSON.stringify({ resumeText: RESUME, jobDescriptionText, skipCache: true }),
    }));
    return { status: res.status, json: await res.json().catch(() => ({})) as Record<string, unknown> };
  };

  it("a wrapped or bare link reaches no prompt and is not called a job description", async () => {
    for (const jd of [WRAPPED, LINK]) {
      prompts = [];
      const r = await scan(jd);
      expect(prompts.length, `the scan never reached the model: ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`).toBeGreaterThan(0);
      expect(prompts.join("\n"), `${JSON.stringify(jd)} reached the model as a posting`).not.toContain("linkedin.com/jobs");
      expect(r.json.keywordSource, "keywords labelled as the posting's").not.toBe("job_description");
    }
  });

  it("a real description still reaches the model", async () => {
    await scan(POSTING);
    expect(prompts.join("\n")).toContain("variance analysis, forecasting and SQL");
  });
});

describe("free-keyword-scan-stream (the fallback)", () => {
  let handler: EdgeHandler;
  beforeAll(async () => {
    installGateway();
    handler = await loadEdgeHandler("free-keyword-scan-stream", {
      "https://esm.sh/@supabase/supabase-js@2":
        "export function createClient() { const db = globalThis.__streamDb; return { rpc: (n, a) => db.rpc(n, a), from: (t) => db.from(t), auth: { getUser: async () => ({ data: { user: null }, error: null }) } }; }",
    });
  }, 240_000);
  beforeEach(() => { prompts = []; (globalThis as Record<string, unknown>).__streamDb = scanDb(); quiet(); });
  const scan = async (jobDescriptionText: string) => {
    installGateway();
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/free-keyword-scan-stream", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer anon_harness", "cf-connecting-ip": "198.51.100.20" },
      body: JSON.stringify({ resumeText: RESUME, jobDescriptionText, skipCache: true }),
    }));
    await res.text();
  };

  it("a wrapped or bare link reaches no prompt", async () => {
    for (const jd of [WRAPPED, LINK]) {
      prompts = [];
      await scan(jd);
      expect(prompts.length, "the scan never reached the model").toBeGreaterThan(0);
      expect(prompts.join("\n"), JSON.stringify(jd)).not.toContain("linkedin.com/jobs");
    }
  });

  it("a real description still reaches the model", async () => {
    await scan(POSTING);
    expect(prompts.join("\n")).toContain("variance analysis, forecasting and SQL");
  });
});

describe("analyze-resume (the $5 analysis)", () => {
  let h: Harness;
  let seen: string[];
  let realAI: (o: unknown) => Promise<unknown>;
  beforeAll(async () => {
    h = await analyzeResumeHarness();
    realAI = (globalThis as Record<string, unknown>).__fakeAI as (o: unknown) => Promise<unknown>;
  }, 240_000);
  beforeEach(() => {
    h.reset();
    seen = [];
    (globalThis as Record<string, unknown>).__fakeAI = (o: unknown) => { seen.push(JSON.stringify(o)); return realAI(o); };
    quiet();
  });

  it("a paid analysis is not framed around a link", async () => {
    h.sessions.set("cs_link", fullAnalysisSession("cs_link"));
    const r = await h.call({ resumeText: RESUME, jobDescriptionText: WRAPPED, sessionId: "cs_link" });
    expect(r.status).toBe(200);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.join("\n"), "the link reached the paid analysis as the posting").not.toContain("linkedin.com/jobs");
    // The system prompt names the tag; only a posting closes one.
    expect(seen.join("\n")).not.toContain("</job_description>");
  });

  it("a real description still frames it", async () => {
    h.sessions.set("cs_real", fullAnalysisSession("cs_real"));
    await h.call({ resumeText: RESUME, jobDescriptionText: POSTING, sessionId: "cs_real" });
    expect(seen.join("\n")).toContain("variance analysis, forecasting and SQL");
  });
});
