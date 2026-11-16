// @vitest-environment node
/**
 * A CHINESE RÉSUMÉ IS NOT NEARLY EMPTY (bug round S14X-117, M-S14-089).
 *
 * The primary counted words by splitting on spaces. Chinese and Japanese
 * write no space between words, so a full Chinese résumé read as a few dozen
 * words: "only N words extracted", a sparse résumé to the model (expansion
 * advice before anything else), and a one-page verdict for any length. One
 * count now serves every reader (resume-structure.ts countWords, which
 * rule-score.ts imports too): Han and kana at about 1.7 characters a word,
 * every other script by its spaces, so an English count is unchanged.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EdgeHandler } from "./helpers/edge-harness";
import { loadScanners, resetWorld, scanPrimary, world } from "./helpers/free-scan-world";
import { computeParseQuality, countWords } from "../../supabase/functions/free-keyword-scan/resume-structure";
import { countWords as streamCountWords } from "../../supabase/functions/free-keyword-scan-stream/resume-structure";
import { CV_SETS } from "./fixtures/one-cv-in-several-languages";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 240_000 });

/** About 1,200 characters: a senior back-end engineer's résumé, in Chinese. */
const ZH_CV = `王晓明
电话：+86 138 0013 8000 | 邮箱：wang.xiaoming@example.com | 上海
个人简介
八年软件开发经验的高级后端工程师，长期负责电商交易与支付系统的架构设计、性能优化和团队管理。熟悉分布式系统、微服务治理和高并发场景，善于把复杂的业务需求拆解成可落地的技术方案，并带领团队按期交付。
工作经历
高级后端工程师，上海云海科技有限公司，2020年3月 - 至今
- 负责公司核心交易系统的架构设计与开发，支持日均一百万笔订单处理，系统可用性保持在百分之九十九点九以上
- 主导订单服务从单体应用拆分为十二个微服务，接口平均响应时间从八百毫秒降低到一百二十毫秒
- 设计并上线分布式缓存方案，数据库读取压力下降百分之六十，大促期间未出现一次服务中断
- 带领六人后端小组，制定代码评审规范和上线流程，线上事故数量同比减少百分之四十五
- 与产品、测试和运维团队紧密合作，推动持续集成与自动化部署，发布周期从两周缩短到三天
后端工程师，杭州星辰网络技术有限公司，2016年7月 - 2020年2月
- 参与支付网关的开发与维护，对接十余家银行和第三方支付渠道，日均处理交易额超过两千万元
- 重构对账模块，自动对账准确率提升到百分之九十九点八，财务人工核对工作量减少约七成
- 编写接口文档和技术方案，组织内部技术分享二十余次，帮助新同事快速熟悉业务和代码
- 负责消息队列的选型与落地，解决了高峰期消息积压的问题，峰值吞吐量提升三倍
项目经历
会员积分平台重构，2021年5月 - 2021年12月
- 负责积分账户和兑换流程的整体设计，把原有三套积分逻辑合并为一套，减少重复开发和维护成本
- 引入灰度发布和全链路压测，新平台上线当天承接三百万会员的迁移，没有出现数据错误
- 输出迁移手册和应急预案，协调客服与运营团队完成用户沟通，投诉量低于预期的一半
跨境结算系统，2019年4月 - 2019年11月
- 参与多币种结算模块的开发，支持美元、欧元和日元的自动换汇与清算，缩短结算周期两天
- 编写单元测试和集成测试，核心模块测试覆盖率从百分之四十提高到百分之八十五
教育背景
计算机科学与技术 学士，浙江大学，2012年9月 - 2016年6月
主修课程：数据结构、操作系统、计算机网络、数据库原理、分布式系统
专业技能
编程语言：Java、Go、Python、SQL
框架与中间件：Spring Boot、Kafka、Redis、MySQL、Elasticsearch、Docker、Kubernetes
其他：系统设计、性能调优、团队管理、敏捷开发、技术文档写作
证书与荣誉
二零二二年公司年度优秀员工；阿里云认证高级工程师；多次获得季度技术创新奖
语言能力
普通话（母语），英语（流利，可作为工作语言进行沟通和撰写技术文档），日语（基础，能阅读简单的技术资料）
`;

describe("one word count for every script", () => {
  it("the Chinese résumé is 1,200 characters and counts at least 300 words, in both copies", () => {
    expect(ZH_CV.length).toBeGreaterThanOrEqual(1200);
    expect(countWords(ZH_CV)).toBeGreaterThanOrEqual(300);
    expect(streamCountWords(ZH_CV)).toBe(countWords(ZH_CV));
  });

  it("its parse check does not call it nearly empty", () => {
    const q = computeParseQuality(ZH_CV, "zh");
    expect(q.wordCount).toBeGreaterThanOrEqual(300);
    expect(q.issueCodes).not.toContain("few_words");
  });

  it("an English résumé's count is exactly what it was: the runs between spaces", () => {
    for (const set of Object.values(CV_SETS)) {
      const en = String(set.texts.en);
      expect(countWords(en)).toBe(en.split(/\s+/).filter(Boolean).length);
    }
  });
});

describe("the primary does not call it sparse", () => {
  let primary: EdgeHandler;
  const spies: Array<ReturnType<typeof vi.spyOn>> = [];
  beforeAll(async () => { ({ primary } = await loadScanners(["primary"])); }, 240_000);
  beforeEach(() => {
    resetWorld();
    for (const m of ["log", "warn", "error", "info"] as const) spies.push(vi.spyOn(console, m).mockImplementation(() => {}));
  });
  afterEach(() => { while (spies.length) spies.pop()!.mockRestore(); });

  it("the model is not told it is a sparse résumé, and the report's parse check counts its words", async () => {
    const { json } = await scanPrimary(primary, { resumeText: ZH_CV });
    const prompts = world.fetched.filter((f) => f.url.includes("ai.gateway.lovable.dev")).map((f) => f.body).join("\n");
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts).not.toContain("SPARSE RESUME DETECTED");
    expect((json.parseQuality as { wordCount: number }).wordCount).toBeGreaterThanOrEqual(300);
  });
});
