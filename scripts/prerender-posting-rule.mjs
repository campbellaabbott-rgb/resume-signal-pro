// Which posting rows may carry a page and job markup of their own: the bake's
// rule 1, in a module with no imports at all, so the app can run the very
// same function. src/components/jobs/posting-page.ts calls it inside
// postingJsonLd, which is what the React posting page and the board's detail
// pane write their job markup from; scripts/prerender-pages.mjs re-exports it
// for the bake (scripts/prerender-seo.mjs), whose other helpers there need
// node:crypto and so could never reach the browser bundle.
//
// `D` is the app's own modules (posting-page.ts and company-display.ts): the
// bake passes its esbuild bundle of them, posting-page.ts passes its own.

/**
 * BOARDS ONLY AN EMPLOYER'S OWN PEOPLE MAY APPLY THROUGH (SEO check
 * 2026-11-15, F02). The catalogue carries career sites an employer runs for
 * its own staff: "Coupang Internal", whose postings say they are exclusively
 * for internal employees and are applied for from a Coupang email address;
 * "Home Chef (Internal Employees)"; "Remote - Referral Board"; Oracle sites
 * named "... Council Internal" or "UoB Employee"; a Workday site named
 * Invitation-Only. A posting page for one of them told Google for Jobs that
 * anyone could apply, and Google's policy refuses a posting with no way to
 * apply, with a manual action as the penalty.
 *
 * The board is read by its name as the board stores it (the row's company)
 * and by its token, the only place a Workday site name or a Greenhouse slug
 * says it. Every word below is one the catalogue's own boards use (the 44 it
 * flags on board/102-integration are listed, with the boards that carry the
 * same words and are open to everyone, in
 * src/test/fixtures/posting-selection-screen-2026-11-15.json): "internal" and its
 * Portuguese and French forms, "referral" and the Portuguese "indicações",
 * employees-only and current-crew wording, and invitation-only. "Internal"
 * that names a medical specialty, an audit profession or a government
 * department ("Internal Medicine Associates", "The Institute of Internal
 * Auditors", the Department of Internal Affairs) is a public employer's name.
 * Returns the kind of board, or null for a board open to everyone.
 */
