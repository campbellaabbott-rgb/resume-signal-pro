// THE OTHER BUCKET, PHASE 1 — SHADOW CLASSIFICATION. Pure module: no I/O, no
// client, no writes. It holds (1) every gate as a NAMED CONSTANT with the
// measurement that produced it, (2) the seven guarded employer defaults keyed
// by company_token, (3) the first-claim resolver that turns the mechanisms'
// verdicts into ONE proposal for the shadow columns, and (4) the reader for
// job_board_meta.category_promotions.
//
// THE ONE RULE EVERYTHING HERE OBEYS: no mechanism writes `category`. A
// proposal lives in category_proposed / category_basis / category_key /
// category_confidence / category_proposed_at / category_proposed_v, and
// `category` moves only via promote_category(basis, key, target) (migration
// 20260909225500) after a written audit — the basis fields PERSIST after
// promotion so Explore can count inferred rows and revert_category
// (20260909226000) puts any key back with one UPDATE. Disagreement between
// mechanisms writes nothing and stamps category_key = 'conflict'.
//
// A guard reads this file with its comments stripped and asserts: no client,
// no table write, no bare `category` member anywhere in the code. The word
// itself is therefore kept out of identifiers and strings below; the field a
// proposal names is its `target`.
//
// Provenance for every number: scratchpad/other-bucket/ (2026-09-10): the
// 2,576-row stratified sample (other-sample.jsonl), the 3,060 labelled rows
// (labelled.jsonl), 2,365 hand-judged employer-page title decisions
// (judgments.json, mirrored byte-for-byte at src/test/fixtures/
// other-bucket-judgments.json), mechC-gate.txt (rule terms), plan/union.txt
// (first-claim accounting), employer-ranking.json (bucket-scoped totals),
// dominos-bracket.json (the bisected Domino's total) and mechA/ (embedding
// leave-one-out + the F2 gate).

import type { JobCategory } from "./categories.ts";
import { CATEGORIZE_VERSION, proposeCategory } from "./categories.ts";

/** A field a proposal may name. "other" is never a target. */
export type Field = Exclude<JobCategory, "other">;

// ── Versions ───────────────────────────────────────────────────────────────
/**
 * The employer table rides THIS version, not CATEGORIZE_VERSION: a shadow
 * re-pass can be kicked without touching the rules version (journal pipeline,
 * STEP 6). Bump when an employer entry or guard changes.
 */
export const CATEGORY_SHADOW_VERSION = 1;
/**
 * The employer defaults were judged on the v9 residue and re-applied after the
 * v10 rules on the same sample (plan/union.txt: rule 419 first, employer +317).
 * Every later CATEGORIZE_VERSION bump moves the residue a rule fires on, so
 * the seven must be re-judged (n >= EMPLOYER_MIN_N, second page) before they
 * are valid under it. A guard asserts CATEGORIZE_VERSION <= this.
 */
export const EMPLOYER_DEFAULTS_VALID_THROUGH_CATEGORIZE_VERSION = 10;

// ── Mechanism 1: RULE gates (categories.ts V10_TERMS) ──────────────────────
/** Hand-judged sample matches per term, all correct (mechC-gate.txt PER TERM; the v9 bar of 8/8). */
export const RULE_TERM_MIN_JUDGED = 8;
/** Distinct employers per term (mechC-gate.txt; a one-employer term is a house title, cf. the refuted "events associate" and "service colleague"). */
export const RULE_TERM_MIN_EMPLOYERS = 2;
/** Non-target hits on the 3,060 labelled rows when the terms are appended LAST (mechC-gate.ts: 0 — the frozen rules keep first claim; recomputed by the v10 test from other-bucket-labelled.json). */
export const RULE_LABELLED_COLLISIONS = 0;

