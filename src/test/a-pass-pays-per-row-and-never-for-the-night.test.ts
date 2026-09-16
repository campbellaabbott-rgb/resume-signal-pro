/**
 * A PASS PAYS PER ROW, AND NEVER FOR THE NIGHT.
 *
 * The six-hour pass is a SECOND way to be allowed, beside — never inside —
 * rowIsEntitled. That predicate has six call sites in five functions, and
 * two of them (agent-runner's nightly pick, send-agent-digest's morning
 * email) are subscription products: extending it would have made a $29
 * session a one-night subscription. So the pass has its own predicates in
 * _shared/agent-entitlement.ts, only the apply path may ask them, and the
 * two subscription-only functions must never import them. SPEC section 6
 * guard 5.
 *
 * Two questions, asked at two moments, both walked by value here and
 * mutation-checked:
 *   passIsLive / mayApply   "may a NEW request be accepted now" — activated,
 *                           not closed, clock running, an application left.
 *   packetIsFunded          "was THIS row paid for" — a live subscription, or
 *                           the pass stamped on the row at accept; the pass
 *                           window is deliberately NOT re-checked.
 *
 * Structure, over comment-stripped source (the BOARD = RAW.replace idiom):
 * the four apply-path files import mayApply or packetIsFunded; agent-runner
 * and send-agent-digest import none of the three; TIER_SEND_CEILING carries
 * the pass tier at the pass's application count, read from pass.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  mayApply,
  packetIsFunded,
  passIsLive,
  rowIsEntitled,
  TIER_SEND_CEILING,
  tierCeiling,
  effectiveDailyCap,
  type PassRow,
} from "../../supabase/functions/_shared/agent-entitlement.ts";
import { PASS_APPLICATIONS, PASS_TIER } from "../../supabase/functions/_shared/pass.ts";

const NOW = Date.parse("2026-09-17T12:00:00Z");
const hoursFromNow = (h: number) => new Date(NOW + h * 3_600_000).toISOString();

/** A pass that is live at NOW by every clause: the mutations below break one clause each. */
const live = (): PassRow => ({
  activated_at: hoursFromNow(-1),
  expires_at: hoursFromNow(5),
  closed_at: null,
  applications_total: PASS_APPLICATIONS,
  applications_used: PASS_APPLICATIONS - 1,
});

const activeSub = { email: "a@b.com", status: "active", current_period_end: hoursFromNow(24 * 20) };
const lapsedSub = { email: "a@b.com", status: "active", current_period_end: hoursFromNow(-1) };

describe("passIsLive, by value and by mutation", () => {
  it("the fixture is live — every clause holds, one application left", () => {
    expect(passIsLive(live(), NOW)).toBe(true);
  });

  it.each<[string, (p: PassRow) => PassRow]>([
    ["never activated", (p) => ({ ...p, activated_at: null })],
    ["closed", (p) => ({ ...p, closed_at: hoursFromNow(-0.5) })],
    ["clock ended", (p) => ({ ...p, expires_at: hoursFromNow(-0.01) })],
    ["clock ends exactly now", (p) => ({ ...p, expires_at: new Date(NOW).toISOString() })],
    ["no clock at all", (p) => ({ ...p, expires_at: null })],
    ["an unparseable clock", (p) => ({ ...p, expires_at: "not a date" })],
    ["every application spent", (p) => ({ ...p, applications_used: p.applications_total ?? 0 })],
    ["over-spent", (p) => ({ ...p, applications_used: (p.applications_total ?? 0) + 1 })],
    ["no applications at all", (p) => ({ ...p, applications_total: 0, applications_used: 0 })],
  ])("is not live when %s", (_what, mutate) => {
    expect(passIsLive(mutate(live()), NOW)).toBe(false);
  });

  it("null and undefined are not passes", () => {
    expect(passIsLive(null, NOW)).toBe(false);
    expect(passIsLive(undefined, NOW)).toBe(false);
  });

  it("a fresh pass with nothing spent is live from activation to the second before its clock ends", () => {
    const fresh: PassRow = { ...live(), applications_used: 0 };
    expect(passIsLive(fresh, NOW)).toBe(true);
    expect(passIsLive(fresh, Date.parse(fresh.expires_at!) - 1000)).toBe(true);
    expect(passIsLive(fresh, Date.parse(fresh.expires_at!))).toBe(false);
  });
});

