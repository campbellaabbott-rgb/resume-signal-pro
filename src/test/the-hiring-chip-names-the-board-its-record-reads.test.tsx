/**
 * THE HIRING CHIP NAMES THE BOARD ITS RECORD READS (S14X-161, header half).
 *
 * WHAT WAS WRONG. On a page that counts several of an employer's boards
 * ("Counted across 3 of this employer's hiring-system boards", PwC's Global
 * Experienced Careers page), the "Actively hiring" chip in the header rests
 * on the hiring record of this one board, which the page reads for its own
 * token alone. Its title gave the record's figures with no word about which
 * board they came from, beside a line counting all three. board-ui taught the
 * record card to name the board (boardUi.recordOneBoard); the chip, which the
 * header owns, still did not.
 *
 * WHAT THIS HOLDS:
 *   1. on a pooled page the chip's title opens with "Hiring record for one of
 *      this employer's {{n}} boards: {{board}}", the card's own words, then
 *      the basis it carried before;
 *   2. a one-board page keeps today's title exactly (positive control);
 *   3. every locale carries the line, in the words the card uses.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { createElement } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { buildLanderModel, type LanderInput } from "@/lib/company/lander-model";
import { CompanyHeader } from "@/components/jobs/company/CompanyHeader";
import { COMPANY_SHARD_LOCALES, companyShard, loadCompanyShard } from "./helpers/company-shard";

const TOKEN = "pwc~wd3~Global_Experienced_Careers";
const TIP = "This one: we watched 42 of its roles come off the board in the last 90 days and stay off.";
const input = (o: Partial<LanderInput> = {}): LanderInput => ({
  token: TOKEN, storedName: "PwC", bakedName: null, cachedName: null,
  listTotal: 2202, listFloor: false, feedTotal: 1042, feedFloor: false, feedAsOf: null,
  boardReadAt: "2026-11-15T09:00:00Z", source: "workday", agency: false, collision: null, isUsajobs: false,
  loading: false, error: false, budgetRefusal: false, gated: { verdict: "closes", withheld: null },
  verdict: "positive", growth: "grew", layoffRows: 0, visitorFilters: [], ...o,
});
const chip = (o: Partial<LanderInput>, tip: string | null = TIP) => {
  const { container } = render(createElement(MemoryRouter, null,
    createElement(CompanyHeader, { model: buildLanderModel(input(o)), token: TOKEN, system: "Workday", employerChipTip: tip ?? undefined, boardReadAt: null, onWatch: () => {} })));
  return container.querySelector("[data-employer-chip]");
};

beforeAll(async () => {
  loadCompanyShard();
  await i18n.changeLanguage("en");
});

describe("the chip says which board its record reads", () => {
  it("on a page pooling three boards the title names the one the record reads, then its basis", () => {
    const c = chip({ pooledBoards: 3 });
    expect(c).not.toBeNull();
    expect(c?.getAttribute("title")).toBe(`Hiring record for one of this employer's 3 boards: Global Experienced Careers\n${TIP}`);
    expect(c?.getAttribute("data-employer-chip-board")).toBe("Global Experienced Careers");
  });

  it("with no basis to carry the title is the board line alone", () => {
    expect(chip({ pooledBoards: 3 }, null)?.getAttribute("title")).toBe("Hiring record for one of this employer's 3 boards: Global Experienced Careers");
  });

  it("a one-board page keeps today's title (positive control)", () => {
    for (const o of [{ pooledBoards: 1 }, {}]) {
      const c = chip(o);
      expect(c?.getAttribute("title")).toBe(TIP);
      expect(c?.hasAttribute("data-employer-chip-board")).toBe(false);
    }
  });
});

describe("every locale carries the line in the card's own words", () => {
  it("all nine company shards match board-ui's recordOneBoard", async () => {
    const boardUi = import.meta.glob<{ default: { boardUi: Record<string, string> } }>("../i18n/shards/board-ui/*.json", { eager: true });
    const card = (l: string) => Object.entries(boardUi).find(([p]) => p.endsWith(`/${l}.json`))?.[1].default.boardUi.recordOneBoard;
    const off: string[] = [];
    for (const l of COMPANY_SHARD_LOCALES) {
      const line = (companyShard(l) as { companyProfile: Record<string, unknown> }).companyProfile.employerChipOneBoard;
      if (typeof line !== "string" || line !== card(l) || !line.includes("{{n}}") || !line.includes("{{board}}")) off.push(l);
    }
    expect(COMPANY_SHARD_LOCALES).toHaveLength(9);
    expect(off).toEqual([]);
  });
});