// ── Mechanism 2: EMPLOYER gates ────────────────────────────────────────────
/** Strict purity on the guarded judged rows — an ambiguous 'A:field' verdict counts AGAINST (judgments.json; the weakest strict-five unguarded is Myview 114/120 = 0.950 exactly). */
export const EMPLOYER_MIN_PURITY = 0.95;
/** Hand-judged rows per employer after the guard (judgments.json: 112-211 per default; Saks 26 and Big 5 14 fail this bar and are not filed). */
export const EMPLOYER_MIN_N = 40;
/** An independent second page, drawn deep, must also clear 0.95 (the Bass Pro lesson: 55/60 on page one, 41/60 at offset 370). */
export const EMPLOYER_SECOND_PAGE_MIN = 0.95;
/**
 * Where the second page must be drawn: offset / bucket-scoped total, as a
 * fraction, "at offset ~= half the employer's bucket count". The seven pages
 * sit at 0.47-0.53 (raw-v2-*-<offset>.json over employer-ranking.json totals;
 * Domino's 8,000 over the bisected 15,000 lower bound = 0.53); a page-one draw
 * (60 / 15,000 = 0.004) is outside the band and is not a second page.
 */
export const EMPLOYER_SECOND_PAGE_OFFSET_BAND: readonly [number, number] = [0.4, 0.6];

// ── Mechanism 3: EMBED gates (F2; mechA/score.mjs; 160 hand-judged rows) ───
// Mirrored in embed-classify.ts, which owns the scorer; a guard asserts the
// two spellings agree so the gate that is audited is the gate that ships.
/** Neighbours per query over the 2,272 title-only anchors (mechA/classify.mjs K = 15). */
export const EMBED_K = 15;
/** Similarity-weighted share of the top field among the K neighbours (share >= 0.6 alone is 15% wrong; with the bars below, 5/160 = 3.1%). */
export const EMBED_MIN_SHARE = 0.6;
/** Cosine of the nearest anchor (mechA/draw.mjs gated the audited draw here; the blind holdout at this gate was 53R/1W/6A on 60 with min nn1 0.8513; combined with the first-draw F2 subset, 141R/5W/14A on 160). */
export const EMBED_MIN_NN1 = 0.85;
/** The nearest of the 17 field centroids must equal the kNN field — a veto, never a vote ('Manager Programs 3' -> product at share 1.00 is the case this refuses). */
export const EMBED_REQUIRE_CENTROID_AGREE = true;
/** Strict precision at the loose gate: product 13%, design 11%, legal 12%, data_ai 36% (mechA/judged.jsonl) — never an embed target. */
export const EMBED_BARRED_TARGETS: ReadonlySet<JobCategory> = new Set<JobCategory>(["product", "design", "legal", "data_ai"]);
/** Frozen anchor-set identity and the key every embed proposal carries. ANY anchor change bumps this and resets every embed-basis promotion to unpromoted (promotionsValidForAnchors). */
export const EMBED_ANCHOR_VERSION = "embed_knn_v1";
/** Leave-one-out kNN agreement of the anchor set with its own labels (mechA/loo-anchors.jsonl: 1,959 / 2,272 = 0.8622); the runtime must reproduce it within the tolerance before it may score. */
export const EMBED_LOO_REFERENCE = 0.862;
export const EMBED_LOO_TOLERANCE = 0.02;

// ── Promotion gates (per key, after a written audit; mirrored as constants in promote_category) ──
/** Fresh judged rows per rule term / employer key before promotion (journal guards §8; c_min_judged_rule). */
export const PROMOTE_MIN_JUDGED_PER_KEY = 8;
/** Fresh judged rows per embed TARGET FIELD (60 for hospitality_retail and healthcare, which carry 93 and 42 of the 265 sample moves; c_min_judged_embed). */
export const PROMOTE_MIN_JUDGED_PER_EMBED_TARGET = 30;
/** Wrong verdicts tolerated for a rule/employer key (c_max_wrong_rule). */
export const PROMOTE_MAX_WRONG = 0;
/** Wrong verdicts tolerated per embed target, per PROMOTE_MIN_JUDGED_PER_EMBED_TARGET judged rows (c_max_wrong_embed; F2 measured 3.1% wrong on 160). */
export const PROMOTE_MAX_WRONG_PER_EMBED_TARGET = 1;

// ── Shadow schema (migration 20260909224000) ───────────────────────────────
export const CATEGORY_BASES = ["rule", "employer", "embed"] as const;
export type CategoryBasis = (typeof CATEGORY_BASES)[number];
/** First-claim order (plan/union.txt: rule 419, employer +317, embed +155 on the sample). */
const BASIS_RANK: Readonly<Record<CategoryBasis, number>> = { rule: 0, employer: 1, embed: 2 };
/** The key a row carries when two mechanisms disagreed: nothing proposed, the row stays in the bucket, the disagreement is visible. */
export const CONFLICT_KEY = "conflict";

