// @vitest-environment node
/**
 * THE DEAD BOARDS LEAVE AND THE MOVED ONES FOLLOW THEIR EMPLOYER (job-board 2026-09-09.103, catalogue lane).
 *
 * Every number here comes from src/test/fixtures/board-103-catalogue-2026-11-17.json, which holds the
 * evidence each change rests on:
 *
 *  - PRUNE. Entries on Greenhouse, Ashby, Personio, Teamtailor and Workable that the 2026-11-07 census
 *    read as dead and that were still dead at the second read on 2026-11-17 (spec M2): one GET of the list
 *    endpoint the reader uses, robots.txt first on every host. Dead means HTTP 404 from the vendor, or a
 *    Personio tenant whose robots.txt now reads "Disallow: /" (Personio serves that for a tenant that is
 *    gone, and the reader may not read past it). Each also served no row in production the same evening
 *    (PR0: job-board countOnly lists, vendor-scoped). A board that answered 200 at the second read stays,
 *    even with no postings: it is not dead.
 *  - REPOINT. A dead entry whose employer now posts on Greenhouse or Ashby under the same slug, found by
 *    probing each dead entry's own slug on those vendors (no Common Crawl list: owner decision OD-CC,
 *    2026-11-17), with at least one posting inside the 30-day window and the board's own text naming the
 *    employer, quoted in the fixture. The record carries the name the board prints, in the case it prints it:
 *    DroneShield, not the slug's Droneshield. Rewritten in place, because the refresh cursor is positional. The token
 *    stays catalogued, so the token-keyed orphan prune cannot reach the old vendor's rows: the old key joins
 *    RETIRED_TWIN_KEYS.
 *  - HELD FOR OD14(b). The thirty repoints whose new board is on Ashby are not carried (heldForOD14b): spec-final
 *    3.1 (RP, L-M4) rides every board newly read on Ashby only on the owner's OD14(b) yes, the same rule that holds
 *    row A's eleven Ashby boards (helpers/ashby-gate.ts states it once for both). Each old record stays as .102
 *    carried it, serving nothing, until .104.
 *  - RETIRE lever:usasurveyjob, a paid-survey ad feed (OD1(a)).
 *  - HOLD the five Workable boards that wait for the owner's OD1 ruling OUTSIDE the catalogue. On .102 a
 *    held board stayed catalogued and was skipped only on the oversize path, so weekday-1 served 153 rows.
 *    Outside JOB_SOURCES no lane reads it, and the orphan prune takes its rows once 20261117110000 lowers
 *    the high-water mark.
 *  - LABEL Distro, a job-ad intermediary, as an agency where its packed row was.
 *  - NEVER: no board of a vendor or employer on the refusal list.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { HOT_TOKENS, JOB_SOURCES, type JobSource } from "../../supabase/functions/job-board/sources";
import { EMPLOYER_ALIASES } from "../../supabase/functions/job-board/employer-aliases";
import { codeOf } from "./helpers/strip-comments";
import { ashbyGate, ashbyNewIn103, newAshbyBoards, ASHBY_102 } from "./helpers/ashby-gate";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
type Repoint = { from: string; to: string; name: string; total: number; inWindow: number; at: string; index: number; prev: string; next: string; evidence: string; was?: string };
type Held = { key: string; name: string; servedAtPr0: number };
type HeldRepoint = Repoint & { reason: string };
const FIX = JSON.parse(read("src/test/fixtures/board-103-catalogue-2026-11-17.json")) as {
  catalogue: { before: number; after: number };
  pruned: Array<[key: string, secondRead: string, firstRead: string]>;
  keptAlive: Array<[key: string, evidence: string]>;
  repointed: Repoint[];
  heldForOD14b: HeldRepoint[];
  retired: string[];
  held: Held[];
  agency: { key: string; name: string; index: number; prev: string; next: string };
  pr0: { at: string; served: Record<string, number> };
  left102: Array<[index: number, key: string]>;
};

/** Row A, appended after Convergint in the same build (the-ai-startup-boards-join-after-convergint.test.ts). */
const ROW_A = (JSON.parse(read("src/test/fixtures/board-103-row-a-2026-11-17.json")) as { added: Array<{ key: string }> }).added.map((a) => a.key);
const key = (s: { source: string; token: string }) => `${s.source}:${s.token}`;
const tokenOf = (k: string) => k.slice(k.indexOf(":") + 1);
const KEYS = JOB_SOURCES.map(key);
const HAS = new Set(KEYS);
const TOKENS = new Set(JOB_SOURCES.map((s) => s.token));
const INDEX = read("supabase/functions/job-board/index.ts");
const TWINS = JSON.parse(`[${/const RETIRED_TWIN_KEYS: readonly string\[\] = \[([^\]]*)\];/.exec(codeOf(INDEX))?.[1] ?? ""}]`) as string[];
/** Board .102's eight (a-retired-twin-leaves-with-its-own-vendor.test.ts). */
const TWINS_102 = ["pinpoint:helsing", "greenhouse:wayve", "greenhouse:clickhouse", "lever:swordhealth", "greenhouse:lovable", "greenhouse:kalshi", "greenhouse:webflow", "greenhouse:worldlabs"];
const LEFT = [...FIX.pruned.map(([k]) => k), ...FIX.retired, ...FIX.held.map((h) => h.key)];

