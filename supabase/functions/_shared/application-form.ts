/** AN EMPLOYER'S REAL APPLICATION FORM ... docs/shared-notes.md#s67 */
import { cleanQuestionLabel } from "./application-questions.ts";
import { greenhouseApi } from "./greenhouse-api.ts";
import { breezyApplyUrl, optionsOf, parseBreezyQuestions, parsePinpointQuestions, pinpointApplyUrl } from "./vendor-questions.ts";
import {
  HOST_LABEL,
  parseBambooForm,
  parseBreezyFormConfig,
  parseLeverForm,
  parsePaylocityForm,
  parsePinpointExtras,
  parseTeamtailorForm,
  parseWorkableForm,
  pinpointVendorPostingUrl,
  type PageExtras,
  type ParsedForm,
} from "./form-readers-extra.ts";

/** The hiring systems this module can read a form from. */
export const FORM_READER_VENDORS: readonly string[] = ["ashby", "bamboohr", "breezy", "greenhouse", "lever", "paylocity", "pinpoint", "recruitee", "teamtailor", "workable"];
/** The ones read through a published public API: the only ones read for the ChatGPT surface (owner decision R2). */
export const PUBLIC_API_FORM_VENDORS: readonly string[] = ["greenhouse", "recruitee"];

/** How long a read is believed. */
export const FORM_CACHE_MS = 24 * 3600_000;
const DEFAULT_TIMEOUT_MS = 6_000;
const MAX_QUESTIONS = 100;

export type FormQuestion = {
  label: string;
  required: boolean;
  /** The vendor's own control type. */
  type: string;
  options?: string[];
  hint?: string;
  /** The employer set this question to ... docs/shared-notes.md#s68 */
  screens?: true;
};
export type FormDocument = { name: string; required: boolean };
export type VendorForm = {
  questions: FormQuestion[];
  documents: FormDocument[];
  /** Parts of the form outside the question list (EEO self-identification, data-protection consent). */
  alsoOnForm: string[];
};

export type FormRead =
  | { kind: "read"; vendor: string; readAt: string; cached: boolean; form: VendorForm }
  | {
    kind: "absent"; vendor: string; readAt: string; cached: boolean; pageRead?: true;
    /** What an apply page with no questions still showed: the CV it asks for, an equality block, a consent. */
    documents?: FormDocument[]; alsoOnForm?: string[];
  }
  | { kind: "no-reader"; vendor: string }
  | { kind: "withheld"; vendor: string }
  | { kind: "unreachable"; vendor: string };

/** The posting as its row states it. */
export type PostingRef = { id: string; source: string; token: string; applyUrl: string | null };

export type FormCacheRow = { vendor: string; ok: boolean; form: unknown; read_at: string };
export type FormCache = {
  get(postingId: string): Promise<FormCacheRow | null>;
  put(postingId: string, vendor: string, ok: boolean, form: VendorForm | ({ pageRead: true } & Partial<PageExtras>) | Record<string, never>): Promise<void>;
};

export type ReadOptions = {
  fetch: typeof fetch;
  cache?: FormCache | null;
  now?: () => number;
  timeoutMs?: number;
  /** The vendors this surface reads; defaults to every reader. */
  vendors?: readonly string[];
};

/** A transient failure: not cached, and answered as unreachable. */
class Transient extends Error {}

/** The external id: everything after `source:token:`, when the id and the row agree on both. */
export function externalIdOf(p: PostingRef): string | null {
  const prefix = `${p.source}:${p.token}:`;
  if (!p.source || !p.token || !p.id.startsWith(prefix)) return null;
  const ext = p.id.slice(prefix.length);
  return ext && ext.length <= 200 ? ext : null;
}

const strip = (s: unknown): string =>
  cleanQuestionLabel(String(s ?? "")).slice(0, 500);

async function get(o: ReadOptions, url: string, init?: RequestInit): Promise<Response | null> {
  let res: Response;
  try {
    res = await o.fetch(url, { ...init, signal: AbortSignal.timeout(o.timeoutMs ?? DEFAULT_TIMEOUT_MS) });
  } catch {
    throw new Transient("fetch failed");
  }
  if (res.status === 429 || res.status >= 500) throw new Transient(`vendor answered ${res.status}`);
  return res.ok ? res : null;
}

async function jsonOf(res: Response): Promise<unknown> {
  try { return await res.json(); } catch { return null; }
}

const isFile = (type: string) => /file|upload|attachment|document/i.test(type);

/** A control the page fills itself (Greenhouse `input_hidden`): never a question for the person. */
const isHiddenType = (type: string) => /^(?:input_)?hidden$/i.test(type.trim());

