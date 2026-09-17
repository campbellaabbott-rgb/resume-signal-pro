// THE BOARD HANDS A JOB AND A SEARCH TO THE AGENT — and people find their way.
//
// Measured 2026-09-16 (Googlebot curls, handoff.md §0.2): the live /jobs
// prerender had 42 links and none to /agents; Jobs.tsx had zero occurrences
// of "/agents"; the header nav had no agents item and is hidden under 640px
// with no hamburger; a /jobs?job=<id> link was byte-identical to /jobs for a
// crawler, and nothing anywhere said the id in it is the argument the
// server's detail tools take. A person with a posting or a search on screen
// and an agent of their own had nothing to hand it.
//
// What this file pins, in three layers:
//
//   1. THE BUILDERS (src/lib/agent-handoff.ts), called, never grepped: the
//      posting prompt carries the id verbatim, the MCP URL and never a key;
//      every tool it names is one the mirror registers (and so, by the
//      the-page-says-six guard, one the server answers to); the search
//      mapper emits only keys the server's SEARCH_PROPERTIES declares — read
//      out of the Deno file, the pricing-truth pattern — with the four
//      renames applied and the one widening switch dropped.
//
//   2. THE BEHAVIOUR, judged by the request body (project_live_click_through):
//      the fetch hook is installed BEFORE the mount, DEV is stubbed off and
//      the page runs at the production hostname, so the analytics transport
//      really serialises — the funnel once recorded NOTHING because a bad
//      visitorId 400'd silently (project_analytics_visitor_id), which is why
//      every new event name here is proven to reach the JSON that leaves the
//      browser with the payload the plan names: agent_handoff_job
//      {host, id, sendable}, agent_deeplink_job {host, id},
//      agent_handoff_search {keys, host}, welcome_agent, and nav_agents under
//      testName "nav". Every variant is ≤ 30 characters (track-ab-event's cap;
//      a longer one 400s silently).
//
//   3. THE SOURCE PROPERTIES over comment-stripped code (project_guard_
//      literals): no typed rate or quota remains on the pages this lane
//      touched or in the prerender; the rate mirror equals the migration's
//      c_rate; the pass sentences interpolate in every locale; the private
//      routes are disallowed in every robots.txt block; the prerender's /jobs
//      block links /agents and its /agents block reads the prompt and
//      resource mirrors; the changelog entry is count-free everywhere.
//
// TEETH are proven on mutated copies at the end of each layer.
//
// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://resumebooster.work/jobs" }
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const invoke = vi.fn();
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: (...a: unknown[]) => rpc(...a),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
// The toast is judged by what the page asked it to say: the <Toaster/> that
// paints it lives in App, not on this page.
const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: unknown[]) => toastSpy(...a), useToast: () => ({ toast: toastSpy, toasts: [] }) }));

function stubTable() {
  const th: Record<string, unknown> = {};
  const self = () => th;
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in"]) th[k] = self;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}

import Jobs, { boardFilterBody, type BoardFilterState } from "../pages/Jobs";
import { Header } from "../components/Header";
import { MCP_URL, RATE_COPY } from "../pages/AgentConnect";
import { FREE_KEY_RATE_PER_MIN } from "../config/free-key-limits";
import { MCP_HOSTS, MCP_CHOOSER_HOSTS, MCP_TOOL_NAMES, MCP_FREE_KEY_DAILY_QUOTA, MCP_PROMPTS, MCP_RESOURCES } from "../config/mcp-tools";
import { PASS } from "../config/products";
import { changelog } from "../data/changelog";
import {
  agentPrompt, agentDeepLink, DEEP_LINK_HOST_NAMES, HOST_STORAGE_KEY, SEARCH_ARG_DROPS, SEARCH_ARG_RENAMES,
  searchPrompt, toSearchJobsArgs, tool,
} from "../lib/agent-handoff";

vi.setConfig({ testTimeout: 30_000 });

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
// Line comments first — a line comment holding `/*` (a path glob) would
// otherwise open a block that the block strip runs to the next `*/`.
const strip = (s: string) =>
  s.replace(/^\s*\/\/[^\n]*/gm, " ").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\{\/\*[\s\S]*?\*\/\}/g, " ");
const SLOW = { timeout: 4000 } as const;
const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();

// ───────────────────────── 1. the builders, called ─────────────────────────

