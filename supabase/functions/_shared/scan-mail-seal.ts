/**
 * THE SENTENCES IN A REPORT MAIL ARE OURS, AND THIS IS HOW THE MAILER KNOWS.
 *
 * send-scan-report ("email me my report") is called by the browser after a
 * free scan, which has no account and stores nothing server-side, so the
 * report's sentences (the verdict, the top issues, the fix-plan steps, the
 * occupation name) arrive in the request body. Before 2026-10-04 the mailer
 * printed whatever sentences the body held, from our verified domain, to
 * whatever address the body named: a stranger could write their own text into
 * a mail that passes SPF and DKIM for resumebooster.work.
 *
 * Now free-keyword-scan seals the sentences it produced -- an HMAC under a key
 * only our functions hold -- and returns the seal in reportMeta.mailSeal. The
 * mailer prints a sentence only when the seal matches; without it, the mail
 * carries the numbers and our own copy and nothing a caller wrote.
 *
 * The canonical text is built by ONE function used on both sides, so the
 * scanner and the mailer can never disagree about what was sealed. It covers
 * exactly what the mail prints: the verdict, the first three issues, the first
 * eight steps, the occupation name and the report id. Numbers are not sealed:
 * the mailer clamps every one of them, and a number carries no message.
 */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** The text a seal covers, as one string. Anything that is not a string counts as "". */
export function scanMailText(r: Record<string, unknown>): string {
  const flags = Array.isArray(r.redFlags) ? r.redFlags.slice(0, 3).map((f) => (isObj(f) ? str(f.issue) : "")) : [];
  const fr = isObj(r.fixRoadmap) ? r.fixRoadmap : null;
  const steps = fr && Array.isArray(fr.steps) ? fr.steps.slice(0, 8).map((s) => (isObj(s) ? str(s.step) : "")) : [];
  const occupation = isObj(r.keywordSource) ? str(r.keywordSource.occupation) : "";
  return JSON.stringify(["scan-mail.1", str(r.verdict), flags, steps, occupation, str(r.reportId)]);
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(`scan-mail-seal:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The seal for a report's sentences; "" when there is no usable key. */
export async function sealScanMail(secret: string, r: Record<string, unknown>): Promise<string> {
  if (!secret || secret.length < 32) return "";
  return hmacHex(secret, scanMailText(r));
}

/** True only when `seal` is the seal of exactly these sentences under `secret`. Constant-time. */
export async function scanMailSealValid(secret: string, r: Record<string, unknown>, seal: unknown): Promise<boolean> {
  if (typeof seal !== "string" || !/^[0-9a-f]{64}$/.test(seal)) return false;
  const want = await sealScanMail(secret, r);
  if (want.length !== seal.length) return false;
  let d = 0;
  for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ seal.charCodeAt(i);
  return d === 0;
}

/**
 * The scanner's half: write the seal into a finished report's reportMeta, in
 * place. The report keys are free-keyword-scan's response names (reportVerdict
 * is the mail's verdict, reportMeta.reportId its report id). Never throws: a
 * report without a seal still renders, and its mail carries the numbers only.
 */
export async function attachScanMailSeal(report: Record<string, unknown>, secret: string): Promise<void> {
  try {
    const meta = isObj(report.reportMeta) ? report.reportMeta : null;
    if (!meta) return;
    const seal = await sealScanMail(secret, {
      verdict: report.reportVerdict,
      redFlags: report.redFlags,
      fixRoadmap: report.fixRoadmap,
      keywordSource: report.keywordSource,
      reportId: meta.reportId,
    });
    if (seal) meta.mailSeal = seal;
  } catch (e) {
    console.warn("[SCAN-MAIL-SEAL] could not seal the report (its mail will carry the numbers only):", e instanceof Error ? e.message : String(e));
  }
}