/** The data_compliance flags under which a Greenhouse form actually asks the person for consent. */
const DATA_CONSENT_FLAGS = ["requires_consent", "requires_processing_consent", "requires_retention_consent", "demographic_data_consent_applies"] as const;

function finish(questions: FormQuestion[], extraDocs: FormDocument[] = [], alsoOnForm: string[] = []): VendorForm | null {
  const qs = questions.filter((q) => q.label).slice(0, MAX_QUESTIONS);
  if (!qs.length && !extraDocs.length) return null;
  const documents = [
    ...extraDocs,
    ...qs.filter((q) => isFile(q.type)).map((q) => ({ name: q.label, required: q.required })),
  ];
  return { questions: qs, documents, alsoOnForm };
}

async function readGreenhouse(o: ReadOptions, p: PostingRef, ext: string): Promise<VendorForm | null> {
  const api = greenhouseApi(p.token);
  const res = await get(o, `https://${api.host}/v1/boards/${encodeURIComponent(api.token)}/jobs/${encodeURIComponent(ext)}?questions=true`);
  if (!res) return null;
  const gh = await jsonOf(res) as {
    questions?: unknown[]; location_questions?: unknown[]; compliance?: unknown[]; data_compliance?: unknown[]; demographic_questions?: unknown;
  } | null;
  if (!gh || typeof gh !== "object") return null;
  const toQ = (raw: unknown): FormQuestion | null => {
    const q = raw as { label?: unknown; required?: unknown; description?: unknown; fields?: Array<{ type?: unknown; values?: unknown }> };
    const label = strip(q?.label);
    if (!label) return null;
    const fields = Array.isArray(q?.fields) ? q.fields : [];
    // A question whose every field is hidden ... docs/shared-notes.md#s69
    if (fields.length && fields.every((f) => isHiddenType(String(f?.type ?? "")))) return null;
    const type = String(fields[0]?.type ?? "");
    const options = fields.map((f) => optionsOf(f?.values)).find(Boolean);
    const hint = strip(q?.description);
    return { label, required: q?.required === true, type, ...(options ? { options } : {}), ...(hint ? { hint } : {}) };
  };
  const questions = [...(gh.questions ?? []), ...(gh.location_questions ?? [])].map(toQ).filter((q): q is FormQuestion => !!q);
  const also: string[] = [];
  for (const c of Array.isArray(gh.compliance) ? gh.compliance : []) {
    const t = String((c as { type?: unknown })?.type ?? "").toLowerCase();
    also.push(t === "eeoc" ? "Voluntary self-identification (EEO) questions" : `Compliance questions${t ? ` (${t})` : ""}`);
  }
  // Greenhouse lists a data_compliance ... docs/shared-notes.md#s70
  for (const c of Array.isArray(gh.data_compliance) ? gh.data_compliance : []) {
    const flags = (c ?? {}) as Record<string, unknown>;
    if (!DATA_CONSENT_FLAGS.some((f) => flags[f] === true)) continue;
    const t = String(flags.type ?? "").toLowerCase();
    also.push(t === "gdpr" ? "Data-protection consent (GDPR)" : `Data-protection consent${t ? ` (${t})` : ""}`);
  }
  if (gh.demographic_questions) also.push("Voluntary demographic questions");
  return finish(questions, [], [...new Set(also)]);
}

const ASHBY_QUERY =
  "query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) { jobPosting(organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId) { id applicationForm { sections { title fieldEntries { isRequired field } } } } }";

async function readAshby(o: ReadOptions, p: PostingRef, ext: string): Promise<VendorForm | null> {
  const res = await get(o, "https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operationName: "ApiJobPosting",
      variables: { organizationHostedJobsPageName: p.token, jobPostingId: ext },
      query: ASHBY_QUERY,
    }),
  });
  if (!res) return null;
  const gql = await jsonOf(res) as { data?: { jobPosting?: { applicationForm?: { sections?: unknown } } } } | null;
  const sections = gql?.data?.jobPosting?.applicationForm?.sections;
  if (!Array.isArray(sections)) return null;
  const questions: FormQuestion[] = [];
  for (const s of sections) {
    for (const fe of (Array.isArray((s as { fieldEntries?: unknown })?.fieldEntries) ? (s as { fieldEntries: unknown[] }).fieldEntries : [])) {
      const e = fe as { isRequired?: unknown; field?: Record<string, unknown> };
      const f = e?.field ?? {};
      const label = strip(f.title);
      if (!label) continue;
      const type = String(f.type ?? "");
      const options = /^boolean$/i.test(type) ? ["Yes", "No"] : optionsOf(f.selectableValues);
      const hint = strip(f.descriptionPlain ?? f.description);
      questions.push({ label, required: e?.isRequired === true, type, ...(options ? { options } : {}), ...(hint ? { hint } : {}) });
    }
  }
  return finish(questions);
}

