/** MORE OF THE EMPLOYER'S FORM, READ WHERE ... docs/shared-notes.md#s34 */
import type { FormDocument, FormQuestion } from "./application-form.ts";

export type ParsedForm = { questions: FormQuestion[]; documents: FormDocument[]; alsoOnForm: string[] };

/** What a page carried beyond its questions. */
export type PageExtras = { documents: FormDocument[]; alsoOnForm: string[] };

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: "-", mdash: "-", hellip: "..." };

/** HTML entities decoded once (a decoded "&amp;quot;" stays "&quot;", never a quote). */
export function decodeHtml(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** Markup to one line of text. */
export function textOf(html: string): string {
  return decodeHtml(String(html ?? "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/** A balanced JSON object or array starting at `start`, or "" when it never closes. */
function balanced(s: string, start: number): string {
  const open = s[start];
  const close = open === "{" ? "}" : open === "[" ? "]" : "";
  if (!close) return "";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return "";
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const YES_NO = ["Yes", "No"];

/** At most this many options are listed; a ... docs/shared-notes.md#s35 */
const MAX_OPTIONS = 50;
const listOf = (xs: string[]): string[] | undefined => {
  const out = xs.map((x) => x.trim()).filter(Boolean);
  return out.length && out.length <= MAX_OPTIONS ? out : undefined;
};

const q = (label: string, required: boolean, type: string, options?: string[], hint?: string): FormQuestion => ({
  label, required, type,
  ...(options && options.length ? { options } : {}),
  ...(hint ? { hint } : {}),
});

const BREEZY_DOCS: ReadonlyArray<[string, string]> = [["resume", "Resume / CV"], ["cover_letter", "Cover letter"]];
const BREEZY_ALSO: ReadonlyArray<[string, string]> = [["work_history", "Work history"], ["education", "Education history"], ["preferred_location", "Preferred location"], ["salary", "Desired salary"]];

/** Breezy's apply page carries the ... docs/shared-notes.md#s36 */
export function parseBreezyFormConfig(html: string): PageExtras {
  const doc = decodeHtml(String(html ?? ""));
  const re = /"application_form"\s*:\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(doc)) !== null) {
    const slice = balanced(doc, m.index + m[0].length - 1);
    if (!slice) continue;
    let cfg: Record<string, unknown>;
    try { cfg = JSON.parse(slice); } catch { continue; }
    if (!cfg || typeof cfg !== "object" || !("resume" in cfg || "cover_letter" in cfg)) continue;
    const state = (k: string) => {
      const v = str(cfg[k]).toLowerCase();
      return v === "required" || v === "optional" ? v : null;
    };
    const documents: FormDocument[] = [];
    for (const [k, name] of BREEZY_DOCS) {
      const s = state(k);
      if (s) documents.push({ name, required: s === "required" });
    }
    const alsoOnForm: string[] = [];
    for (const [k, name] of BREEZY_ALSO) {
      const s = state(k);
      if (s) alsoOnForm.push(`${name} (${s})`);
    }
    return { documents, alsoOnForm };
  }
  return { documents: [], alsoOnForm: [] };
}

/** Pinpoint's apply page renders its ... docs/shared-notes.md#s37 */
export function parsePinpointExtras(html: string): PageExtras {
  const page = String(html ?? "");
  const alsoOnForm: string[] = [];
  const topics: string[] = [];
  const re = /data-component-name="External::Jobs::Equalitymonitoring::[^"]*"[^>]*>([\s\S]*?)<\/script>/g;
  let m: RegExpExecArray | null;
  let blocks = 0;
  while ((m = re.exec(page)) !== null) {
    blocks++;
    const id = /"id"\s*:\s*"application_form_equality_monitoring_([^"]{1,60})"/.exec(m[1]);
    const topic = id ? decodeHtml(id[1]).trim() : "";
    if (topic && !topics.includes(topic)) topics.push(topic);
  }
  if (blocks) alsoOnForm.push(`Voluntary equality-monitoring questions${topics.length ? ` (${topics.slice(0, 12).join(", ")})` : ""}: the person may answer or decline`);
  const consent = /<input[^>]*name="application\[process_information\]"[^>]*type="checkbox"[^>]*>|<input[^>]*type="checkbox"[^>]*name="application\[process_information\]"[^>]*>/.exec(page);
  if (consent) {
    const required = /\brequired\b/.test(consent[0]);
    const label = /<label[^>]*for="application_process_information"[^>]*>([\s\S]*?)<\/label>/.exec(page);
    const words = label ? textOf(label[1]).replace(/^\(\s*required\s*\)\s*/i, "").replace(/[\s*✱]+$/u, "").slice(0, 200) : "";
    alsoOnForm.push(`Data-protection consent${required ? " (required)" : ""}${words ? ` "${words}"` : ""}: the person ticks it`);
  }
  return { documents: [], alsoOnForm };
}