/** One mechanism's verdict for one row, in the shape the resolver compares. */
export interface ShadowProposal {
  basis: CategoryBasis;
  /** The term name, the company_token, or the anchor version — the audit and the revert are per key. */
  key: string;
  target: Field;
  /** 1 for a rule, the measured purity for an employer, the kNN share for embed. */
  confidence: number;
}

/**
 * The shadow-column patch — the ONLY shape a pass may write. A bare
 * `category` column is not a member of this type on purpose; a guard asserts
 * that (against comment-stripped code) and that this module performs no
 * database write at all.
 */
export interface ShadowPatch {
  category_proposed: Field | null;
  category_basis: CategoryBasis | null;
  category_key: string | null;
  category_confidence: number | null;
  category_proposed_at: string;
  category_proposed_v: number;
}

// ── Mechanism 2: the seven employer defaults, keyed by company_token ───────
export interface EmployerDefault {
  /** The catalog token as stored in job_board_postings.company_token. PINNED at build time from sources.ts; a display-name lookup at runtime is not allowed (a token can change; two Myview boards exist). */
  token: string;
  /** Display name at judging time — for humans and the build-time catalog cross-check only. */
  name: string;
  /** The judgments.json key the figures were computed under. Must equal the token: no cross-board borrowing. */
  judgedKey: string;
  target: Field;
  /** 'strict' cleared EMPLOYER_MIN_PURITY unguarded on both pages; 'conditional' clears it only with its guard. */
  mode: "strict" | "conditional";
  /** Rows whose title matches STAY IN THE BUCKET — they are not filed elsewhere. null = no guard. */
  guard: RegExp | null;
  /** Strict purity on the judged rows AFTER the guard: target verdicts / kept rows. Ambiguous counts against. */
  purity: number;
  /** Kept (guarded) judged rows. */
  n: number;
  /** The same count with NO guard applied — what the guard is worth. */
  unguarded: { right: number; n: number };
  /** The independent deep page, guarded: target verdicts / kept rows, and the list offset it was drawn at. */
  secondPage: { right: number; n: number; offset: number };
  /** Bucket-scoped `total` under category:other at judging time (employer-ranking.json). Extrapolation input and the offset-band denominator. */
  bucketTotal: number;
}

/**
 * Every figure below is what judgments.json produces THROUGH THE ENTRY'S OWN
 * GUARD; the employer guard test recomputes all of them from the fixture and
 * fails on drift. Unguarded strict purity is quoted so the guard's worth is
 * visible. Second-page offsets are the raw-v2-*-<offset>.json draws.
 */
