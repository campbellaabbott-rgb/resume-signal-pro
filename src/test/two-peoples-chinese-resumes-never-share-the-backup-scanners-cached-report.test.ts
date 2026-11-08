// @vitest-environment node
//
// Node, not jsdom: the handler is bundled with esbuild (helpers/edge-harness.ts).
/**
 * TWO PEOPLE'S CHINESE RÉSUMÉS NEVER SHARE THE BACKUP SCANNER'S CACHED REPORT
 * (sweep M-S14-064).
 *
 * free-keyword-scan-stream keyed its 24-hour report cache on a "normalised"
 * text whose punctuation strip had no Unicode flag, so it deleted every
 * letter outside A-Z. Two Chinese new-graduate résumés with no Latin contact
 * line -- different names, schools and fields -- both normalised to their
 * dates, '202009202406', and the second visitor (or anyone, free and
 * uncounted) was served the first person's report. A full-width Japanese
 * résumé normalised to nothing at all.
 *
 * Run against the shipped handler, network faked: the key each scan asks the
 * cache for is read from the get_cached_response call, and the cache answers a
 * report only for the key it was stored under.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { codeOf } from "./helpers/strip-comments";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const CLIENT =
  "export function createClient() { const db = globalThis.__streamDb; return { rpc: (n, a) => db.rpc(n, a), from: (t) => db.from(t), auth: { getUser: async () => ({ data: { user: null }, error: null }) } }; }";
const STUBS: Record<string, string> = { "https://esm.sh/@supabase/supabase-js@2": CLIENT };

// Same shape, same dates, different people (the register's two résumés).
const ZHANG_WEI = [
  "张伟", "求职意向：软件工程师", "教育背景", "北京大学 软件工程 学士 2020.09 - 2024.06",
  "实习经历", "字节跳动 后端开发实习生", "负责推荐系统接口开发，优化查询性能，参与代码评审与单元测试编写",
  "专业技能", "熟悉分布式系统、数据库设计与性能调优，具备良好的团队协作与沟通能力，热爱技术并持续学习",
].join("\n");
const LI_NA = [
  "李娜", "求职意向：市场营销专员", "教育背景", "复旦大学 市场营销 学士 2020.09 - 2024.06",
  "实习经历", "联合利华 品牌市场实习生", "协助策划新品上市活动，撰写社交媒体内容，整理消费者调研数据并汇报",
  "专业技能", "熟悉市场调研方法、品牌传播策略与数据分析工具，具备良好的文案写作与跨部门沟通能力，积极主动",
].join("\n");
// Full-width digits and letters only: nothing survived the old key.
const TANAKA = "田中太郎\n職務経歴書\n株式会社サンプル　営業部　２０１８年４月～２０２３年３月\n法人営業として新規顧客開拓を担当し、年間売上目標を三年連続で達成。チームリーダーとして後輩五名の育成を行い、営業手法の標準化に取り組んだ。顧客満足度調査の改善にも貢献した。";
const SUZUKI = "鈴木花子\n職務経歴書\n株式会社テスト　人事部　２０１８年４月～２０２３年３月\n採用担当として新卒および中途採用の計画立案と面接を担当し、採用人数目標を毎年達成。研修制度の見直しを主導し、離職率の低下に貢献した。社内広報の企画運営も行い、説明会の参加者数を前年比で大きく伸ばした。";

/** The key the fork built before this fix, copied from it verbatim: what an old cache entry is stored under. */
const v7KeyOf = (resume: string, country: string, language: string): string => {
  const norm = resume
    .replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").replace(/[^\w\s]/g, "")
    .replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, "").replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, "")
    .replace(/\b\d{5}(-\d{4})?\b/g, "")
    .replace(/\bsr\b/gi, "senior").replace(/\bjr\b/gi, "junior").replace(/\bmgr\b/gi, "manager")
    .replace(/\bdir\b/gi, "director").replace(/\bvp\b/gi, "vice president").replace(/\bexec\b/gi, "executive")
    .replace(/\bassoc\b/gi, "associate").replace(/\basst\b/gi, "assistant").replace(/\badmin\b/gi, "administrator")
    .replace(/\bdev\b/gi, "developer").replace(/\beng\b/gi, "engineer").replace(/\bmkt\b/gi, "marketing")
    .replace(/\bops\b/gi, "operations")
    .replace(/\b(responsible for|duties included|tasked with|worked on|assisted with|helped with|in charge of|accountable for)\b/gi, "")
    .trim().toLowerCase();
  return createHash("sha256").update(`v7|${norm}||${country}|${language}`).digest("hex").slice(0, 32);
};