async function readRecruitee(o: ReadOptions, p: PostingRef, ext: string): Promise<VendorForm | null> {
  // The tenant becomes a hostname: anything but a plain subdomain label is no form.
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(p.token)) return null;
  const res = await get(o, `https://${p.token}.recruitee.com/api/offers/${encodeURIComponent(ext)}`);
  if (!res) return null;
  const rec = await jsonOf(res) as { offer?: Record<string, unknown> } & Record<string, unknown> | null;
  const offer = (rec?.offer ?? rec) as Record<string, unknown> | null;
  if (!offer || typeof offer !== "object") return null;
  const questions: FormQuestion[] = (Array.isArray(offer.open_questions) ? offer.open_questions : [])
    .map((raw: unknown) => {
      const q = raw as { body?: unknown; kind?: unknown; required?: unknown; open_question_options?: unknown; options?: unknown };
      const label = strip(q?.body);
      const type = String(q?.kind ?? "");
      const options = /^boolean$/i.test(type) ? ["Yes", "No"] : (optionsOf(q?.open_question_options) ?? optionsOf(q?.options));
      return { label, required: q?.required === true, type, ...(options ? { options } : {}) };
    })
    .filter((q: FormQuestion) => q.label);
  const docs: FormDocument[] = [];
  for (const [key, name] of [["options_cv", "Resume / CV"], ["options_cover_letter", "Cover letter"], ["options_photo", "Photo"]] as const) {
    const v = String(offer[key] ?? "off");
    if (v === "required" || v === "optional") docs.push({ name, required: v === "required" });
  }
  // A form with no custom questions is ... docs/shared-notes.md#s71
  return finish(questions, docs) ?? { questions: [], documents: [], alsoOnForm: [] };
}


