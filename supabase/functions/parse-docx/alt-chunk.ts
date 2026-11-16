/**
 * A WEB PAGE EMBEDDED IN A .DOCX, AS LINES (S14X-281, C-S14-131).
 *
 * HTML-to-Word converters (html-docx-js and its kind, and the résumé sites
 * built on them) write a document whose body is a w:altChunk: a pointer to an
 * embedded page, usually a MIME (.mht) message holding quoted-printable HTML.
 * Word renders it; mammoth has no reader for it, so the upload read as empty.
 * This turns that part into the page's lines: the MIME wrapper is opened, the
 * transfer encoding and the charset decoded, and the HTML read with block
 * elements as line breaks, head, script, style and comments dropped, and
 * entities decoded.
 *
 * Written for this purpose rather than borrowed from the job board's HTML
 * reader, so the board's modules stay out of the parsers. Plain TypeScript
 * with no imports.
 */

// Latin-1 letters by entity name, U+00C0 to U+00FF in order.
const LATIN1 =
  "Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml";
const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", shy: "­", ndash: "–", mdash: "—",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", bull: "•", middot: "·", hellip: "…",
  copy: "©", reg: "®", trade: "™", euro: "€", pound: "£", deg: "°",
};
LATIN1.split(" ").forEach((name, i) => { NAMED[name] = String.fromCharCode(0xc0 + i); });

export function decodeEntities(s: string): string {
  return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]*);/g, (m, e: string) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return NAMED[e] ?? NAMED[e.toLowerCase()] ?? m;
  });
}

const BLOCK = /<\/?(?:p|div|br|li|h[1-6]|tr|table|ul|ol|dl|dt|dd|section|article|header|footer|blockquote|pre|hr|address)\b[^>]*>/gi;

/** An HTML page's visible text, one line per block element. */
export function htmlLines(html: string): string[] {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(head|script|style|title|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(?:td|th)\b[^>]*>/gi, " ")
    .replace(BLOCK, "\n")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(text).split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/** Bytes as a string of the same code units, so a MIME message can be cut without decoding it. */
function raw(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return s;
}
const bytesOf = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

function quotedPrintable(s: string): Uint8Array {
  const t = s.replace(/=\r?\n/g, "");
  const out: number[] = [];
  for (let i = 0; i < t.length; i++) {
    const hex = t.slice(i + 1, i + 3);
    if (t[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(hex)) { out.push(parseInt(hex, 16)); i += 2; } else out.push(t.charCodeAt(i) & 0xff);
  }
  return new Uint8Array(out);
}

const base64 = (s: string): Uint8Array => bytesOf(atob(s.replace(/[^A-Za-z0-9+/=]/g, "")));

/** The page's text from its bytes: a byte-order mark, the charset the message or the page declares, else UTF-8, else windows-1252. */
function decodeHtml(bytes: Uint8Array, declared: string | null): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  const meta = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(raw(bytes.subarray(0, 4096)))?.[1] ?? null;
  for (const label of [declared, meta]) {
    if (!label) continue;
    try { return new TextDecoder(label).decode(bytes); } catch { /* a label this runtime does not know */ }
  }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return new TextDecoder("windows-1252").decode(bytes); }
}

/** Header block and body of one MIME entity; folded header lines unfolded. */
function entity(s: string): { headers: string; body: string } {
  const m = /\r?\n\r?\n/.exec(s);
  if (!m) return { headers: s.replace(/\r?\n[ \t]+/g, " "), body: "" };
  return { headers: s.slice(0, m.index).replace(/\r?\n[ \t]+/g, " "), body: s.slice(m.index + m[0].length) };
}
const header = (headers: string, name: string) => new RegExp(`^${name}\\s*:\\s*(.*)$`, "im").exec(headers)?.[1] ?? "";
const param = (value: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*"?([^";]+)"?`, "i").exec(value)?.[1]?.trim() ?? null;

/** The HTML of a MIME message: its first text/html part (or its only part), decoded. */
function mimeHtml(message: string): string {
  const top = entity(message);
  const type = header(top.headers, "Content-Type");
  const boundary = param(type, "boundary");
  let parts = [top];
  if (boundary) {
    parts = top.body.split(`--${boundary}`).slice(1).filter((p) => !p.startsWith("--")).map((p) => entity(p.replace(/^\r?\n/, "")));
  }
  const part = parts.find((p) => /text\/html/i.test(header(p.headers, "Content-Type"))) ?? parts[0];
  if (!part) return "";
  const encoding = header(part.headers, "Content-Transfer-Encoding").trim().toLowerCase();
  const body = encoding === "quoted-printable" ? quotedPrintable(part.body) : encoding === "base64" ? base64(part.body) : bytesOf(part.body);
  return decodeHtml(body, param(header(part.headers, "Content-Type"), "charset"));
}

/** The lines of an altChunk part: a MIME (.mht) message, or a bare HTML page. */
export function altChunkLines(bytes: Uint8Array): string[] {
  const start = raw(bytes.subarray(0, 512));
  if (/^\s*(?:MIME-Version|Content-Type|Content-Transfer-Encoding|Content-Location)\s*:/i.test(start)) return htmlLines(mimeHtml(raw(bytes)));
  return htmlLines(decodeHtml(bytes, null));
}
