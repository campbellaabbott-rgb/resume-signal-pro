// @vitest-environment node
/**
 * THE COMPANY PICKER COULD NOT FIND DOMINO'S BY THE NAME PEOPLE TYPE (L8-08).
 *
 * company-suggest matched name.toLowerCase().includes(q): "dominos" found
 * nothing although Domino's had 21,531 open roles, "chilis" nothing ("chili"
 * found Chili's 1,094). Both sides are now folded to letters and digits, the
 * way the employer router already reads names (foldName).
 * The client-side head filter (Jobs.tsx mergeCompanyOptions) has the same
 * defect and is the frontend's.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { bootBoardList, type BoardList } from "./helpers/board-list";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

let board: BoardList;
beforeAll(async () => {
  board = await bootBoardList();
  board.answer((q) => (q.table === "job_board_meta" && q.calls.some(([m, a]) => m === "eq" && a[0] === "k" && a[1] === "refresh")
    ? {
      data: {
        companiesFacet: [
          { token: "dominos", name: "Domino's", count: 21531 },
          { token: "chilis", name: "Chili's", count: 1094 },
          { token: "att", name: "AT&T", count: 900 },
          { token: "dominion", name: "Dominion Energy", count: 300 },
          { token: "daangn", name: "당근마켓", count: 40 },
          { token: "vikos", name: "Ηπειρωτική Βιομηχανία Εμφιαλώσεων Α.Ε. (ΒΙΚΟΣ)", count: 12 },
          { token: "eoppep", name: "Εθνικός Οργανισμός Πρόληψης & Αντιμετώπισης των Εξαρτήσεων", count: 9 },
          { token: "kku", name: "มหาวิทยาลัยขอนแก่น", count: 7 },
          { token: "gekterna", name: "ΟΜΙΛΟΣ ΓΕΚ ΤΕΡΝΑ / GEK TERNA GROUP", count: 30 },
          { token: "tatamotors", name: "टाटा मोटर्स", count: 25 },
        ],
        companiesOpen: { dominos: 21531, chilis: 1094, att: 900, dominion: 300, daangn: 40, vikos: 12, eoppep: 9, kku: 7, gekterna: 30, tatamotors: 25 },
      },
      error: null,
    }
    : undefined));
});

const names = async (q: string) =>
  ((await board.post({ action: "company-suggest", q })).companies as Array<{ name: string }>).map((c) => c.name);

describe("the employer typeahead reads names the way people type them", () => {
  it("dominos finds Domino's, chilis finds Chili's, att finds AT&T", async () => {
    expect(await names("dominos")).toEqual(["Domino's"]);
    expect(await names("chilis")).toEqual(["Chili's"]);
    expect(await names("at&t")).toEqual(["AT&T"]);
    expect(await names("att")).toEqual(["AT&T"]);
  });

  it("a prefix still ranks first, by open roles beneath", async () => {
    expect(await names("domin")).toEqual(["Domino's", "Dominion Energy"]);
  });

  it("a name in another script is found by what is typed in it, as the lowercase match before the fold found it", async () => {
    expect(await names("당근")).toEqual(["당근마켓"]);
    expect(await names("ΒΙΚΟΣ")).toEqual(["Ηπειρωτική Βιομηχανία Εμφιαλώσεων Α.Ε. (ΒΙΚΟΣ)"]);
    expect(await names("ขอนแก่น")).toEqual(["มหาวิทยาลัยขอนแก่น"]);
    expect(await names("टाटा")).toEqual(["टाटा मोटर्स"]);
    expect(await names("ΤΕΡΝΑ")).toEqual(["ΟΜΙΛΟΣ ΓΕΚ ΤΕΡΝΑ / GEK TERNA GROUP"]);
    expect(await names("terna")).toEqual(["ΟΜΙΛΟΣ ΓΕΚ ΤΕΡΝΑ / GEK TERNA GROUP"]);
  });

  it("Greek reads without its accents and with either sigma, the way Domino's reads without its apostrophe", async () => {
    expect(await names("εθνικος οργανισμος")).toEqual(["Εθνικός Οργανισμός Πρόληψης & Αντιμετώπισης των Εξαρτήσεων"]);
    expect(await names("εθνικοσοργ")).toEqual(["Εθνικός Οργανισμός Πρόληψης & Αντιμετώπισης των Εξαρτήσεων"]);
  });

  it("a query of nothing but punctuation matches nothing, not everything", async () => {
    expect(await names("''")).toEqual([]);
  });
});