/** The apply page is the posting's own URL, and only on the vendor's own domain. */
function onVendorDomain(url: string, domain: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === domain || u.hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

/** An apply page that answered but carried no question this reader found, with what it did show. */
type PageWithoutQuestions = { pageRead: true; extras: PageExtras };

/** A posting's Pinpoint page: its own URL ... docs/shared-notes.md#s72 */
function pinpointPostingUrl(p: PostingRef, posting: string): string | null {
  if (onVendorDomain(posting, "pinpointhq.com")) return posting;
  return pinpointVendorPostingUrl(p.token, posting);
}

async function readHtmlForm(o: ReadOptions, p: PostingRef, vendor: "breezy" | "pinpoint"): Promise<VendorForm | null | PageWithoutQuestions> {
  const posting = String(p.applyUrl ?? "");
  const page = vendor === "breezy"
    ? (posting && onVendorDomain(posting, "breezy.hr") ? posting : null)
    : (posting ? pinpointPostingUrl(p, posting) : null);
  if (!page) return null;
  const url = vendor === "breezy" ? breezyApplyUrl(page) : pinpointApplyUrl(page);
  const res = await get(o, url);
  if (!res) return null;
  let html = "";
  try { html = await res.text(); } catch { return null; }
  const raw = vendor === "breezy" ? parseBreezyQuestions(html) : parsePinpointQuestions(html);
  // What the page says beside its ... docs/shared-notes.md#s73
  const extras = vendor === "breezy" ? parseBreezyFormConfig(html) : parsePinpointExtras(html);
  // Nothing found is equally consistent ... docs/shared-notes.md#s74
  const form = raw.length
    ? finish(raw.map((q) => ({
      label: strip(q.label),
      required: q.required,
      type: q.type,
      ...(q.options ? { options: q.options } : {}),
      ...(q.hint ? { hint: strip(q.hint) } : {}),
    })), extras.documents, extras.alsoOnForm)
    : null;
  return form ?? { pageRead: true, extras };
}

// Each fetch is pinned to the vendor's ... docs/shared-notes.md#s75

/** A fetch that follows no redirect: a 3xx is returned to the caller, never followed. */
async function getPinned(o: ReadOptions, url: string): Promise<Response | null> {
  let res: Response;
  try {
    res = await o.fetch(url, { redirect: "manual", signal: AbortSignal.timeout(o.timeoutMs ?? DEFAULT_TIMEOUT_MS) });
  } catch {
    throw new Transient("fetch failed");
  }
  if (res.status === 429 || res.status >= 500) throw new Transient(`vendor answered ${res.status}`);
  return res;
}

async function textOfPinned(o: ReadOptions, url: string): Promise<string | null> {
  const res = await getPinned(o, url);
  if (!res || res.status !== 200) return null;
  try { return await res.text(); } catch { return null; }
}

/** The parsed form, its labels and hints cleaned as every reader's are. */
function cleaned(f: ParsedForm | null): VendorForm | null {
  if (!f) return null;
  const questions = f.questions.map(({ hint, ...q }) => {
    const h = hint ? strip(hint) : "";
    return { ...q, label: strip(q.label), ...(h ? { hint: h } : {}) };
  });
  return finish(questions, f.documents.map((d) => ({ name: strip(d.name) || d.name, required: d.required })), f.alsoOnForm.map((a) => strip(a)).filter(Boolean));
}

const DIGITS = /^\d{1,12}$/;

async function readPaylocity(o: ReadOptions, ext: string): Promise<VendorForm | null> {
  if (!DIGITS.test(ext)) return null;
  const html = await textOfPinned(o, `https://recruiting.paylocity.com/Recruiting/Jobs/Apply/${ext}`);
  return html ? cleaned(parsePaylocityForm(html)) : null;
}

async function readWorkable(o: ReadOptions, ext: string): Promise<VendorForm | null> {
  if (!/^[A-Z0-9]{4,16}$/i.test(ext)) return null;
  const res = await getPinned(o, `https://apply.workable.com/api/v1/jobs/${encodeURIComponent(ext)}/form`);
  if (!res || res.status !== 200) return null;
  return cleaned(parseWorkableForm(await jsonOf(res)));
}

async function readBamboo(o: ReadOptions, p: PostingRef, ext: string): Promise<VendorForm | null> {
  if (!HOST_LABEL.test(p.token) || !DIGITS.test(ext)) return null;
  const res = await getPinned(o, `https://${p.token.toLowerCase()}.bamboohr.com/careers/${ext}/detail`);
  if (!res || res.status !== 200) return null;
  return cleaned(parseBambooForm(await jsonOf(res)));
}

async function readLever(o: ReadOptions, p: PostingRef, ext: string): Promise<VendorForm | null> {
  if (!HOST_LABEL.test(p.token) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ext)) return null;
  // Lever's EU tenants live on jobs.eu.lever.co; the posting's own URL says which.
  const host = /^https:\/\/jobs\.eu\.lever\.co\//i.test(String(p.applyUrl ?? "")) ? "jobs.eu.lever.co" : "jobs.lever.co";
  const html = await textOfPinned(o, `https://${host}/${encodeURIComponent(p.token)}/${ext}/apply`);
  return html ? cleaned(parseLeverForm(html)) : null;
}

/** The registrable part of a hostname: its ... docs/shared-notes.md#s76 */
function siteOf(hostname: string): string {
  const labels = hostname.toLowerCase().split(".").filter(Boolean);
  const n = labels.length >= 3 && /^[a-z]{2}$/.test(labels.at(-1)!) && /^(?:co|com|org|net|ac|gov|edu|ne|or)$/.test(labels.at(-2)!) ? 3 : 2;
  return labels.slice(-n).join(".");
}