/** The server's search_jobs argument names, parsed out of the Deno file. */
function serverSearchProperties(): string[] {
  const src = strip(read("supabase/functions/agent-mcp/index.ts"));
  const start = src.indexOf("const SEARCH_PROPERTIES = {");
  expect(start, "SEARCH_PROPERTIES not found in agent-mcp/index.ts").toBeGreaterThan(-1);
  // The object ends at the first line that is exactly `};` after the opener.
  const end = src.indexOf("\n};", start);
  const body = src.slice(start, end);
  const names = [...body.matchAll(/^\s{2}(\w+):\s*\{/gm)].map((m) => m[1]);
  expect(names.length, "no property names parsed").toBeGreaterThan(15);
  return names;
}

/** Every filter the board can carry, all switched on — the widest body it can send. */
const FULL_STATE: BoardFilterState = {
  q: "nurse -travel", location: "austin", remoteOnly: true, workMode: "", category: "healthcare", inclUncat: true,
  agentOnly: true, country: "US,GB", experience: "mid,senior", companyTokens: ["acme", "beta"], salaryFloor: 90000,
  salaryCeiling: 150000, payBasis: "salaried", statedPayOnly: true, includeUnstatedPay: true, maxYears: 5,
  department: "ICU", vendor: "greenhouse,lever", employmentType: "full_time,contract", hideAgencies: true, freshness: "7",
};

describe("1. the posting prompt", () => {
  const JOB = { id: "greenhouse:acme:1", sendable: false };
  it("carries the id verbatim, the MCP URL, an unkeyed tool first and the keyed check behind its clause, and never a key", () => {
    const p = agentPrompt(JOB);
    expect(p).toContain(`job id "${JOB.id}"`);
    expect(p).toContain(MCP_URL);
    // The first call answers with no key (the wall was a prompt whose first
    // tool needed one); the keyed check follows behind its condition.
    expect(p).toMatch(/call fetch with job id/);
    expect(p).toMatch(/if this connection holds a key or is signed in, call check_apply_support/);
    expect(p).not.toMatch(/rb_live_/);
    expect(p).not.toMatch(/request_application/);
    expect(p.length).toBeLessThan(14_000); // the claude:// prefill cap
  });
  it("names the apply tool only on a sendable posting, and puts the person's yes first", () => {
    const p = agentPrompt({ ...JOB, sendable: true });
    expect(p).toMatch(/request_application needs my explicit yes first/);
  });
  it("every tool a prompt names is one the mirror registers, and tool() refuses one it does not", () => {
    for (const p of [agentPrompt(JOB), agentPrompt({ ...JOB, sendable: true }), searchPrompt({ query: "x" }, { activelyHiring: true })]) {
      const named = [...p.matchAll(/\b([a-z]+_[a-z_]+)\b/g)].map((m) => m[1]);
      expect(named.length).toBeGreaterThan(0);
      for (const n of named) expect(MCP_TOOL_NAMES, `${n} is not a registered tool`).toContain(n);
    }
    expect(() => tool("who_is_hiring")).toThrow(/does not register/);
    // The source names tools only through tool(): a bare "call get_jobs" in
    // a template would bypass the check.
    const src = strip(read("src/lib/agent-handoff.ts"));
    for (const n of MCP_TOOL_NAMES) {
      const bare = new RegExp(`(?<!tool\\(")\\b${n}\\b(?!")`);
      expect(src.replace(/tool\("[a-z_]+"\)/g, "T"), `${n} is spelled outside tool() in agent-handoff.ts`).not.toMatch(bare);
    }
  });
  it("the deep link exists for the two documented schemes only, keyed by names the host mirror carries, and decodes to the prompt", () => {
    for (const n of DEEP_LINK_HOST_NAMES) expect(MCP_HOSTS.map((h) => h.name), `${n} is not a host in MCP_HOSTS`).toContain(n);
    expect(DEEP_LINK_HOST_NAMES.length).toBe(2);
    const p = agentPrompt(JOB);
    for (const n of DEEP_LINK_HOST_NAMES) {
      const link = agentDeepLink(n, p)!;
      expect(link).toMatch(/^claude:\/\/(claude\.ai|code)\/new\?q=/);
      expect(decodeURIComponent(link.split("?q=")[1])).toBe(p);
      expect(link).not.toMatch(/rb_live_/);
    }
    for (const h of MCP_HOSTS) if (!DEEP_LINK_HOST_NAMES.includes(h.name)) expect(agentDeepLink(h.name, p)).toBeNull();
  });
  it("remembers the host under the same key the pass receipt page writes", () => {
    const pass = strip(read("src/pages/AgentPass.tsx"));
    const m = /const HOST_STORAGE_KEY = "([^"]+)";/.exec(pass);
    expect(m, "AgentPass.tsx no longer declares HOST_STORAGE_KEY").toBeTruthy();
    expect(HOST_STORAGE_KEY).toBe(m![1]);
  });
});

