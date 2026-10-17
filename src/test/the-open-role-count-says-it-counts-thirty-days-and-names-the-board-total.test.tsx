/**
 * THE OPEN-ROLE COUNT SAYS IT COUNTS THIRTY DAYS AND NAMES THE BOARD TOTAL
 * (Track 1, A3).
 *
 * The page called the roles it serves (those dated in the last 30 days) all
 * of an employer's open roles: Stripe 260 served against 727 on its own
 * Greenhouse board on 2026-10-11, and BASS ABA "has no open roles" while its
 * board listed 31 roles aged 38 to 101 days. Now:
 *
 *   - the figure says "dated in the last 30 days", splits off the roles with
 *     no date, and the board's own total is printed beside it with its read
 *     time, from the newest complete read (state ok or empty, a total stated,
 *     no more than 48 hours old, not Workday's 2,000 cap);
 *   - a page with nothing in the window says what the last complete read saw:
 *     older roles listed, an empty board, or that we have not read the whole
 *     board recently; never "has no open roles" while older ones are listed.
 *
 * The list reply for bassabatherapy recorded on 2026-10-12 (total 0) is the
 * zero page's input; the board totals are the curve's feed columns
 * (20261012121000), modelled on the read states the collector writes.
 */
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { loadCompanyShard } from "./helpers/company-shard";
import {
  BOARD_TOTAL_MAX_AGE_MS,
  SERVED_WINDOW_DAYS,
  boardTotalFact,
  buildLanderModel,
  zeroReadingOf,
  type LanderInput,
} from "@/lib/company/lander-model";
import { CompanyHeader, boardTotalLine, openRolesLine, zeroAnswer } from "@/components/jobs/company/CompanyHeader";

const FIXTURE = JSON.parse(readFileSync(resolve(__dirname, "fixtures/ghost-track1-live-2026-10-12.json"), "utf8")) as {
  lists: Record<string, { total: number | null; status: number }>;
};
// The model's freshness rule and the page's "ago" read one clock.
const NOW = Date.now();
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const input = (o: Partial<LanderInput> = {}): LanderInput => ({
  token: "stripe", storedName: "Stripe", bakedName: null, cachedName: null,
  listTotal: 258, listFloor: false, feedTotal: null, feedFloor: false, feedAsOf: null,
  boardReadAt: new Date(Date.now() - 46 * 60_000).toISOString(), source: "greenhouse", agency: false, collision: null, isUsajobs: false,
  loading: false, error: false, budgetRefusal: false, gated: { verdict: "unknown", withheld: null },
  verdict: "unknown", growth: "unknown", layoffRows: 0, visitorFilters: [], now: NOW, ...o,
});
const t = i18n.t.bind(i18n);

describe("the board total is printed only from a complete, fresh, uncapped read", () => {
  const ok = { total: 727, readAt: hoursAgo(2), state: "ok", capped: false };
  it("Stripe-like: 727 read two hours ago on a complete read", () => {
    expect(boardTotalFact(ok, NOW)).toEqual({ total: 727, readAt: ok.readAt });
    expect(boardTotalFact({ ...ok, total: "727" }, NOW)?.total, "a numeric string is a number").toBe(727);
  });
  it("refuses a capped Workday total, an unknown cap, a stale read, an error visit and a missing total", () => {
    expect(boardTotalFact({ ...ok, capped: true }, NOW)).toBeNull();
    expect(boardTotalFact({ ...ok, capped: null }, NOW), "unknown is not 'not capped'").toBeNull();
    expect(boardTotalFact({ ...ok, readAt: hoursAgo(49) }, NOW)).toBeNull();
    expect(boardTotalFact({ ...ok, readAt: hoursAgo(47.9) }, NOW)).not.toBeNull();
    expect(BOARD_TOTAL_MAX_AGE_MS).toBe(48 * 3_600_000);
    expect(boardTotalFact({ ...ok, state: "error" }, NOW)).toBeNull();
    expect(boardTotalFact({ ...ok, state: "truncated" }, NOW)).toBeNull();
    expect(boardTotalFact({ ...ok, total: null }, NOW)).toBeNull();
    expect(boardTotalFact(null, NOW)).toBeNull();
  });
  it("an empty read (every role older than our window) is complete", () => {
    expect(boardTotalFact({ total: 31, readAt: hoursAgo(5), state: "empty", capped: false }, NOW)?.total).toBe(31);
  });
});

