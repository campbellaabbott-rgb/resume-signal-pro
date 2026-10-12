/**
 * AN EMPLOYER'S REAL APPLICATION FORM, READ FROM WHERE THE EMPLOYER PUBLISHED IT.
 *
 * The apply_myself tool (agent-mcp) hands a person's own AI the form the
 * employer will actually show them, so the AI can ask the person every factual
 * question and draft only the open-ended ones. Five hiring systems publish the
 * form somewhere a server can read it:
 *
 *   greenhouse  the public board API, ?questions=true (an EU tenant on its own host)
 *   recruitee   the public offers API: open_questions plus the document config
 *   ashby       the public GraphQL the hosted job page itself calls
 *   breezy      the /apply page, which server-renders the questionnaire as JSON
 *   pinpoint    the /applications/new page, one react-on-rails script per question
 *
 * Every other system (about nine postings in ten) has no reader, and the
 * answer says so rather than guessing a form.
 *
 * WHAT THIS MODULE IS NOT ALLOWED TO DO.
 *   - Import job-board's files. Its source list alone is megabytes; a posting's
 *     vendor, tenant and apply URL come from the posting row the caller read
 *     (job_board_postings), never from a list of sources.
 *   - Fetch a host the posting does not name. The Recruitee tenant becomes a
 *     subdomain and the Breezy and Pinpoint apply pages are the posting's own
 *     URL, so each is checked against the vendor's domain first: a row whose
 *     tenant or URL does not look like the vendor's is read as no form, never
 *     fetched.
 *   - Invent. A payload that does not parse, or parses to nothing, is "no form
 *     could be read" -- never an empty form, which would tell a person the
 *     employer asks nothing. A Breezy or Pinpoint apply page that answered
 *     but carried no screening questions is still no form, marked pageRead:
 *     the page was there, it showed nothing beyond the person's details and
 *     CV (or nothing this reader could parse), which is not the same as a
 *     hiring system that publishes no form at all.
 *
 * Reads go through a 24-hour cache (application_form_cache, 20261011100000)
 * when the caller hands one in: a fresh row is the answer, a stale or missing
 * one is read from the vendor and written back, a vendor that answered "no
 * such form" is cached the same way, and a transient failure (timeout,
 * network, 429, 5xx) is never cached.
 *
 * Pure apart from the injected fetch and cache, so the Node suite runs every
 * reader against recorded payloads and Deno imports it unchanged.
 */
import { cleanQuestionLabel } from "./application-questions.ts";
import { greenhouseApi } from "./greenhouse-api.ts";
import { breezyApplyUrl, optionsOf, parseBreezyQuestions, parsePinpointQuestions, pinpointApplyUrl } from "./vendor-questions.ts";

/** The hiring systems this module can read a form from. */
export const FORM_READER_VENDORS: readonly string[] = ["ashby", "breezy", "greenhouse", "pinpoint", "recruitee"];
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
  | { kind: "absent"; vendor: string; readAt: string; cached: boolean; pageRead?: true }
  | { kind: "no-reader"; vendor: string }
  | { kind: "withheld"; vendor: string }
  | { kind: "unreachable"; vendor: string };

/** The posting as its row states it. */
export type PostingRef = { id: string; source: string; token: string; applyUrl: string | null };

export type FormCacheRow = { vendor: string; ok: boolean; form: unknown; read_at: string };
export type FormCache = {
  get(postingId: string): Promise<FormCacheRow | null>;
  put(postingId: string, vendor: string, ok: boolean, form: VendorForm | { pageRead: true } | Record<string, never>): Promise<void>;
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

function finish(questions: FormQuestion[], extraDocs: FormDocument[] = [], alsoOnForm: string[] = []): VendorForm | null {
  const qs = questions.filter((q) => q.label).slice(0, MAX_QUESTIONS);
  if (!qs.length && !extraDocs.length) return null;
  const documents = [
    ...extraDocs,
    ...qs.filter((q) => isFile(q.type)).map((q) => ({ name: q.label, required: q.required })),
  ];
  return { questions: qs, documents, alsoOnForm };
}

// ── the five readers ───────────────────────────────────────────────────────

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
  for (const c of Array.isArray(gh.data_compliance) ? gh.data_compliance : []) {
    const t = String((c as { type?: unknown })?.type ?? "").toLowerCase();
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
  // A form with no custom questions is still a real form, and its document
  // list still says what to attach.
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

/** An apply page that answered but carried no question this reader found. */
const PAGE_WITHOUT_QUESTIONS = Symbol("page without questions");

async function readHtmlForm(o: ReadOptions, p: PostingRef, vendor: "breezy" | "pinpoint"): Promise<VendorForm | null | typeof PAGE_WITHOUT_QUESTIONS> {
  const posting = String(p.applyUrl ?? "");
  const domain = vendor === "breezy" ? "breezy.hr" : "pinpointhq.com";
  if (!posting || !onVendorDomain(posting, domain)) return null;
  const url = vendor === "breezy" ? breezyApplyUrl(posting) : pinpointApplyUrl(posting);
  const res = await get(o, url);
  if (!res) return null;
  let html = "";
  try { html = await res.text(); } catch { return null; }
  const raw = vendor === "breezy" ? parseBreezyQuestions(html) : parsePinpointQuestions(html);
  // Nothing found is equally consistent with a changed page: no form read,
  // but a page that was read.
  return finish(raw.map((q) => ({
    label: strip(q.label),
    required: q.required,
    type: q.type,
    ...(q.options ? { options: q.options } : {}),
    ...(q.hint ? { hint: strip(q.hint) } : {}),
  }))) ?? PAGE_WITHOUT_QUESTIONS;
}

/** The form a cached row holds, when it holds one in the shape this module writes. */
function formOfRow(row: FormCacheRow): VendorForm | null {
  const f = row.form as Partial<VendorForm> | null;
  if (!f || !Array.isArray(f.questions) || !Array.isArray(f.documents)) return null;
  return { questions: f.questions, documents: f.documents, alsoOnForm: Array.isArray(f.alsoOnForm) ? f.alsoOnForm : [] };
}

/**
 * The posting's application form, or the reason there is none. Never throws:
 * a fault of the vendor's is `unreachable`, and a fault of the cache is read
 * past (the vendor is asked) or written past (the answer is still returned).
 */
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
          return { kind: "absent", vendor, readAt: row.read_at, cached: true, ...(pageRead ? { pageRead: true as const } : {}) };
        }
      }
    } catch {
      // An unreadable cache is a slower answer, never a wrong one.
    }
  }

  let form: VendorForm | null;
  let pageRead = false;
  try {
    const got = vendor === "greenhouse" ? await readGreenhouse(o, p, ext)
      : vendor === "ashby" ? await readAshby(o, p, ext)
      : vendor === "recruitee" ? await readRecruitee(o, p, ext)
      : await readHtmlForm(o, p, vendor as "breezy" | "pinpoint");
    pageRead = got === PAGE_WITHOUT_QUESTIONS;
    form = got === PAGE_WITHOUT_QUESTIONS ? null : got;
  } catch (e) {
    if (e instanceof Transient) return { kind: "unreachable", vendor };
    return { kind: "unreachable", vendor };
  }
  const readAt = new Date(now()).toISOString();
  if (o.cache) {
    try { await o.cache.put(p.id, vendor, !!form, form ?? (pageRead ? { pageRead: true } : {})); } catch { /* the answer stands without the cache */ }
  }
  if (form) return { kind: "read", vendor, readAt, cached: false, form };
  return { kind: "absent", vendor, readAt, cached: false, ...(pageRead ? { pageRead: true as const } : {}) };
}