export const EMPLOYER_DEFAULTS: ReadonlyArray<EmployerDefault> = [
  // Chili's — 120/120 on both pages, no guard needed (the cleanest default).
  {
    token: "fa-etjg-saasfaprod1~ocs~CX_1003", name: "Chili's", judgedKey: "fa-etjg-saasfaprod1~ocs~CX_1003",
    target: "hospitality_retail", mode: "strict", guard: null,
    purity: 120 / 120, n: 120, unguarded: { right: 120, n: 120 }, secondPage: { right: 60, n: 60, offset: 150 }, bucketTotal: 317,
  },
  // JCPenney — 130/131 unguarded; the survivor is "Program Mgr Wholesale
  // Digital" (product), now guarded out.
  {
    token: "jobs.jcp.com", name: "JCPenney", judgedKey: "jobs.jcp.com",
    target: "hospitality_retail", mode: "strict", guard: /Program Mgr/i,
    purity: 130 / 130, n: 130, unguarded: { right: 130, n: 131 }, secondPage: { right: 60, n: 60, offset: 400 }, bucketTotal: 830,
  },
  // Dollar Tree — 130/133 unguarded (two WMS coordinators, one 2nd-shift
  // department supervisor); WMS/shift/distribution/DC rows stay.
  {
    token: "dollartree~wd5~dollartreeus", name: "Dollar Tree", judgedKey: "dollartree~wd5~dollartreeus",
    target: "hospitality_retail", mode: "strict", guard: /WMS|shift|distribution|\bDC\b/i,
    purity: 130 / 130, n: 130, unguarded: { right: 130, n: 133 }, secondPage: { right: 57, n: 57, offset: 1500 }, bucketTotal: 3156,
  },
  // Kroger — 115/120 unguarded. Titles are "DEPARTMENT/ROLE"; the guard reads
  // ONLY the text before the first slash (DISTRIBUTION - ORDER SELECTOR,
  // TRANSPORTATION/HOSTLER, LOSS PREV/... stay; GROCERY/DISTRIBUTION HELPER
  // does not trip it). Two ambiguous HR-support rows are KEPT and count
  // against: 115/117 = 0.983.
  {
    token: "eluq~us2~CX_1", name: "The Kroger Co.", judgedKey: "eluq~us2~CX_1",
    target: "hospitality_retail", mode: "strict", guard: /^[^/]*\b(DISTRIBUTION|TRANSPORTATION|LOSS PREV)\b/i,
    purity: 115 / 117, n: 117, unguarded: { right: 115, n: 120 }, secondPage: { right: 57, n: 57, offset: 380 }, bucketTotal: 760,
  },
  // Myview (the paradox_careers tenant: the FR grocery titles) — 114/120
  // unguarded, exactly the bar; Director / Senior Manager / Coordinator /
  // Co-Op rows stay. Two ambiguous rows kept (Store Administrator, Receiver):
  // 114/116 = 0.983.
  {
    token: "myview~wd3~paradox_careers", name: "Myview", judgedKey: "myview~wd3~paradox_careers",
    target: "hospitality_retail", mode: "strict", guard: /Director|Senior Manager|Coordinator|Co-Op/i,
    purity: 114 / 116, n: 116, unguarded: { right: 114, n: 120 }, secondPage: { right: 58, n: 58, offset: 750 }, bucketTotal: 1501,
  },
  // Albertsons — CONDITIONAL: 112/120 unguarded (0.933 fails the bar);
  // guarded 112/112 on both pages. fuel / receiver / (prod) / insights /
  // senior manager rows stay.
  {
    token: "eofd~us6~CX_1", name: "Albertsons Companies", judgedKey: "eofd~us6~CX_1",
    target: "hospitality_retail", mode: "conditional", guard: /fuel|receiver|\(prod\)|insights|senior manager/i,
    purity: 112 / 112, n: 112, unguarded: { right: 112, n: 120 }, secondPage: { right: 55, n: 55, offset: 1000 }, bucketTotal: 2018,
  },
  // Domino's — CONDITIONAL: 215/238 strict unguarded (0.903). Delivery
  // Expert, E-Biker, driver and CSR rows are EXCLUDED and stay in the bucket,
  // never filed anywhere -- the guard is a HOLD on the row (employerHolds /
  // resolveShadowRow), not merely a silence of this mechanism, so an embed
  // vote cannot file them either (the drivers convention is operations, but
  // no employer default may file a role the rules refuse). Guarded 211/211; the
  // deep page (offset 8,000 of a bucket bisected to >15,000 and <=17,500,
  // dominos-bracket.json; bucketTotal is the lower bound) 59/59.
  {
    token: "dominos", name: "Domino's", judgedKey: "dominos",
    target: "hospitality_retail", mode: "conditional", guard: /delivery|e-biker|driver|\bCSR\b/i,
    purity: 211 / 211, n: 211, unguarded: { right: 215, n: 238 }, secondPage: { right: 59, n: 59, offset: 8000 }, bucketTotal: 15000,
  },
];

/**
 * Employers judged and REFUSED as defaults, by the key judgments.json holds
 * them under (strict bucket-residue purity in the note). A guard asserts none
 * is in EMPLOYER_DEFAULTS and that the judged rows themselves fail the bar.
 * Not a comment: this list is a negative test set.
 */