describe("1. the search mapper", () => {
  it("emits only keys the server's SEARCH_PROPERTIES declares, from the widest board body, with the sort beside them", () => {
    const server = serverSearchProperties();
    const body = boardFilterBody(FULL_STATE);
    // The widest body carries every board filter (a state that drops one is
    // a vacuous subset check).
    expect(Object.keys(body).length).toBeGreaterThanOrEqual(20);
    const args = toSearchJobsArgs(body, "salary");
    for (const k of Object.keys(args)) expect(server, `${k} is not a search_jobs argument`).toContain(k);
    // The four renames landed under the server's names and nothing under the board's.
    for (const [from, to] of Object.entries(SEARCH_ARG_RENAMES)) {
      expect(body, `${from} is not in the board body — the rename is stale`).toHaveProperty(from);
      expect(args).toHaveProperty(to);
      expect(args).not.toHaveProperty(from);
    }
    expect(args.query).toBe("nurse -travel");
    expect(args.agentReadyOnly).toBe(true);
    expect(args.salaryMin).toBe(90000);
    expect(args.salaryMax).toBe(150000);
    // The widening switch has no argument and is dropped, not renamed.
    for (const k of SEARCH_ARG_DROPS) { expect(body).toHaveProperty(k); expect(args).not.toHaveProperty(k); }
    // The board's array becomes the server's comma list.
    expect(args.companies).toBe("acme,beta");
    expect(args.sort).toBe("salary");
    // Nothing the board did not send appears.
    expect(Object.keys(toSearchJobsArgs({}))).toEqual([]);
  });
  it("the search prompt carries the arguments as JSON, the URL, and names the client-side filter as not included", () => {
    const args = toSearchJobsArgs(boardFilterBody(FULL_STATE), "newest");
    const p = searchPrompt(args, { activelyHiring: true });
    expect(p).toContain(`search_jobs with ${JSON.stringify(args)}`);
    expect(p).toContain(MCP_URL);
    expect(p).toMatch(/"Actively hiring" filter is applied in the browser, not by search_jobs, so it is not included/);
    expect(searchPrompt(args)).not.toMatch(/Actively hiring/);
  });
  it("teeth: a key the server does not declare fails the subset check", () => {
    const server = serverSearchProperties();
    const stray = { ...toSearchJobsArgs(boardFilterBody(FULL_STATE)), includeUncategorised: true, q: "x" };
    const offenders = Object.keys(stray).filter((k) => !server.includes(k));
    expect(offenders).toEqual(["includeUncategorised", "q"]);
  });
});

// ───────────────────────── 2. behaviour, by the request body ───────────────

const ROWS = [
  {
    // breezy: a vendor the apply agent has an adapter for (SENDABLE_VENDORS),
    // so this row wears the chip and its prompt names the apply tool.
    id: "breezy:acme:1", source: "breezy", token: "acme", company: "Acme",
    title: "Staff Engineer", location: "Cambridge", country: "GB",
    salary: "$120,000 – $150,000", salaryMinAnnual: 120000, salaryMaxAnnual: 150000, salaryPeriod: "year", salaryCurrency: "USD",
    workMode: "remote", employmentType: "full_time", experienceBand: "senior", minYears: 6,
    category: "engineering", department: "Platform", agency: false,
    postedAt: ago(3), lastSeen: ago(3), recheckedAt: ago(0), applyUrl: "https://x/1", remote: true,
  },
  {
    id: "workday:beta:2", source: "workday", token: "beta", company: "Beta",
    title: "Warehouse Associate", location: "Austin, TX, USA", country: "US",
    salary: null, salaryMinAnnual: null, salaryMaxAnnual: null, salaryPeriod: null, salaryCurrency: null,
    workMode: "onsite", employmentType: "part_time", experienceBand: null, minYears: null,
    category: "operations", department: null, agency: false,
    postedAt: ago(1), lastSeen: ago(1), recheckedAt: null, applyUrl: "https://x/2", remote: false,
  },
];
type Body = Record<string, unknown>;

/** The analytics bodies that left the browser, in order — this lane's two
 *  test names only (the page also fires the conversion funnel's landing
 *  view on mount, which is not what is being judged here). */
const tracked = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls
  .filter(([u]) => String(u).endsWith("/functions/v1/track-ab-event"))
  .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Body)
  .filter((b) => b.testName === "job_board" || b.testName === "nav");
const clipboard = () => (navigator.clipboard.writeText as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));

function hookFetch() {
  // BEFORE THE MOUNT, so the mount-time record is the baseline and a later
  // body is a change. DEV off and the production hostname (set per file
  // below) so postTrackEvent really serialises.
  vi.stubEnv("DEV", false);
  const spy = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", spy);
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => undefined) }, configurable: true });
  return spy;
}

function mount(path = "/jobs") {
  window.history.replaceState({}, "", path);
  rpc.mockImplementation(async () => ({ data: [], error: null }));
  invoke.mockImplementation(async (fn: string, a: { body?: Body } | undefined) => {
    const b = a?.body ?? {};
    if (fn === "job-fit") return { data: { terms: [] }, error: null };
    if (fn === "job-board" && b.action === "detail") return { data: { job: ROWS.find((r) => r.id === b.id) ?? null, description: "A role." } };
    if (fn === "job-board" && b.action === "facets") return { data: { categories: {}, refreshedAt: ago(0), sources: {}, sourcesAt: ago(0) }, error: null };
    if (fn === "job-board" && b.action === "list") {
      if (b.facetCounts) return { data: { categories: {} } };
      if (b.countOnly) return { data: { total: ROWS.length } };
      return { data: { jobs: ROWS, total: ROWS.length, totalAllCompanies: ROWS.length, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false } };
    }
    return { data: {} };
  });
  return render(<MemoryRouter><Jobs /></MemoryRouter>);
}
const text = () => document.body.textContent ?? "";
const settled = async () => waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
/** The panel is open once its chooser is in the document (the card has none). */
const panelOpen = async () => waitFor(() => expect(screen.getAllByLabelText("Which agent?").length).toBeGreaterThan(0), SLOW);
const panelClosed = () => expect(screen.queryAllByLabelText("Which agent?").length).toBe(0);
const card = (needle: string) => Array.from(document.querySelectorAll<HTMLElement>("[data-job-id]")).find((c) => (c.textContent ?? "").includes(needle))!;
/** The panel's full control: the one beside Share (the card's copy has no chooser). */
const panelHandoff = () => screen.getAllByRole("button", { name: "Open in your agent" }).find((b) => b.parentElement?.querySelector('select[aria-label="Which agent?"]'))!;

