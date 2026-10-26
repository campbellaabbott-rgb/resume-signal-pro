/**
 * THE TITLE AND DESCRIPTION OF THE BOARD'S INDEXED PAGES, ONE BUILDER FOR BOTH
 * RENDERERS (SEO-007, R3).
 *
 * The bake and the React page wrote different heads for the same address:
 * /jobs/company/dominos baked "Domino's jobs: 23,789 open roles from their own
 * hiring system" and React replaced it with "Domino's jobs: open roles from
 * their own hiring system"; the field pages and /jobs differed the same way;
 * an agency's page baked "roles listed by a staffing agency" while React said
 * "open roles from their own hiring system" (it had no agency branch).
 *
 * Every head here is built from main-locale keys (jobsPage.*, read by the
 * bake from en.json, and from the company shard for the federal listing
 * site's own words), with English defaults that are the bake's own sentences
 * — scripts/prerender-pages.mjs companyLanderPage for the company pages,
 * which src/test/seo-react-one-head-per-address.test.tsx holds equal to this
 * builder for every kind, with and without a count. React reads it for an
 * address it renders without a baked head (an SPA navigation); on a load of a
 * baked file it keeps the baked words (SEO.tsx preferBakedHead).
 *
 * `n` is always the figure already formatted for the reader's language (or
 * the bake's margined "85,000+" claim); null prints the count-free sentence.
 */

/** i18next's t(key, defaultValue, vars) shape; the bake passes a reader over EN_LOCALE. */
export type HeadT = (key: string, defaultValue: string, vars?: Record<string, unknown>) => string;

export interface BoardHead {
  title: string;
  description: string;
}

/** The SERP budget the bake applies: the name stays whole, the source phrase gives way first, then the count. */
export const BOARD_TITLE_MAX = 68;
const fit = (...options: string[]) => options.find((o) => o.length <= BOARD_TITLE_MAX) ?? options[options.length - 1];

/**
 * DESCRIPTIONS BUILT UP TO THE SNIPPET BUDGET, NEVER CUT (OBS-2), AS THE BAKE
 * BUILDS THEM: the first option that fits 160 characters, else the last. The
 * shorter options are taken from the localized sentence itself, so every
 * language gives way the same way: its first sentence (the call to action
 * goes), then the clause before a mark that follows the name.
 */
export const BOARD_DESCRIPTION_MAX = 160;
const snip = (...options: string[]) => {
  const opts = options.filter((o) => o.length > 0);
  return opts.find((o) => o.length <= BOARD_DESCRIPTION_MAX) ?? opts[opts.length - 1] ?? "";
};
/** Where the name last ends in `s` (0 when it is absent), so a period inside a name never ends a sentence. */
const afterName = (s: string, name: string) => {
  const i = name ? s.lastIndexOf(name) : -1;
  return i < 0 ? 0 : i + name.length;
};
/** The first sentence of `s` (to its first full stop or danda after the name), or "" when it has only one. */
const firstSentence = (s: string, name: string) => {
  const m = /[.\u0964](?=\s|$)/.exec(s.slice(afterName(s, name)));
  if (!m) return "";
  const end = afterName(s, name) + m.index + 1;
  return end < s.length ? s.slice(0, end) : "";
};
/** The text before the first `mark` after the name's first appearance, closed with the sentence's own stop. */
const clauseBefore = (s: string, name: string, mark: string) => {
  const from = name ? Math.max(0, s.indexOf(name)) + name.length : 0;
  const i = s.indexOf(mark, from);
  if (i < 0) return "";
  const stop = /\u0964/.test(s) ? "\u0964" : ".";
  return `${s.slice(0, i).trimEnd()}${stop}`;
};

export type CompanyHeadKind = "employer" | "agency" | "usajobs";

/**
 * A company page. `name` is the board's display name; `possessive` its
 * possessive ("Domino's", never "Domino's's"). For the federal listing site
 * `usajobsH1` and `capLine` are the company shard's own sentences.
 */
