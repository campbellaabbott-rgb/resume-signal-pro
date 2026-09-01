/**
 * Reading an employer's REAL application questions out of Breezy and Pinpoint.
 *
 * WHY THIS EXISTS — a measured inversion. `realQuestions` was true for exactly
 * three vendors: teamtailor, ashby and greenhouse. Ashby is 60/60 CAPTCHA and
 * Greenhouse is invisible reCAPTCHA Enterprise, so the agent was harvesting the
 * real form for TWO VENDORS IT CANNOT DRIVE, and none for breezy, personio and
 * pinpoint — three of the four it can.
 *
 * The consequence was visible in a live dry run on 2026-08-01. With a complete
 * profile, a Breezy posting still refused with four blockers and a Pinpoint one
 * with a single blocker, and every one of them was employer-specific prose:
 *
 *     "Walk me through your last role where you were directly responsible…"
 *     "What was your average close rate across your team…"
 *
 * Those are exactly what `generate-application-answers` already drafts from the
 * résumé with a `supported` flag, and what `buildPacket` already consumes as
 * `drafted`. The drafting was never the missing piece. The HARVEST was: with
 * `realQuestions: false`, apply-agent falls back to four generic questions
 * (name, email, phone, résumé), never sees the employer's real form, and the
 * worker meets the questions cold and refuses.
 *
 * WHY SERVER-SIDE PARSING IS POSSIBLE AT ALL. Both vendors render their apply
 * form on the server. That is not obvious and I got it wrong once: probing
 * Pinpoint's POSTING page found nothing and I nearly recorded it as JS-only.
 * The questions live on the APPLY route — the same URL the worker's adapter
 * already navigates to — where all 19 of them are in the HTML. Probing the
 * wrong URL and concluding "not available" is the same mistake as querying the
 * wrong parameter and concluding "no rows".
 *
 * Personio is deliberately absent. Its apply route IS server-rendered but
 * contains no <label> elements at all, and the same dry run measured ZERO
 * required questions beyond the adapter's own fields — so there is nothing here
 * worth harvesting, and a parser would be code maintained for no yield.
 */

export type HarvestedQuestion = {
  label: string;
  required: boolean;
  /** The vendor's own type name, passed to classifyQuestion by the caller. */
  type: string;
};

/**
 * The apply routes, derived from the POSTING'S OWN URL — never rebuilt from the
 * id.
 *
 * The first version of this took `(token, externalId)` and composed the path.
 * It worked for Breezy and 404'd on 8 of 8 live Pinpoint boards, because
 * Pinpoint's `id` is a numeric key (`505393`) while its apply path uses an
 * unrelated UUID (`ac538c02-…`). The two are not derivable from each other, and
 * nothing about the id says so.
 *
 * The stored `apply_url` is the same value the worker's adapter navigates to,
 * which is the property that actually matters: harvesting one form and filling
 * a different one would put confident answers to unasked questions into a
 * packet, and nobody would see it happen. Deriving both from one source makes
 * that impossible rather than merely unlikely.
 *
 * Both mirror their adapter's own rule — `resolveFormUrl` strips query/hash and
 * trailing slashes before appending, so the same input yields the same URL on
 * both sides.
 */
const applyBase = (postingUrl: string) =>
  postingUrl.replace(/[?#].*$/, "").replace(/\/+$/, "");

export const breezyApplyUrl = (postingUrl: string) => `${applyBase(postingUrl)}/apply`;
export const pinpointApplyUrl = (postingUrl: string) => `${applyBase(postingUrl)}/applications/new`;

/**
 * Breezy embeds its questionnaire as JSON inside an HTML attribute, so every
 * quote arrives as `&quot;`. Decode enough to parse it — and decode `&amp;`
 * LAST, because doing it first turns `&amp;quot;` into a quote that was never
 * meant to be one.
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Walk a balanced `[...]` from `start`. Returns the slice, or "" if unbalanced
 *  — a truncated payload must fail closed rather than yield half a form. */
function balancedArray(s: string, start: number): string {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return "";
}

/**
 * Breezy: `"questions":[{ "text": …, "required": …, "type": { "id": … } }]`
 *
 * There can be more than one `"questions":[` in the document, so each candidate
 * is parsed and only a question-SHAPED one is accepted. Matching the first
 * occurrence and trusting it is how a parser silently returns a nav menu.
 */
export function parseBreezyQuestions(html: string): HarvestedQuestion[] {
  const doc = decodeEntities(html);
  const re = /"questions"\s*:\s*\[/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(doc)) !== null) {
    const slice = balancedArray(doc, m.index + m[0].length - 1);
    if (!slice) continue;
    let arr: unknown;
    try { arr = JSON.parse(slice); } catch { continue; }
    if (!Array.isArray(arr)) continue;
    const out: HarvestedQuestion[] = [];
    for (const raw of arr) {
      const q = raw as { text?: unknown; required?: unknown; type?: { id?: unknown } };
      const label = String(q?.text ?? "").trim();
      if (!label) continue;
      out.push({ label, required: q?.required === true, type: String(q?.type?.id ?? "") });
    }
    if (out.length) return out;
  }
  return [];
}

/**
 * Pinpoint is react-on-rails: every question is its own
 * `<script type="application/json" class="js-react-on-rails-component"
 *  data-component-name="Shared::Form::Questions::…">` carrying
 * `questionDetails: { title, questionType, required }`.
 *
 * Filtering on `Form::Questions::` matters — the page ships many other
 * react-on-rails components (headers, file inputs, consent widgets), and
 * treating all of them as questions would put UI furniture in front of a
 * candidate as though an employer had asked it.
 */
export function parsePinpointQuestions(html: string): HarvestedQuestion[] {
  const re = /<script[^>]*class="[^"]*js-react-on-rails-component[^"]*"[^>]*data-component-name="([^"]+)"[^>]*>([\s\S]*?)<\/script>/g;
  const out: HarvestedQuestion[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (!m[1].includes("Form::Questions::")) continue;
    let parsed: { questionDetails?: { title?: unknown; questionType?: unknown; required?: unknown } };
    try { parsed = JSON.parse(m[2]); } catch { continue; }
    const qd = parsed?.questionDetails;
    const label = String(qd?.title ?? "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push({
      label,
      required: qd?.required === true,
      type: String(qd?.questionType ?? ""),
    });
  }
  return out;
}