describe("the dead boards leave", () => {
  it("no pruned key is catalogued, and each was dead at both reads, ten days apart, and served nothing", () => {
    expect(FIX.pruned.length).toBeGreaterThan(300);
    expect(FIX.pruned.filter(([k]) => HAS.has(k)).map(([k]) => k)).toEqual([]);
    for (const [k, second, first] of FIX.pruned) {
      expect(second, k).toMatch(/^(404 2026-11-17T\d\d:\d\d:\d\dZ|robots Disallow: \/ \([a-z0-9.-]+\.jobs\.personio\.(de|com)\))$/);
      // The first read is the 2026-11-07 dead list, whose reasons were cut at 24 characters.
      expect(first, `${k}: no first read`).toMatch(/^2026-11-07 (HTTP 404|personio feed unavailabl)$/);
      expect(first.includes("personio"), `${k}: the two reads disagree on the kind of death`).toBe(second.startsWith("robots"));
      expect(FIX.pr0.served[k], `${k} served rows at PR0`).toBe(0);
    }
    expect(new Set(FIX.pruned.map(([k]) => k.slice(0, k.indexOf(":")))), "only vendors whose robots and terms allow the read").toEqual(new Set(["greenhouse", "ashby", "personio", "teamtailor", "workable"]));
  });

  it("a board that answered at the second read stays catalogued, empty or not", () => {
    expect(FIX.keptAlive.length).toBeGreaterThan(0);
    for (const [k] of FIX.keptAlive) expect(HAS.has(k), `${k} answered 200 and was pruned`).toBe(true);
  });

  it("the catalogue is .102's 44,499 less what left, plus row A's appended boards; a repoint changes no count", () => {
    expect(FIX.catalogue.before).toBe(44_499);
    expect(FIX.catalogue.after).toBe(FIX.catalogue.before - LEFT.length);
    expect(JOB_SOURCES.length).toBe(FIX.catalogue.after + ROW_A.length);
    expect(KEYS.slice(FIX.catalogue.after), "row A sits after every board this lane kept").toEqual(ROW_A);
    expect(new Set(KEYS).size, "a key is carried twice").toBe(KEYS.length);
  });

  it("each board that left goes back at its .102 index and each repoint reads as its old key, rebuilding .102's 44,499 (the oracle-host pin hashes that order)", () => {
    expect(FIX.left102.map(([, k]) => k).sort()).toEqual([...LEFT].sort());
    const was = new Map(FIX.repointed.map((r) => [r.to, r.from]));
    const back = KEYS.slice(0, FIX.catalogue.after).map((k) => was.get(k) ?? k);
    for (const [i, k] of FIX.left102) back.splice(i, 0, k);
    expect(back).toHaveLength(FIX.catalogue.before);
    for (const [i, k] of FIX.left102) expect(back[i], `${k} at ${i}`).toBe(k);
    expect(new Set(back).size, "a board went back on top of another").toBe(back.length);
  });

  it("no hot token, light token or employer alias names a token that left the catalogue", () => {
    for (const t of HOT_TOKENS) expect(TOKENS.has(t), `${t} is hot but not catalogued`).toBe(true);
    const gone = new Set(LEFT.map(tokenOf).filter((t) => !TOKENS.has(t)));
    const aliasTokens = Object.entries(EMPLOYER_ALIASES).flatMap(([a, v]) => v.tokens.map((t) => `${a}:${t}`));
    expect(aliasTokens.filter((at) => gone.has(tokenOf(at)))).toEqual([]);
  });
});