export const REFUTED_EMPLOYER_TOKENS: ReadonlyArray<[judgedKey: string, name: string, why: string]> = [
  ["ejwl~us2~CX", "Marriott", "0.83 — enriched for Executive Resolution / finance / receiving"],
  ["efet~us2~CX_1", "Hilton", "0.78"],
  ["basspro~wd1~careers", "Bass Pro", "0.81 at depth (55/60 page one, 41/60 at offset 370)"],
  ["oreillyauto~wd1~oreilly", "O'Reilly", "0.67 bimodal (parts specialist vs delivery/materials)"],
  ["egud~us2~CX_1", "AutoZone", "0.58"],
  ["ebwh~us2~CX_1001", "Macy's", "0.90 unreplicated (n=60, one page)"],
  ["thermofisher~wd5~ThermoFisherCareers", "Thermo Fisher", "0.72"],
  ["hcbt~em2~CX_1001", "Kotak", "three-way split sales/finance/customer"],
  ["cvshealth~wd1~CVS_Health_Careers", "CVS", "0.47"],
  ["pwc~wd3~Global_Experienced_Careers", "PwC", "0.65"],
  ["jobs.uhsinc.com", "UHS", "0.60 — a hospital employer is not a clinical role (dietary x14)"],
  ["fa-evxo-saasfaprod1~ocs~CX_1", "CHS", "0.52 (EVS x7)"],
  ["pae~wd1~Amentum_Careers", "Amentum", "0.55"],
  ["jci~wd5~JCI", "JCI", "0.57"],
  ["ejhp~us6~CX_1", "Sherwin-Williams", "0.42"],
  ["globalhr~wd5~REC_RTX_Ext_Gateway", "RTX", "0.43"],
  ["AECOM2", "AECOM", "0.36"],
  ["ngc~wd1~Northrop_Grumman_External_Site", "Northrop", "0.30"],
  ["cleveland", "Cleveland Clinic", "0.77"],
  ["cityny", "City of New York", "0/60 — no field"],
  ["saks", "Saks", "n=26 < EMPLOYER_MIN_N (25/26 pure; the next lever needs a 60-row probe)"],
  ["big5", "Big 5", "n=14 < EMPLOYER_MIN_N"],
  ["tyson", "Tyson Foods", "0.68 (operations 41/60; judged under the tysonfoods~wd5~TSN board)"],
];

const EMPLOYER_BY_TOKEN: ReadonlyMap<string, EmployerDefault> = new Map(EMPLOYER_DEFAULTS.map((e) => [e.token, e]));

/** True when the employer's guard says this title stays in the bucket. */
export function employerGuardExcludes(e: EmployerDefault, title: string): boolean {
  return e.guard ? e.guard.test(title ?? "") : false;
}

/**
 * A guard hit is a HOLD ON THE ROW, not a silence of one mechanism: the
 * judged verdict for these titles (a Domino's Delivery Expert, a JCPenney
 * Program Mgr, a Kroger DISTRIBUTION row) was "not this employer's field",
 * and the plan's rule is that they stay in the bucket, never filed. Without
 * this, an F2-clearing embed vote filed a Domino's delivery row as
 * hospitality_retail (mechA/judged.jsonl n=30, share 0.732) -- promotable
 * under (embed, embed_knn_v1, hospitality_retail) with no per-employer audit.
 * resolveShadowRow returns {kind: "held"} for such a row regardless of what
 * the rule or embed mechanism says, and shadowRowPatch writes nothing for it.
 */
export function employerHolds(companyToken: string | null | undefined, title: string): boolean {
  const e = companyToken ? EMPLOYER_BY_TOKEN.get(companyToken) : undefined;
  return e ? employerGuardExcludes(e, title) : false;
}

/**
 * The employer mechanism. Null when the token has no default (the common
 * case), when there is no token, or when the guard excludes the title (the
 * row stays in the bucket; it is NOT filed anywhere else). Confidence is the
 * measured, guarded, strict purity.
 */
export function proposeByEmployer(companyToken: string | null | undefined, title: string): ShadowProposal | null {
  const e = companyToken ? EMPLOYER_BY_TOKEN.get(companyToken) : undefined;
  if (!e) return null;
  if (employerGuardExcludes(e, title)) return null;
  return { basis: "employer", key: e.token, target: e.target, confidence: e.purity };
}

/**
 * Every gate an entry must clear, as a validator over the table's own
 * figures. Returns one {token, reason} per failure; an empty list means the
 * table is admissible. The catalog tokens are handed in by the caller (the
 * test parses sources.ts through the one catalog reader), so this module
 * stays free of file I/O.
 */