/** One DNS label: what a tenant token must be before it becomes a hostname. */
export const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

/** A Pinpoint posting on the employer's ... docs/shared-notes.md#s38 */
export function pinpointVendorPostingUrl(token: string, applyUrl: string): string | null {
  if (!HOST_LABEL.test(String(token ?? ""))) return null;
  let u: URL;
  try { u = new URL(String(applyUrl ?? "")); } catch { return null; }
  const path = u.pathname.replace(/\/+$/, "");
  if (!/^(?:\/[a-z]{2}(?:-[a-z]{2})?)?\/postings\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(path)) return null;
  return `https://${token.toLowerCase()}.pinpointhq.com${path}`;
}

/** Controls whose kind the field's own name settles; every other field's kind is left unstated rather than guessed. */
const PAYLOCITY_TYPES: Record<string, string> = {
  name: "text", emailAddress: "email", cellPhone: "phone", homePhone: "phone",
  address: "text", address2: "text", city: "text", postalCode: "text",
  dateAvailable: "date", dateOfBirth: "date", smsOptedIn: "boolean",
};
const PAYLOCITY_DOCS: Record<string, string> = { uploadCoverLetter: "Cover letter", uploadAdditionalFiles: "Additional files" };
/** Fields read by the group they head: the group's own head is the question. */
const PAYLOCITY_SUBFIELDS = new Set(["priorFelony", "priorMisdemeanor", "acknowledgementText"]);
const PAYLOCITY_ALSO: Record<string, string> = {
  eVerify: "An E-Verify notice",
  eeoGenderEthnicity: "Voluntary self-identification (EEO) questions",
  eeoDisability: "Voluntary disability self-identification (OFCCP)",
  ofccp: "Voluntary veteran self-identification (OFCCP)",
  acknowledgement: "An acknowledgement you sign before you submit",
};
/** Sections that repeat per entry (a job ... docs/shared-notes.md#s39 */
const PAYLOCITY_REPEATING = new Set(["workHistory", "educationHistory", "references"]);

type PlField = { name?: unknown; displayName?: unknown; isIncluded?: unknown; isRequired?: unknown; values?: unknown };
type PlSection = { name?: unknown; headingText?: unknown; isIncluded?: unknown; fields?: unknown };