const fold = (s) => String(s ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const PUBLIC_INTERNAL_NAME = /\binternal\s+(?:medicine|med|audit\w*|affairs|revenue)\b/;
export function internalBoardReason(token, name) {
  const n = fold(name).replace(/[^a-z0-9]+/g, " ").trim();
  const t = fold(token).replace(/[^a-z0-9]+/g, "");
  if (/\binternal\b/.test(n) && !PUBLIC_INTERNAL_NAME.test(n)) return "an internal board";
  if (/internal(?!medicine|audit|affairs|revenue)/.test(t)) return "an internal board";
  // Portuguese and French: "Vagas Internas", "Recrutement Interne", "ifoodinterno".
  if (/\b(?:interno|internos|interna|internas|interne)\b/.test(n) && !/\b(?:medicina|medecine)\s+intern/.test(n)) return "an internal board";
  if (/(?:interno|internas?|interne)$/.test(t)) return "an internal board";
  if (/\breferrals?\b|\bindicacoes\b/.test(n) || /referral/.test(t)) return "a referral board";
  if (/\bemployees?\s+(?:only|portal|openings)\b|\bcurrent\s+(?:crew|employees|staff|team\s+members?|associates|colleagues)\b|\bemployees?$/.test(n)) return "an employees-only board";
  if (/employeesonly|employeeopenings|currentemployees/.test(t)) return "an employees-only board";
  if (/\binvitation\s+only\b/.test(n) || /invitationonly/.test(t)) return "an invitation-only board";
  return null;
}

/**
 * A POSTING WHOSE OWN TEXT SAYS ONLY THE EMPLOYER'S OWN PEOPLE MAY APPLY, on
 * any board (F02). Each shape is one a real posting printed on 2026-11-15:
 * Coupang's "This posting is exclusively for internal employees", Vital
 * Farms' "This posting is intended for current Vital Farms employees", Lush's
 * "( Internal Only)", and Zup's "aplicação na vaga interna" and "Processo
 * Seletivo Interno". What public postings print about internal applicants is
 * not one: a notice addressed to them ("IMPORTANT NOTICE FOR INTERNAL
 * APPLICANTS ONLY: ... must apply to the internal job posting"), a link for
 * current employees, an internal deadline, a role "open to internal and
 * external candidates", or "for internal use only" over a recruiter's tag.
 * None of the public postings in the same fixture is caught, nor any of the
 * 2,722 they were drawn from (the 208 live marked-up pages, 2,067 board rows,
 * 447 public Brazilian postings).
 * Returns the words that say it, or null.
 */
const WHO = String.raw`(?:employees?|candidates?|applicants?|staff|team\s*members?|associates?|colleagues?|crew(?:\s*members?)?|workers?|personnel)`;
// Up to three words naming the employer ("current Vital Farms employees"),
// never a word that opens the role to anyone else.
const NAMED = String.raw`(?:(?!(?:and|or|as|external|outside|former|new|non|all)\b)[\p{L}\p{N}'’.&-]+\s+){0,3}`;
// "current employees and external applicants" opens the role to everyone.
const NOT_ALSO = String.raw`(?!\s*,?\s*(?:and|or|&|as\s+well\s+as|plus|along\s+with)\s)`;
const RESTRICTED_TO_OWN = new RegExp(String.raw`\bthis\s+(?:job\s+)?(?:posting|position|job|role|opening|vacancy|requisition|opportunity|req)\s+is\s+(?:(?:only|exclusively|solely|strictly)\s+)?(?:(?:open|available|intended|reserved|restricted|limited)\s+)?(?:(?:only|exclusively|solely|strictly)\s+)?(?:to|for)\s+(?:our\s+)?(?:current|internal|existing)\s+${NAMED}${WHO}\b${NOT_ALSO}`, "iu");
const OWN_PEOPLE_ONLY = new RegExp(String.raw`\b(?:internal|current|existing)\s+${NAMED}${WHO}\s+only\b`, "giu");
// What comes right before a notice addressed to internal applicants.
const NOTICE_TO = /\b(?:notice|note|instructions?|information|message|reminder)\s+(?:for|to)\s+$/i;
const LABELS = [
  /\binternal[\s-]+only\b/iu,
  /\bthis\s+is\s+an\s+internal\s+(?:job\s+)?(?:posting|position|vacancy|opening|requisition)\b/iu,
  /\b(?:processo\s+seletivo\s+interno|vagas?\s+internas?)\b/iu,
];
export function internalOnlyTextReason(text) {
  const t = String(text ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;|\u00a0/g, " ").replace(/\s+/g, " ");
  const restricted = RESTRICTED_TO_OWN.exec(t);
  if (restricted) return restricted[0];
  for (const m of t.matchAll(OWN_PEOPLE_ONLY)) {
    if (!NOTICE_TO.test(t.slice(Math.max(0, m.index - 40), m.index))) return m[0];
  }
  for (const re of LABELS) {
    const m = re.exec(t);
    if (m) return m[0];
  }
  return null;
}

/**
 * A PAID-SURVEY PANEL AD IS NOT A JOB (SEO check 2026-11-15, F03). The Lever
 * board "usasurveyjob" carried 1,571 postings on 2026-11-15 under 90 titles
 * ("Work From Home Customer Service Representative - Part Time" 465 times),
 * every one an invitation to take paid surveys, 1,286 of them sending
 * applicants to an affiliate tracker ("APPLY AT : https://...ttrk.io/...").
 * Google's policy on advertisements disguised as job postings names
 * affiliate programs. The board is held here until the owner's mill-screen
 * decision retires or labels it in the catalogue, and the same ad on any
 * other board is read by its own words. Each shape below is one its
 * postings print: "Earn money at Home by Participating in Surveys", "Earn by
 * taking polls", "take surveys to earn Money", "participate in paid
 * research", "Survey Taker", "our work at home Panelist Program". Together
 * they catch all 1,571, and none of the 2,722 public postings above, 62 of
 * which speak of surveys, focus groups, panels or polls as work (the fixture
 * holds 40 of them). Returns the words, or null.
 */
export const PAID_SURVEY_AD_BOARDS = new Set(["usasurveyjob"]);
const SURVEYS = String.raw`(?:surveys?|polls?|paid\s+(?:studies|research)|focus\s+groups?)`;
const SURVEY_AD = [
  new RegExp(String.raw`\b(?:earn|make)\s+(?:(?:extra|additional|some|real)\s+)?(?:money|cash|income)?[^.\n]{0,40}\b(?:by|for|from|through)\s+(?:participating\s+in|taking|completing|answering|doing)\s+(?:paid\s+)?(?:online\s+)?${SURVEYS}`, "iu"),
  /\bearn\s+by\s+taking\s+(?:polls|surveys)\b/iu,
  /\b(?:take|taking|complete|completing|answer|answering)\s+(?:paid\s+)?(?:online\s+)?(?:surveys|polls)\s+(?:to|and)\s+(?:earn|make|get\s+paid)\b/iu,
  /\bparticipat\w*\s+in\s+paid\s+(?:research|studies|surveys|focus\s+groups|polls)\b/iu,
  /\bsurvey\s+takers?\b/iu,
  /\bpanelist\s+program\b/iu,
];
export function paidSurveyAdReason(text) {
  const t = String(text ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  for (const re of SURVEY_AD) {
    const m = re.exec(t);
    if (m) return m[0];
  }
  return null;
}

/**
 * Rule 1 of the posting rule: a row may get a page of its own only when it
 * carries everything the page must state, under its employer's own name (F1),
 * from the employer itself (a staffing agency's row is not: the page says the
 * posting came from the employer's own system and names the row's company as
 * the hiring organisation; nor is a row the USAJOBS listing site carries),
 * with a place, and still live. The description
 * gate needs the detail read and is applied after it.
 *
 * A row whose board names no hirer for it (D.postingEmployer answers "") gets
 * no page: its markup would have to name the board's publisher as the hiring
 * organisation.
 *
 * A row from a board only the employer's own people may apply through
 * (internalBoardReason, F02) or from a paid-survey ad feed
 * (PAID_SURVEY_AD_BOARDS, F03) gets none either: a carried page becomes the
 * bake's noindex "no longer has a page of its own" stub with no markup, and
 * the pool never picks a new one from it.
 */
export const postingRowEligible = (j, D) => !!(j
  && typeof j.id === "string"
  && D.postingPagePath(j.id)
  && typeof j.title === "string" && j.title.trim()
  && typeof j.company === "string" && j.company.trim()
  && D.postingEmployer(j)
  && !D.isCodeShapedName(j.token ?? D.postingPathParts(j.id)?.token ?? null, D.postingEmployer(j))
  && j.agency !== true
  // USAJOBS is a listing site, not an employer: a page of its own would say
  // "Apply on <agency>'s own site" and "never an aggregator" of a row the
  // federal listing site carries.
  && j.source !== "usajobs" && (j.token ?? D.postingPathParts(j.id)?.token ?? null) !== "usajobs"
  && !internalBoardReason(j.token ?? D.postingPathParts(j.id)?.token ?? null, j.company)
  && !PAID_SURVEY_AD_BOARDS.has(j.token ?? D.postingPathParts(j.id)?.token ?? "")
  && j.country
  && (j.workMode === "remote" || j.location)
  && D.isPostingLive(j));

/**
 * Why a row rule 1 admits still gets no NEW page for the name it would print,
 * or null when it may (SEO/GEO audit 2026-11-07, B02). Two reasons: the name
 * gate refuses the name (D.postingNameVerdict: logo text, a web address, a
 * colour caption, a tenant code), or nobody ever wrote it, because it is the
 * board's own code as the catalogue was handed it (D.isUnreviewedTenantName:
 * "Atd", "Starfish", "Creatoriq", "Harmattan Ai"). Asked only of a posting
 * the bake would give a NEW page: a carried page keeps its page under D7, and
 * an override is what names it.
 */
export const postingFreshNameReason = (j, D) => {
  const named = D.postingNameVerdict(j);
  if (named.reason) return named.reason;
  const token = j.token ?? D.postingPathParts(j.id)?.token ?? null;
  return D.isUnreviewedTenantName(token, named.name) ? "unreviewed tenant name" : null;
};
