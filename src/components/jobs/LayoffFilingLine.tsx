// A FILING IS PRINTED AS A FILING.
//
// Three surfaces on the board carry an employer's layoff filing beside the
// roles it has up: a muted chip in the card's meta row, one line in the
// detail panel's provenance strip, and an "Also on record:" item in the
// employer page's Hiring Health card. Each prints the filer's name verbatim
// as the source spells it (never the tenant's name), the filing's own date
// with its basis, our read time, the count or percentage the filing states,
// the state or the form, and a link to the source. No adjective, no verdict:
// the copy rule's banned nouns (SPEC §7) appear in no layoff.* key in any
// language, and a filing never enters activelyHiringVerdict,
// hiringRecordVerdict or growthVerdict. It sits BESIDE "Actively hiring" on
// purpose -- both can be true of one employer on one day, and the tooltip
// says so.
//
// WHAT REACHES THIS FILE. Only the rows of get_employer_layoff_filings (one
// per token asked, lf_* columns) and get_employer_layoff_filings_all (every
// qualifying filing for one token, la_* columns). Both are SECURITY DEFINER
// readers whose predicates decide what qualifies -- matched through
// layoff_matches via an exact multi-token name or a curated alias, status
// active, a source URL, inside the display window, never after our read,
// a state notice at or above the single-site worker bar, never an 8-K/A.
// The client mirrors the shape of those rules in readLayoffRow so a row that
// somehow arrives outside them renders nothing, and adds the one rule only
// the client can apply: a state notice is a US filing and hides on a posting
// whose stated country is not the US. Nothing here reads layoff_filings, and
// nothing here reads get_layoff_partition -- that is the Ghost Index's
// section, and a per-posting surface never draws on the aggregate.
//
// A ROW IS AN ANSWER; NO ROW IS NEVER "NO FILING". The reader answers every
// token it is handed, with lf_source NULL when nothing qualifies. The hook
// keeps that null so the token is not asked again, and renders nothing for
// it -- the same nothing an unasked token gets, because no surface may ever
// print an absence (an unread feed is not one either).
//
// TWO DATES ON EVERY LINE, AS THE RPC STATES THEM, IN THE READER'S LANGUAGE.
// A filing's dates arrive as YYYY-MM-DD and print as that calendar day in the
// reader's language ("Sep 10, 2026", "10. Sept. 2026"), never as the raw ISO
// string beside a US-locale timestamp (audit CP18 found both on one line).
// They are formatted at UTC noon, never parsed at local midnight, which would
// shift each one a day in every western timezone. Our read is a timestamp and
// renders in the reader's language and timezone; past LAYOFF_STALE_HOURS for
// that source it prints as an absolute "last read" instead of a relative age.

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import i18n, { type TFunction } from "i18next";
import { tPlural } from "@/lib/company/plural";
import { companyLanderPath } from "@/lib/public-href";
import { useTranslation } from "react-i18next";
import { ExternalLink, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { date as fmtDate, dateTime as fmtDateTime } from "@/lib/format";
import { STATE_ALIASES } from "../../../supabase/functions/_shared/location-terms";
import {
  LAYOFF_MATCHED_VIA,
  LAYOFF_RELATIONS,
  LAYOFF_SOURCES,
  LAYOFF_STALE_HOURS,
} from "@/config/layoffs";

export type LayoffSource = (typeof LAYOFF_SOURCES)[number];
export type LayoffRelation = (typeof LAYOFF_RELATIONS)[number];

/** One qualifying filing, as a surface prints it. Field names are ours;
 *  readLayoffRow maps the reader's prefixed columns onto them. */
export interface LayoffFiling {
  companyToken: string;
  source: LayoffSource;
  relation: LayoffRelation;
  /** The employer AS THE SOURCE NAMES IT, verbatim. */
  filer: string;
  /** The filing's own date (WARN notice date / 8-K report date), YYYY-MM-DD. */
  eventDate: string;
  eventBasis: string;
  /** When it became public (state stamp / SEC file date), YYYY-MM-DD. */
  publicDate: string;
  publicBasis: string;
  state: string | null;
  site: string | null;
  workers: number | null;
  eventType: string | null;
  effectiveDate: string | null;
  pct: number | null;
  headcount: number | null;
  form: string | null;
  sourceUrl: string;
  sourceName: string;
  /** Our read of the source, ISO timestamp. */
  readAt: string;
  /** Further qualifying filings for the same token beyond this newest one. */
  moreN: number;
  /**
   * Does the filing describe a workforce event (S8-026)? TRUE for a WARN
   * notice; for an 8-K, the parser's reading of its Item 2.05 section. NULL
   * or FALSE: an exit-cost filing (a product line, a lease, a status update
   * on a plan already filed), printed in neutral words. UNDEFINED: a reader
   * from before the column existed, which keeps the old sentence rather than
   * turning every 8-K neutral in the deploy window.
   */
  workforce?: boolean | null;
}

type Prefix = "lf" | "la";

const numOrNull = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return null;
};
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const isDateOnly = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * The reader's row, refused unless it is exactly what the matcher admits.
 *
 * Returns null both for the reader's "nothing qualifies" answer (NULL
 * source) and for any row that fails the client's mirror of the surfacing
 * rules -- an unknown source, an unknown relation, a URL that is not https,
 * an empty filer, an unparseable date, a state notice with no worker count
 * (NULL never prints as 0), an 8-K/A, or a row that names a matched_via the
 * matcher does not have or flags itself ambiguous. The reader never sends
 * those; the point is that a future column cannot leak a filing past the
 * rule that admitted it.
 */