export function validateEmployerDefaults(
  defaults: ReadonlyArray<EmployerDefault>,
  catalogTokens: ReadonlySet<string>,
): Array<{ token: string; reason: string }> {
  const out: Array<{ token: string; reason: string }> = [];
  const seen = new Set<string>();
  const [lo, hi] = EMPLOYER_SECOND_PAGE_OFFSET_BAND;
  for (const e of defaults) {
    const fail = (reason: string) => out.push({ token: e.token, reason });
    if (seen.has(e.token)) fail("duplicate token");
    seen.add(e.token);
    if (!catalogTokens.has(e.token)) fail("token is not in sources.ts");
    if (e.judgedKey !== e.token) fail(`judged under ${e.judgedKey}, not the token`);
    if ((e.target as string) === "other") fail("target is other");
    if (EMBED_BARRED_TARGETS.has(e.target)) fail(`target ${e.target} is barred`);
    if (!(e.purity >= EMPLOYER_MIN_PURITY)) fail(`purity ${e.purity.toFixed(3)} < ${EMPLOYER_MIN_PURITY}`);
    if (!(e.n >= EMPLOYER_MIN_N)) fail(`n ${e.n} < ${EMPLOYER_MIN_N}`);
    if (!(e.secondPage.n > 0)) fail("no second page");
    else if (!(e.secondPage.right / e.secondPage.n >= EMPLOYER_SECOND_PAGE_MIN)) {
      fail(`second page ${e.secondPage.right}/${e.secondPage.n} < ${EMPLOYER_SECOND_PAGE_MIN}`);
    }
    const frac = e.bucketTotal > 0 ? e.secondPage.offset / e.bucketTotal : 0;
    if (!(frac >= lo && frac <= hi)) fail(`second page offset ${e.secondPage.offset}/${e.bucketTotal} = ${frac.toFixed(3)} is outside the band [${lo}, ${hi}]`);
    const unguarded = e.unguarded.n ? e.unguarded.right / e.unguarded.n : 0;
    if (e.mode === "strict" && !(unguarded >= EMPLOYER_MIN_PURITY)) fail(`strict default but unguarded ${unguarded.toFixed(3)} < ${EMPLOYER_MIN_PURITY}`);
    if (e.mode === "conditional" && !e.guard) fail("conditional default without a guard");
    if (e.mode === "conditional" && unguarded >= EMPLOYER_MIN_PURITY) fail("conditional default that clears the bar unguarded — mark it strict");
  }
  return out;
}

// ── Mechanism 3: the embed verdict, as the resolver receives it ────────────
/**
 * embed-classify.ts's proposal, after ITS gate (share, nn1, centroid, target
 * set), in the shape the resolver compares. The barred targets and the
 * anchor version are re-checked here so a loosened scorer, or a proposal made
 * under a previous anchor set, can never reach a row: either returns null.
 */
export function embedToShadow(p: { field: string; key: string; confidence: number } | null | undefined): ShadowProposal | null {
  if (!p) return null;
  if (p.key !== EMBED_ANCHOR_VERSION) return null;
  if (p.field === "other" || EMBED_BARRED_TARGETS.has(p.field as JobCategory)) return null;
  if (!(p.confidence >= EMBED_MIN_SHARE)) return null;
  return { basis: "embed", key: p.key, target: p.field as Field, confidence: p.confidence };
}

// ── The first-claim resolver ───────────────────────────────────────────────
export type ShadowResolution =
  /** One field, proposed by every mechanism that fired; the winner is the highest-ranked basis. */
  | { kind: "claim"; proposal: ShadowProposal; agreed: ShadowProposal[] }
  /** Two mechanisms named different fields: nothing is proposed, the row stays, category_key = 'conflict'. */
  | { kind: "conflict"; proposals: ShadowProposal[] }
  /** Nothing fired: the sweep leaves the row untouched. */
  | { kind: "silent" }
  /** An employer guard holds the row (employerHolds): it stays in the bucket whatever the other mechanisms said; nothing is written. */
  | { kind: "held"; token: string };

const isBasis = (b: unknown): b is CategoryBasis => typeof b === "string" && (CATEGORY_BASES as ReadonlyArray<string>).includes(b);