describe("the figure states its basis", () => {
  it("'dated in the last 30 days', the undated split off, and the board total beside it", async () => {
    await i18n.changeLanguage("en");
    const model = buildLanderModel(input({ boardTotal: { total: 727, readAt: hoursAgo(2), state: "ok", capped: false }, undatedOpen: 3 }));
    expect(openRolesLine(t, model.openRoles, "en", model.undatedOpen)).toMatch(/^255 roles dated in the last 30 days \(3 more carry no date\) · read 46 min ago$/);
    expect(boardTotalLine(t, model, "en")).toBe("Their board listed 727 roles in all when we read it 2 hr ago.");
    expect(SERVED_WINDOW_DAYS).toBe(30);
  });

  it("a capped Workday board prints no total; a floor is never split", () => {
    const capped = buildLanderModel(input({ boardTotal: { total: 2000, readAt: hoursAgo(1), state: "ok", capped: true } }));
    expect(boardTotalLine(t, capped, "en")).toBeNull();
    const floor = buildLanderModel(input({ listTotal: 10_000, listFloor: true, undatedOpen: 40 }));
    expect(openRolesLine(t, floor.openRoles, "en", floor.undatedOpen)).toMatch(/^10,000\+ roles dated in the last 30 days · we count up to 10,000/);
  });

  it("the rendered header carries both lines", () => {
    loadCompanyShard();
    const model = buildLanderModel(input({ boardTotal: { total: 727, readAt: hoursAgo(2), state: "ok", capped: false } }));
    const { container } = render(<MemoryRouter><CompanyHeader model={model} token="stripe" system="Greenhouse" boardReadAt={input().boardReadAt} onWatch={() => {}} /></MemoryRouter>);
    expect(container.querySelector("[data-company-answer]")?.textContent).toMatch(/^258 roles dated in the last 30 days · read/);
    expect(container.querySelector("[data-company-board-total]")?.textContent).toBe("Their board listed 727 roles in all when we read it 2 hr ago.");
  });
});

describe("a page with nothing in the window says what the board holds", () => {
  const bass = (bt: LanderInput["boardTotal"]) => buildLanderModel(input({
    token: "bassabatherapy", storedName: "BASS ABA Therapy", listTotal: FIXTURE.lists.bassabatherapy.total, boardTotal: bt,
  }));

  it("the recorded list reply for BASS ABA served nothing (2026-10-12)", () => {
    expect(FIXTURE.lists.bassabatherapy.status).toBe(200);
    expect(FIXTURE.lists.bassabatherapy.total).toBe(0);
    expect(bass(undefined).variant).toBe("zero");
  });

  it("older roles listed: none of them is dated in the window, with the board's total and read date", () => {
    const m = bass({ total: 31, readAt: hoursAgo(5), state: "empty", capped: false });
    expect(m.zeroReading).toBe("older");
    expect(zeroAnswer(t, m, "en")).toMatch(/^None of the 31 roles on BASS ABA Therapy's board is dated in the last 30 days \(read \d{1,2} [A-Z][a-z]{2,4}\.? \d{4}\)\. We show roles dated in the last 30 days\.$/);
  });

  it("an empty board, a board we have not read in full recently, and an answer not yet in", () => {
    expect(zeroAnswer(t, bass({ total: 0, readAt: hoursAgo(5), state: "ok", capped: false }), "en")).toBe("No roles on BASS ABA Therapy's job board when we read it 5 hr ago.");
    expect(zeroAnswer(t, bass({ total: 31, readAt: hoursAgo(80), state: "ok", capped: false }), "en")).toBe("We have not read BASS ABA Therapy's whole board recently.");
    expect(zeroAnswer(t, bass(null), "en"), "a reader without the columns is unread, never a zero").toBe("We have not read BASS ABA Therapy's whole board recently.");
    expect(zeroReadingOf({ boardTotal: undefined })).toBeNull();
    expect(zeroAnswer(t, bass(undefined), "en")).toBe("No roles dated in the last 30 days");
  });

  it("a generic board label takes no possessive", () => {
    const m = buildLanderModel(input({ storedName: "Corporate", listTotal: 0, boardTotal: { total: 12, readAt: hoursAgo(3), state: "ok", capped: false } }));
    expect(zeroAnswer(t, m, "en")).toMatch(/^None of the 12 roles on this board is dated in the last 30 days \(read [^)]+\)\. We show roles dated in the last 30 days\.$/);
  });

  it("a collision page and USAJOBS print no board total", () => {
    const usa = buildLanderModel(input({ isUsajobs: true, boardTotal: { total: 9000, readAt: hoursAgo(1), state: "ok", capped: false } }));
    expect(usa.boardTotal).toBeNull();
  });
});