async function readTeamtailor(o: ReadOptions, p: PostingRef, ext: string): Promise<VendorForm | null> {
  // The board's Teamtailor ids are the job ... docs/shared-notes.md#s77
  const num = /^(\d{1,12})(?:-[^/?#\s]*)?$/.exec(ext)?.[1];
  if (!HOST_LABEL.test(p.token) || !num) return null;
  const path = `/jobs/${num}/applications/new`;
  const first = await getPinned(o, `https://${p.token.toLowerCase()}.teamtailor.com${path}`);
  if (!first) return null;
  let res: Response | null = first;
  if (first.status >= 300 && first.status < 400) {
    // A tenant on its own career domain ... docs/shared-notes.md#s78
    const to = (() => { try { return new URL(first.headers.get("location") ?? "", `https://${p.token}.teamtailor.com`); } catch { return null; } })();
    const own = (() => { try { return new URL(String(p.applyUrl ?? "")); } catch { return null; } })();
    const sameSite = !!to && !!own && to.protocol === "https:" && own.protocol === "https:" &&
      to.pathname.replace(/\/+$/, "") === path && !to.username && !to.password && (to.port === "" || to.port === "443") &&
      (to.hostname.endsWith(".teamtailor.com") || siteOf(to.hostname) === siteOf(own.hostname));
    res = sameSite ? await getPinned(o, to!.toString()) : null;
  }
  if (!res || res.status !== 200) return null;
  let html = "";
  try { html = await res.text(); } catch { return null; }
  return cleaned(parseTeamtailorForm(html));
}

/** The form a cached row holds, when it holds one in the shape this module writes. */
function formOfRow(row: FormCacheRow): VendorForm | null {
  const f = row.form as Partial<VendorForm> | null;
  if (!f || !Array.isArray(f.questions) || !Array.isArray(f.documents)) return null;
  // A row cached before hidden fields were dropped still holds them (S12-173).
  const questions = f.questions.filter((q) => !isHiddenType(String(q?.type ?? "")));
  return { questions, documents: f.documents, alsoOnForm: Array.isArray(f.alsoOnForm) ? f.alsoOnForm : [] };
}

/** What a cached page-read row still says the page showed. */
function extrasOfRow(form: unknown): Partial<PageExtras> {
  const f = (form ?? {}) as { documents?: unknown; alsoOnForm?: unknown };
  const docs = Array.isArray(f.documents) ? (f.documents as FormDocument[]).filter((d) => d && typeof d.name === "string") : [];
  const also = Array.isArray(f.alsoOnForm) ? (f.alsoOnForm as unknown[]).filter((x): x is string => typeof x === "string") : [];
  return { ...(docs.length ? { documents: docs } : {}), ...(also.length ? { alsoOnForm: also } : {}) };
}

/** The posting's application form, or the ... docs/shared-notes.md#s79 */
export async function readApplicationForm(p: PostingRef, o: ReadOptions): Promise<FormRead> {
  const vendor = p.source;
  if (!FORM_READER_VENDORS.includes(vendor)) return { kind: "no-reader", vendor };
  if (!(o.vendors ?? FORM_READER_VENDORS).includes(vendor)) return { kind: "withheld", vendor };
  const ext = externalIdOf(p);
  const now = o.now ?? Date.now;
  if (!ext) return { kind: "absent", vendor, readAt: new Date(now()).toISOString(), cached: false };

  if (o.cache) {
    try {
      const row = await o.cache.get(p.id);
      const age = row ? now() - Date.parse(row.read_at) : Infinity;
      if (row && row.vendor === vendor && age >= 0 && age < FORM_CACHE_MS) {
        const form = row.ok ? formOfRow(row) : null;
        if (row.ok && form) return { kind: "read", vendor, readAt: row.read_at, cached: true, form };
        if (!row.ok) {
          const pageRead = (row.form as { pageRead?: unknown } | null)?.pageRead === true;
          return { kind: "absent", vendor, readAt: row.read_at, cached: true, ...(pageRead ? { pageRead: true as const, ...extrasOfRow(row.form) } : {}) };
        }
      }
    } catch {
      // An unreadable cache is a slower answer, never a wrong one.
    }
  }

  let form: VendorForm | null;
  let page: PageWithoutQuestions | null = null;
  try {
    const got = vendor === "greenhouse" ? await readGreenhouse(o, p, ext)
      : vendor === "ashby" ? await readAshby(o, p, ext)
      : vendor === "recruitee" ? await readRecruitee(o, p, ext)
      : vendor === "paylocity" ? await readPaylocity(o, ext)
      : vendor === "workable" ? await readWorkable(o, ext)
      : vendor === "teamtailor" ? await readTeamtailor(o, p, ext)
      : vendor === "lever" ? await readLever(o, p, ext)
      : vendor === "bamboohr" ? await readBamboo(o, p, ext)
      : await readHtmlForm(o, p, vendor as "breezy" | "pinpoint");
    page = got && "pageRead" in got ? got : null;
    form = got && !("pageRead" in got) ? got : null;
  } catch (e) {
    if (e instanceof Transient) return { kind: "unreachable", vendor };
    return { kind: "unreachable", vendor };
  }
  const readAt = new Date(now()).toISOString();
  const seen = page ? {
    ...(page.extras.documents.length ? { documents: page.extras.documents } : {}),
    ...(page.extras.alsoOnForm.length ? { alsoOnForm: page.extras.alsoOnForm } : {}),
  } : {};
  if (o.cache) {
    try { await o.cache.put(p.id, vendor, !!form, form ?? (page ? { pageRead: true, ...seen } : {})); } catch { /* the answer stands without the cache */ }
  }
  if (form) return { kind: "read", vendor, readAt, cached: false, form };
  return { kind: "absent", vendor, readAt, cached: false, ...(page ? { pageRead: true as const, ...seen } : {}) };
}