/** The window.pageData object a Paylocity Apply page assigns, or null. */
function paylocityPageData(html: string): Record<string, unknown> | null {
  const page = String(html ?? "");
  const at = page.search(/window\.pageData\s*=/);
  if (at < 0) return null;
  const start = page.indexOf("{", at);
  if (start < 0) return null;
  const slice = balanced(page, start);
  if (!slice) return null;
  try {
    const data = JSON.parse(slice);
    return data && typeof data === "object" ? data as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** A Paylocity Apply page: the custom ... docs/shared-notes.md#s40 */
export function parsePaylocityForm(html: string): ParsedForm | null {
  const data = paylocityPageData(html);
  const cja = data?.customJobApplication as { sections?: unknown; requireResume?: unknown } | undefined;
  if (!data || !cja || !Array.isArray(cja.sections)) return null;
  const questions: FormQuestion[] = [];
  const documents: FormDocument[] = [];
  const alsoOnForm: string[] = [];
  const screenerAt = { at: -1 };
  for (const rawSection of cja.sections as PlSection[]) {
    if (rawSection?.isIncluded === false) continue;
    const section = str(rawSection?.name);
    const fields = (Array.isArray(rawSection?.fields) ? rawSection.fields : []) as PlField[];
    const included = fields.filter((f) => f?.isIncluded === true && str(f?.displayName));
    if (!included.length) continue;
    if (PAYLOCITY_REPEATING.has(section)) {
      const names = included.map((f) => `${textOf(str(f.displayName))}${f.isRequired === true ? " (required)" : ""}`);
      alsoOnForm.push(`${textOf(str(rawSection.headingText)) || section}: ${names.join(", ")}`.slice(0, 400));
      continue;
    }
    if (section === "expandedIdentityQuestions") {
      alsoOnForm.push(`Voluntary identity questions (${included.map((f) => textOf(str(f.displayName))).join(", ")}): the person may answer or decline`.slice(0, 400));
      continue;
    }
    for (const f of included) {
      const name = str(f.name);
      const label = textOf(str(f.displayName));
      const required = f.isRequired === true;
      if (PAYLOCITY_SUBFIELDS.has(name)) continue;
      if (PAYLOCITY_DOCS[name]) { documents.push({ name: PAYLOCITY_DOCS[name], required }); continue; }
      if (PAYLOCITY_ALSO[name]) { alsoOnForm.push(PAYLOCITY_ALSO[name]); continue; }
      const values = Array.isArray(f.values) ? (f.values as Array<{ label?: unknown; value?: unknown }>).map((v) => str(v?.label) || str(v?.value)) : [];
      const type = PAYLOCITY_TYPES[name] ?? (values.length ? "select" : "");
      const options = type === "boolean" ? YES_NO : listOf(values);
      questions.push(q(label, required, type, options));
    }
    if (section === "info") screenerAt.at = questions.length;
  }
  const requireResume = (data.requireResume ?? cja.requireResume) === true;
  documents.unshift({ name: "Resume / CV", required: requireResume });
  const screen: FormQuestion[] = [];
  const sq = (data.screener as { questions?: unknown } | null | undefined)?.questions;
  for (const raw of Array.isArray(sq) ? sq : []) {
    // Title, required, type, the answers' TITLES and whether it screens. Nothing else is read.
    const s = raw as { title?: unknown; isRequired?: unknown; questionType?: unknown; allowsMultipleResponses?: unknown; isAutoReject?: unknown; answers?: unknown };
    const label = textOf(str(s?.title));
    if (!label) continue;
    const answers = Array.isArray(s?.answers) ? (s.answers as Array<{ title?: unknown }>).map((a) => textOf(str(a?.title))) : [];
    const type = str(s?.questionType) + (s?.allowsMultipleResponses === true ? "_multiple" : "");
    screen.push({ ...q(label, s?.isRequired === true, type, listOf(answers)), ...(s?.isAutoReject === true ? { screens: true as const } : {}) });
  }
  const at = screenerAt.at < 0 ? questions.length : screenerAt.at;
  questions.splice(at, 0, ...screen);
  return { questions, documents, alsoOnForm: [...new Set(alsoOnForm)] };
}

type WkField = { id?: unknown; label?: unknown; required?: unknown; type?: unknown; helper?: unknown; options?: unknown; fields?: unknown };

/** Workable's form endpoint: sections of ... docs/shared-notes.md#s41 */
export function parseWorkableForm(body: unknown): ParsedForm | null {
  if (!Array.isArray(body)) return null;
  const questions: FormQuestion[] = [];
  const documents: FormDocument[] = [];
  const alsoOnForm: string[] = [];
  for (const section of body) {
    const fields = (section as { fields?: unknown })?.fields;
    for (const raw of (Array.isArray(fields) ? fields : []) as WkField[]) {
      const label = textOf(str(raw?.label));
      if (!label) continue;
      const type = str(raw?.type).toLowerCase();
      const required = raw?.required === true;
      if (type === "file") { documents.push({ name: label, required }); continue; }
      if (type === "group") {
        const sub = (Array.isArray(raw?.fields) ? raw.fields : []) as WkField[];
        alsoOnForm.push(`${label} (${required ? "required" : "optional"}): ${sub.map((f) => textOf(str(f?.label))).filter(Boolean).join(", ")}`.slice(0, 400));
        continue;
      }
      const options = type === "boolean"
        ? YES_NO
        : listOf((Array.isArray(raw?.options) ? raw.options : []).map((o: unknown) => str((o as { value?: unknown })?.value) || str((o as { name?: unknown })?.name)));
      questions.push(q(label, required, type, options, textOf(str(raw?.helper)) || undefined));
    }
  }
  if (!questions.length && !documents.length) return null;
  return { questions, documents, alsoOnForm };
}

/** A label or legend's own words: the required star and the screen-reader "required" removed. */
function labelWords(inner: string): string {
  return textOf(inner.replace(/<sup[\s\S]*?<\/sup>/gi, " ").replace(/<span[^>]*class="[^"]*\bsr-only\b[^"]*"[^>]*>[\s\S]*?<\/span>/gi, " "));
}

/** Teamtailor's /applications/new page ... docs/shared-notes.md#s42 */
export function parseTeamtailorForm(html: string): ParsedForm | null {
  const page = String(html ?? "");
  const start = page.search(/<form[^>]*id="job-application-form"/);
  if (start < 0) return null;
  const end = page.indexOf("</form>", start);
  const form = page.slice(start, end < 0 ? undefined : end);
  const questions: FormQuestion[] = [];
  const marks = [...form.matchAll(/data-question-mandatory="(true|false)"(?:\s+data-question-multiple-choice="(true|false)")?/g)];
  for (let i = 0; i < marks.length; i++) {
    const block = form.slice(marks[i].index!, i + 1 < marks.length ? marks[i + 1].index! : undefined);
    const answer = /name="candidate\[answers_attributes\]\[(\d+)\]\[(?!question_id|picked_question_id)(\w+)\]/.exec(block);
    if (!answer) continue;
    const [, n, kind] = answer;
    // The question's own words come before ... docs/shared-notes.md#s43
    const head = block.slice(0, answer.index);
    const close = block.indexOf("</fieldset>", answer.index);
    const body = block.slice(answer.index, close < 0 ? undefined : close);
    const legend = /<legend[^>]*>([\s\S]*?)<\/legend>/.exec(head);
    const label = legend ? null : new RegExp(`<label[^>]*for="candidate_answers_attributes_${n}_\\w+"[^>]*>([\\s\\S]*?)</label>`).exec(block);
    let words = "";
    let hint = "";
    if (legend) {
      const hintDiv = /<div[^>]*>([\s\S]*?)<\/div>/.exec(legend[1]);
      hint = hintDiv ? textOf(hintDiv[1]) : "";
      words = labelWords(hintDiv ? legend[1].replace(hintDiv[0], " ") : legend[1]);
    } else if (label) {
      words = labelWords(label[1]);
    }
    if (!words) continue;
    const required = marks[i][1] === "true";
    const many = marks[i][2] === "true";
    let type = kind;
    let options: string[] | undefined;
    if (kind === "text") {
      type = new RegExp(`<textarea[^>]*name="candidate\\[answers_attributes\\]\\[${n}\\]\\[text\\]"`).test(block) ? "textarea" : "text";
    } else if (kind === "choice" || kind === "boolean") {
      const sel = /<select[\s\S]*?<\/select>/.exec(body);
      if (sel) {
        type = "select";
        options = listOf([...sel[0].matchAll(/<option[^>]*value="([^"]+)"[^>]*>([\s\S]*?)<\/option>/g)].map((o) => textOf(o[2])));
      } else {
        type = kind === "boolean" ? "boolean" : many ? "checkbox" : "radio";
        options = listOf([...body.matchAll(/<label[^>]*for="(?:candidate_answers_attributes_\d+_choice_\w+|boolean-[\w-]+)"[^>]*>([\s\S]*?)<\/label>/g)].map((o) => textOf(o[1])));
      }
    }
    questions.push(q(words, required, type, options, hint || undefined));
  }
  // The locations the person picks from: the fieldset that holds the location boxes.
  const locAt = form.indexOf('name="candidate[location_ids][]"');
  if (locAt >= 0) {
    const from = form.lastIndexOf("<fieldset", locAt);
    const to = form.indexOf("</fieldset>", locAt);
    const set = from >= 0 ? form.slice(from, to < 0 ? undefined : to) : "";
    const legend = /<legend[^>]*>([\s\S]*?)<\/legend>/.exec(set);
    const options = listOf([...set.matchAll(/<label[^>]*for="candidate_location_ids_\d+"[^>]*>([\s\S]*?)<\/label>/g)].map((o) => textOf(o[1])));
    if (legend) questions.push(q(labelWords(legend[1]) || "Locations", /data-asterisk="true"/.test(legend[1]), "checkbox", options));
  }
  const cover = /<label[^>]*for="candidate_job_applications_attributes_0_cover_letter"[^>]*>([\s\S]*?)<\/label>/.exec(form);
  if (cover) questions.push(q(labelWords(cover[1]) || "Cover letter", /data-asterisk="true"/.test(cover[1]), "textarea"));
  const documents: FormDocument[] = [];
  const cv = /<div[^>]*data-forms--inputs--upload-required-value="(true|false)"[^>]*id="upload_resume_field"[^>]*>[\s\S]*?<label[^>]*>([\s\S]*?)<\/label>/.exec(form);
  if (cv) documents.push({ name: labelWords(cv[2]) || "Resume / CV", required: cv[1] === "true" });
  const more = /<label[^>]*for="candidate_file_remote_url"[^>]*>([\s\S]*?)<\/label>/.exec(form);
  if (more) documents.push({ name: labelWords(more[1]) || "Additional files", required: false });
  const alsoOnForm: string[] = [];
  if (/name="candidate\[consent_given\]"/.test(form)) alsoOnForm.push("A privacy statement you accept by submitting: read it on the form");
  if (!questions.length && !documents.length) return null;
  return { questions, documents, alsoOnForm };
}

type LvField = { type?: unknown; text?: unknown; description?: unknown; required?: unknown; options?: unknown };

/** Lever's /apply page carries each custom ... docs/shared-notes.md#s44 */
export function parseLeverForm(html: string): ParsedForm | null {
  const page = String(html ?? "");
  if (!/<form[^>]*/.test(page) || !/name="resume"/.test(page)) return null;
  const questions: FormQuestion[] = [];
  const documents: FormDocument[] = [];
  const resume = /<li[^>]*class="[^"]*application-question[^"]*\bresume\b[^"]*"[^>]*>[\s\S]*?<div[^>]*class="application-label"[^>]*>([\s\S]*?)<\/div>/.exec(page);
  documents.push({ name: "Resume / CV", required: !!resume && /class="required"/.test(resume[1]) });
  for (const m of page.matchAll(/<input[^>]*type="hidden"[^>]*value="([^"]*)"[^>]*name="cards\[[0-9a-f-]+\]\[baseTemplate\]"/g)) {
    let card: { fields?: unknown };
    try { card = JSON.parse(decodeHtml(m[1])); } catch { continue; }
    for (const raw of (Array.isArray(card?.fields) ? card.fields : []) as LvField[]) {
      const label = textOf(str(raw?.text));
      if (!label) continue;
      const type = str(raw?.type);
      const required = raw?.required === true;
      if (/file/i.test(type)) { documents.push({ name: label, required }); continue; }
      const options = listOf((Array.isArray(raw?.options) ? raw.options : []).map((o: unknown) => textOf(str((o as { text?: unknown })?.text))));
      questions.push(q(label, required, type, options, textOf(str(raw?.description)) || undefined));
    }
  }
  const alsoOnForm: string[] = [];
  if (/name="eeo\[/.test(page)) alsoOnForm.push("Voluntary self-identification (EEO) questions");
  if (/name="surveysResponses/.test(page)) alsoOnForm.push("A voluntary survey");
  if (/name="consent\[/.test(page)) alsoOnForm.push("Data-protection consent: the person ticks it");
  return { questions, documents, alsoOnForm };
}

const BAMBOO_TYPES: Record<string, string> = {
  firstName: "text", lastName: "text", email: "email", phone: "phone", streetAddress: "text", city: "text", zip: "text",
  state: "select", countryId: "select", educationLevelId: "select", dateAvailable: "date",
};
const BAMBOO_DOCS: Record<string, string> = { resumeFileId: "Resume / CV", coverLetterFileId: "Cover letter" };
const BAMBOO_EEO = new Set(["genderId", "ethnicityId", "veteranStatusId", "disabilityId"]);

type BhField = { isRequired?: unknown; label?: unknown; options?: unknown };
type BhCustom = { question?: unknown; isRequired?: unknown; type?: unknown; options?: unknown };

/** BambooHR's /careers/{id}/detail JSON ... docs/shared-notes.md#s45 */
export function parseBambooForm(body: unknown): ParsedForm | null {
  const result = (body as { result?: { jobOpening?: { jobOpeningStatus?: unknown }; formFields?: unknown } } | null)?.result;
  const ff = result?.formFields as Record<string, unknown> | undefined;
  if (!ff || typeof ff !== "object") return null;
  const status = str(result?.jobOpening?.jobOpeningStatus);
  if (status && status.toLowerCase() !== "open") return null;
  const questions: FormQuestion[] = [];
  const documents: FormDocument[] = [];
  const alsoOnForm: string[] = [];
  const custom: FormQuestion[] = [];
  for (const [key, raw] of Object.entries(ff)) {
    if (key === "customQuestions") {
      for (const c of (Array.isArray(raw) ? raw : []) as BhCustom[]) {
        const label = textOf(str(c?.question));
        if (!label) continue;
        const type = str(c?.type);
        const options = /^yes_?no$/i.test(type)
          ? YES_NO
          : listOf((Array.isArray(c?.options) ? c.options : []).map((o: unknown) => textOf(str((o as { option?: unknown })?.option))));
        custom.push(q(label, c?.isRequired === true, type, options));
      }
      continue;
    }
    if (BAMBOO_EEO.has(key)) {
      if (raw && typeof raw === "object" && !Array.isArray(raw)) alsoOnForm.push("Voluntary self-identification (EEO) questions");
      continue;
    }
    const f = raw as BhField;
    if (!f || typeof f !== "object" || Array.isArray(f)) continue;
    const label = textOf(str(f.label));
    if (!label) continue;
    const required = f.isRequired === true;
    if (BAMBOO_DOCS[key]) { documents.push({ name: BAMBOO_DOCS[key], required }); continue; }
    const options = listOf((Array.isArray(f.options) ? f.options : []).map((o: unknown) => textOf(str((o as { text?: unknown })?.text))));
    questions.push(q(label, required, BAMBOO_TYPES[key] ?? "", options));
  }
  questions.push(...custom);
  if (!questions.length && !documents.length) return null;
  return { questions, documents, alsoOnForm: [...new Set(alsoOnForm)] };
}