describe("the lander's sentences (pass B: the company shard and the listing shard)", () => {
  const en = JSON.parse(readFileSync(resolve(__dirname, "../i18n/locales/en.json"), "utf8")) as { jobsPage: Record<string, string> };
  const company = (JSON.parse(readFileSync(resolve(__dirname, "../i18n/shards/company/en.json"), "utf8")) as { companyProfile: Record<string, unknown> }).companyProfile;
  const listing = (JSON.parse(readFileSync(resolve(__dirname, "../i18n/shards/listing/en.json"), "utf8")) as { listing: Record<string, unknown> }).listing;
  const leaf = (o: unknown, path: string): string => String(path.split(".").reduce<unknown>((x, k) => (x && typeof x === "object" ? (x as Record<string, unknown>)[k] : undefined), o));
  const strings = (o: unknown, prefix = ""): Array<[string, string]> => Object.entries((o ?? {}) as Record<string, unknown>).flatMap(([k, v]) => (v && typeof v === "object" ? strings(v, `${prefix}${k}.`) : [[`${prefix}${k}`, String(v)] as [string, string]]));
  it("the zero answer states the window and asserts no empty board", () => {
    expect(leaf(company, "zero.answer")).toBe("No roles dated in the last {{days}} days");
    expect(leaf(company, "zero.basis")).toBe("We show roles dated in the last {{days}} days.");
    expect(leaf(company, "zero.older_other")).toMatch(/is dated in the last \{\{days\}\} days \(read \{\{date\}\}\)/);
    expect(leaf(company, "openRoles_other")).toMatch(/dated in the last \{\{days\}\} days/);
    expect(leaf(company, "subtitle")).toBe("Live jobs straight from {{companyPossessive}} own hiring system.");
    for (const k of ["companySeoTitle", "companySeoDescription", "openRolesTip", "orientTitle", "zeroTitle"]) {
      expect(en.jobsPage[k], k).not.toMatch(/verified|re-verified/i);
    }
    for (const [k, v] of strings(company)) expect(v, `companyProfile.${k}`).not.toMatch(/verified/i);
  });
  it("the posting stamp is a feed read, not a check of the posting, and the apply re-check is conditional", () => {
    expect(leaf(listing, "status.read")).toBe("Employer's feed read {{ago}}");
    expect(leaf(listing, "status.readTip")).toMatch(/It is not a check of this one posting\.$/);
    expect(leaf(listing, "card.feedRead")).toBe("{{system}} · feed read {{ago}}");
    expect(en.jobsPage.badgeLive).toMatch(/where the system allows it$/);
  });
});