describe("2. the hand-offs on /jobs, judged by the request body", () => {
  // The production hostname: isTrackingDisabled() reads window.location.
  beforeEach(() => {
    try { localStorage.clear(); sessionStorage.clear(); } catch { /* blocked */ }
    invoke.mockReset(); rpc.mockReset(); toastSpy.mockReset();
    // jsdom lets the URL be replaced within the same origin only; the file
    // runs under the environment option below so the origin IS production.
    expect(window.location.hostname).toBe("resumebooster.work");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("'Open in your agent' on the detail panel copies a prompt with the id and the MCP URL and fires agent_handoff_job {host, id, sendable}", async () => {
    const fetchSpy = hookFetch();
    mount(); await settled();
    fireEvent.click(card("Staff Engineer"));
    await panelOpen();
    const before = tracked(fetchSpy).length;
    fireEvent.click(panelHandoff());
    await waitFor(() => expect(clipboard().length).toBe(1), SLOW);
    const copied = clipboard()[0];
    expect(copied).toContain('job id "breezy:acme:1"');
    expect(copied).toContain(`(${MCP_URL})`);
    expect(copied).not.toMatch(/rb_live_/);
    // breezy IS a sendable vendor, so the prompt names the apply tool.
    expect(copied).toMatch(/request_application/);
    await waitFor(() => expect(tracked(fetchSpy).length).toBe(before + 1), SLOW);
    const ev = tracked(fetchSpy).at(-1)!;
    expect(ev.testName).toBe("job_board");
    expect(ev.variant).toBe("agent_handoff_job");
    expect(ev.eventType).toBe("view");
    expect(String(ev.visitorId)).toMatch(/^[0-9a-f-]{36}$/);
    expect(ev.metadata).toEqual({ host: MCP_HOSTS[0].name, id: "breezy:acme:1", sendable: true });
    await waitFor(() => expect(toastSpy).toHaveBeenCalledTimes(1), SLOW);
    expect(toastSpy.mock.calls[0][0]).toEqual({ title: "Prompt copied — paste it to your agent. It names this posting and our MCP server." });
  });

  it("the chooser is the host mirror; picking a deep-link host renders a claude:// link that decodes to the prompt and fires agent_deeplink_job {host, id}", async () => {
    const fetchSpy = hookFetch();
    mount(); await settled();
    fireEvent.click(card("Warehouse Associate"));
    await panelOpen();
    // The panel is laid out once per breakpoint, so the chooser exists in
    // each copy; every copy is the host mirror, and each is driven below.
    const selects = screen.getAllByLabelText("Which agent?") as HTMLSelectElement[];
    // Every real app, and never the switchboard's "More…" button: a hand-off cannot open "More…".
    for (const select of selects) expect(Array.from(select.options).map((o) => o.value)).toEqual(MCP_CHOOSER_HOSTS.map((h) => h.name));
    expect(MCP_CHOOSER_HOSTS.map((h) => h.id)).not.toContain("more");
    expect(MCP_CHOOSER_HOSTS.length).toBe(MCP_HOSTS.length - 1);
    // A host with no documented prefill link gets no link at all.
    const plain = MCP_HOSTS.find((h) => !DEEP_LINK_HOST_NAMES.includes(h.name))!.name;
    for (const select of selects) fireEvent.change(select, { target: { value: plain } });
    expect(screen.queryAllByRole("link", { name: /Open there/ })).toEqual([]);
    const host = DEEP_LINK_HOST_NAMES[0];
    for (const select of selects) fireEvent.change(select, { target: { value: host } });
    const link = (await screen.findAllByRole("link", { name: /Open there/ }))[0];
    const href = link.getAttribute("href")!;
    expect(href).toMatch(/^claude:\/\//);
    const prompt = decodeURIComponent(href.split("?q=")[1]);
    expect(prompt).toContain('job id "workday:beta:2"');
    expect(prompt).toContain(MCP_URL);
    expect(prompt).not.toMatch(/request_application/); // workday is not sendable
    // The pick is remembered under the shared key.
    expect(localStorage.getItem(HOST_STORAGE_KEY)).toBe(host);
    const before = tracked(fetchSpy).length;
    // jsdom cannot navigate a claude:// scheme; the click is what is judged.
    document.addEventListener("click", (e) => e.preventDefault(), { once: true, capture: false });
    fireEvent.click(link);
    await waitFor(() => expect(tracked(fetchSpy).length).toBe(before + 1), SLOW);
    const ev = tracked(fetchSpy).at(-1)!;
    expect(ev.variant).toBe("agent_deeplink_job");
    expect(ev.metadata).toEqual({ host, id: "workday:beta:2" });
  });

  it("the card's copy of the control copies for the remembered host and asks nothing", async () => {
    const fetchSpy = hookFetch();
    localStorage.setItem(HOST_STORAGE_KEY, MCP_HOSTS[1].name);
    mount(); await settled();
    const btn = within(card("Warehouse Associate")).getByRole("button", { name: "Open in your agent" });
    expect(card("Warehouse Associate").querySelector("select")).toBeNull();
    const before = tracked(fetchSpy).length;
    fireEvent.click(btn);
    await waitFor(() => expect(clipboard().length).toBe(1), SLOW);
    expect(clipboard()[0]).toContain('job id "workday:beta:2"');
    await waitFor(() => expect(tracked(fetchSpy).length).toBe(before + 1), SLOW);
    expect(tracked(fetchSpy).at(-1)!.metadata).toEqual({ host: MCP_HOSTS[1].name, id: "workday:beta:2", sendable: false });
    // A card click did not also open the panel (stopPropagation).
    panelClosed();
  });

  it("'Send this search to my agent' copies exactly the search_jobs arguments for the filter state on screen, and fires agent_handoff_search {keys, host}", async () => {
    const fetchSpy = hookFetch();
    // A filter state from the address bar — the same one the list request
    // was built from, so the arguments handed over are the request's twin.
    mount("/jobs?q=nurse&location=austin&remote=1&agentOnly=1&salaryFloor=90000&salaryCeiling=150000&noAgencies=1&fresh=7&country=US,GB&inclUncat=1&category=healthcare&sort=salary&activelyHiring=1");
    // The two rows fall to the browser-side filters under this state; the
    // control is there regardless of what the list shows.
    await waitFor(() => expect(screen.getByRole("button", { name: "Send this search to my agent" })).toBeTruthy(), SLOW);
    const before = tracked(fetchSpy).length;
    fireEvent.click(screen.getByRole("button", { name: "Send this search to my agent" }));
    await waitFor(() => expect(clipboard().length).toBe(1), SLOW);
    const copied = clipboard()[0];
    const json = /search_jobs with (\{.*?\}) and show me/.exec(copied)?.[1] ?? "";
    expect(json, "no JSON argument object in the copied prompt").not.toBe("");
    const args = JSON.parse(json) as Body;
    // EXACTLY the arguments for this state: the four renames, the widening
    // switch dropped, the on-screen sort, nothing the state did not carry.
    expect(args).toEqual({
      query: "nurse", location: "austin", remote: true, category: "healthcare", agentReadyOnly: true,
      country: "US,GB", salaryMin: 90000, salaryMax: 150000, excludeAgencies: true, maxAgeDays: 7, sort: "salary",
    });
    expect(copied).toContain(MCP_URL);
    expect(copied).toMatch(/"Actively hiring" filter is applied in the browser/);
    // Every emitted key is one the server declares.
    const server = serverSearchProperties();
    for (const k of Object.keys(args)) expect(server).toContain(k);
    await waitFor(() => expect(tracked(fetchSpy).length).toBe(before + 1), SLOW);
    const ev = tracked(fetchSpy).at(-1)!;
    expect(ev.testName).toBe("job_board");
    expect(ev.variant).toBe("agent_handoff_search");
    expect(ev.metadata).toEqual({ keys: Object.keys(args), host: MCP_HOSTS[0].name });
    // The toast names the browser-side filter as not included, in the
    // guarded moat wording the saved-search toast already uses.
    await waitFor(() => expect(toastSpy).toHaveBeenCalledTimes(1), SLOW);
    const t = toastSpy.mock.calls[0][0] as { title: string; description?: string };
    expect(t.title).toBe("Search copied as a prompt — paste it to your agent.");
    expect(t.description).toMatch(/“Actively hiring” filter[\s\S]*is applied in your browser, not on the board/);
    expect(t.description).not.toMatch(/\{\{/);
  });

  it("an unfiltered board hands over an empty argument object and the order on screen", async () => {
    hookFetch();
    mount(); await settled();
    fireEvent.click(screen.getByRole("button", { name: "Send this search to my agent" }));
    await waitFor(() => expect(clipboard().length).toBe(1), SLOW);
    const json = /search_jobs with (\{.*?\}) and show me/.exec(clipboard()[0])?.[1] ?? "";
    expect(JSON.parse(json)).toEqual({ sort: "newest" });
    await waitFor(() => expect(toastSpy).toHaveBeenCalledTimes(1), SLOW);
    expect((toastSpy.mock.calls[0][0] as { description?: string }).description).toBeUndefined();
  });

  it("the welcome strip's fourth entry links /agents and fires welcome_agent; the Applying row links /agents beside the chip", async () => {
    const fetchSpy = hookFetch();
    mount(); await settled();
    const link = screen.getByRole("link", { name: "Bring your own agent" });
    expect(link.getAttribute("href")).toBe("/agents");
    const before = tracked(fetchSpy).length;
    fireEvent.click(link);
    await waitFor(() => expect(tracked(fetchSpy).length).toBe(before + 1), SLOW);
    expect(tracked(fetchSpy).at(-1)!.variant).toBe("welcome_agent");
    // The panel of a sendable posting: the chip to the plan, and the pass
    // beside it. The tooltip no longer says the plan is the only way.
    fireEvent.click(card("Staff Engineer"));
    await panelOpen();
    const chips = screen.getAllByRole("link", { name: "Agent can apply" });
    expect(chips.length).toBeGreaterThanOrEqual(2); // the card's and the panel's
    for (const c of chips) expect(c.getAttribute("title")).toMatch(/Needs the Agent plan or a live pass\.$/);
    for (const l of screen.getAllByRole("link", { name: "or bring your own agent" })) expect(l.getAttribute("href")).toBe("/agents");
  });

  it("every variant this lane sends fits track-ab-event's cap", () => {
    const src = strip(read("src/pages/Jobs.tsx")) + strip(read("src/components/Header.tsx"));
    const variants = ["agent_handoff_job", "agent_deeplink_job", "agent_handoff_search", "welcome_agent", "nav_agents"];
    for (const v of variants) {
      expect(src, `${v} is not sent anywhere`).toContain(`"${v}"`);
      expect(v.length).toBeLessThanOrEqual(30);
    }
  });
});

describe("2. the header", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  it("carries an Agents item right after Jobs, an icon-only twin where the nav is hidden, and both fire nav_agents under testName nav", async () => {
    const fetchSpy = hookFetch();
    render(<MemoryRouter><Header /></MemoryRouter>);
    const links = screen.getAllByRole("link", { name: "Agents" });
    expect(links.length).toBe(2);
    for (const l of links) expect(l.getAttribute("href")).toBe("/agents");
    // Order in the wide nav: Jobs, then Agents.
    const wide = links.find((l) => (l.textContent ?? "").trim() === "Agents")!;
    const jobs = screen.getByRole("link", { name: "Jobs" });
    expect(jobs.compareDocumentPosition(wide) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The twin is the one that renders under 640px: icon-only, labelled.
    const twin = links.find((l) => (l.textContent ?? "").trim() === "")!;
    expect(twin.className).toMatch(/\bsm:hidden\b/);
    expect(twin.getAttribute("aria-label")).toBe("Agents");
    fireEvent.click(wide);
    await waitFor(() => expect(tracked(fetchSpy).length).toBe(1), SLOW);
    expect(tracked(fetchSpy)[0]).toMatchObject({ testName: "nav", variant: "nav_agents", eventType: "view" });
    fireEvent.click(twin);
    await waitFor(() => expect(tracked(fetchSpy).length).toBe(2), SLOW);
  });
});

// ───────────────────────── 3. the source properties ────────────────────────

/** A typed rate or quota: digits, then requests/calls, then a per-minute or per-day unit. */
const TYPED_RATE = /\b\d[\d,]*\s*(?:requests?|calls?)\s*(?:\/|a |per )\s*(?:minute|min\b|day)/i;
/** "60 requests/minute, 1,000/day" — the retired shape, with the bare "/day" tail. */
const TYPED_RATE_TAIL = /\b\d[\d,]*\/day\b/;

describe("3. no typed rate or quota remains on the pages this lane touched", () => {
  const FILES = ["src/pages/AgentConnect.tsx", "src/pages/Agent.tsx", "src/pages/Jobs.tsx", "src/components/Header.tsx", "scripts/prerender-seo.mjs", "src/lib/agent-handoff.ts"];
  for (const f of FILES) {
    it(`${f}`, () => {
      const code = strip(read(f)).replace(/\$\{[^}]*\}/g, "${…}").replace(/\{\{\w+\}\}/g, "{{…}}");
      expect(code, `${f} types a rate or quota`).not.toMatch(TYPED_RATE);
      expect(code, `${f} types a per-day quota`).not.toMatch(TYPED_RATE_TAIL);
    });
  }
  it("the rate mirror equals api_key_issue's c_rate in the newest migration that defines it", () => {
    const dir = resolve(ROOT, "supabase/migrations");
    const newest = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
      .filter((f) => /FUNCTION public\.api_key_issue\s*\(/.test(read(`supabase/migrations/${f}`))).pop();
    expect(newest, "no migration defines api_key_issue").toBeTruthy();
    const m = /c_rate integer := (\d+);/.exec(read(`supabase/migrations/${newest}`).replace(/--[^\n]*/g, " "));
    expect(m, "api_key_issue no longer declares c_rate — RE-ANCHOR this guard").toBeTruthy();
    expect(FREE_KEY_RATE_PER_MIN).toBe(Number(m![1]));
    expect(RATE_COPY).toEqual({ ratePerMin: FREE_KEY_RATE_PER_MIN, dailyQuota: MCP_FREE_KEY_DAILY_QUOTA });
  });
  it("the rate sentence on /agents and in the prerender is interpolated from the two mirrors, and says the pass raises both", () => {
    const page = strip(read("src/pages/AgentConnect.tsx"));
    expect(page.match(/agentConnect\.rateLine/g)?.length).toBe(2);
    expect(page).toMatch(/\{\{ratePerMin\}\} requests a minute and \{\{dailyQuota\}\} calls a day; a live pass raises both/);
    expect(page).not.toMatch(/Both (kinds )?meter identically/);
    const bake = strip(read("scripts/prerender-seo.mjs"));
    expect(bake).toMatch(/const FREE_KEY_RATE_SENTENCE = `\$\{D\.FREE_KEY_RATE_PER_MIN\} requests a minute and \$\{D\.MCP_FREE_KEY_DAILY_QUOTA\.toLocaleString\("en-US"\)\} calls a day per key; a live pass raises both for its hours`;/);
    expect(bake.match(/\$\{FREE_KEY_RATE_SENTENCE\}/g)?.length).toBe(3);
    expect(bake).not.toMatch(/meter identically/);
    // The data entry the bake bundles exports both mirrors.
    expect(bake).toMatch(/MCP_FREE_KEY_DAILY_QUOTA, MCP_PROMPTS, MCP_RESOURCES \} from "\.\.\/src\/config\/mcp-tools"/);
    expect(bake).toMatch(/export \{ FREE_KEY_RATE_PER_MIN \} from "\.\.\/src\/config\/free-key-limits"/);
  });
  it("teeth: the retired spelling fails the rate regex, and an interpolated sentence passes", () => {
    expect(TYPED_RATE.test("Both kinds meter identically: 60 requests/minute, 1,000/day per key.")).toBe(true);
    expect(TYPED_RATE_TAIL.test("60 requests/minute, 1,000/day per key")).toBe(true);
    expect(TYPED_RATE.test("Every key meters at 60 requests a minute and 1,000 calls a day.")).toBe(true);
    const ok = "A free key meters at {{ratePerMin}} requests a minute and {{dailyQuota}} calls a day".replace(/\{\{\w+\}\}/g, "{{…}}");
    expect(TYPED_RATE.test(ok)).toBe(false);
  });
});

describe("3. the pass sentences this lane added interpolate in every locale", () => {
  const LOCALE_DIR = resolve(ROOT, "src/i18n/locales");
  const files = readdirSync(LOCALE_DIR).filter((f) => f.endsWith(".json"));
  type Doc = Record<string, Record<string, unknown>>;
  const doc = (f: string): Doc => JSON.parse(readFileSync(resolve(LOCALE_DIR, f), "utf8"));
  const EN = doc("en.json");
  const get = (d: Doc, path: string) =>
    path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), d) as string | undefined;
  const KEYS = ["agentPage.connectInstead", "faq.questions.bringYourAgent.answer", "agentConnect.rateLine"];
  const placeholders = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
  it("finds nine locale files", () => expect(files.length).toBe(9));
  for (const f of files) {
    it(`${f}`, () => {
      const d = doc(f);
      for (const k of KEYS) {
        const v = get(d, k);
        expect(v, `${f} lacks ${k}`).toBeTruthy();
        expect(placeholders(v!), `${f} ${k} placeholders`).toEqual(placeholders(get(EN, k)!));
        expect(v!.replace(/\{\{\w+\}\}/g, ""), `${f} ${k} spells a digit`).not.toMatch(/\d/);
      }
      // The retired key came out of this file, and the re-minted one is in.
      expect(get(d, "jobsPage.agentAppliesTip"), `${f} still carries the retired agentAppliesTip`).toBeUndefined();
      expect(get(d, "jobsPage.agentAppliesTip2")).toBeTruthy();
    });
  }
  it("en's placeholders are the pass mirror's names, and the /agent line and the FAQ are wired to it", () => {
    expect(placeholders(get(EN, "agentPage.connectInstead")!)).toEqual(["passHours", "passPrice"]);
    expect(placeholders(get(EN, "faq.questions.bringYourAgent.answer")!)).toEqual(["passApplications", "passHours", "passPrice"]);
    const agent = strip(read("src/pages/Agent.tsx"));
    expect(agent).toMatch(/agentPage\.connectInstead[\s\S]{0,300}\{ passHours: PASS\.sessionHours, passPrice: PASS\.priceUsd \}/);
    expect(agent).toMatch(/to="\/agents"/);
    const faq = strip(read("src/components/FAQ.tsx"));
    expect(faq).toMatch(/"bringYourAgent",/);
    expect(faq).toMatch(/passPrice: PASS\.priceUsd,\s*passHours: PASS\.sessionHours,\s*passApplications: PASS\.applications,/);
    expect([PASS.priceUsd, PASS.sessionHours, PASS.applications].every((n) => Number.isFinite(n))).toBe(true);
  });
});

describe("3. the private routes are disallowed in every robots.txt block", () => {
  const ROBOTS = read("public/robots.txt");
  const parity = read("src/test/sitemap-prerender-parity.test.ts");
  const list = /const PRIVATE_ROUTES = \[([\s\S]*?)\];/.exec(parity)?.[1] ?? "";
  const PRIVATE = [...list.matchAll(/"(\/[^"]+)"/g)].map((m) => m[1]);
  /** robots.txt as blocks: each User-agent line and the directives to the next. */
  const blocks = (txt: string) => {
    const out: Array<{ ua: string; disallow: string[] }> = [];
    for (const line of txt.split("\n")) {
      const l = line.trim();
      if (/^User-agent:/i.test(l)) out.push({ ua: l.replace(/^User-agent:\s*/i, ""), disallow: [] });
      else if (/^Disallow:/i.test(l) && out.length) out[out.length - 1].disallow.push(l.replace(/^Disallow:\s*/i, ""));
    }
    return out;
  };
  const offences = (txt: string) => blocks(txt).flatMap((b) => PRIVATE.filter((r) => !b.disallow.includes(r)).map((r) => `${b.ua} lacks ${r}`));
  it("reads a non-trivial allowlist and a non-trivial robots.txt", () => {
    expect(PRIVATE.length).toBeGreaterThan(8);
    for (const r of ["/agents/pass", "/oauth/consent"]) expect(PRIVATE).toContain(r);
    expect(blocks(ROBOTS).length).toBeGreaterThan(10);
  });
  it("PRIVATE_ROUTES ⊆ Disallow in every named block and in *", () => {
    expect(offences(ROBOTS)).toEqual([]);
    expect(blocks(ROBOTS).some((b) => b.ua === "*")).toBe(true);
  });
  it("teeth: one Disallow line removed from one block is one offence", () => {
    const mutated = ROBOTS.replace("User-agent: Googlebot\nAllow: /\nDisallow: /auth\n", "User-agent: Googlebot\nAllow: /\n");
    expect(mutated).not.toBe(ROBOTS);
    expect(offences(mutated)).toEqual(["Googlebot lacks /auth"]);
    const noConsent = ROBOTS.replace(/Disallow: \/oauth\/consent\n/, "");
    expect(offences(noConsent).length).toBe(1);
  });
});

describe("3. the prerender links the hand-off and lists the attach menu from the mirrors", () => {
  const BAKE = strip(read("scripts/prerender-seo.mjs"));
  const between = (from: string, to: string) => {
    const i = BAKE.indexOf(from); expect(i, `${from} not found`).toBeGreaterThan(-1);
    const j = BAKE.indexOf(to, i); expect(j, `${to} not found after ${from}`).toBeGreaterThan(i);
    return BAKE.slice(i, j);
  };
  it("the /jobs crawler block links /agents and states the URL→id sentence", () => {
    const jobs = between('path: "/jobs",', 'path: "/ghost-job-index",');
    expect(jobs).toMatch(/<a href="\/agents">connect your agent<\/a>/);
    expect(jobs).toMatch(/\/jobs\?job=&lt;id&gt;<\/code> link's id is the argument/);
  });
  it("the /agents block renders prompts and resources off D.MCP_PROMPTS and D.MCP_RESOURCES, after the tools and before the boundary", () => {
    const agents = between('path: "/agents",', 'path: "/freelance-boost",');
    const tools = agents.indexOf("D.MCP_TOOLS.map(");
    const prompts = agents.indexOf("D.MCP_PROMPTS.map(");
    const resources = agents.indexOf("D.MCP_RESOURCES.map(");
    const boundary = agents.indexOf("What your agent can and cannot do");
    expect(tools).toBeGreaterThan(-1);
    expect(prompts).toBeGreaterThan(tools);
    expect(resources).toBeGreaterThan(prompts);
    expect(boundary).toBeGreaterThan(resources);
    // The gate word comes off the mirror's flag, never typed per entry.
    expect(agents).toMatch(/r\.keyed \? "needs a key or sign-in" : "reads with no key"/);
    // No count of prompts or resources is spelled.
    expect(agents).not.toMatch(/\b(?:one|two|three|four|five|\d+)\s+(?:prompts|resources)\b/i);
    expect(MCP_PROMPTS.length).toBeGreaterThan(0);
    expect(MCP_RESOURCES.length).toBeGreaterThan(0);
  });
  it("the page renders the same section from the same mirrors", () => {
    const page = strip(read("src/pages/AgentConnect.tsx"));
    expect(page).toMatch(/MCP_PROMPTS\.map\(/);
    expect(page).toMatch(/MCP_RESOURCES\.map\(/);
    expect(page).not.toMatch(/\b(?:one|two|three|four|five|\d+)\s+(?:prompts|resources)\b/i);
    // No copy claims a host renders a job's resource link.
    expect(page).not.toMatch(/resource_link|renders the link/i);
  });
});

describe("3. the changelog entry is one, dated, and count-free in every locale", () => {
  const ID = "aPassAndAHandOff";
  it("is the newest entry", () => {
    expect(changelog[0]).toEqual({ id: ID, date: "2026-09-16", tags: ["new"] });
  });
  const dir = resolve(ROOT, "src/i18n/changelog");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    it(`${f} carries it with no digit`, () => {
      const e = JSON.parse(readFileSync(resolve(dir, f), "utf8")).changelogEntries[ID];
      expect(e?.title?.length).toBeGreaterThan(4);
      expect(e?.description?.length).toBeGreaterThan(20);
      expect(`${e.title} ${e.description}`).not.toMatch(/\d/);
      expect(`${e.title} ${e.description}`).not.toMatch(/hired|only way/i);
    });
  }
});