export function readLayoffRow(raw: unknown, prefix: Prefix = "lf"): LayoffFiling | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const g = (k: string) => r[`${prefix}_${k}`];
  const source = g("source");
  if (source === null || source === undefined) return null;
  if (!(LAYOFF_SOURCES as readonly unknown[]).includes(source)) return null;
  const relation = g("relation");
  if (!(LAYOFF_RELATIONS as readonly unknown[]).includes(relation)) return null;
  const via = g("matched_via") ?? r.matched_via;
  if (via !== undefined && via !== null && !(LAYOFF_MATCHED_VIA as readonly unknown[]).includes(via)) return null;
  if (g("ambiguous") === true || r.ambiguous === true) return null;
  const token = strOrNull(g("company_token"));
  const filer = strOrNull(g("filer"));
  const sourceUrl = strOrNull(g("source_url"));
  const sourceName = strOrNull(g("source_name"));
  const readAt = strOrNull(g("read_at"));
  const eventDate = g("event_date");
  const publicDate = g("public_date");
  if (!token || !filer || !sourceName || !readAt) return null;
  if (!sourceUrl || !/^https:\/\//.test(sourceUrl)) return null;
  if (!isDateOnly(eventDate) || !isDateOnly(publicDate)) return null;
  if (!Number.isFinite(Date.parse(readAt))) return null;
  const form = strOrNull(g("form"));
  if (form === "8-K/A") return null;
  const workers = numOrNull(g("workers"));
  if (source === "state_warn" && workers === null) return null;
  const more = prefix === "lf" ? numOrNull(g("more_n")) : Math.max(0, (numOrNull(g("total_n")) ?? 1) - 1);
  const wf = g("workforce");
  return {
    companyToken: token,
    source: source as LayoffSource,
    relation: relation as LayoffRelation,
    filer,
    eventDate,
    eventBasis: strOrNull(g("event_basis")) ?? "",
    publicDate,
    publicBasis: strOrNull(g("public_basis")) ?? "",
    state: strOrNull(g("state")),
    site: strOrNull(g("site")),
    workers,
    eventType: strOrNull(g("event_type")),
    effectiveDate: isDateOnly(g("effective_date")) ? (g("effective_date") as string) : null,
    pct: numOrNull(g("pct")),
    headcount: numOrNull(g("headcount")),
    form,
    sourceUrl,
    sourceName,
    readAt,
    moreN: Math.max(0, Math.round(more ?? 0)),
    ...(wf === undefined ? {} : { workforce: wf === true ? true : wf === false ? false : null }),
  };
}

/** An 8-K whose Item 2.05 section the reader says is not a workforce event. */
export function layoffIsExitCostOnly(row: Pick<LayoffFiling, "source" | "workforce">): boolean {
  return row.source === "sec_8k_205" && row.workforce !== undefined && row.workforce !== true;
}

/** The one hide rule the RPC cannot apply: a state WARN notice is a US
 *  filing and does not print on a posting whose stated country is not the
 *  US. An 8-K is company-wide and prints regardless, named as an SEC filing.
 *  An unstated country hides nothing. */