describe("mayApply — a live subscription OR a live pass", () => {
  it("either alone allows; neither refuses", () => {
    expect(mayApply(activeSub, null, NOW)).toBe(true);
    expect(mayApply(null, live(), NOW)).toBe(true);
    expect(mayApply(activeSub, live(), NOW)).toBe(true);
    expect(mayApply(null, null, NOW)).toBe(false);
    expect(mayApply(lapsedSub, null, NOW)).toBe(false);
  });

  it("agrees with its two halves on every combination", () => {
    const subs = [null, activeSub, lapsedSub, { status: "canceled" }];
    const passes = [null, live(), { ...live(), closed_at: hoursFromNow(-1) }, { ...live(), activated_at: null }];
    for (const s of subs) {
      for (const p of passes) {
        expect(mayApply(s, p, NOW)).toBe(rowIsEntitled(s, NOW) || passIsLive(p, NOW));
      }
    }
  });
});

describe("packetIsFunded — the row is the receipt", () => {
  it("a live subscription funds any row, stamped or not", () => {
    expect(packetIsFunded(activeSub, { pass_id: null }, NOW)).toBe(true);
    expect(packetIsFunded(activeSub, {}, NOW)).toBe(true);
    expect(packetIsFunded(activeSub, null, NOW)).toBe(true);
  });

  it("a stamped row is funded with a LAPSED subscription and with none — the pass window is not re-checked", () => {
    const stamped = { pass_id: "1c7a0b8e-0000-4000-8000-000000000001" };
    expect(packetIsFunded(lapsedSub, stamped, NOW)).toBe(true);
    expect(packetIsFunded(null, stamped, NOW)).toBe(true);
    // A request accepted at 5:50 and sent at hour seven: the pass is over,
    // the row is still paid for. Asking the pass again here is the day-8 lapse.
    expect(packetIsFunded(null, stamped, NOW + 30 * 3_600_000)).toBe(true);
  });

  it("an unstamped row with no live subscription is not funded", () => {
    expect(packetIsFunded(null, { pass_id: null }, NOW)).toBe(false);
    expect(packetIsFunded(lapsedSub, { pass_id: "" }, NOW)).toBe(false);
    expect(packetIsFunded(null, {}, NOW)).toBe(false);
    expect(packetIsFunded(null, null, NOW)).toBe(false);
  });

  it("only a string id counts as a stamp", () => {
    expect(packetIsFunded(null, { pass_id: 42 as unknown as string }, NOW)).toBe(false);
  });
});

