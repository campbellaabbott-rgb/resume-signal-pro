export type HarvestedQuestion = {
  label: string;
  required: boolean;
  type: string;
};
const applyBase = (postingUrl: string) =>
  postingUrl.replace(/[?#].*$/, "").replace(/\/+$/, "");
export const breezyApplyUrl = (postingUrl: string) => `${applyBase(postingUrl)}/apply`;
export const pinpointApplyUrl = (postingUrl: string) => `${applyBase(postingUrl)}/applications/new`;
function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
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