export function layoffHidesForCountry(row: Pick<LayoffFiling, "source">, country: string | null | undefined): boolean {
  if (row.source !== "state_warn") return false;
  if (!country) return false;
  return country.trim().toUpperCase() !== "US";
}

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data?: unknown; error?: unknown } | undefined>;
const rpc: Rpc = (fn, args) =>
  (supabase as unknown as { rpc: Rpc }).rpc(fn, args);

/**
 * The card and detail reader: one batched call per set of visible tokens,
 * deduped and cancel-safe, on the same rules as the curve and growth
 * fetches in Jobs.tsx -- only an ANSWERED read keeps its tokens, a failed
 * one hands them back so the next run asks again, and `error` is read
 * explicitly because supabase-js resolves a PostgREST failure (a 404 in the
 * deploy window before the reader exists must not look like "nothing
 * qualifies"). Capped at 200 tokens, the reader's own cap.
 *
 * Returns a lookup: undefined = not asked (or still in flight); null =
 * asked and nothing qualifies; a row = the newest qualifying filing.
 */
export function useEmployerLayoffFilings(
  tokens: ReadonlyArray<string | null | undefined>,
): (tok?: string | null) => LayoffFiling | null | undefined {
  const attempted = useRef<Set<string>>(new Set());
  const [byToken, setByToken] = useState<Record<string, LayoffFiling | null>>({});
  const uniq = Array.from(new Set(tokens.filter((x): x is string => typeof x === "string" && x.length > 0)));
  const key = uniq.join("\n");
  useEffect(() => {
    const seen = attempted.current;
    const batch = uniq.filter((tok) => !seen.has(tok)).slice(0, 200);
    if (batch.length === 0) return;
    batch.forEach((tok) => seen.add(tok));
    let cancelled = false;
    let settled = false;
    const giveUp = () => {
      if (cancelled) return;
      settled = true;
      batch.forEach((tok) => seen.delete(tok));
    };
    (async () => {
      try {
        const res = await rpc("get_employer_layoff_filings", { p_tokens: batch });
        if (cancelled) return;
        const data = res?.data;
        if (res?.error || !Array.isArray(data)) { giveUp(); return; }
        setByToken((prev) => {
          const next = { ...prev };
          // Every token asked is answered -- a row with a NULL source is the
          // answer "nothing qualifies", kept as null so it is not re-asked.
          for (const tok of batch) if (!(tok in next)) next[tok] = null;
          for (const raw of data) {
            const tok = (raw as { lf_company_token?: unknown })?.lf_company_token;
            if (typeof tok !== "string") continue;
            next[tok] = readLayoffRow(raw, "lf");
          }
          return next;
        });
        settled = true;
      } catch { giveUp(); }
    })();
    return () => {
      cancelled = true;
      if (!settled) batch.forEach((tok) => seen.delete(tok));
    };
    // `key` is the deduped token list; `uniq` is derived from it each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (tok) => (tok ? byToken[tok] : undefined);
}

/** The employer page reader: every qualifying filing in the window for one
 *  token, newest first, at most 20. Empty until answered, empty on failure --
 *  the item hides either way, and the card never prints an absence. */
export function useEmployerLayoffFilingsAll(token: string | null | undefined): LayoffFiling[] {
  const [rows, setRows] = useState<LayoffFiling[]>([]);
  useEffect(() => {
    if (!token) { setRows([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await rpc("get_employer_layoff_filings_all", { p_token: token });
        if (cancelled) return;
        const data = res?.data;
        if (res?.error || !Array.isArray(data)) { setRows([]); return; }
        setRows(data.map((raw) => readLayoffRow(raw, "la")).filter((x): x is LayoffFiling => x !== null));
      } catch {
        if (!cancelled) setRows([]);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);
  return rows;
}

type T = (k: string, d: string, o?: Record<string, unknown>) => string;

/** Coarse relative age for our read, for the fresh case only. A read under
 *  two minutes old prints as one minute rather than borrowing agoLabel's
 *  "just now" -- a word the copy rule keeps away from a filing. */
function readAgoLabel(iso: string, t: T): string {
  const ms = Date.now() - Date.parse(iso);
  const min = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 60_000) : 0;
  if (min < 60) return t("jobsPage.agoMinutes", "{{count}}m ago", { count: Math.max(1, min) });
  const h = Math.floor(min / 60);
  if (h < 48) return t("jobsPage.agoHours", "{{count}}h ago", { count: h });
  return t("jobsPage.agoDays", "{{count}}d ago", { count: Math.floor(h / 24) });
}

/** Past the source's staleness bound the relative age gives way to the
 *  absolute stamp -- a "read 3d ago" beside a nightly feed is a claim the
 *  feed is being read, and past the bound it is not. */
export function layoffReadIsStale(row: Pick<LayoffFiling, "source" | "readAt">, now = Date.now()): boolean {
  const bound = row.source === "sec_8k_205" ? LAYOFF_STALE_HOURS.edgar : LAYOFF_STALE_HOURS.warn;
  const age = now - Date.parse(row.readAt);
  return !Number.isFinite(age) || age > bound * 3_600_000;
}

/** The language a filing's dates print in: the page's, unless a caller names one. */
const pageLang = (lang?: string) => lang || i18n.language || "en";

function readStamp(row: LayoffFiling, t: T, lang?: string): string {
  return layoffReadIsStale(row)
    ? t("jobsPage.layoffReadStale", "last read {{readAt}}", { readAt: fmtDateTime(row.readAt, { lng: pageLang(lang) }) })
    : t("jobsPage.layoffRead", "read from {{sourceName}} {{readAgo}}", { sourceName: row.sourceName, readAgo: readAgoLabel(row.readAt, t) });
}

/** The state as the agency prints it (a proper noun, English), from the
 *  two-letter code the notice carries; the code itself when unknown. */
export function layoffStateName(code: string | null): string {
  if (!code) return "";
  return STATE_ALIASES[code.toLowerCase()]?.names[0] ?? code;
}

const fmtCount = (n: number) => Math.round(n).toLocaleString();
const fmtPct = (p: number) => p.toLocaleString(undefined, { maximumFractionDigits: 1 });

// Where the source link goes inside the translated sentence. The key holds
// "{{sourceName}} ↗" at the point the link belongs; the sentence is rendered
// with this marker in that slot and split around it, so the anchor can be a
// real element in any word order a translator chooses.
// Written as an escape: a raw NUL byte in a source file makes grep report
// "no match" for the whole file (project_grep_binary_trap), which would
// blind every grep-based check of surface isolation over src/components.
const LINK_SLOT = "\u0000";

/** The §7.2 sentence for one filing, with LINK_SLOT where its source link
 *  belongs, every date in the reader's language. Exported for the guard. */
export function layoffLineText(row: LayoffFiling, t: T, lang?: string): { text: string; linkLabel: string } {
  const filer = row.relation === "subsidiary_site" ? "" : row.filer;
  const day = (d: string) => fmtDate(d, { lng: pageLang(lang) });
  let text: string;
  let linkLabel: string;
  if (row.source === "state_warn") {
    linkLabel = row.sourceName;
    const common = {
      filer,
      workers: fmtCount(row.workers ?? 0),
      site: row.site ?? t("jobsPage.layoffSiteUnstated", "a site the notice does not name"),
      effectiveClause: row.effectiveDate ? t("jobsPage.layoffEffective", ", effective {{effectiveDate}}", { effectiveDate: day(row.effectiveDate) }) : "",
      kindClause: row.eventType === "closure" ? t("jobsPage.layoffKindClosure", " (site closure)") : "",
      agency: row.sourceName,
      visibleDate: day(row.publicDate),
      sourceName: LINK_SLOT,
    };
    text = row.eventBasis === "warn_notice_date"
      ? t("jobsPage.layoffLineWarnNoticed", "{{filer}} filed a layoff notice with {{state}} dated {{noticeDate}}: {{workers}} positions at {{site}}{{effectiveClause}}{{kindClause}} · listed by {{agency}} on {{visibleDate}} · {{sourceName}} ↗", { ...common, state: layoffStateName(row.state), noticeDate: day(row.eventDate) })
      : t("jobsPage.layoffLineWarnReceived", "{{filer}} filed a layoff notice received by {{agency}} on {{visibleDate}}: {{workers}} positions at {{site}}{{effectiveClause}}{{kindClause}} · {{sourceName}} ↗", common);
  } else {
    linkLabel = t("jobsPage.layoffSecFilingLink", "SEC filing");
    const common = { filer, reportDate: day(row.eventDate), filedDate: day(row.publicDate), sourceName: LINK_SLOT };
    if (layoffIsExitCostOnly(row)) {
      // Item 2.05 is exit or disposal costs; this section describes no
      // workforce event we could read, so it is named, never called a cut.
      text = t("jobsPage.layoffLineSecExit", "{{filer}} filed an 8-K under Item 2.05 (costs of exiting or disposing of an activity) dated {{reportDate}}, filed with the SEC on {{filedDate}} · {{sourceName}} ↗", common);
    } else if (row.pct !== null) {
      text = t("jobsPage.layoffLineSecPct", "{{filer}} reported a workforce reduction of about {{pct}}% in an 8-K (Item 2.05) dated {{reportDate}}, filed with the SEC on {{filedDate}} · {{sourceName}} ↗", { ...common, pct: fmtPct(row.pct) });
    } else if (row.headcount !== null) {
      text = t("jobsPage.layoffLineSecCount", "{{filer}} reported a workforce reduction of about {{headcount}} positions in an 8-K (Item 2.05) dated {{reportDate}}, filed with the SEC on {{filedDate}} · {{sourceName}} ↗", { ...common, headcount: fmtCount(row.headcount) });
    } else {
      text = t("jobsPage.layoffLineSecNoNumber", "{{filer}} reported a workforce reduction in an 8-K (Item 2.05) dated {{reportDate}}, filed with the SEC on {{filedDate}} · {{sourceName}} ↗", common);
    }
  }
  if (row.relation === "subsidiary_site") {
    // The FILER's name and the parent sentence -- never that this board's
    // roles are affected. The line is rendered with an empty subject and the
    // parent clause supplies it.
    text = t("jobsPage.layoffParent", "{{filer}}, the parent company of this board's employer, {{line}}", { filer: row.filer, line: text.trimStart() });
  }
  return { text, linkLabel };
}

const stop = (e: MouseEvent) => e.stopPropagation();

function withSourceLink(text: string, row: LayoffFiling, linkLabel: string): ReactNode {
  const at = text.indexOf(LINK_SLOT);
  if (at < 0) return text;
  const before = text.slice(0, at);
  let after = text.slice(at + LINK_SLOT.length);
  let label = linkLabel;
  if (after.startsWith(" ↗")) { label = `${linkLabel} ↗`; after = after.slice(2); }
  return (
    <>
      {before}
      <a
        href={row.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="link"
        onClick={stop}
        data-layoff-source={row.source}
      >
        {label}
      </a>
      {after}
    </>
  );
}

/** The full §7.2 line: the sentence with its source link, our read stamp,
 *  and the count of further filings on the employer page when there are
 *  any. Used by the detail panel and, one per filing, by the employer page. */
function FilingSentence({ row, t }: { row: LayoffFiling; t: T }) {
  const { text, linkLabel } = layoffLineText(row, t);
  return (
    <>
      {withSourceLink(text, row, linkLabel)}
      {" · "}
      <span data-layoff-read-at={row.readAt}>{readStamp(row, t)}</span>
      {row.moreN > 0 && (
        <>
          {" · "}
          <Link to={companyLanderPath(row.companyToken)} className="link" onClick={stop}>
            {t("jobsPage.layoffMore", "+{{more}} more on the employer page", { more: fmtCount(row.moreN) })}
          </Link>
        </>
      )}
    </>
  );
}

interface LineProps {
  /** undefined = not asked / in flight; null = nothing qualifies. Both
   *  render nothing. */
  row: LayoffFiling | null | undefined;
  /** The posting's stated country, for the WARN-is-a-US-filing rule. */
  country?: string | null;
}

/** §7.1 -- the card's muted chip, Info icon, in the meta row AFTER the
 *  Actively-hiring slot. Links to the source; the tooltip carries the filer,
 *  the date, the non-relationship to the badge, and our read. */
export function LayoffFilingChip({ row, country }: LineProps) {
  const { t } = useTranslation();
  if (!row || layoffHidesForCountry(row, country)) return null;
  const readAgo = layoffReadIsStale(row) ? fmtDateTime(row.readAt, { lng: pageLang() }) : readAgoLabel(row.readAt, t);
  return (
    <a
      href={row.sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={stop}
      className="inline-flex items-center gap-1 text-muted-foreground whitespace-nowrap hover:underline"
      data-layoff-filing="chip"
      data-layoff-source={row.source}
      data-layoff-event-date={row.eventDate}
      title={t("jobsPage.layoffTip", "{{filer}} made this filing on {{eventDate}}. It is a fact about the employer on that date, not about this role. It sits beside the hiring badge on purpose: that badge is only what we watched on this board — roles taken down and left down, or more roles served — and a filing made elsewhere does not change it. Neither one says anyone was hired. Read from {{sourceName}} {{readAgo}}.", { filer: row.filer, eventDate: fmtDate(row.eventDate, { lng: pageLang() }), sourceName: row.sourceName, readAgo })}
    >
      <Info className="w-3 h-3 shrink-0" />
      {row.source === "state_warn"
        ? t("jobsPage.layoffChipWarn", "Layoff notice on file")
        : layoffIsExitCostOnly(row)
          ? t("jobsPage.layoffChipSecExit", "Exit-cost filing on file")
          : t("jobsPage.layoffChipSec", "Workforce reduction filed")}
    </a>
  );
}

/** §7.2 -- the detail panel's own line under the Share/handoff row. */
export function LayoffFilingLine({ row, country }: LineProps) {
  const { t } = useTranslation();
  if (!row || layoffHidesForCountry(row, country)) return null;
  return (
    <p className="text-xs text-muted-foreground leading-snug -mt-2" data-layoff-filing="line" data-layoff-source={row.source}>
      <FilingSentence row={row} t={t} />
    </p>
  );
}

/** §7.3 -- the employer page's Hiring Health item: "Also on record:" and
 *  every qualifying filing in the window, newest first, each with its own
 *  link. Renders nothing when there is none, never a sentence about it. */
export function LayoffFilingsOnRecord({ rows }: { rows: LayoffFiling[] }) {
  const { t } = useTranslation();
  if (rows.length === 0) return null;
  return (
    <li data-layoff-filing="record">
      {t("jobsPage.hhAlsoOnRecord", "Also on record:")}
      <ul className="mt-1 space-y-1 pl-3 border-l border-border/60">
        {rows.map((row) => (
          <li key={`${row.source}:${row.filer}:${row.eventDate}:${row.sourceUrl}`} className="text-meta" data-layoff-source={row.source}>
            <FilingSentence row={{ ...row, moreN: 0 }} t={t} />
          </li>
        ))}
      </ul>
    </li>
  );
}

/** What a compact public-records row says about one filing: its kind, its place, its count and the day it was filed. */
export function layoffRowText(row: LayoffFiling, t: TFunction, lang?: string): string {
  const l = pageLang(lang);
  if (row.source === "state_warn") {
    const workers = row.workers ?? 0;
    const filed = fmtDate(row.eventBasis === "warn_notice_date" ? row.eventDate : row.publicDate, { lng: l });
    return tPlural(t, "companyProfile.records.warnRow", workers,
      { state: layoffStateName(row.state), workers: workers.toLocaleString(l), date: filed },
      "WARN notice · {{state}} · {{workers}} worker · filed {{date}}",
      "WARN notice · {{state}} · {{workers}} workers · filed {{date}}");
  }
  const date = fmtDate(row.publicDate, { lng: l });
  return layoffIsExitCostOnly(row)
    ? t("companyProfile.records.secExitRow", "SEC 8-K Item 2.05, exit or disposal costs · filed {{date}}", { date })
    : t("companyProfile.records.secRow", "SEC 8-K Item 2.05 · filed {{date}}", { date });
}

/**
 * The employer profile's Public records list: one compact row per qualifying
 * filing, newest first -- the filer as the source spells it, the kind of
 * filing, the state and the count a notice states, the day it was filed, the
 * source link and our read. Renders nothing when there is none, never a
 * sentence about an absence.
 */
export function LayoffFilingRows({ rows }: { rows: LayoffFiling[] }) {
  const { t, i18n: inst } = useTranslation();
  if (rows.length === 0) return null;
  const lang = inst.language || "en";
  return (
    <ul className="space-y-2" data-layoff-filing="records">
      {rows.map((row) => {
        const link = row.source === "state_warn" ? row.sourceName : t("jobsPage.layoffSecFilingLink", "SEC filing");
        return (
          <li key={`${row.source}:${row.filer}:${row.eventDate}:${row.sourceUrl}`} className="text-meta" data-layoff-source={row.source}>
            <span className="font-medium text-foreground">
              {row.relation === "subsidiary_site"
                ? t("companyProfile.records.parentFiler", "{{filer}} (parent company)", { filer: row.filer })
                : row.filer}
            </span>
            <span className="text-muted-foreground">{" · "}{layoffRowText(row, t, lang)}{" · "}</span>
            <a
              href={row.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary"
              data-layoff-source={row.source}
            >
              {link}
              <ExternalLink className="w-3 h-3" aria-hidden="true" />
            </a>
            <span className="block text-xs text-subtle-foreground" data-layoff-read-at={row.readAt}>{readStamp(row, t, lang)}</span>
          </li>
        );
      })}
    </ul>
  );
}