describe("the pass tier's send ceiling is its application count, read from pass.ts", () => {
  it("TIER_SEND_CEILING carries the pass at PASS_APPLICATIONS", () => {
    expect(TIER_SEND_CEILING[PASS_TIER]).toBe(PASS_APPLICATIONS);
    expect(tierCeiling(PASS_TIER)).toBe(PASS_APPLICATIONS);
    expect(PASS_APPLICATIONS).toBeGreaterThan(0);
  });

  it("the candidate's lower choice still wins on a pass; an unknown tier still sends nothing", () => {
    expect(effectiveDailyCap(1, PASS_TIER)).toBe(1);
    expect(effectiveDailyCap(PASS_APPLICATIONS * 3, PASS_TIER)).toBe(PASS_APPLICATIONS);
    expect(effectiveDailyCap(PASS_APPLICATIONS * 3, "pass_")).toBe(0);
  });

  it("the ceiling is READ from pass.ts, not spelled in agent-entitlement.ts", () => {
    const src = readFileSync(resolve(__dirname, "../../supabase/functions/_shared/agent-entitlement.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    expect(src).toMatch(/import \{[^}]*\bPASS_APPLICATIONS\b[^}]*\} from "\.\/pass\.ts"/);
    expect(src).toMatch(/\[PASS_TIER\]: PASS_APPLICATIONS/);
    const ceiling = src.slice(src.indexOf("TIER_SEND_CEILING"), src.indexOf("};", src.indexOf("TIER_SEND_CEILING")));
    expect(ceiling).not.toMatch(new RegExp(`(?<![\\w.])${PASS_APPLICATIONS}(?![\\w.])`));
  });
});

// ── structure: who may ask, who must not ─────────────────────────────────────

const ROOT = resolve(__dirname, "../..");
const codeOf = (rel: string) =>
  readFileSync(resolve(ROOT, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:\w])\/\/[^\n]*/g, "$1 ");

const PASS_PREDICATES = ["mayApply", "passIsLive", "packetIsFunded"] as const;
const importsFromEntitlement = (code: string): string[] => {
  const m = /import\s*\{([^}]*)\}\s*from\s*["']\.\.\/_shared\/agent-entitlement\.ts["']/.exec(code);
  return (m?.[1] ?? "").split(",").map((s) => s.replace(/^\s*type\s+/, "").trim()).filter(Boolean);
};

const APPLY_PATH = [
  "supabase/functions/agent-mcp/index.ts",
  "supabase/functions/apply-agent/index.ts",
  "supabase/functions/apply-broker/index.ts",
];
const SUBSCRIPTION_ONLY = [
  "supabase/functions/agent-runner/index.ts",
  "supabase/functions/send-agent-digest/index.ts",
];

describe("only the apply path asks the pass; the subscription products never do", () => {
  it.each(APPLY_PATH)("%s imports mayApply or packetIsFunded and calls it", (rel) => {
    const code = codeOf(rel);
    const names = importsFromEntitlement(code);
    const used = names.filter((n) => n === "mayApply" || n === "packetIsFunded");
    expect(used, `${rel} must import mayApply or packetIsFunded`).not.toEqual([]);
    for (const n of used) expect(code, `${rel} imports ${n} but never calls it`).toMatch(new RegExp(`\\b${n}\\s*\\(`));
  });

  it("agent-mcp asks mayApply at BOTH apply seams — readiness and the enqueue — and stamps the funding source into the RPC", () => {
    const code = codeOf("supabase/functions/agent-mcp/index.ts");
    const readiness = code.slice(code.indexOf("async function applyReadiness("), code.indexOf("async function runRequestApplication("));
    const seam = code.slice(code.indexOf("async function enqueueApplication("), code.indexOf("async function readApplicationStatus("));
    expect(readiness).toMatch(/mayApply\(/);
    expect(seam).toMatch(/mayApply\(/);
    expect(seam).toMatch(/p_pass_funded: passFunded/);
    // The subscription wins when both hold: consumption never draws on a
    // pass while a plan is live.
    expect(seam).toMatch(/const passFunded = !subscribed;/);
    expect(seam).toMatch(/refuse\("pass"/);
  });

  it("apply-agent prepares only pass-stamped rows for an unsubscribed mandate, copies the stamp onto the packet, and caps by the pass tier", () => {
    const code = codeOf("supabase/functions/apply-agent/index.ts");
    expect(code).toMatch(/\.not\("pass_id", "is", null\)/);
    expect(code).toMatch(/pass_id: q\.pass_id \?\? null,/);
    expect(code).toMatch(/subscribed \? sub\?\.status : PASS_TIER/);
    expect(code).toMatch(/import \{ PASS_TIER \} from "\.\.\/_shared\/pass\.ts"/);
    expect(code).toMatch(/passRowsPrepared/);
  });

  it("apply-broker's last gate asks packetIsFunded of the claimed row, never the pass window", () => {
    const code = codeOf("supabase/functions/apply-broker/index.ts");
    expect(code).toMatch(/if \(!packetIsFunded\(sub, row[^)]*\)\) \{ await unclaim\(\); continue; \}/);
    expect(code).not.toMatch(/passIsLive|mayApply/);
    expect(code).not.toMatch(/from\("agent_passes"\)/);
  });

  it.each(SUBSCRIPTION_ONLY)("%s imports none of the pass predicates and reads no pass row", (rel) => {
    const code = codeOf(rel);
    const names = importsFromEntitlement(code);
    for (const n of PASS_PREDICATES) {
      expect(names, `${rel} must not import ${n} — that is the one-night-subscription bug`).not.toContain(n);
      expect(code).not.toMatch(new RegExp(`\\b${n}\\s*\\(`));
    }
    expect(code).not.toMatch(/agent_passes/);
    expect(code, "the subscription-only functions keep the subscription set").toMatch(/entitledFromRows/);
  });
});

describe("teeth", () => {
  it("the import parser reads names, drops type imports, and the predicate list is what it claims", () => {
    expect(importsFromEntitlement('import {\n  ENTITLEMENT_COLUMNS,\n  mayApply,\n  type PassRow,\n} from "../_shared/agent-entitlement.ts";'))
      .toEqual(["ENTITLEMENT_COLUMNS", "mayApply", "PassRow"]);
    expect(importsFromEntitlement('import { rowIsEntitled } from "../_shared/agent.ts";')).toEqual([]);
  });

  it("a subscription-only copy that imports the pass predicate is caught", () => {
    const code = codeOf("supabase/functions/agent-runner/index.ts");
    const mutated = code.replace(
      /import\s*\{([^}]*)\}\s*from\s*["']\.\.\/_shared\/agent-entitlement\.ts["']/,
      (_m, names) => `import {${names}, passIsLive } from "../_shared/agent-entitlement.ts"`,
    );
    expect(mutated).not.toBe(code);
    expect(importsFromEntitlement(mutated)).toContain("passIsLive");
    expect(importsFromEntitlement(code)).not.toContain("passIsLive");
  });

  it("a comment naming the predicate is stripped before the check", () => {
    const prose = "// passIsLive(x) would be wrong here\nconst ok = entitledFromRows(rows);\n";
    const stripped = prose.replace(/(^|[^:\w])\/\/[^\n]*/g, "$1 ");
    expect(stripped).not.toMatch(/\bpassIsLive\s*\(/);
  });
});