let handler: EdgeHandler;
let db: FakeDb;
let asked: string[];
let cache: Map<string, Record<string, unknown>>;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = {
    SUPABASE_URL: "https://harness.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-harness",
    SUPABASE_ANON_KEY: "anon_harness",
    LOVABLE_API_KEY: "lovable_harness",
  };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.EdgeRuntime = { waitUntil: () => undefined };
  g.fetch = async (url: string) => {
    if (String(url).includes("ai.gateway.lovable.dev")) return new Response(JSON.stringify({ error: "harness stops at the model" }), { status: 400 });
    return new Response("{}", { status: 200 });
  };
  handler = await loadEdgeHandler("free-keyword-scan-stream", STUBS);
}, 180_000);

const spies: Array<ReturnType<typeof vi.spyOn>> = [];
beforeEach(() => {
  db = new FakeDb();
  asked = [];
  cache = new Map();
  db.rpcs.check_global_rate_limit = () => ({ data: true, error: null });
  db.rpcs.check_rate_limit = () => ({ data: true, error: null });
  db.rpcs.get_cached_response = (a) => {
    asked.push(String(a.p_cache_key));
    return { data: cache.get(String(a.p_cache_key)) ?? null, error: null };
  };
  db.rpcs.acquire_scan_slot = () => ({ data: "slot-1", error: null });
  db.rpcs.release_scan_slot = () => ({ data: null, error: null });
  db.rpcs.log_scan_metric = () => ({ data: null, error: null });
  (globalThis as Record<string, unknown>).__streamDb = db;
  for (const m of ["log", "warn", "error", "info"] as const) spies.push(vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => { while (spies.length) spies.pop()!.mockRestore(); });

async function scan(resumeText: string) {
  const before = asked.length;
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/free-keyword-scan-stream", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer anon_harness", "cf-connecting-ip": "198.51.100.20" },
    body: JSON.stringify({ resumeText, targetCountry: "US", language: "en" }),
  }));
  const text = await res.text();
  const events = [...text.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map((m) => ({ event: m[1], data: JSON.parse(m[2]) as Record<string, unknown> }));
  // The key THIS scan asked for: none if it was refused before the cache.
  return { key: asked.length === before + 1 ? asked[before] : undefined, complete: events.find((e) => e.event === "complete")?.data };
}

/** A report as the cache holds it, naming whose résumé it was made from. */
const reportOf = (whose: string) => ({ atsScoreEstimate: 64, industry: "General", candidateName: whose, summary: `${whose}'s report` });

describe("the backup scanner's cache key", () => {
  it("two different Chinese résumés with the same dates ask the cache for different keys", async () => {
    const a = await scan(ZHANG_WEI);
    const b = await scan(LI_NA);
    expect(a.key, "the scan asked the cache").toMatch(/^[0-9a-f]{32}$/);
    expect(b.key, "the scan asked the cache").toMatch(/^[0-9a-f]{32}$/);
    expect(b.key).not.toBe(a.key);
  });

  it("two different full-width Japanese résumés ask for different keys", async () => {
    const a = await scan(TANAKA);
    const b = await scan(SUZUKI);
    expect(a.key, "the scan asked the cache").toMatch(/^[0-9a-f]{32}$/);
    expect(b.key, "the scan asked the cache").toMatch(/^[0-9a-f]{32}$/);
    expect(b.key).not.toBe(a.key);
  });

  it("the second person is never served the first person's cached report", async () => {
    const a = await scan(ZHANG_WEI);
    cache.set(a.key, reportOf("张伟"));
    expect((await scan(ZHANG_WEI)).complete?.candidateName, "the same résumé still hits its own cache").toBe("张伟");
    const b = await scan(LI_NA);
    expect(b.complete?.candidateName).not.toBe("张伟");
    expect(b.complete?.cached).not.toBe(true);
  });

  it("a report cached under the old key is never served, even to its own résumé's collision", async () => {
    // Stored by 张伟's scan under the old key, which 李娜's résumé also produced.
    expect(v7KeyOf(LI_NA, "US", "en"), "the old key really did collide").toBe(v7KeyOf(ZHANG_WEI, "US", "en"));
    cache.set(v7KeyOf(ZHANG_WEI, "US", "en"), reportOf("张伟"));
    const b = await scan(LI_NA);
    expect(b.key, "the scan asked the cache").toMatch(/^[0-9a-f]{32}$/);
    expect(b.key).not.toBe(v7KeyOf(LI_NA, "US", "en"));
    expect(b.complete?.candidateName).not.toBe("张伟");
  });

  it("whitespace and case alone do not split one résumé's key", async () => {
    const a = await scan(ZHANG_WEI);
    const b = await scan(`  ${ZHANG_WEI.replace(/\n/g, "\n\n  ")}  `);
    expect(a.key, "the scan asked the cache").toMatch(/^[0-9a-f]{32}$/);
    expect(b.key).toBe(a.key);
  });

  it("the key's version moved past the one the colliding entries were stored under", () => {
    const code = codeOf(readFileSync(resolve(__dirname, "../../supabase/functions/free-keyword-scan-stream/index.ts"), "utf8"));
    const v = Number(/const cacheInput = `v(\d+)\|/.exec(code)?.[1]);
    expect(v).toBeGreaterThanOrEqual(8);
  });
});