/** A proposal the resolver will consider at all; anything else is silence, never a move. */
function admissible(p: ShadowProposal | null | undefined): p is ShadowProposal {
  if (!p || typeof p !== "object") return false;
  if (!isBasis(p.basis)) return false;
  if (typeof p.key !== "string" || !p.key || p.key === CONFLICT_KEY) return false;
  if (typeof p.target !== "string" || !p.target || (p.target as string) === "other") return false;
  if (p.basis === "embed" && (p.key !== EMBED_ANCHOR_VERSION || EMBED_BARRED_TARGETS.has(p.target))) return false;
  return true;
}

/**
 * ORDER: rule -> employer -> embed, BY BASIS, never by input position
 * (plan/union.txt: rule 419, employer +317, embed +155 on the sample;
 * reversing changes nothing about precision but would stamp rule-explainable
 * rows with an inference basis, so rule goes first). A basis wins ONLY when
 * every other mechanism that fired agrees or is silent; any disagreement is a
 * conflict (journal guards §7 — the Kroger "CUSTOMER SVC/DEPT MANAGER" case,
 * now silent because the abbreviation step is withheld). Pure: same input,
 * same output, nothing written.
 */
export function resolveFirstClaim(proposals: ReadonlyArray<ShadowProposal | null | undefined>): ShadowResolution {
  const fired = proposals.filter(admissible).sort((a, b) => BASIS_RANK[a.basis] - BASIS_RANK[b.basis]);
  if (fired.length === 0) return { kind: "silent" };
  const target = fired[0].target;
  if (fired.some((p) => p.target !== target)) return { kind: "conflict", proposals: fired };
  return { kind: "claim", proposal: fired[0], agreed: fired };
}

/**
 * The row patch for a resolution — the ONLY thing a sweep may write. A claim
 * fills the six shadow columns; a conflict clears the proposal and stamps
 * CONFLICT_KEY; silence returns null so the sweep leaves the row untouched.
 * `version` is the rules version the hop runs under (category_proposed_v).
 */
export function shadowRowPatch(res: ShadowResolution, version: number, at: string = new Date().toISOString()): ShadowPatch | null {
  if (res.kind === "silent" || res.kind === "held") return null;
  if (res.kind === "conflict") {
    return { category_proposed: null, category_basis: null, category_key: CONFLICT_KEY, category_confidence: null, category_proposed_at: at, category_proposed_v: version };
  }
  return {
    category_proposed: res.proposal.target,
    category_basis: res.proposal.basis,
    category_key: res.proposal.key,
    category_confidence: res.proposal.confidence,
    category_proposed_at: at,
    category_proposed_v: version,
  };
}

/** One stored-'other' row as the sweep sees it, plus the embed verdict when the hop has one. */
export interface ShadowRowInput {
  title: string;
  department?: string | null;
  company_token?: string | null;
  embed?: { field: string; key: string; confidence: number } | null;
}

/**
 * The three mechanisms over one row, resolved. THE ENTRY POINT the hop
 * (phase 2) must use -- not resolveFirstClaim directly -- because only here
 * is the employer hold applied: a row an employer guard holds is returned as
 * {kind: "held"} before any mechanism is consulted, so neither a rule term
 * nor an embed vote can file it. Then rule from categories.ts proposeCategory
 * (null unless the frozen rules leave the row in "other"), employer from the
 * token, embed from the scorer's proposal. Returns the resolution; the patch
 * is shadowRowPatch(..., CATEGORIZE_VERSION).
 */
export function resolveShadowRow(input: ShadowRowInput): ShadowResolution {
  const token = input.company_token ?? null;
  if (employerHolds(token, input.title ?? "")) return { kind: "held", token: token as string };
  const rule = proposeCategory(input.title ?? "", input.department ?? null);
  return resolveFirstClaim([
    rule ? { basis: rule.basis, key: rule.key, target: rule.target, confidence: rule.confidence } : null,
    proposeByEmployer(input.company_token ?? null, input.title ?? ""),
    embedToShadow(input.embed ?? null),
  ]);
}

/** The version a hop stamps into category_proposed_v today. */
export const SHADOW_PROPOSED_VERSION = CATEGORIZE_VERSION;