export function companyBoardHead(o: {
  kind: CompanyHeadKind;
  name: string;
  possessive: string;
  n: string | null;
  t: HeadT;
  usajobsH1?: string;
  capLine?: string;
}): BoardHead {
  const { kind, name: company, possessive: companyPossessive, n, t } = o;
  const v = { company, companyPossessive, n };
  if (kind === "usajobs") {
    const h1 = o.usajobsH1 ?? "";
    const full = n
      ? t("jobsPage.usajobsSeoDescriptionCount", "{{n}} federal openings listed on USAJOBS, each naming its agency. {{cap}} Check your resume's fit free.", { n, cap: o.capLine ?? "" })
      : t("jobsPage.usajobsSeoDescription", "Federal openings listed on USAJOBS, each naming its agency. {{cap}} Check your resume's fit free.", { cap: o.capLine ?? "" });
    return {
      title: n ? fit(t("jobsPage.usajobsSeoTitleCount", "{{h1}}: {{n}} roles", { h1, n }), h1) : h1,
      description: snip(full, firstSentence(full, "")),
    };
  }
  if (kind === "agency") {
    return {
      title: n
        ? fit(
            t("jobsPage.agencySeoTitleCount", "{{company}} jobs: {{n}} roles listed by a staffing agency", v),
            t("jobsPage.agencySeoTitleCountShort", "{{company}} jobs: {{n}} roles", v),
            t("jobsPage.companySeoTitleShort", "{{company}} jobs", v),
          )
        : fit(t("jobsPage.agencySeoTitle", "{{company}} jobs: roles listed by a staffing agency", v), t("jobsPage.companySeoTitleShort", "{{company}} jobs", v)),
      description: (() => {
        const bare = t("jobsPage.agencySeoDescription", "Roles listed by {{company}}, a staffing agency: roles are usually for its clients. Check your resume's fit free before you apply.", v);
        const full = n ? t("jobsPage.agencySeoDescriptionCount", "{{n}} roles listed by {{company}}, a staffing agency: roles are usually for its clients. Check your resume's fit free before you apply.", v) : bare;
        return snip(full, firstSentence(full, company), clauseBefore(bare, company, ":"));
      })(),
    };
  }
  return {
    title: n
      ? fit(
          t("jobsPage.companySeoTitleCount", "{{company}} jobs: {{n}} open roles from their own hiring system", v),
          t("jobsPage.companySeoTitleCountShort", "{{company}} jobs: {{n}} open roles", v),
          t("jobsPage.companySeoTitleShort", "{{company}} jobs", v),
        )
      : fit(t("jobsPage.companySeoTitle", "{{company}} jobs: open roles from their own hiring system", v), t("jobsPage.companySeoTitleShort", "{{company}} jobs", v)),
    description: (() => {
      const full = n
        ? t("jobsPage.companySeoDescriptionCount", "{{n}} open roles at {{company}}, read from {{companyPossessive}} own hiring system. Check your resume's fit free before you apply.", v)
        : t("jobsPage.companySeoDescription", "Open roles at {{company}}, read from {{companyPossessive}} own hiring system. Check your resume's fit free before you apply.", v);
      // A long name: "read from its own hiring system", then the count and the name alone.
      const vIts = { ...v, companyPossessive: t("jobsPage.companySeoPossessiveIts", "its", v) };
      const its = n
        ? t("jobsPage.companySeoDescriptionCount", "{{n}} open roles at {{company}}, read from {{companyPossessive}} own hiring system. Check your resume's fit free before you apply.", vIts)
        : t("jobsPage.companySeoDescription", "Open roles at {{company}}, read from {{companyPossessive}} own hiring system. Check your resume's fit free before you apply.", vIts);
      return snip(full, firstSentence(full, company), firstSentence(its, company), clauseBefore(full, company, ", "));
    })(),
  };
}

/**
 * A field page (/jobs/field/<slug>). `n` is the bake's margined claim
 * ("85,000+"), `exact` the formatted count for the description, `boards`
 * the formatted board count and `countsDay` the bake's dated clause; React
 * passes none of them and prints the count-free sentences.
 */
export function fieldBoardHead(o: { label: string; t: HeadT; n?: string | null; exact?: string | null; boards?: string | null; countsDay?: string | null }): BoardHead {
  const { label: category, t } = o;
  const v = { category, n: o.n, exact: o.exact, boards: o.boards, countsDay: o.countsDay };
  const lead = o.exact && o.countsDay
    ? t("jobsPage.landerSeoDescriptionLeadCount", "{{exact}} live {{category}} openings, {{countsDay}}", v)
    : t("jobsPage.landerSeoDescriptionLead", "Live {{category}} openings", v);
  const boards = o.boards ? t("jobsPage.landerSeoDescriptionBoards", ", from {{boards}} company job boards", v) : "";
  return {
    title: o.n
      ? t("jobsPage.landerSeoTitleCount", "{{category}} Jobs — {{n}} Live Openings", v)
      : t("jobsPage.landerSeoTitle", "{{category}} Jobs — Live Openings from Company Boards", v),
    description: `${lead}${boards}${t("jobsPage.landerSeoDescriptionTail", ", each read from the hiring system that published it.", v)}`,
  };
}

/**
 * The board (/jobs). `n` and `boards` are the bake's margined claims; React
 * passes neither and prints the count-free sentences.
 */
export function jobsBoardHead(o: { t: HeadT; n?: string | null; boards?: string | null }): BoardHead {
  const { t } = o;
  const v = { n: o.n, boards: o.boards };
  const phrase = o.n && o.boards
    ? t("jobsPage.seoPhraseCountBoards", "{{n}} live openings across {{boards}} company job boards", v)
    : o.n
      ? t("jobsPage.seoPhraseCount", "{{n}} live openings", v)
      : t("jobsPage.seoPhrase", "live openings from companies' own job boards", v);
  return {
    title: o.n
      ? t("jobsPage.seoTitleCount", "Live Job Board — {{n}} Openings Direct From Company Career Pages", v)
      : t("jobsPage.seoTitle", "Live Job Board — Openings Direct From Company Career Pages", v),
    description: t("jobsPage.seoDescription", "Browse {{phrase}}, each read from the hiring system that published it, never copied from another job board. No dated posting older than 30 days.", { phrase }),
  };
}