describe("the moved boards follow their employer, in place", () => {
  it("each repoint's new key is carried at its record's index, between its neighbours, under the employer's name; the old key is not", () => {
    expect(FIX.repointed.length).toBeGreaterThanOrEqual(1);
    expect(FIX.repointed.length + FIX.heldForOD14b.length, "the lane found 34 moved boards").toBe(34);
    for (const r of FIX.repointed) {
      expect(HAS.has(r.from), `${r.from} is still carried`).toBe(false);
      expect(tokenOf(r.to), "a repoint keeps its token").toBe(tokenOf(r.from));
      expect(["greenhouse", "ashby"], r.to).toContain(r.to.slice(0, r.to.indexOf(":")));
      const i = KEYS.indexOf(r.to);
      expect(i, `${r.to} is not where its record was`).toBe(r.index);
      expect([KEYS[i - 1], KEYS[i + 1]], r.to).toEqual([r.prev, r.next]);
      expect(JOB_SOURCES[i].name, r.to).toBe(r.name);
      expect(r.inWindow, `${r.to}: a repoint needs a posting inside the window`).toBeGreaterThanOrEqual(1);
    }
  });

  it("each repoint carries the name its new board prints, in the case it prints it, quoted from that board's own response", () => {
    // A legal suffix the old record carried ("Courier Newsroom, Inc.") is not part of the name the board prints;
    // the suffix is dropped in any case, the name itself is matched case for case (DroneShield is not Droneshield).
    const bare = (s: string) => s.replace(/,?\s+(inc|llc|ltd|gmbh|corp)\.?$/i, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const prints = (evidence: string, name: string) => new RegExp(`(^|[^A-Za-z0-9])${bare(name)}([^A-Za-z0-9]|$)`).test(evidence);
    // The held ones too: .104 carries them under these names.
    for (const r of [...FIX.repointed, ...FIX.heldForOD14b]) {
      expect(r.evidence, `${r.to}: no quote of the board naming its employer`).toBeTruthy();
      expect(prints(r.evidence, r.name), `${r.to} is carried as ${r.name}, which its quote does not print: ${r.evidence}`).toBe(true);
    }
    // Boards that print another name, or another case, than their old record. CardFlight's employer posts on
    // Ashby as SwipeSimple; DroneShield, EGYM, FUTRUE and UJV are the case their boards print.
    const renamed = (rs: Repoint[]) => rs.filter((r) => r.was !== undefined).map((r) => [r.from, r.was, r.name]);
    expect(renamed(FIX.repointed)).toEqual([["rippling:droneshield", "Droneshield", "DroneShield"]]);
    expect(renamed(FIX.heldForOD14b)).toEqual([["greenhouse:cardflight", "CardFlight", "SwipeSimple"], ["personio:egym", "Egym", "EGYM"],
      ["personio:futrue", "Futrue", "FUTRUE"], ["rippling:ujv", "Ujv", "UJV"]]);
    for (const r of [...FIX.repointed, ...FIX.heldForOD14b].filter((x) => x.was)) expect(prints(r.evidence, r.was!), `${r.to}'s quote prints its old name, so it needs no rename`).toBe(false);
  });

  it("has teeth: a slug-cased name its board does not print fails, and a legal suffix still passes", () => {
    const bare = (s: string) => s.replace(/,?\s+(inc|llc|ltd|gmbh|corp)\.?$/i, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const prints = (evidence: string, name: string) => new RegExp(`(^|[^A-Za-z0-9])${bare(name)}([^A-Za-z0-9]|$)`).test(evidence);
    expect(prints("company_name: DroneShield", "Droneshield")).toBe(false);
    expect(prints("company_name: DroneShield", "DroneShield")).toBe(true);
    expect(prints("company_name: Courier Newsroom", "Courier Newsroom, Inc.")).toBe(true);
  });

  it("the spec's five measured repoints: the two to Greenhouse ride, the three to Ashby wait for OD14(b)", () => {
    const moved = new Set(FIX.repointed.map((r) => `${r.from}>${r.to}`));
    for (const m of ["bamboohr:everstand>greenhouse:everstand", "bamboohr:couriernewsroom>greenhouse:couriernewsroom"]) expect(moved.has(m), m).toBe(true);
    const held = new Set(FIX.heldForOD14b.map((r) => `${r.from}>${r.to}`));
    for (const m of ["greenhouse:toogoodtogo>ashby:toogoodtogo", "greenhouse:amenitiz>ashby:amenitiz", "greenhouse:philo>ashby:philo"]) expect(held.has(m), m).toBe(true);
  });

  it("RETIRED_TWIN_KEYS adds exactly the keys that left while their token stays carried, after .102's eight", () => {
    const stillCarried = [...FIX.repointed.map((r) => r.from), ...LEFT].filter((k) => TOKENS.has(tokenOf(k)));
    expect(TWINS.slice(0, TWINS_102.length)).toEqual(TWINS_102);
    expect(new Set(TWINS.slice(TWINS_102.length))).toEqual(new Set(stillCarried));
    expect(TWINS.length).toBe(TWINS_102.length + stillCarried.length);
    for (const k of TWINS) expect(HAS.has(k), `${k} is a twin key the catalogue still carries`).toBe(false);
  });
});

describe("the boards newly read on Ashby wait for OD14(b), as row A's do", () => {
  it("each held repoint's old record is still carried at its index, between its neighbours, and its Ashby key is not", () => {
    const back = new Map(FIX.heldForOD14b.map((r) => [r.to, r.from]));
    for (const r of FIX.heldForOD14b) {
      expect(r.to.startsWith("ashby:"), r.to).toBe(true);
      expect(r.reason, r.to).toMatch(/OD14\(b\)/);
      expect(HAS.has(r.to), `${r.to} is carried before the owner's OD14(b) answer`).toBe(false);
      expect(KEYS[r.index], `${r.from} is not back at its index`).toBe(r.from);
      expect([KEYS[r.index - 1], KEYS[r.index + 1]], r.from).toEqual([back.get(r.prev) ?? r.prev, back.get(r.next) ?? r.next]);
      expect(FIX.pr0.served[r.from], `${r.from} served rows at PR0, so its .102 name reaches rows`).toBe(0);
    }
  });

  it("no board is new to Ashby in this build while the gate is shut, and every Ashby board is accounted for", () => {
    const gate = ashbyGate();
    const n = ashbyNewIn103(KEYS);
    expect(n.unaccounted, "Ashby boards the fixtures do not account for: one moved onto Ashby without an entry").toBe(0);
    expect(gate.open ? [] : n.boards, `new Ashby boards while the gate is shut (${gate.why.join("; ")})`).toEqual([]);
  });

  it("has teeth: a repoint onto Ashby, or one with no fixture entry, fails while the gate is shut, and the gate opens only on both conditions", () => {
    expect(newAshbyBoards({ ashby102: ASHBY_102, ashbyNow: ASHBY_102 - 86 + 1, leftAshby: 86, repointedTo: ["ashby:toogoodtogo", "greenhouse:everstand"], added: [] }))
      .toEqual({ boards: ["ashby:toogoodtogo"], unaccounted: 0 });
    expect(newAshbyBoards({ ashby102: ASHBY_102, ashbyNow: ASHBY_102 - 86 + 30, leftAshby: 86, repointedTo: [], added: [] }).unaccounted).toBe(30);
    const asked = { "supabase/functions/job-board/index.ts": 'await fetch("https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting");' };
    const listed = { "supabase/functions/_shared/application-form.ts": 'export const FORM_READER_VENDORS: readonly string[] = ["ashby", "lever"];' };
    const stopped = {
      "supabase/functions/job-board/index.ts": '// was: await fetch("https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting");\nconst x = 1;',
      "supabase/functions/_shared/application-form.ts": 'export const FORM_READER_VENDORS: readonly string[] = ["lever"]; // "ashby" left on OD14(b)',
    };
    const yes = { reservations: { "bug-round": { ownerDecided: { "OD14-ASHBY-1": { choice: "stop", on: "2026-11-20" } } } } };
    const none = { reservations: { "bug-round": { ownerDecided: { "S14X-012": { choice: "B" } } } } };
    expect(ashbyGate({ ledger: none, files: stopped }).open).toBe(false);
    expect(ashbyGate({ ledger: yes, files: asked }).open).toBe(false);
    expect(ashbyGate({ ledger: yes, files: listed }).open).toBe(false);
    expect(ashbyGate({ ledger: yes, files: stopped })).toEqual({ open: true, why: [] });
    expect(ashbyGate({ ledger: { reservations: { x: { ownerDecided: { "OD14(b)": { choice: "yes" } } } } }, files: stopped }).open).toBe(true);
  });
});

describe("the paid-survey feed retires and the held boards wait outside the catalogue", () => {
  it("lever:usasurveyjob is gone, token and all", () => {
    expect(FIX.retired).toEqual(["lever:usasurveyjob"]);
    expect(TOKENS.has("usasurveyjob")).toBe(false);
  });

  it("the five boards held for OD1 are not catalogued, and no other vendor carries their tokens", () => {
    expect(FIX.held.map((h) => h.key)).toEqual(["workable:nogigiddy", "workable:weekday-1", "workable:hire-resolve-the-top-recruitment-agency",
      "workable:mercier-consultancy", "workable:mercier-consultancy-group"]);
    for (const h of FIX.held) expect(TOKENS.has(tokenOf(h.key)), `${h.key}: the orphan prune cannot reach a token another board carries`).toBe(false);
    // What stops serving once the clamp unblocks the prune (PR0, 2026-11-17).
    expect(Object.fromEntries(FIX.held.map((h) => [h.key, h.servedAtPr0]))).toMatchObject({ "workable:weekday-1": 153, "workable:mercier-consultancy-group": 13 });
  });
});

describe("Distro wears the agency flag where its packed row was", () => {
  it("is an object entry with agency true, at its index and between its neighbours", () => {
    const { key: k, name, index, prev, next } = FIX.agency;
    const i = KEYS.indexOf(k);
    expect(i, `${k} moved: the cursor is positional`).toBe(index);
    expect([KEYS[i - 1], KEYS[i + 1]]).toEqual([prev, next]);
    expect([JOB_SOURCES[i].name, (JOB_SOURCES[i] as JobSource).agency]).toEqual([name, true]);
    expect(codeOf(read("supabase/functions/job-board/sources.ts"))).toContain(`{ name: "${name}", source: "lever", token: "distro", agency: true },`);
  });
});

/**
 * THE REFUSAL LIST. Vendors and employers whose terms the program will not read under (spec-final section
 * 6, m2), unless the owner rules otherwise: a NEVER vendor's boards, and the careers sites of UnitedHealth
 * (with Optum), Apple, and Google (with DeepMind and YouTube). The screen matches a board's host, its token,
 * or its whole normalised name, never a word inside a name: "Apple Tree Dental" and "MrBeast" are not on it.
 */
const NEVER_VENDORS = ["isolved", "applicantpro", "hireology", "paycor", "paychex", "paycom", "gupy"];
const NEVER_HOSTS = /(^|\.)(apple\.com|google\.com|deepmind\.google|deepmind\.com|youtube\.com|unitedhealthgroup\.com|optum\.com|paycor\.com|paycomonline\.net|hireology\.com|applicantpro\.com|gupy\.io)$/;
const NEVER_NAMES = new Set(["apple", "appleinc", "google", "googlellc", "alphabet", "deepmind", "googledeepmind", "youtube", "unitedhealthgroup", "unitedhealthcare", "optum"]);
const norm = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
const refused = (s: JobSource) =>
  NEVER_VENDORS.includes(s.source) || NEVER_HOSTS.test(s.host ?? "") || NEVER_HOSTS.test(s.token.split("~")[0]) || NEVER_NAMES.has(norm(s.name)) || NEVER_NAMES.has(norm(s.token));

describe("the refusal list", () => {
  it("no catalogued board is on it", () => {
    expect(JOB_SOURCES.filter(refused).map(key)).toEqual([]);
  });

  it("has teeth: a board of each kind it names is refused, and a name that only contains one is not", () => {
    const doctored: JobSource[] = [
      { name: "Apple", source: "greenhouse", token: "apple" },
      { name: "Optum", source: "icims", token: "careers.optum.com" },
      { name: "YouTube", source: "lever", token: "yt", host: "careers.youtube.com" },
      { name: "Some Co", source: "paycom" as string as JobSource["source"], token: "someco" },
      { name: "Google DeepMind", source: "ashby", token: "gdm" },
    ];
    expect(doctored.map(refused)).toEqual([true, true, true, true, true]);
    const fine: JobSource[] = [
      { name: "Apple Tree Dental", source: "lever", token: "appletreedental" },
      { name: "MrBeast", source: "greenhouse", token: "mrbeastyoutube" },
    ];
    expect(fine.map(refused)).toEqual([false, false]);
  });
});