// ── The promotion reader (job_board_meta.category_promotions) ──────────────
/**
 * One listed triple, exactly as promote_category (20260909225500) reads it:
 * {"basis","key","target","audit","judged","wrong"}, an element of the BARE
 * JSON ARRAY that is job_board_meta.category_promotions' value (20260909224000
 * seeds '[]'; a wrapped {"list": [...]} or {"promotions": [...]} is tolerated
 * by every reader but is not the shape to write). The list is written ONLY by
 * hand, after an audit file exists at scratchpad/other-bucket/audit/
 * <basis>-<key>.md; the function refuses any triple not listed, listed
 * without an audit, or listed under the bar. This build ships ZERO promotions
 * (the seed is []).
 */
export interface Promotion {
  basis: CategoryBasis;
  key: string;
  target: Field;
  /** The audit file that authorised it (required by promote_category). */
  audit: string | null;
  /** Fresh judged rows in that audit, and how many were wrong (strict: ambiguous counts as wrong). null when the entry carries none. */
  judged: number | null;
  wrong: number | null;
  promotedAt?: string;
}

const asCount = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return v;
  if (typeof v === "string" && /^[0-9]+$/.test(v)) return Number(v);
  return null;
};

/**
 * Parse the meta row's value. Tolerant of the shapes a hand-written row can
 * take — a bare array (the seeded, canonical shape), {"list": [...]} or
 * {"promotions": [...]} — and DROPS anything malformed rather than throwing:
 * a malformed row must fail closed (nothing promoted), never open.
 */
export function readPromotions(value: unknown): Promotion[] {
  let list: unknown[] = [];
  if (Array.isArray(value)) list = value;
  else if (value && typeof value === "object") {
    const o = value as { list?: unknown; promotions?: unknown };
    if (Array.isArray(o.list)) list = o.list;
    else if (Array.isArray(o.promotions)) list = o.promotions;
  }
  const out: Promotion[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    if (!isBasis(p.basis)) continue;
    if (typeof p.key !== "string" || !p.key || p.key === CONFLICT_KEY) continue;
    if (typeof p.target !== "string" || !p.target || p.target === "other") continue;
    out.push({
      basis: p.basis,
      key: p.key,
      target: p.target as Field,
      audit: typeof p.audit === "string" && p.audit ? p.audit : null,
      judged: asCount(p.judged),
      wrong: asCount(p.wrong),
      ...(typeof p.promotedAt === "string" ? { promotedAt: p.promotedAt } : {}),
    });
  }
  return out;
}

/**
 * The same bar promote_category enforces in SQL, so a reader can tell a
 * listing that WILL promote from one the function will refuse: an audit file
 * named, judged/wrong present, judged >= the per-basis minimum, wrong <= the
 * per-basis maximum. A missing count is a refusal, never a pass.
 */
export function promotionClearsBar(p: Promotion): boolean {
  if (!p.audit) return false;
  if (p.judged === null || p.wrong === null) return false;
  const minJudged = p.basis === "embed" ? PROMOTE_MIN_JUDGED_PER_EMBED_TARGET : PROMOTE_MIN_JUDGED_PER_KEY;
  const maxWrong = p.basis === "embed" ? PROMOTE_MAX_WRONG_PER_EMBED_TARGET : PROMOTE_MAX_WRONG;
  return p.judged >= minJudged && p.wrong <= maxWrong;
}

/** True only for an exact (basis, key, target) triple in the list. */
export function isPromoted(list: ReadonlyArray<Promotion>, basis: CategoryBasis, key: string, target: string): boolean {
  return list.some((p) => p.basis === basis && p.key === key && p.target === target);
}

/**
 * The embed anchor set is frozen under EMBED_ANCHOR_VERSION; every embed
 * promotion names the anchor version as its key, so a promotion made under a
 * previous anchor set is NOT a promotion under this one. Filtering here is
 * what "any anchor change resets every embed-basis promotion" means in code.
 */
export function promotionsValidForAnchors(list: ReadonlyArray<Promotion>, anchorVersion: string = EMBED_ANCHOR_VERSION): Promotion[] {
  return list.filter((p) => p.basis !== "embed" || p.key === anchorVersion);
}
